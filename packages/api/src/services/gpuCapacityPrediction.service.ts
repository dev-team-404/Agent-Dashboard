/**
 * GPU Capacity Prediction Service
 *
 * 매일 새벽 1시(KST) 실행:
 * 1. 현재 사용량 데이터 수집 (UsageLog, RequestLog, GpuMetricSnapshot)
 * 2. 목표 인원(기본 15,000명) 스케일업 예측 (보수적)
 * 3. 필요 GPU 수 계산 + B300 기준 부족분
 * 4. 시스템 LLM으로 분석 리포트 생성 (논리+계산 근거 포함)
 */

import { prisma } from '../index.js';
import { B300_SPEC, lookupGpuSpec, calcTheoreticalMaxTps, estimateModelParams } from './gpuMonitor.service.js';

const INTERVAL_MS = 60 * 60 * 1000;
const LLM_TIMEOUT_MS = 120_000;
const SAFETY_MARGIN = 1.3;
const SUBLINEAR_SCALE = 0.7; // DAU/총인원 비율은 규모 커질수록 감소

let interval: ReturnType<typeof setInterval> | null = null;
let lastRunDate = '';

// ================================================================
// LLM 호출 (aiEstimation 패턴 동일)
// ================================================================
async function callSystemLlm(
  model: { name: string; endpointUrl: string; apiKey: string | null; extraHeaders: unknown; extraBody: unknown },
  systemPrompt: string, userPrompt: string,
): Promise<string> {
  let url = model.endpointUrl.trim();
  if (!url.endsWith('/chat/completions')) url = `${url.replace(/\/$/, '')}/chat/completions`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (model.apiKey) headers['Authorization'] = `Bearer ${model.apiKey}`;
  if (model.extraHeaders && typeof model.extraHeaders === 'object') {
    for (const [k, v] of Object.entries(model.extraHeaders as Record<string, string>)) {
      if (!['content-type', 'authorization'].includes(k.toLowerCase())) headers[k] = v;
    }
  }

  const body = {
    ...(model.extraBody && typeof model.extraBody === 'object' ? model.extraBody : {}),
    model: model.name,
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    max_tokens: 4096,
    temperature: 0.2,
    stream: false,
  };

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
    clearTimeout(tid);
    if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text().catch(() => '')).substring(0, 300)}`);
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content || '';
  } catch (err) { clearTimeout(tid); throw err; }
}

// ================================================================
// 핵심 예측 로직
// ================================================================
export async function runGpuCapacityPrediction(): Promise<any> {
  console.log('[GPU Capacity] Starting prediction...');

  // ── 1. 설정 로드 ──
  const targetSetting = await prisma.systemSetting.findUnique({ where: { key: 'GPU_CAPACITY_TARGET_USERS' } });
  const targetUserCount = parseInt(targetSetting?.value || '15000', 10);

  // ── 2. 사용량 데이터 수집 (최근 5영업일) ──
  const holidays = await prisma.holiday.findMany({ where: { date: { gte: new Date(Date.now() - 30 * 86400000) } } });
  const holidaySet = new Set(holidays.map(h => h.date.toISOString().split('T')[0]));

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);

  // 고유 사용자 수 (30일)
  const userCountResult = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(DISTINCT user_id) as count FROM usage_logs
    WHERE timestamp >= ${thirtyDaysAgo} AND user_id IS NOT NULL`;
  const currentUsers = Number(userCountResult[0]?.count || 0);

  // 일별 통계 (최근 7일)
  const dailyStats = await prisma.$queryRaw<Array<{ day: string; dau: bigint; total_tokens: bigint; total_requests: bigint }>>`
    SELECT DATE(timestamp) as day,
           COUNT(DISTINCT user_id) as dau,
           SUM(COALESCE(input_tokens,0) + COALESCE(output_tokens,0)) as total_tokens,
           COUNT(*) as total_requests
    FROM usage_logs
    WHERE timestamp >= ${sevenDaysAgo} AND user_id IS NOT NULL
    GROUP BY DATE(timestamp)
    ORDER BY day DESC`;

  // 영업일만 필터
  const bizDays = dailyStats.filter(d => {
    const date = new Date(d.day + 'T00:00:00+09:00');
    const dow = date.getDay();
    return dow !== 0 && dow !== 6 && !holidaySet.has(d.day);
  }).slice(0, 5);

  const currentDau = bizDays.length > 0 ? bizDays.reduce((s, d) => s + Number(d.dau), 0) / bizDays.length : 1;
  const avgTokensPerDay = bizDays.length > 0 ? bizDays.reduce((s, d) => s + Number(d.total_tokens), 0) / bizDays.length : 0;
  const avgRequestsPerDay = bizDays.length > 0 ? bizDays.reduce((s, d) => s + Number(d.total_requests), 0) / bizDays.length : 0;
  const avgTokensPerUser = currentDau > 0 ? avgTokensPerDay / currentDau : 0;
  const avgRequestsPerUser = currentDau > 0 ? avgRequestsPerDay / currentDau : 0;

  // 평균 레이턴시
  const latencyResult = await prisma.$queryRaw<[{ avg_ms: number | null }]>`
    SELECT AVG(latency_ms) as avg_ms FROM request_logs
    WHERE status_code < 400 AND timestamp >= ${sevenDaysAgo} AND latency_ms IS NOT NULL`;
  const avgLatencyMs = latencyResult[0]?.avg_ms || null;

  // ── 3. GPU 메트릭 수집 ──
  const KST_OFFSET = 9 * 60 * 60 * 1000;
  const snapshots = await prisma.gpuMetricSnapshot.findMany({
    where: { timestamp: { gte: sevenDaysAgo } },
    select: { gpuMetrics: true, llmMetrics: true, timestamp: true },
  });

  // 피크 동시 요청 (P95)
  const concurrents: number[] = [];
  let totalGpuUtil = 0, gpuUtilCount = 0;
  let totalKvCache = 0, kvCacheCount = 0;
  let totalThroughput = 0, tpCount = 0;

  for (const snap of snapshots) {
    const kstHour = new Date(snap.timestamp.getTime() + KST_OFFSET).getUTCHours();
    const isBiz = kstHour >= 9 && kstHour < 18;

    const llms = snap.llmMetrics as any[];
    if (Array.isArray(llms)) {
      const concurrent = llms.reduce((s: number, l: any) => s + (l.runningRequests || 0) + (l.waitingRequests || 0), 0);
      if (concurrent > 0) concurrents.push(concurrent);

      if (isBiz) {
        for (const l of llms) {
          if (l.kvCacheUsagePct != null) { totalKvCache += l.kvCacheUsagePct; kvCacheCount++; }
          const tp = (l.promptThroughputTps || 0) + (l.genThroughputTps || 0);
          if (tp > 0) { totalThroughput += tp; tpCount++; }
        }
      }
    }

    const gpus = snap.gpuMetrics as any[];
    if (Array.isArray(gpus) && isBiz) {
      for (const g of gpus) { totalGpuUtil += g.utilGpu || 0; gpuUtilCount++; }
    }
  }

  concurrents.sort((a, b) => a - b);
  const p95Idx = Math.floor(concurrents.length * 0.95);
  const peakConcurrent = concurrents.length > 0 ? concurrents[Math.min(p95Idx, concurrents.length - 1)] : 0;
  const avgGpuUtil = gpuUtilCount > 0 ? totalGpuUtil / gpuUtilCount : null;
  const avgKvCache = kvCacheCount > 0 ? totalKvCache / kvCacheCount : null;
  const avgThroughput = tpCount > 0 ? totalThroughput / tpCount : 0;

  // ── 4. GPU 인벤토리 ──
  const servers = await prisma.gpuServer.findMany({ where: { enabled: true } });
  const latestSnaps = await prisma.gpuMetricSnapshot.findMany({
    where: { serverId: { in: servers.map(s => s.id) } },
    orderBy: { timestamp: 'desc' },
    distinct: ['serverId'],
    select: { serverId: true, gpuMetrics: true, llmMetrics: true },
  });

  const inventoryMap = new Map<string, { count: number; vramGb: number; spec: any }>();
  let totalVramGb = 0;
  let detectedModelName: string | null = null;

  for (const snap of latestSnaps) {
    const gpus = snap.gpuMetrics as any[];
    if (!Array.isArray(gpus)) continue;
    for (const g of gpus) {
      const spec = lookupGpuSpec(g.name);
      const label = spec?.label || g.name;
      const vram = (g.memTotalMb || 0) / 1024;
      totalVramGb += vram;
      const existing = inventoryMap.get(label) || { count: 0, vramGb: spec?.vramGb || vram, spec };
      existing.count++;
      inventoryMap.set(label, existing);
    }
    // 모델명 탐지
    const llms = snap.llmMetrics as any[];
    if (Array.isArray(llms) && llms.length > 0 && !detectedModelName) {
      detectedModelName = llms[0]?.modelNames?.[0] || null;
    }
  }

  const gpuInventory = Array.from(inventoryMap.entries()).map(([type, v]) => ({ type, count: v.count, vramGb: v.vramGb }));
  const totalGpuCount = gpuInventory.reduce((s, g) => s + g.count, 0);

  // ── 5. 예측 계산 ──
  const dauRatio = currentUsers > 0 ? currentDau / currentUsers : 0.3;
  const targetDau = targetUserCount * dauRatio * SUBLINEAR_SCALE;
  const scalingFactor = currentDau > 0 ? targetDau / currentDau : targetUserCount / Math.max(currentUsers, 1);

  // Method A: KV Cache 기반 VRAM 스케일링
  const kvVramCurrent = avgKvCache != null && avgKvCache > 0 ? (avgKvCache / 100) * totalVramGb : totalVramGb * 0.5;
  const kvVramPredicted = kvVramCurrent * scalingFactor;
  const totalVramA = totalVramGb > 0 ? totalVramGb * (kvVramPredicted / kvVramCurrent) : kvVramPredicted;

  // Method B: Throughput 기반 GPU 수 스케일링
  const predictedThroughput = avgThroughput * scalingFactor;
  const modelParams = detectedModelName ? estimateModelParams(detectedModelName) : null;
  const firstSpec = gpuInventory[0]?.vramGb ? inventoryMap.get(gpuInventory[0].type)?.spec : null;
  const maxTpsPerGpu = (firstSpec && modelParams) ? calcTheoreticalMaxTps(firstSpec, 1, modelParams) : 0;
  const gpuNeededB = maxTpsPerGpu > 0 ? Math.ceil(predictedThroughput / maxTpsPerGpu) : 0;
  const avgVramPerGpu = totalGpuCount > 0 ? totalVramGb / totalGpuCount : 80;
  const totalVramB = gpuNeededB * avgVramPerGpu;

  // 보수적: 둘 중 큰 값 × 안전마진
  const predictedTotalVram = Math.max(totalVramA, totalVramB, totalVramGb) * SAFETY_MARGIN;
  const gapVram = Math.max(0, predictedTotalVram - totalVramGb);
  const b300Units = Math.ceil(gapVram / B300_SPEC.vramGb);

  // 기존 GPU 타입별 필요 수량
  const predictedGpuCount = gpuInventory.map(g => ({
    type: g.type,
    currentCount: g.count,
    predictedCount: Math.ceil(g.count * scalingFactor * SAFETY_MARGIN),
    additionalNeeded: Math.max(0, Math.ceil(g.count * scalingFactor * SAFETY_MARGIN) - g.count),
  }));

  const calculationDetails = {
    inputs: {
      targetUserCount, currentUsers, currentDau: Math.round(currentDau * 10) / 10,
      dauRatio: Math.round(dauRatio * 1000) / 1000,
      avgTokensPerUser: Math.round(avgTokensPerUser), avgRequestsPerUser: Math.round(avgRequestsPerUser * 10) / 10,
      peakConcurrent, avgThroughput: Math.round(avgThroughput * 10) / 10,
      avgGpuUtil: avgGpuUtil ? Math.round(avgGpuUtil * 10) / 10 : null,
      avgKvCache: avgKvCache ? Math.round(avgKvCache * 10) / 10 : null,
      detectedModelName, modelParams: modelParams ? `${modelParams}B` : null,
    },
    scaling: {
      targetDau: Math.round(targetDau),
      scalingFactor: Math.round(scalingFactor * 100) / 100,
      safetyMargin: SAFETY_MARGIN,
      sublinearScale: SUBLINEAR_SCALE,
    },
    methodA: { kvVramCurrent: Math.round(kvVramCurrent), kvVramPredicted: Math.round(kvVramPredicted), totalVramA: Math.round(totalVramA) },
    methodB: { predictedThroughput: Math.round(predictedThroughput * 10) / 10, maxTpsPerGpu: Math.round(maxTpsPerGpu * 10) / 10, gpuNeededB, totalVramB: Math.round(totalVramB) },
    result: { predictedTotalVram: Math.round(predictedTotalVram), gapVram: Math.round(gapVram), b300Units },
  };

  // ── 6. LLM 분석 리포트 ──
  let aiAnalysis = '';
  let aiConfidence = 'MEDIUM';
  let modelId = '';

  try {
    const llmSetting = await prisma.systemSetting.findUnique({ where: { key: 'SYSTEM_LLM_MODEL_ID' } });
    if (llmSetting?.value) {
      const model = await prisma.model.findUnique({ where: { id: llmSetting.value } });
      if (model) {
        modelId = model.id;
        const prompt = `당신은 GPU 인프라 용량 계획 전문가입니다. 아래 데이터를 기반으로 한국어 분석 리포트를 작성하세요.

## 현재 상황
- 현재 사용자: ${currentUsers}명 (일평균 활성: ${Math.round(currentDau)}명)
- 인당 일 평균: ${Math.round(avgTokensPerUser).toLocaleString()} 토큰, ${(avgRequestsPerUser).toFixed(1)}회 요청
- 피크 동시 요청: ${peakConcurrent}건
- 평균 레이턴시: ${avgLatencyMs ? Math.round(avgLatencyMs) + 'ms' : '데이터 없음'}
- 서빙 모델: ${detectedModelName || '미확인'} (${modelParams ? modelParams + 'B 파라미터' : '크기 미확인'})

## 현재 GPU 인벤토리
${gpuInventory.map(g => `- ${g.type} x${g.count} (VRAM ${g.vramGb}GB/장, 총 ${g.count * g.vramGb}GB)`).join('\n')}
- 총 VRAM: ${Math.round(totalVramGb)}GB
- 영업시간 평균 GPU 사용률: ${avgGpuUtil ? avgGpuUtil.toFixed(1) + '%' : '데이터 없음'}
- 영업시간 평균 KV Cache: ${avgKvCache ? avgKvCache.toFixed(1) + '%' : '데이터 없음'}
- 평균 처리량: ${avgThroughput.toFixed(1)} tok/s

## 예측 (목표: ${targetUserCount.toLocaleString()}명)
- 스케일링 팩터: x${scalingFactor.toFixed(2)} (DAU 비율 ${(dauRatio * 100).toFixed(1)}% × 서브리니어 0.7)
- 예상 피크 DAU: ${Math.round(targetDau)}명
- Method A (KV Cache 기반): 필요 VRAM ${Math.round(totalVramA)}GB
- Method B (처리량 기반): 필요 GPU ${gpuNeededB}장 (VRAM ${Math.round(totalVramB)}GB)
- 보수적 예측 (×${SAFETY_MARGIN}): ${Math.round(predictedTotalVram)}GB
- 부족분: ${Math.round(gapVram)}GB → B300(${B300_SPEC.vramGb}GB) ${b300Units}장 필요

## 분석 요청
1. 위 계산 과정의 논리적 타당성을 평가하세요
2. 보수적이되 현실적인 추가 관점을 제시하세요 (피크 vs 평균, 모델 크기 변화 가능성 등)
3. 최종 권고안을 구체적 수치와 함께 제시하세요
4. 신뢰도를 HIGH/MEDIUM/LOW로 판단하세요 (데이터 충분성 기반)

JSON 형식으로만 응답하세요:
{"analysis": "...(한국어 분석 텍스트, 계산 논리 포함)...", "confidence": "HIGH|MEDIUM|LOW", "adjustedB300Units": <숫자>, "recommendations": ["...", "..."]}`;

        const raw = await callSystemLlm(model, '당신은 GPU 인프라 용량 계획 전문가입니다. JSON으로만 응답하세요.', prompt);
        try {
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            aiAnalysis = parsed.analysis || raw;
            aiConfidence = parsed.confidence || 'MEDIUM';
            if (parsed.adjustedB300Units && typeof parsed.adjustedB300Units === 'number') {
              // LLM이 조정한 값이 있으면 반영 (더 보수적인 값만)
              calculationDetails.result.b300Units = Math.max(b300Units, parsed.adjustedB300Units);
            }
            if (parsed.recommendations) {
              (calculationDetails as any).recommendations = parsed.recommendations;
            }
          } else {
            aiAnalysis = raw;
          }
        } catch {
          aiAnalysis = raw;
        }
      }
    }
  } catch (err: any) {
    console.error('[GPU Capacity] LLM analysis failed:', err.message);
    aiAnalysis = `LLM 분석 실패: ${err.message}. 수치 기반 예측만 제공됩니다.`;
  }

  if (!aiAnalysis) {
    aiAnalysis = `[자동 계산 결과] 현재 ${currentUsers}명 사용자(DAU ${Math.round(currentDau)}) 기준, ${targetUserCount}명 스케일업 시 약 ${Math.round(predictedTotalVram)}GB VRAM 필요. 현재 ${Math.round(totalVramGb)}GB 보유, B300(${B300_SPEC.vramGb}GB) ${b300Units}장 추가 필요.`;
  }

  // ── 7. DB 저장 ──
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const prediction = await prisma.gpuCapacityPrediction.upsert({
    where: { date: today },
    update: {
      targetUserCount, currentDau, currentUsers,
      avgTokensPerUserPerDay: avgTokensPerUser, avgRequestsPerUserPerDay: avgRequestsPerUser,
      peakConcurrentRequests: peakConcurrent, avgLatencyMs,
      currentGpuInventory: gpuInventory as any, currentTotalVramGb: totalVramGb,
      currentAvgGpuUtil: avgGpuUtil, currentAvgKvCache: avgKvCache,
      predictedTotalVramGb: predictedTotalVram,
      predictedGpuCount: predictedGpuCount as any,
      predictedB300Units: calculationDetails.result.b300Units,
      gapVramGb: gapVram, scalingFactor, safetyMargin: SAFETY_MARGIN,
      aiAnalysis, aiConfidence, modelId: modelId || 'none',
      calculationDetails: calculationDetails as any,
    },
    create: {
      date: today, targetUserCount, currentDau, currentUsers,
      avgTokensPerUserPerDay: avgTokensPerUser, avgRequestsPerUserPerDay: avgRequestsPerUser,
      peakConcurrentRequests: peakConcurrent, avgLatencyMs,
      currentGpuInventory: gpuInventory as any, currentTotalVramGb: totalVramGb,
      currentAvgGpuUtil: avgGpuUtil, currentAvgKvCache: avgKvCache,
      predictedTotalVramGb: predictedTotalVram,
      predictedGpuCount: predictedGpuCount as any,
      predictedB300Units: calculationDetails.result.b300Units,
      gapVramGb: gapVram, scalingFactor, safetyMargin: SAFETY_MARGIN,
      aiAnalysis, aiConfidence, modelId: modelId || 'none',
      calculationDetails: calculationDetails as any,
    },
  });

  console.log(`[GPU Capacity] Prediction saved: ${b300Units} B300 units needed (gap: ${Math.round(gapVram)}GB)`);
  return prediction;
}

// ================================================================
// 크론 (매일 KST 01:00)
// ================================================================
export function startGpuCapacityPredictionCron() {
  interval = setInterval(async () => {
    const now = new Date();
    const kstHour = (now.getUTCHours() + 9) % 24;
    const today = now.toISOString().split('T')[0];

    if (kstHour === 1 && lastRunDate !== today) {
      lastRunDate = today;
      try {
        await runGpuCapacityPrediction();
      } catch (err) {
        console.error('[GPU Capacity] Prediction cron failed:', err);
      }
    }
  }, INTERVAL_MS);
  console.log('[GPU Capacity] Cron started (runs daily at KST 01:00)');
}
