/**
 * GPU Capacity Prediction Service (v2)
 *
 * 매일 KST 01:00 자동 실행:
 * 1. 현재 사용량 + 성장 추세 수집
 * 2. 서비스별/모델별 리소스 분석
 * 3. 주간 성장률 반영 스케일업 예측
 * 4. LLM 분석 리포트 (논리+계산 근거)
 */

import { prisma } from '../index.js';
import { B300_SPEC, lookupGpuSpec, calcTheoreticalMaxTps, estimateModelParams } from './gpuMonitor.service.js';

const INTERVAL_MS = 60 * 60 * 1000;
const LLM_TIMEOUT_MS = 120_000;
const SAFETY_MARGIN = 1.3;
const SUBLINEAR_SCALE = 0.7;
const MAX_SCALING_FACTOR = 500; // 과도한 예측 방지

let interval: ReturnType<typeof setInterval> | null = null;
let lastRunDate = '';

// ── LLM 호출 ──
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
    max_tokens: 4096, temperature: 0.2, stream: false,
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

// ── 핵심 예측 ──
export async function runGpuCapacityPrediction(): Promise<any> {
  console.log('[GPU Capacity] Starting prediction...');

  const targetSetting = await prisma.systemSetting.findUnique({ where: { key: 'GPU_CAPACITY_TARGET_USERS' } });
  const targetUserCount = parseInt(targetSetting?.value || '15000', 10);

  const holidays = await prisma.holiday.findMany({ where: { date: { gte: new Date(Date.now() - 60 * 86400000) } } });
  const holidaySet = new Set(holidays.map(h => h.date.toISOString().split('T')[0]));
  const isBizDay = (d: string) => { const dt = new Date(d + 'T00:00:00+09:00'); return dt.getDay() !== 0 && dt.getDay() !== 6 && !holidaySet.has(d); };

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
  const KST_OFFSET = 9 * 60 * 60 * 1000;

  // ── 고유 사용자 ──
  const userCountResult = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(DISTINCT user_id) as count FROM usage_logs WHERE timestamp >= ${thirtyDaysAgo} AND user_id IS NOT NULL`;
  const currentUsers = Number(userCountResult[0]?.count || 0);

  // ── 일별 통계 (14일) — 성장률 계산용 ──
  const dailyStats = await prisma.$queryRaw<Array<{ day: string; dau: bigint; total_tokens: bigint; total_requests: bigint }>>`
    SELECT DATE(timestamp)::text as day, COUNT(DISTINCT user_id) as dau,
           SUM(COALESCE("inputTokens",0) + COALESCE("outputTokens",0)) as total_tokens,
           COUNT(*) as total_requests
    FROM usage_logs WHERE timestamp >= ${fourteenDaysAgo} AND user_id IS NOT NULL
    GROUP BY DATE(timestamp) ORDER BY day`;

  const bizDays = dailyStats.filter(d => isBizDay(d.day)).map(d => ({
    day: d.day, dau: Number(d.dau), tokens: Number(d.total_tokens), requests: Number(d.total_requests),
  }));

  // 최근 5영업일 vs 이전 5영업일 → 주간 성장률
  const recent5 = bizDays.slice(-5);
  const prev5 = bizDays.slice(Math.max(0, bizDays.length - 10), Math.max(0, bizDays.length - 5));
  const recentAvgDau = recent5.length > 0 ? recent5.reduce((s, d) => s + d.dau, 0) / recent5.length : 1;
  const prevAvgDau = prev5.length > 0 ? prev5.reduce((s, d) => s + d.dau, 0) / prev5.length : recentAvgDau;
  const recentAvgTokens = recent5.length > 0 ? recent5.reduce((s, d) => s + d.tokens, 0) / recent5.length : 0;
  const prevAvgTokens = prev5.length > 0 ? prev5.reduce((s, d) => s + d.tokens, 0) / prev5.length : recentAvgTokens;
  const recentTokensPerUser = recentAvgDau > 0 ? recentAvgTokens / recentAvgDau : 0;
  const prevTokensPerUser = prevAvgDau > 0 ? prevAvgTokens / prevAvgDau : recentTokensPerUser;

  const dauGrowthRate = prevAvgDau > 0 ? (recentAvgDau - prevAvgDau) / prevAvgDau : 0;
  const tokensPerUserGrowthRate = prevTokensPerUser > 0 ? (recentTokensPerUser - prevTokensPerUser) / prevTokensPerUser : 0;
  const weeklyGrowthRate = Math.max(dauGrowthRate, tokensPerUserGrowthRate, 0); // 음수면 0

  const currentDau = recentAvgDau;
  const avgTokensPerDay = recentAvgTokens;
  const avgRequestsPerDay = recent5.length > 0 ? recent5.reduce((s, d) => s + d.requests, 0) / recent5.length : 0;
  const avgTokensPerUser = currentDau > 0 ? avgTokensPerDay / currentDau : 0;
  const avgRequestsPerUser = currentDau > 0 ? avgRequestsPerDay / currentDau : 0;

  // ── 에러율 ──
  const errorResult = await prisma.$queryRaw<[{ total: bigint; errors: bigint }]>`
    SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status_code >= 400) as errors
    FROM request_logs WHERE timestamp >= ${sevenDaysAgo}`;
  const errorRate = Number(errorResult[0]?.total || 0) > 0 ? Number(errorResult[0]?.errors || 0) / Number(errorResult[0]?.total) : 0;

  // ── 서비스별 토큰 소비 Top 5 ──
  const serviceBreakdown = await prisma.$queryRaw<Array<{ service_id: string; name: string; tokens: bigint; reqs: bigint }>>`
    SELECT u.service_id, COALESCE(s.name, u.service_id) as name,
           SUM(COALESCE(u."inputTokens",0) + COALESCE(u."outputTokens",0)) as tokens, COUNT(*) as reqs
    FROM usage_logs u LEFT JOIN services s ON u.service_id = s.id
    WHERE u.timestamp >= ${sevenDaysAgo} AND u.service_id IS NOT NULL
    GROUP BY u.service_id, s.name ORDER BY tokens DESC LIMIT 5`;
  const topServices = serviceBreakdown.map(s => ({ name: s.name, tokens: Number(s.tokens), requests: Number(s.reqs) }));

  // ── 레이턴시 ──
  const latencyResult = await prisma.$queryRaw<[{ avg_ms: number | null; p95_ms: number | null }]>`
    SELECT AVG(latency_ms) as avg_ms,
           PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) as p95_ms
    FROM request_logs WHERE status_code < 400 AND timestamp >= ${sevenDaysAgo} AND latency_ms IS NOT NULL`;
  const avgLatencyMs = latencyResult[0]?.avg_ms || null;
  const p95LatencyMs = latencyResult[0]?.p95_ms || null;

  // ── GPU 메트릭 (영업시간만) ──
  const snapshots = await prisma.gpuMetricSnapshot.findMany({
    where: { timestamp: { gte: sevenDaysAgo } },
    select: { gpuMetrics: true, llmMetrics: true, timestamp: true },
  });

  const bizConcurrents: number[] = [];
  let totalGpuUtil = 0, gpuUtilCount = 0, totalKvCache = 0, kvCacheCount = 0, totalThroughput = 0, tpCount = 0;

  for (const snap of snapshots) {
    const kstHour = new Date(snap.timestamp.getTime() + KST_OFFSET).getUTCHours();
    const isBiz = kstHour >= 9 && kstHour < 18;
    if (!isBiz) continue;

    const llms = snap.llmMetrics as any[];
    if (Array.isArray(llms)) {
      const concurrent = llms.reduce((s: number, l: any) => s + (l.runningRequests || 0) + (l.waitingRequests || 0), 0);
      if (concurrent > 0) bizConcurrents.push(concurrent);
      for (const l of llms) {
        if (l.kvCacheUsagePct != null) { totalKvCache += l.kvCacheUsagePct; kvCacheCount++; }
        const tp = (l.promptThroughputTps || 0) + (l.genThroughputTps || 0);
        if (tp > 0) { totalThroughput += tp; tpCount++; }
      }
    }
    const gpus = snap.gpuMetrics as any[];
    if (Array.isArray(gpus)) { for (const g of gpus) { totalGpuUtil += g.utilGpu || 0; gpuUtilCount++; } }
  }

  bizConcurrents.sort((a, b) => a - b);
  const peakConcurrent = bizConcurrents.length > 0 ? bizConcurrents[Math.min(Math.floor(bizConcurrents.length * 0.95), bizConcurrents.length - 1)] : 0;
  const avgGpuUtil = gpuUtilCount > 0 ? totalGpuUtil / gpuUtilCount : null;
  const avgKvCache = kvCacheCount > 0 ? totalKvCache / kvCacheCount : null;
  const avgThroughput = tpCount > 0 ? totalThroughput / tpCount : 0;

  // ── GPU 인벤토리 ──
  const servers = await prisma.gpuServer.findMany({ where: { enabled: true } });
  const latestSnaps = await prisma.gpuMetricSnapshot.findMany({
    where: { serverId: { in: servers.map(s => s.id) } },
    orderBy: { timestamp: 'desc' }, distinct: ['serverId'],
    select: { serverId: true, gpuMetrics: true, llmMetrics: true },
  });

  const inventoryMap = new Map<string, { count: number; vramGb: number; spec: any }>();
  let totalVramGb = 0;
  let detectedModelName: string | null = null;
  const allModels: string[] = [];

  for (const snap of latestSnaps) {
    const gpus = snap.gpuMetrics as any[];
    if (!Array.isArray(gpus)) continue;
    for (const g of gpus) {
      const spec = lookupGpuSpec(g.name);
      const label = spec?.label || g.name;
      const vram = (g.memTotalMb || 0) / 1024;
      totalVramGb += vram;
      const existing = inventoryMap.get(label) || { count: 0, vramGb: spec?.vramGb || vram, spec };
      existing.count++; inventoryMap.set(label, existing);
    }
    const llms = snap.llmMetrics as any[];
    if (Array.isArray(llms)) {
      for (const l of llms) {
        const names = l?.modelNames || [];
        for (const n of names) { if (n && !allModels.includes(n)) allModels.push(n); }
        if (!detectedModelName && names[0]) detectedModelName = names[0];
      }
    }
  }

  const gpuInventory = Array.from(inventoryMap.entries()).map(([type, v]) => ({ type, count: v.count, vramGb: v.vramGb }));
  const totalGpuCount = gpuInventory.reduce((s, g) => s + g.count, 0);

  // ── 데이터 신뢰도 판단 ──
  let dataConfidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'HIGH';
  const confidenceIssues: string[] = [];
  if (currentUsers < 10) { dataConfidence = 'LOW'; confidenceIssues.push('사용자 10명 미만'); }
  else if (currentUsers < 50) { dataConfidence = 'MEDIUM'; confidenceIssues.push('사용자 50명 미만'); }
  if (recent5.length < 3) { dataConfidence = 'LOW'; confidenceIssues.push('영업일 데이터 3일 미만'); }
  if (totalGpuCount === 0) { dataConfidence = 'LOW'; confidenceIssues.push('GPU 서버 데이터 없음'); }
  if (avgThroughput === 0) { confidenceIssues.push('LLM 처리량 데이터 없음'); if (dataConfidence === 'HIGH') dataConfidence = 'MEDIUM'; }

  // ── 예측 계산 ──
  const dauRatio = currentUsers > 0 ? currentDau / currentUsers : 0.3;
  const targetDau = targetUserCount * dauRatio * SUBLINEAR_SCALE;
  const rawScaling = currentDau > 0 ? targetDau / currentDau : targetUserCount / Math.max(currentUsers, 1);
  const scalingFactor = Math.min(rawScaling, MAX_SCALING_FACTOR);

  // 성장률 반영 (6개월 후 예상 = 현재 × (1 + 주간성장률)^26)
  const growthMultiplier = Math.pow(1 + weeklyGrowthRate, 26); // 26주 = ~6개월
  const growthAdjustedScaling = scalingFactor * Math.min(growthMultiplier, 3); // 최대 3배 제한

  // Method A: KV Cache + 모델 가중치 분리 스케일링
  const kvRatio = avgKvCache != null && avgKvCache > 0 ? avgKvCache / 100 : 0.3;
  const modelWeightVram = totalVramGb * (1 - kvRatio); // 모델 가중치 (고정)
  const kvVramCurrent = totalVramGb * kvRatio;
  const kvVramPredicted = kvVramCurrent * growthAdjustedScaling;
  const totalVramA = modelWeightVram + kvVramPredicted;

  // Method B: Throughput 스케일링 (모든 GPU 타입 고려)
  const modelParams = detectedModelName ? estimateModelParams(detectedModelName) : null;
  let weightedMaxTps = 0;
  if (modelParams) {
    for (const [, inv] of inventoryMap) {
      if (inv.spec) weightedMaxTps += calcTheoreticalMaxTps(inv.spec, inv.count, modelParams);
    }
  }
  const predictedThroughput = avgThroughput * growthAdjustedScaling;
  const tpsScaleRatio = weightedMaxTps > 0 ? predictedThroughput / weightedMaxTps : growthAdjustedScaling;
  const totalVramB = totalVramGb * Math.max(tpsScaleRatio, 1);

  // 에러율 보정 (에러 5% 이상이면 추가 여유 필요)
  const errorMargin = errorRate > 0.05 ? 1 + errorRate : 1;

  // GPU 건강도 보정 = 피크 throughput / 이론 최대
  // 피크 throughput 구하기 (7일, 영업시간)
  let peakThroughput = 0;
  for (const snap of snapshots) {
    const kstH = new Date(snap.timestamp.getTime() + KST_OFFSET).getUTCHours();
    if (kstH < 9 || kstH >= 18) continue;
    const llms = snap.llmMetrics as any[];
    if (!Array.isArray(llms)) continue;
    const tp = llms.reduce((s: number, l: any) => s + (l.promptThroughputTps || 0) + (l.genThroughputTps || 0), 0);
    if (tp > peakThroughput) peakThroughput = tp;
  }
  const avgHealthPct = weightedMaxTps > 0 && peakThroughput > 0
    ? Math.min((peakThroughput / weightedMaxTps) * 100, 100)
    : null;
  const healthMargin = avgHealthPct != null && avgHealthPct > 0 && avgHealthPct < 95
    ? 1 / (avgHealthPct / 100)
    : 1;

  // 예상 소진 시점 (현재 여유가 몇 주 후 0%가 되는지)
  const currentEffUtil = weightedMaxTps > 0 && avgThroughput > 0
    ? (avgThroughput / (weightedMaxTps * (avgHealthPct || 100) / 100)) * 100
    : null;
  const weeksUntilSaturated = (currentEffUtil != null && weeklyGrowthRate > 0 && currentEffUtil < 100)
    ? Math.ceil(Math.log(100 / currentEffUtil) / Math.log(1 + weeklyGrowthRate))
    : null;

  // 보수적: max × 안전마진 × 에러보정 × 건강도보정
  const predictedTotalVram = Math.max(totalVramA, totalVramB, totalVramGb) * SAFETY_MARGIN * errorMargin * Math.min(healthMargin, 1.5);
  const gapVram = Math.max(0, predictedTotalVram - totalVramGb);
  const b300Units = Math.ceil(gapVram / B300_SPEC.vramGb);

  const predictedGpuCount = gpuInventory.map(g => ({
    type: g.type, currentCount: g.count,
    predictedCount: Math.ceil(g.count * growthAdjustedScaling * SAFETY_MARGIN * errorMargin),
    additionalNeeded: Math.max(0, Math.ceil(g.count * growthAdjustedScaling * SAFETY_MARGIN * errorMargin) - g.count),
  }));

  const calculationDetails = {
    inputs: {
      targetUserCount, currentUsers, currentDau: Math.round(currentDau * 10) / 10,
      dauRatio: Math.round(dauRatio * 1000) / 1000,
      avgTokensPerUser: Math.round(avgTokensPerUser), avgRequestsPerUser: Math.round(avgRequestsPerUser * 10) / 10,
      peakConcurrent, avgLatencyMs: avgLatencyMs ? Math.round(avgLatencyMs) : null,
      p95LatencyMs: p95LatencyMs ? Math.round(p95LatencyMs as number) : null,
      errorRate: Math.round(errorRate * 10000) / 100, // %
      detectedModels: allModels, modelParams: modelParams ? `${modelParams}B` : null,
    },
    growth: {
      dauGrowthRate: Math.round(dauGrowthRate * 1000) / 10, // %
      tokensPerUserGrowthRate: Math.round(tokensPerUserGrowthRate * 1000) / 10,
      weeklyGrowthRate: Math.round(weeklyGrowthRate * 1000) / 10,
      growthMultiplier6mo: Math.round(growthMultiplier * 100) / 100,
      growthAdjustedScaling: Math.round(growthAdjustedScaling * 100) / 100,
    },
    scaling: { targetDau: Math.round(targetDau), scalingFactor: Math.round(scalingFactor * 100) / 100, safetyMargin: SAFETY_MARGIN, errorMargin: Math.round(errorMargin * 100) / 100, healthMargin: Math.round(healthMargin * 100) / 100, avgHealthPct: avgHealthPct ? Math.round(avgHealthPct * 10) / 10 : null, peakThroughput: Math.round(peakThroughput * 10) / 10, currentEffUtil: currentEffUtil ? Math.round(currentEffUtil * 10) / 10 : null, weeksUntilSaturated },
    methodA: { modelWeightVram: Math.round(modelWeightVram), kvVramCurrent: Math.round(kvVramCurrent), kvVramPredicted: Math.round(kvVramPredicted), totalVramA: Math.round(totalVramA) },
    methodB: { currentTps: Math.round(avgThroughput * 10) / 10, predictedTps: Math.round(predictedThroughput * 10) / 10, weightedMaxTps: Math.round(weightedMaxTps * 10) / 10, totalVramB: Math.round(totalVramB) },
    result: { predictedTotalVram: Math.round(predictedTotalVram), gapVram: Math.round(gapVram), b300Units },
    topServices, dataConfidence, confidenceIssues,
  };

  // ── LLM 분석 ──
  let aiAnalysis = '';
  let aiConfidence = dataConfidence;
  let modelId = '';

  try {
    // GPU 예측 전용 LLM → 없으면 시스템 LLM fallback
    const gpuLlmSetting = await prisma.systemSetting.findUnique({ where: { key: 'GPU_CAPACITY_LLM_MODEL_ID' } });
    const llmSetting = gpuLlmSetting || await prisma.systemSetting.findUnique({ where: { key: 'SYSTEM_LLM_MODEL_ID' } });
    if (llmSetting?.value) {
      const model = await prisma.model.findUnique({ where: { id: llmSetting.value } });
      if (model) {
        modelId = model.id;
        const prompt = `당신은 GPU 인프라 용량 계획 전문가입니다. 아래 데이터를 기반으로 한국어 분석 리포트를 작성하세요.

## 현재 상황
- 사용자: ${currentUsers}명 (일평균 활성 DAU: ${Math.round(currentDau)}명)
- 인당: ${Math.round(avgTokensPerUser).toLocaleString()} 토큰/일, ${avgRequestsPerUser.toFixed(1)}회/일
- 피크 동시 요청(P95, 영업시간): ${peakConcurrent}건
- 레이턴시: 평균 ${avgLatencyMs ? Math.round(avgLatencyMs) + 'ms' : 'N/A'}, P95 ${p95LatencyMs ? Math.round(p95LatencyMs as number) + 'ms' : 'N/A'}
- 에러율: ${(errorRate * 100).toFixed(2)}%
- 서빙 모델: ${allModels.join(', ') || '미확인'} (${modelParams ? modelParams + 'B' : '크기 미확인'})

## 성장 추세 (최근 2주)
- DAU 주간 성장률: ${(dauGrowthRate * 100).toFixed(1)}%
- 인당 토큰 주간 성장률: ${(tokensPerUserGrowthRate * 100).toFixed(1)}%
- 6개월 후 예상 배율: x${growthMultiplier.toFixed(2)}

## 서비스별 토큰 소비 Top 5
${topServices.map((s, i) => `${i + 1}. ${s.name}: ${s.tokens.toLocaleString()} 토큰 (${s.requests.toLocaleString()}건)`).join('\n') || '데이터 없음'}

## GPU 인벤토리
${gpuInventory.map(g => `- ${g.type} x${g.count} (${g.vramGb}GB/장)`).join('\n') || '없음'}
- 총 VRAM: ${Math.round(totalVramGb)}GB, GPU 사용률: ${avgGpuUtil ? avgGpuUtil.toFixed(1) + '%' : 'N/A'}, KV Cache: ${avgKvCache ? avgKvCache.toFixed(1) + '%' : 'N/A'}
- 평균 throughput: ${avgThroughput.toFixed(1)} tok/s, 피크 throughput (영업시간): ${peakThroughput.toFixed(1)} tok/s
- 이론 최대 throughput: ${weightedMaxTps.toFixed(1)} tok/s
- GPU 건강도 (피크/이론): ${avgHealthPct ? avgHealthPct.toFixed(1) + '%' : 'N/A'}
- 현재 실효 사용률: ${currentEffUtil ? currentEffUtil.toFixed(1) + '%' : 'N/A'}
${weeksUntilSaturated ? `- ⚠️ 현재 성장률 유지 시 약 ${weeksUntilSaturated}주 후 포화 예상` : '- 포화 시점: 계산 불가 (성장률 0 또는 데이터 부족)'}

## 예측 (목표 ${targetUserCount.toLocaleString()}명, 성장률 반영)
- 스케일링: x${scalingFactor.toFixed(1)} (기본) → x${growthAdjustedScaling.toFixed(1)} (6개월 성장 반영)
- Method A (모델가중치 고정 + KV 스케일): ${Math.round(totalVramA)}GB
- Method B (처리량 스케일): ${Math.round(totalVramB)}GB
- 건강도 보정: x${Math.min(healthMargin, 1.5).toFixed(2)} (건강도 ${avgHealthPct ? avgHealthPct.toFixed(0) + '%' : 'N/A'})
- 안전마진 x${SAFETY_MARGIN}, 에러보정 x${errorMargin.toFixed(2)} → 최종 ${Math.round(predictedTotalVram)}GB
- 부족: ${Math.round(gapVram)}GB → B300(${B300_SPEC.vramGb}GB) ${b300Units}장

## 분석 요청
1. 계산 과정의 논리적 타당성 평가
2. 성장 추세 기반 추가 리스크 (인당 토큰 증가, 서비스 고도화)
3. 보수적이되 현실적인 최종 권고 (구체적 수치)
4. 데이터 신뢰도 (${dataConfidence}) 및 개선점
5. ${targetUserCount.toLocaleString()}명 서비스 시 예상 레이턴시 변화

JSON으로만 응답: {"analysis":"...한국어...","confidence":"HIGH|MEDIUM|LOW","adjustedB300Units":<숫자>,"recommendations":["...",...],"predictedLatencyMs":<숫자|null>}`;

        const raw = await callSystemLlm(model, '당신은 GPU 인프라 용량 계획 전문가입니다. JSON으로만 응답하세요.', prompt);
        try {
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            aiAnalysis = parsed.analysis || raw;
            aiConfidence = parsed.confidence || dataConfidence;
            if (parsed.adjustedB300Units && typeof parsed.adjustedB300Units === 'number') {
              calculationDetails.result.b300Units = Math.max(b300Units, parsed.adjustedB300Units);
            }
            if (parsed.recommendations) (calculationDetails as any).recommendations = parsed.recommendations;
            if (parsed.predictedLatencyMs) (calculationDetails as any).predictedLatencyMs = parsed.predictedLatencyMs;
          } else { aiAnalysis = raw; }
        } catch { aiAnalysis = raw; }
      }
    }
  } catch (err: any) {
    console.error('[GPU Capacity] LLM failed:', err.message);
    aiAnalysis = `LLM 분석 실패: ${err.message}`;
  }

  if (!aiAnalysis) {
    aiAnalysis = `[자동] ${currentUsers}명(DAU ${Math.round(currentDau)}) → ${targetUserCount}명 스케일 시 ${Math.round(predictedTotalVram)}GB 필요. 현재 ${Math.round(totalVramGb)}GB, B300 ${b300Units}장 추가 필요. 주간 성장률 ${(weeklyGrowthRate * 100).toFixed(1)}%.`;
  }

  // ── DB 저장 ──
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const prediction = await prisma.gpuCapacityPrediction.upsert({
    where: { date: today },
    update: {
      targetUserCount, currentDau, currentUsers, avgTokensPerUserPerDay: avgTokensPerUser,
      avgRequestsPerUserPerDay: avgRequestsPerUser, peakConcurrentRequests: peakConcurrent, avgLatencyMs,
      currentGpuInventory: gpuInventory as any, currentTotalVramGb: totalVramGb,
      currentAvgGpuUtil: avgGpuUtil, currentAvgKvCache: avgKvCache,
      predictedTotalVramGb: predictedTotalVram, predictedGpuCount: predictedGpuCount as any,
      predictedB300Units: calculationDetails.result.b300Units, gapVramGb: gapVram,
      scalingFactor: growthAdjustedScaling, safetyMargin: SAFETY_MARGIN,
      aiAnalysis, aiConfidence, modelId: modelId || 'none', calculationDetails: calculationDetails as any,
    },
    create: {
      date: today, targetUserCount, currentDau, currentUsers, avgTokensPerUserPerDay: avgTokensPerUser,
      avgRequestsPerUserPerDay: avgRequestsPerUser, peakConcurrentRequests: peakConcurrent, avgLatencyMs,
      currentGpuInventory: gpuInventory as any, currentTotalVramGb: totalVramGb,
      currentAvgGpuUtil: avgGpuUtil, currentAvgKvCache: avgKvCache,
      predictedTotalVramGb: predictedTotalVram, predictedGpuCount: predictedGpuCount as any,
      predictedB300Units: calculationDetails.result.b300Units, gapVramGb: gapVram,
      scalingFactor: growthAdjustedScaling, safetyMargin: SAFETY_MARGIN,
      aiAnalysis, aiConfidence, modelId: modelId || 'none', calculationDetails: calculationDetails as any,
    },
  });

  console.log(`[GPU Capacity] Done: B300 ${calculationDetails.result.b300Units}장 (gap ${Math.round(gapVram)}GB, growth x${growthMultiplier.toFixed(2)})`);
  return prediction;
}

// ── 크론 ──
export function startGpuCapacityPredictionCron() {
  interval = setInterval(async () => {
    const now = new Date();
    const kstHour = (now.getUTCHours() + 9) % 24;
    const today = now.toISOString().split('T')[0];
    if (kstHour === 1 && lastRunDate !== today) {
      lastRunDate = today;
      try { await runGpuCapacityPrediction(); } catch (err) { console.error('[GPU Capacity] Cron failed:', err); }
    }
  }, INTERVAL_MS);
  console.log('[GPU Capacity] Cron started (daily KST 01:00)');
}
