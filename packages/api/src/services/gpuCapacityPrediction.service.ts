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
import { B300_SPEC, lookupGpuSpec, calcTheoreticalMaxTps, estimateModelParams, detectPrecision } from './gpuMonitor.service.js';
import { logInternalLlmUsage } from './internalUsageLogger.js';

const INTERVAL_MS = 60 * 60 * 1000;
const LLM_TIMEOUT_MS = 120_000;
const SAFETY_MARGIN = 1.5; // 과소 추정 방지 (1.3 → 1.5 상향)
const MAX_SCALING_FACTOR = 500; // 과도한 예측 방지

let interval: ReturnType<typeof setInterval> | null = null;
let lastRunDate = '';

// ── LLM 호출 ──
async function callSystemLlm(
  model: { id?: string; name: string; endpointUrl: string; apiKey: string | null; extraHeaders: unknown; extraBody: unknown },
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
  const startMs = Date.now();
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
    clearTimeout(tid);
    const latencyMs = Date.now() - startMs;
    if (!res.ok) {
      const errText = (await res.text().catch(() => '')).substring(0, 300);
      if (model.id) {
        logInternalLlmUsage({
          modelId: model.id, modelName: model.name,
          inputTokens: 0, outputTokens: 0, latencyMs,
          path: '/internal/gpu-capacity-prediction', statusCode: res.status,
          errorMessage: errText,
        });
      }
      throw new Error(`LLM ${res.status}: ${errText}`);
    }
    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    if (model.id) {
      logInternalLlmUsage({
        modelId: model.id, modelName: model.name,
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
        latencyMs, path: '/internal/gpu-capacity-prediction',
      });
    }
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
    GROUP BY u.service_id, s.name ORDER BY tokens DESC`;
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
    const kstDate = new Date(snap.timestamp.getTime() + KST_OFFSET);
    const kstHour = kstDate.getUTCHours();
    const kstDow = kstDate.getUTCDay();
    const dateStr = kstDate.toISOString().split('T')[0];
    const isBiz = kstHour >= 9 && kstHour < 18 && kstDow !== 0 && kstDow !== 6 && !holidaySet.has(dateStr);
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
  const allModels: string[] = [];

  // 모델별 throughput 비율 수집 (모든 배포 모델의 실제 사용 비율)
  interface ModelProfile {
    name: string;
    params: number | null;
    precision: 'fp8' | 'fp16';
    avgTps: number;       // 평균 throughput
    peakTps: number;      // 피크 throughput
    avgKvPct: number;     // 평균 KV cache
    gpuCount: number;     // 사용 GPU 수 (추정)
    tpsRatio: number;     // 전체 대비 throughput 비율
  }
  const modelTpsMap = new Map<string, { totalTps: number; count: number; peakTps: number; totalKv: number; kvCount: number }>();

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
        // 모델별 throughput + KV cache 수집
        const modelKey = names[0] || l.containerName || 'unknown';
        const tp = (l.promptThroughputTps || 0) + (l.genThroughputTps || 0);
        const kv = l.kvCacheUsagePct;
        const existing = modelTpsMap.get(modelKey) || { totalTps: 0, count: 0, peakTps: 0, totalKv: 0, kvCount: 0 };
        existing.totalTps += tp; existing.count++;
        if (tp > existing.peakTps) existing.peakTps = tp;
        if (kv != null) { existing.totalKv += kv; existing.kvCount++; }
        modelTpsMap.set(modelKey, existing);
      }
    }
  }

  // 모델 프로파일 구축 (throughput 비율 기반)
  const totalModelTps = Array.from(modelTpsMap.values()).reduce((s, m) => s + (m.count > 0 ? m.totalTps / m.count : 0), 0);
  const modelProfiles: ModelProfile[] = [];
  for (const [name, data] of modelTpsMap) {
    const avgTps = data.count > 0 ? data.totalTps / data.count : 0;
    const params = estimateModelParams(name);
    modelProfiles.push({
      name, params,
      precision: detectPrecision(name),
      avgTps, peakTps: data.peakTps,
      avgKvPct: data.kvCount > 0 ? data.totalKv / data.kvCount : 0,
      gpuCount: 0, // 아래서 추정
      tpsRatio: totalModelTps > 0 ? avgTps / totalModelTps : 1 / Math.max(modelTpsMap.size, 1),
    });
  }
  // GPU 배분 추정: throughput 비율로 GPU 분배 (최소 1)
  const totalGpuForModels = Array.from(inventoryMap.values()).reduce((s, v) => s + v.count, 0);
  if (modelProfiles.length > 0) {
    let allocated = 0;
    for (let i = 0; i < modelProfiles.length; i++) {
      if (i === modelProfiles.length - 1) { modelProfiles[i].gpuCount = Math.max(1, totalGpuForModels - allocated); }
      else { const cnt = Math.max(1, Math.round(totalGpuForModels * modelProfiles[i].tpsRatio)); modelProfiles[i].gpuCount = cnt; allocated += cnt; }
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
  // target 인원 그대로 사용 (서브리니어 보정 없음 — 과소 추정 방지)
  const dauRatio = currentUsers > 0 ? currentDau / currentUsers : 0.3;
  const targetDau = targetUserCount * dauRatio;
  const rawScaling = currentDau > 0 ? targetDau / currentDau : targetUserCount / Math.max(currentUsers, 1);
  const scalingFactor = Math.min(rawScaling, MAX_SCALING_FACTOR);

  // 성장률 반영 (6개월 후 예상 = 현재 × (1 + 주간성장률)^26)
  const growthMultiplier = Math.pow(1 + weeklyGrowthRate, 26); // 26주 = ~6개월
  const growthAdjustedScaling = scalingFactor * Math.min(growthMultiplier, 3); // 최대 3배 제한

  // ── 모델별 이론 최대 throughput 계산 (모든 배포 모델 반영) ──
  let weightedMaxTps = 0;
  const modelBreakdown: Array<{ name: string; params: number | null; precision: string; tpsRatio: number; avgTps: number; peakTps: number; theoreticalMaxTps: number; avgKvPct: number; gpuCount: number }> = [];

  // 대표 GPU 스펙 (가장 많은 GPU 타입)
  let dominantSpec: any = null;
  let dominantCount = 0;
  for (const [, inv] of inventoryMap) { if (inv.count > dominantCount) { dominantCount = inv.count; dominantSpec = inv.spec; } }

  for (const mp of modelProfiles) {
    let modelMaxTps = 0;
    if (mp.params && dominantSpec) {
      // 해당 모델에 배분된 GPU 수 기준 이론 최대
      modelMaxTps = calcTheoreticalMaxTps(dominantSpec, mp.gpuCount, mp.params, mp.precision);
    }
    weightedMaxTps += modelMaxTps;
    modelBreakdown.push({
      name: mp.name, params: mp.params, precision: mp.precision,
      tpsRatio: Math.round(mp.tpsRatio * 1000) / 10, // %
      avgTps: Math.round(mp.avgTps * 10) / 10,
      peakTps: Math.round(mp.peakTps * 10) / 10,
      theoreticalMaxTps: Math.round(modelMaxTps * 10) / 10,
      avgKvPct: Math.round(mp.avgKvPct * 10) / 10,
      gpuCount: mp.gpuCount,
    });
  }

  // 모델 파라미터 없는 경우 fallback: 전체 GPU 기준 보수적 계산
  if (weightedMaxTps === 0 && dominantSpec) {
    // 가장 큰 모델 기준 (보수적)
    const fallbackParams = modelProfiles.reduce((max, m) => m.params && m.params > max ? m.params : max, 0) || 70;
    const totalGpuCount = Array.from(inventoryMap.values()).reduce((s, v) => s + v.count, 0);
    weightedMaxTps = calcTheoreticalMaxTps(dominantSpec, totalGpuCount, fallbackParams);
  }

  // Method A: KV Cache + 모델 가중치 분리 스케일링 (모델별 KV 비율 반영)
  let totalVramA = 0;
  if (modelProfiles.length > 0) {
    // 모델별로 분리 계산 후 합산
    for (const mp of modelProfiles) {
      const modelVram = totalVramGb * mp.tpsRatio; // 이 모델의 VRAM 비중
      const kvR = mp.avgKvPct > 0 ? mp.avgKvPct / 100 : 0.3;
      const mWeight = modelVram * (1 - kvR); // 모델 가중치 (고정)
      const kvScaled = modelVram * kvR * growthAdjustedScaling;
      totalVramA += mWeight + kvScaled;
    }
  } else {
    const kvRatio = avgKvCache != null && avgKvCache > 0 ? avgKvCache / 100 : 0.3;
    totalVramA = totalVramGb * (1 - kvRatio) + totalVramGb * kvRatio * growthAdjustedScaling;
  }

  // Method B: Throughput 스케일링 (모든 모델의 이론 최대 합산 사용)
  const predictedThroughput = avgThroughput * growthAdjustedScaling;
  const tpsScaleRatio = weightedMaxTps > 0 ? predictedThroughput / weightedMaxTps : growthAdjustedScaling;
  const totalVramB = totalVramGb * Math.max(tpsScaleRatio, 1);

  // 에러율 보정 (에러 5% 이상이면 추가 여유 필요)
  const errorMargin = errorRate > 0.05 ? 1 + errorRate : 1;

  // GPU 건강도 보정 = 피크 throughput / 이론 최대
  // 피크 throughput 구하기 (7일, 영업시간)
  let peakThroughput = 0;
  for (const snap of snapshots) {
    const kstDate = new Date(snap.timestamp.getTime() + KST_OFFSET);
    const kstH = kstDate.getUTCHours();
    const kstDow = kstDate.getUTCDay();
    const dateStr = kstDate.toISOString().split('T')[0];
    if (kstH < 9 || kstH >= 18 || kstDow === 0 || kstDow === 6 || holidaySet.has(dateStr)) continue;
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
  const weeksUntilSaturated = (currentEffUtil != null && currentEffUtil >= 100)
    ? 0  // 이미 포화 상태
    : (currentEffUtil != null && weeklyGrowthRate > 0)
      ? Math.ceil(Math.log(100 / currentEffUtil) / Math.log(1 + weeklyGrowthRate))
      : null;

  // ── 현재 피크 기준 부족분 (target 무관, 지금 당장의 부족) ──
  const peakEffUtil = weightedMaxTps > 0 && peakThroughput > 0 && avgHealthPct
    ? (peakThroughput / (weightedMaxTps * avgHealthPct / 100)) * 100
    : null;
  // 피크 때 VRAM이 얼마나 더 필요한지 (KV cache 피크 기준)
  let peakKvMax = 0;
  for (const snap of snapshots) {
    const llms = snap.llmMetrics as any[];
    if (!Array.isArray(llms)) continue;
    const kv = llms.reduce((s: number, l: any) => s + (l.kvCacheUsagePct || 0), 0) / Math.max(llms.length, 1);
    if (kv > peakKvMax) peakKvMax = kv;
  }
  // 현재 피크 기준: 건강도 반영 실효 사용률이 80% 넘으면 부족
  const currentPeakVramNeeded = peakEffUtil != null && peakEffUtil > 80
    ? totalVramGb * (peakEffUtil / 80) * SAFETY_MARGIN  // 80%를 안전 기준으로
    : null;
  const currentPeakGapVram = currentPeakVramNeeded ? Math.max(0, currentPeakVramNeeded - totalVramGb) : 0;
  const currentPeakB300Units = Math.ceil(currentPeakGapVram / B300_SPEC.vramGb);

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
      detectedModels: allModels,
    },
    modelBreakdown, // 모델별 params, throughput 비율, 이론 최대 등
    growth: {
      dauGrowthRate: Math.round(dauGrowthRate * 1000) / 10, // %
      tokensPerUserGrowthRate: Math.round(tokensPerUserGrowthRate * 1000) / 10,
      weeklyGrowthRate: Math.round(weeklyGrowthRate * 1000) / 10,
      growthMultiplier6mo: Math.round(growthMultiplier * 100) / 100,
      growthAdjustedScaling: Math.round(growthAdjustedScaling * 100) / 100,
    },
    scaling: { targetDau: Math.round(targetDau), scalingFactor: Math.round(scalingFactor * 100) / 100, safetyMargin: SAFETY_MARGIN, errorMargin: Math.round(errorMargin * 100) / 100, healthMargin: Math.round(healthMargin * 100) / 100, avgHealthPct: avgHealthPct ? Math.round(avgHealthPct * 10) / 10 : null, peakThroughput: Math.round(peakThroughput * 10) / 10, currentEffUtil: currentEffUtil ? Math.round(currentEffUtil * 10) / 10 : null, weeksUntilSaturated },
    methodA: { totalVramA: Math.round(totalVramA), note: '모델별 가중치 고정 + KV cache 스케일링 합산' },
    methodB: { currentTps: Math.round(avgThroughput * 10) / 10, predictedTps: Math.round(predictedThroughput * 10) / 10, weightedMaxTps: Math.round(weightedMaxTps * 10) / 10, totalVramB: Math.round(totalVramB) },
    currentPeakShortage: {
      peakEffUtil: peakEffUtil ? Math.round(peakEffUtil * 10) / 10 : null,
      peakKvMax: Math.round(peakKvMax * 10) / 10,
      gapVram: Math.round(currentPeakGapVram),
      b300Units: currentPeakB300Units,
      note: '현재 피크 기준 (target 무관, 실효 사용률 80% 초과 시 부족)',
    },
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

## 배포 모델 현황 (throughput 비율 기반 리소스 배분)
${modelBreakdown.length > 0 ? modelBreakdown.map(m => `- ${m.name}: ${m.params ? m.params + 'B' : '크기 미확인'} (${m.precision}) | 비율 ${m.tpsRatio}% | 평균 ${m.avgTps} tok/s, 피크 ${m.peakTps} tok/s | 이론max ${m.theoreticalMaxTps} tok/s | KV ${m.avgKvPct}% | GPU ${m.gpuCount}장`).join('\n') : '- 모델 데이터 없음'}

## 사용자 현황 (추이 아닌 절대값 — 외부 사용량 전송 서비스로 인해 추이 부정확)
- DAU: ${Math.round(currentDau)}명 (최근 5영업일 평균)
- 전체 사용자: ${currentUsers}명 (최근 30일)
- 인당 평균 토큰: ${Math.round(avgTokensPerUser).toLocaleString()}/일
- 6개월 스케일링 배율: x${growthMultiplier.toFixed(2)} (참고용)

## 서비스별 토큰 소비 Top 5
${topServices.map((s, i) => `${i + 1}. ${s.name}: ${s.tokens.toLocaleString()} 토큰 (${s.requests.toLocaleString()}건)`).join('\n') || '데이터 없음'}

## GPU 인벤토리
${gpuInventory.map(g => `- ${g.type} x${g.count} (${g.vramGb}GB/장)`).join('\n') || '없음'}
- 총 VRAM: ${Math.round(totalVramGb)}GB, GPU 사용률: ${avgGpuUtil ? avgGpuUtil.toFixed(1) + '%' : 'N/A'}, KV Cache: ${avgKvCache ? avgKvCache.toFixed(1) + '%' : 'N/A'}
- 평균 throughput: ${avgThroughput.toFixed(1)} tok/s, 피크 throughput (영업시간): ${peakThroughput.toFixed(1)} tok/s
- 이론 최대 throughput: ${weightedMaxTps.toFixed(1)} tok/s
- GPU 건강도 (피크/이론): ${avgHealthPct ? avgHealthPct.toFixed(1) + '%' : 'N/A'}
- 현재 실효 사용률: ${currentEffUtil ? currentEffUtil.toFixed(1) + '%' : 'N/A'}
${weeksUntilSaturated === 0 ? '- 🚨 현재 이미 포화 상태!' : weeksUntilSaturated != null ? `- ⚠️ 현재 성장률 유지 시 약 ${weeksUntilSaturated}주 후 포화 예상` : '- 포화 시점: 계산 불가 (성장률 0 또는 데이터 부족)'}

## 서비스 품질 메트릭 (최근 스냅샷 기준)
${(() => {
  const allLlms: any[] = [];
  for (const snap of latestSnaps) { const ls = (snap.llmMetrics as any[]) || []; allLlms.push(...ls); }
  const lines: string[] = [];
  for (const l of allLlms) {
    const name = l.modelNames?.[0] || l.containerName || 'unknown';
    const parts: string[] = [`- ${name}:`];
    if (l.ttftMs != null) parts.push(`TTFT ${Math.round(l.ttftMs)}ms`);
    if (l.tpotMs != null) parts.push(`TPOT ${Math.round(l.tpotMs)}ms`);
    if (l.e2eLatencyMs != null) parts.push(`E2E ${Math.round(l.e2eLatencyMs)}ms`);
    if (l.prefixCacheHitRate != null) parts.push(`Cache Hit ${(l.prefixCacheHitRate * 100).toFixed(1)}%`);
    if (l.preemptionCount != null && l.preemptionCount > 0) parts.push(`⚠ Preemption ${l.preemptionCount}회`);
    if (l.queueTimeMs != null) parts.push(`Queue ${Math.round(l.queueTimeMs)}ms`);
    if (parts.length > 1) lines.push(parts.join(' | '));
  }
  return lines.length > 0 ? lines.join('\n') : '- 서비스 품질 데이터 없음';
})()}

## 현재 피크 기준 부족분 (target 무관)
- 피크 실효 사용률: ${peakEffUtil ? peakEffUtil.toFixed(1) + '%' : 'N/A'}
- 피크 KV Cache: ${peakKvMax.toFixed(1)}%
- 현재 피크 부족 VRAM: ${Math.round(currentPeakGapVram)}GB → B300 ${currentPeakB300Units}장
${currentPeakB300Units > 0 ? '⚠️ 현재 피크에서도 이미 리소스 부족!' : '✅ 현재 피크에서는 여유 있음'}

## 예측 (목표 ${targetUserCount.toLocaleString()}명, 성장률 반영)
- 스케일링: x${scalingFactor.toFixed(1)} (기본) → x${growthAdjustedScaling.toFixed(1)} (6개월 성장 반영)
- Method A (모델별 가중치 고정 + KV 스케일 합산): ${Math.round(totalVramA)}GB
- Method B (처리량 스케일): ${Math.round(totalVramB)}GB
- 건강도 보정: x${Math.min(healthMargin, 1.5).toFixed(2)} (건강도 ${avgHealthPct ? avgHealthPct.toFixed(0) + '%' : 'N/A'})
- 안전마진 x${SAFETY_MARGIN}, 에러보정 x${errorMargin.toFixed(2)} → 최종 ${Math.round(predictedTotalVram)}GB
- 부족: ${Math.round(gapVram)}GB → B300(${B300_SPEC.vramGb}GB) ${b300Units}장

## 분석 요청
⚠ 중요: 과소 추정은 서비스 장애로 직결됩니다. 과대 추정(GPU 여유)은 비용 문제지만, 과소 추정(GPU 부족)은 서비스 품질 저하와 사용자 이탈로 이어집니다. 반드시 보수적으로(넉넉하게) 추정하세요.

1. 계산 과정의 논리적 타당성 평가 — 과소 추정 위험이 있다면 반드시 지적
2. 성장 추세 기반 추가 리스크 (인당 토큰 증가, 서비스 고도화, 새 모델 추가 가능성)
3. 보수적이고 넉넉한 최종 권고 (구체적 수치, 과소보다는 과대 추정이 안전)
4. 데이터 신뢰도 (${dataConfidence}) — 데이터 부족 시 더 보수적으로
5. ${targetUserCount.toLocaleString()}명 서비스 시 예상 레이턴시 변화

adjustedB300Units는 위 계산의 ${b300Units}장 이상으로 제시하세요. 줄이지 마세요.

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
    aiAnalysis = `[자동] ${currentUsers}명(DAU ${Math.round(currentDau)}) → 목표 ${targetUserCount.toLocaleString()}명 기준 ${Math.round(predictedTotalVram)}GB 필요 (현재 ${Math.round(totalVramGb)}GB). 부족분: B300 ${calculationDetails.result.b300Units}장. ${currentPeakB300Units > 0 ? `현재 피크에서도 B300 ${currentPeakB300Units}장 부족.` : ''} 주간 성장률 ${(weeklyGrowthRate * 100).toFixed(1)}%.`;
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
