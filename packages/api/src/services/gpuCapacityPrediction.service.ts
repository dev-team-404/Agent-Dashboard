/**
 * GPU Capacity Prediction Service (v2)
 *
 * 매일 KST 01:00 자동 실행:
 * 1. 현재 사용량 + 성장 추세 수집
 * 2. 서비스별/모델별 리소스 분석
 * 3. 주간 성장률 반영 스케일업 예측
 * 4. LLM 분석 리포트 (논리+계산 근거)
 */

import { prisma, pgPool } from '../index.js';
import { B300_SPEC, lookupGpuSpec } from './gpuMonitor.service.js';
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
    max_tokens: 12000, temperature: 0.2, stream: false,
    response_format: { type: 'json_object' },
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

  // 미연결 장비 (모니터링 불가하지만 존재하는 GPU — 추정에 포함)
  const fleetSetting = await prisma.systemSetting.findUnique({ where: { key: 'GPU_UNMONITORED_FLEET' } });
  const unmonitoredFleet: Array<{ type: string; count: number; label?: string; vramGb?: number }> =
    fleetSetting?.value ? JSON.parse(fleetSetting.value) : [];

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

  // ── 벤치마크 기반 예측 (SQL 집계 불필요 — 설정값만 사용) ──
  const { getAllBenchmarks } = await import('./gpuBenchmark.service.js');
  const benchmarks = await getAllBenchmarks();

  // ── GPU 인벤토리 (벤치마크 기반 — SQL 집계 불필요) ──
  const servers = await prisma.gpuServer.findMany({ where: { enabled: true } });

  // 서버별 벤치마크 + GPU 수 집계
  let totalBenchmarkTps = 0, totalBenchmarkConc = 0, totalVramGb = 0, totalGpuCount = 0;
  const serverBreakdown: Array<{ name: string; gpuCount: number; vramGb: number; benchmarkTps: number; benchmarkKv: number; benchmarkConc: number; source: string }> = [];
  const gpuInventory: Array<{ type: string; count: number; vramGb: number }> = [];
  const allModels: string[] = [];

  for (const s of servers) {
    const bm = benchmarks.get(s.id);
    // GPU 수: pgPool로 최신 스냅샷에서 빠르게 확인
    let gpuCount = 0, vramGb = 0, gpuType = 'Unknown';
    try {
      const { rows } = await pgPool.query(`
        SELECT jsonb_array_length(gpu_metrics) as cnt,
          (gpu_metrics->0->>'name') as gpu_name,
          (gpu_metrics->0->>'memTotalMb')::float as mem
        FROM gpu_metric_snapshots WHERE server_id = $1
        ORDER BY timestamp DESC LIMIT 1
      `, [s.id]);
      if (rows[0]) {
        gpuCount = Number(rows[0].cnt) || 0;
        gpuType = rows[0].gpu_name || 'Unknown';
        vramGb = gpuCount * ((Number(rows[0].mem) || 0) / 1024);
      }
    } catch {}

    totalGpuCount += gpuCount;
    totalVramGb += vramGb;
    if (gpuCount > 0) gpuInventory.push({ type: gpuType, count: gpuCount, vramGb: Math.round(vramGb / gpuCount) });

    if (bm) {
      totalBenchmarkTps += bm.peakTps;
      totalBenchmarkConc += bm.peakConcurrent;
      serverBreakdown.push({ name: s.name, gpuCount, vramGb: Math.round(vramGb), benchmarkTps: bm.peakTps, benchmarkKv: bm.peakKvPct, benchmarkConc: bm.peakConcurrent, source: bm.source });
    }
  }

  // 미연결 장비 합산
  for (const uf of unmonitoredFleet) {
    if (uf.count <= 0) continue;
    const spec = lookupGpuSpec(uf.type);
    const vram = uf.vramGb || spec?.vramGb || 80;
    totalVramGb += vram * uf.count;
    totalGpuCount += uf.count;
    gpuInventory.push({ type: `${uf.type} (${uf.label || '미연결'})`, count: uf.count, vramGb: vram });
    // 미연결 장비의 벤치마크: 모니터링 장비의 GPU당 평균 × 미연결 GPU 수
    const avgTpsPerGpu = serverBreakdown.length > 0
      ? serverBreakdown.reduce((s, b) => s + (b.gpuCount > 0 ? b.benchmarkTps / b.gpuCount : 0), 0) / serverBreakdown.length : 0;
    const avgConcPerGpu = serverBreakdown.length > 0
      ? serverBreakdown.reduce((s, b) => s + (b.gpuCount > 0 ? b.benchmarkConc / b.gpuCount : 0), 0) / serverBreakdown.length : 0;
    const avgBmKv = serverBreakdown.length > 0 ? serverBreakdown.reduce((s, b) => s + b.benchmarkKv, 0) / serverBreakdown.length : 0;
    totalBenchmarkTps += avgTpsPerGpu * uf.count;
    totalBenchmarkConc += avgConcPerGpu * uf.count;
    serverBreakdown.push({ name: `${uf.type} (${uf.label || '미연결'})`, gpuCount: uf.count, vramGb: vram * uf.count, benchmarkTps: Math.round(avgTpsPerGpu * uf.count), benchmarkKv: Math.round(avgBmKv), benchmarkConc: Math.round(avgConcPerGpu * uf.count), source: 'estimated' });
  }

  // ── 데이터 신뢰도 판단 ──
  let dataConfidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'HIGH';
  const confidenceIssues: string[] = [];
  if (currentUsers < 10) { dataConfidence = 'LOW'; confidenceIssues.push('사용자 10명 미만'); }
  else if (currentUsers < 50) { dataConfidence = 'MEDIUM'; confidenceIssues.push('사용자 50명 미만'); }
  if (recent5.length < 3) { dataConfidence = 'LOW'; confidenceIssues.push('영업일 데이터 3일 미만'); }
  if (totalGpuCount === 0) { dataConfidence = 'LOW'; confidenceIssues.push('GPU 서버 데이터 없음'); }
  if (benchmarks.size === 0) { dataConfidence = 'LOW'; confidenceIssues.push('벤치마크 미산출 — 재산출 필요'); }
  if (totalBenchmarkTps === 0) { confidenceIssues.push('벤치마크 처리량 0 — 데이터 부족'); if (dataConfidence === 'HIGH') dataConfidence = 'MEDIUM'; }

  // ── 예측 계산 (벤치마크 × 스케일링 — 단순 곱셈, SQL 없음) ──
  const dauRatio = currentUsers > 0 ? currentDau / currentUsers : 0.3;
  const targetDau = targetUserCount * dauRatio;
  const rawScaling = currentDau > 0 ? targetDau / currentDau : targetUserCount / Math.max(currentUsers, 1);
  const scalingFactor = Math.min(rawScaling, MAX_SCALING_FACTOR);
  const tokenGrowthMultiplier = Math.pow(1 + Math.max(tokensPerUserGrowthRate, 0), 26);
  const growthAdjustedScaling = scalingFactor * Math.min(tokenGrowthMultiplier, 3);

  // 에러율 보정
  const errorMargin = errorRate > 0.05 ? 1 + errorRate : 1;

  // ── 3차원 부족분 (벤치마크 기반) ──
  // B300 벤치마크 (GPU 스펙 기반 추정)
  const b300TpsPerUnit = 500;  // B300 1장당 추정 처리량 (모델/설정 의존, 보수적)
  const b300ConcPerUnit = 50;  // B300 1장당 추정 동시 처리

  // 1. 처리량 차원
  const targetTps = totalBenchmarkTps * growthAdjustedScaling;
  const tpsGap = Math.max(0, targetTps - totalBenchmarkTps);
  const tpsB300 = b300TpsPerUnit > 0 ? Math.ceil(tpsGap / b300TpsPerUnit) : 0;

  // 2. KV 메모리 차원 (VRAM 기반)
  const vramNeeded = totalVramGb * growthAdjustedScaling;
  const vramGap = Math.max(0, vramNeeded - totalVramGb);
  const kvB300 = Math.ceil(vramGap / B300_SPEC.vramGb);

  // 3. 동시성 차원
  const targetConc = totalBenchmarkConc * growthAdjustedScaling;
  const concGap = Math.max(0, targetConc - totalBenchmarkConc);
  const concB300 = b300ConcPerUnit > 0 ? Math.ceil(concGap / b300ConcPerUnit) : 0;

  // 최종 = max(3차원) × 안전마진
  const rawB300 = Math.max(tpsB300, kvB300, concB300);
  const b300Units = Math.ceil(rawB300 * SAFETY_MARGIN * errorMargin);
  const gapVram = b300Units * B300_SPEC.vramGb;
  const predictedTotalVram = totalVramGb + gapVram;
  const bottleneck = rawB300 === tpsB300 ? 'throughput' : rawB300 === kvB300 ? 'kvMemory' : 'concurrency';

  // 피크 관련 참조값 (벤치마크에서)
  const peakThroughput = totalBenchmarkTps;
  const avgThroughput = totalBenchmarkTps * 0.5; // 평균 ≈ 피크의 50% 추정
  const avgKvCache = serverBreakdown.length > 0 ? serverBreakdown.reduce((s, b) => s + b.benchmarkKv, 0) / serverBreakdown.length : null;
  const avgGpuUtil = null; // 벤치마크 기반에선 미사용
  const peakConcurrent = Math.round(totalBenchmarkConc);
  const avgHealthPct = null; // compute-bound 기반 → 벤치마크 체계에서 불필요
  const weightedMaxTps = 0; // 미사용
  const weightedBwMaxTps = 0; // 미사용

  // 소진 시점 (벤치마크 기준 — 현재 용량의 몇 주 후 소진)
  const currentCapacityPct = totalBenchmarkTps > 0 ? (avgThroughput / totalBenchmarkTps) * 100 : 0;
  const weeksUntilSaturated = weeklyGrowthRate > 0 && currentCapacityPct < 100
    ? Math.ceil(Math.log(100 / Math.max(currentCapacityPct, 1)) / Math.log(1 + weeklyGrowthRate))
    : currentCapacityPct >= 100 ? 0 : null;

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
      errorRate: Math.round(errorRate * 10000) / 100,
      detectedModels: allModels,
    },
    // 서버별 벤치마크 현황
    serverBreakdown,
    growth: {
      dauGrowthRate: Math.round(dauGrowthRate * 1000) / 10,
      tokensPerUserGrowthRate: Math.round(tokensPerUserGrowthRate * 1000) / 10,
      tokenGrowthMultiplier6mo: Math.round(tokenGrowthMultiplier * 100) / 100,
      growthAdjustedScaling: Math.round(growthAdjustedScaling * 100) / 100,
      note: 'target에 DAU 증가 이미 반영 → 인당 토큰 소비 증가만 추가 반영',
    },
    scaling: {
      targetDau: Math.round(targetDau), scalingFactor: Math.round(scalingFactor * 100) / 100,
      safetyMargin: SAFETY_MARGIN, errorMargin: Math.round(errorMargin * 100) / 100,
      weeksUntilSaturated,
    },
    // 3차원 부족분 분석 (벤치마크 기반)
    dimensionalBreakdown: {
      throughput: { current: Math.round(totalBenchmarkTps), target: Math.round(targetTps), gap: Math.round(tpsGap), b300: tpsB300 },
      kvMemory: { currentVram: Math.round(totalVramGb), targetVram: Math.round(vramNeeded), gap: Math.round(vramGap), b300: kvB300 },
      concurrency: { current: peakConcurrent, target: Math.round(targetConc), gap: Math.round(concGap), b300: concB300 },
      bottleneck,
      b300PerUnit: { tps: b300TpsPerUnit, concurrent: b300ConcPerUnit, vramGb: B300_SPEC.vramGb },
    },
    result: { predictedTotalVram: Math.round(predictedTotalVram), gapVram: Math.round(gapVram), b300Units },
    topServices, dataConfidence, confidenceIssues,
    unmonitoredFleet: unmonitoredFleet.length > 0 ? unmonitoredFleet.map(f => ({ ...f, totalVramGb: (f.vramGb || lookupGpuSpec(f.type)?.vramGb || 80) * f.count })) : [],
    monthlyForecast: [] as Array<{ month: string; tokenGrowthMultiplier: number; totalScaling: number; predictedVramGb: number; gapVramGb: number; b300Units: number; growthOnlyB300: number }>,
  };

  // ── 월별 예측 (현재 월 ~ 올해 12월, 인당 토큰 성장률 기반) ──
  // 두 가지 관점:
  //   growthOnly: 현재 인프라 유지 시 성장만 반영한 부족분 (투자 시급성)
  //   withTarget: target 인원 기준 월별 투자 스케줄
  {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const monthsToDecember = Math.max(0, 12 - currentMonth);

    const forecast: Array<{ month: string; tokenGrowthMultiplier: number; totalScaling: number; predictedVramGb: number; gapVramGb: number; b300Units: number; growthOnlyB300: number }> = [];

    for (let i = 1; i <= monthsToDecember; i++) {
      const futureMonth = currentMonth + i;
      const monthLabel = `${currentYear}-${String(futureMonth).padStart(2, '0')}`;
      const weeksFromNow = i * 4.33;
      const tokenGrowthAtM = Math.pow(1 + Math.max(tokensPerUserGrowthRate, 0), weeksFromNow);
      const cappedTokenGrowth = Math.min(tokenGrowthAtM, 3);

      // ── 현재 인프라 유지 시 (성장률만 반영, target 무관, 벤치마크 기반) ──
      let growthOnlyB300 = 0;
      if (totalBenchmarkTps > 0) {
        const futureRequired = totalBenchmarkTps * cappedTokenGrowth;
        const growthGap = Math.max(0, futureRequired - totalBenchmarkTps);
        growthOnlyB300 = b300TpsPerUnit > 0 ? Math.ceil(Math.ceil(growthGap / b300TpsPerUnit) * SAFETY_MARGIN * errorMargin) : 0;
      }

      // ── target 기준 (벤치마크 3차원) ──
      const scalingAtM = scalingFactor * cappedTokenGrowth;
      const tpsB300m = b300TpsPerUnit > 0 ? Math.ceil(Math.max(0, totalBenchmarkTps * scalingAtM - totalBenchmarkTps) / b300TpsPerUnit) : 0;
      const kvB300m = Math.ceil(Math.max(0, totalVramGb * scalingAtM - totalVramGb) / B300_SPEC.vramGb);
      const concB300m = b300ConcPerUnit > 0 ? Math.ceil(Math.max(0, totalBenchmarkConc * scalingAtM - totalBenchmarkConc) / b300ConcPerUnit) : 0;
      const rawB300_m = Math.max(tpsB300m, kvB300m, concB300m);
      const b300Units_m = Math.ceil(rawB300_m * SAFETY_MARGIN * errorMargin);
      const gapVram_m = b300Units_m * B300_SPEC.vramGb;

      forecast.push({
        month: monthLabel,
        tokenGrowthMultiplier: Math.round(cappedTokenGrowth * 100) / 100,
        totalScaling: Math.round(scalingAtM * 100) / 100,
        predictedVramGb: Math.round(totalVramGb + gapVram_m),
        gapVramGb: Math.round(gapVram_m),
        b300Units: b300Units_m,
        growthOnlyB300, // 현재 인프라 유지 시 성장으로 인한 추가 B300
      });
    }

    calculationDetails.monthlyForecast = forecast;
  }

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

## 서버별 벤치마크 (관측 P95 피크 기반)
${serverBreakdown.map(s => `- ${s.name}: GPU ${s.gpuCount}장 | 피크 ${s.benchmarkTps} tok/s | KV피크 ${s.benchmarkKv}% | 동시피크 ${s.benchmarkConc}건 | 출처: ${s.source}`).join('\n') || '- 벤치마크 미산출'}

## 사용자 현황 (추이 아닌 절대값 — 외부 사용량 전송 서비스로 인해 추이 부정확)
- DAU: ${Math.round(currentDau)}명 (최근 5영업일 평균)
- 전체 사용자: ${currentUsers}명 (최근 30일)
- 인당 평균 토큰: ${Math.round(avgTokensPerUser).toLocaleString()}/일
- 6개월 스케일링 배율: x${tokenGrowthMultiplier.toFixed(2)} (참고용)

## 서비스별 토큰 소비 Top 5
${topServices.map((s, i) => `${i + 1}. ${s.name}: ${s.tokens.toLocaleString()} 토큰 (${s.requests.toLocaleString()}건)`).join('\n') || '데이터 없음'}

## GPU 인벤토리
${gpuInventory.map(g => `- ${g.type} x${g.count} (${g.vramGb}GB/장)`).join('\n') || '없음'}
${unmonitoredFleet.length > 0 ? `\n※ 미연결 장비 포함 (모니터링 불가, 평균 사용률 가정):\n${unmonitoredFleet.map(f => `  - ${f.type} x${f.count} (${f.label || '미연결'}) — VRAM ${(f.vramGb || 80) * f.count}GB`).join('\n')}` : ''}
- 총 VRAM: ${Math.round(totalVramGb)}GB, GPU ${totalGpuCount}장
- 벤치마크 총 용량: ${Math.round(totalBenchmarkTps)} tok/s, 동시 ${peakConcurrent}건
- 평균 KV Cache: ${avgKvCache ? avgKvCache.toFixed(1) + '%' : 'N/A'}
${weeksUntilSaturated === 0 ? '- 🚨 현재 이미 포화 상태!' : weeksUntilSaturated != null ? `- ⚠️ 현재 성장률 유지 시 약 ${weeksUntilSaturated}주 후 포화 예상` : ''}

## 3차원 부족분 예측 (목표 ${targetUserCount.toLocaleString()}명, 벤치마크 기반)
- 스케일링: x${scalingFactor.toFixed(1)} × 인당 토큰 성장 x${tokenGrowthMultiplier.toFixed(2)} = x${growthAdjustedScaling.toFixed(1)}

| 차원 | 현재 용량 | 목표 | 부족분 | B300 필요 |
|------|----------|------|--------|----------|
| 처리량 | ${Math.round(totalBenchmarkTps)} tok/s | ${Math.round(targetTps)} tok/s | ${Math.round(tpsGap)} tok/s | ${tpsB300}장 |
| KV 메모리 | ${Math.round(totalVramGb)}GB | ${Math.round(vramNeeded)}GB | ${Math.round(vramGap)}GB | ${kvB300}장 |
| 동시처리 | ${peakConcurrent}건 | ${Math.round(targetConc)}건 | ${Math.round(concGap)}건 | ${concB300}장 |
| **병목** | | | | **${bottleneck === 'throughput' ? '처리량' : bottleneck === 'kvMemory' ? 'KV메모리' : '동시처리'}** |

- 안전마진 x${SAFETY_MARGIN}, 에러보정 x${errorMargin.toFixed(2)}
- **최종: B300 ${b300Units}장** (${Math.round(gapVram)}GB)
- 병목 차원: ${bottleneck === 'throughput' ? '처리량' : bottleneck === 'kvMemory' ? 'KV 메모리' : '동시처리'}

## 월별 예측 (${new Date().getFullYear()}년 말까지, 인당 토큰 성장 반영)
${calculationDetails.monthlyForecast.length > 0
  ? '| 월 | 토큰 성장 | 성장만 B300 | 목표 기준 B300 | 목표 기준 VRAM |\n|---|---|---|---|---|\n' +
    calculationDetails.monthlyForecast.map(f =>
      `| ${f.month} | x${f.tokenGrowthMultiplier} | +${f.growthOnlyB300}장 | +${f.b300Units}장 | ${f.predictedVramGb}GB |`
    ).join('\n')
  : '- 월별 예측 데이터 없음 (이미 12월 이후)'}

※ "성장만 B300" = 현재 인프라 유지하면서 토큰 성장만 대응하는 데 필요한 추가 장비
※ "목표 기준 B300" = 목표 ${targetUserCount.toLocaleString()}명 + 토큰 성장 대응 총 필요 장비

위 월별 추이에서 가파른 증가 구간이 있다면 해당 시점 전에 GPU 확보가 완료되어야 함을 강조하세요.

## 산업 트렌드 (인당 토큰 소비 급증 근거)
⚠ 아래 외부 리서치는 과소 추정 위험을 방지하기 위해 반드시 참고하세요:
- IDC FutureScape 2026: 2027년까지 토큰/API 호출 로드 1,000배 증가, 에이전트 사용 10배 증가
- Deloitte TMT 2026: AI 컴퓨팅 수요 연 4-5배 성장, 추론이 2026년 전체 컴퓨팅의 2/3 차지
- OpenAI Enterprise AI 2025: 추론 토큰 소비 조직당 연 320배 증가 (관측치)
- Sequoia Capital 2025: 지식 노동자당 컴퓨팅 10~10,000배 증가 전망
- Gartner 2025: 2026년 말 기업 앱의 40%에 AI 에이전트 탑재 (현재 <5%)
- Agentic AI 시스템은 단순 Q&A 대비 10~100배 토큰 소비 (multi-step reasoning + tool use + context 재전송)
- Test-time scaling (chain-of-thought): 단순 추론 대비 100배 이상 컴퓨팅 (Deloitte)

현재 우리 조직도 agentic system 확산 예정이며, 인당 토큰 소비가 월 10% 이상 증가할 것으로 전망합니다.
위 계산의 인당 토큰 성장률(${(tokensPerUserGrowthRate * 100).toFixed(1)}%/주)이 이 추세 대비 보수적인지 반드시 평가하세요.

## 분석 요청
⚠ 중요: 과소 추정은 서비스 장애로 직결됩니다. 과대 추정(GPU 여유)은 비용 문제지만, 과소 추정(GPU 부족)은 서비스 품질 저하와 사용자 이탈로 이어집니다. 과소 투자가 훨씬 위험합니다. 반드시 보수적으로(넉넉하게) 추정하세요.

1. 계산 과정의 논리적 타당성 평가 — 과소 추정 위험이 있다면 반드시 지적
2. 성장 추세 기반 추가 리스크 (인당 토큰 증가, agentic system 확산, 새 모델 추가, 서비스 고도화)
3. 위 산업 트렌드 대비 우리 성장률 가정이 충분히 보수적인지 평가
4. 보수적이고 넉넉한 최종 권고 (구체적 수치, 과소보다는 과대 추정이 안전)
5. 데이터 신뢰도 (${dataConfidence}) — 데이터 부족 시 더 보수적으로
6. ${targetUserCount.toLocaleString()}명 서비스 시 예상 레이턴시 변화

adjustedB300Units는 위 계산의 ${b300Units}장 이상으로 제시하세요. 줄이지 마세요.

추가로, 경영진/비전문가도 이해할 수 있는 "경영 의사결정 보고서"도 작성하세요:
- GPU, VRAM, throughput 같은 전문 용어를 피하고 비유나 쉬운 표현 사용
- "서버 처리 능력", "추가 장비 N대", "월 예상 비용" 등 비즈니스 관점
- 핵심 메시지: 현재 상태, 목표 달성에 필요한 투자, 투자하지 않았을 때의 리스크
- 산업 트렌드 근거에는 반드시 출처 링크를 마크다운으로 포함하세요:
  - IDC FutureScape: https://my.idc.com/getdoc.jsp?containerId=prUS53883425
  - Deloitte TMT 2026: https://www.deloitte.com/us/en/insights/industry/technology/technology-media-and-telecom-predictions/2026/compute-power-ai.html
  - Gartner AI Agents 2026: https://www.gartner.com/en/newsroom/press-releases/2025-08-26-gartner-predicts-40-percent-of-enterprise-apps-will-feature-task-specific-ai-agents-by-2026
  - Sequoia AI 2025: https://sequoiacap.com/article/ai-in-2025/
  - Stanford HAI 2025: https://hai.stanford.edu/ai-index/2025-ai-index-report
- 근거를 인용할 때 "(출처: [IDC FutureScape 2026](링크))" 형식으로 자연스럽게 포함
- 4-6문단, 보고서 톤, 간결하면서 핵심 전달

JSON으로만 응답: {"analysis":"...기술 분석(한국어, 마크다운)...","executiveReport":"...경영 보고서(한국어, 마크다운)...","confidence":"HIGH|MEDIUM|LOW","adjustedB300Units":<숫자>,"recommendations":["...",...],"predictedLatencyMs":<숫자|null>}`;

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
            if (parsed.executiveReport) (calculationDetails as any).executiveReport = parsed.executiveReport;
          } else { aiAnalysis = raw; }
        } catch { aiAnalysis = raw; }
      }
    }
  } catch (err: any) {
    console.error('[GPU Capacity] LLM failed:', err.message);
    aiAnalysis = `LLM 분석 실패: ${err.message}`;
  }

  if (!aiAnalysis) {
    aiAnalysis = `[자동] ${currentUsers}명(DAU ${Math.round(currentDau)}) → 목표 ${targetUserCount.toLocaleString()}명 기준 B300 ${calculationDetails.result.b300Units}장 필요. 병목: ${bottleneck === 'throughput' ? '처리량' : bottleneck === 'kvMemory' ? 'KV메모리' : '동시처리'}. 주간 성장률 ${(weeklyGrowthRate * 100).toFixed(1)}%.`;
  }

  // ── DB 저장 (타입 안전장치) ──
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const safeInt = (v: any): number => { const n = parseInt(String(v), 10); return isNaN(n) ? 0 : n; };
  const safeFloat = (v: any): number => { const n = parseFloat(String(v)); return isNaN(n) ? 0 : n; };
  const safeFloatNull = (v: any): number | null => { if (v == null) return null; const n = parseFloat(String(v)); return isNaN(n) ? null : n; };
  const safeConfidence = (v: string): string => ['HIGH', 'MEDIUM', 'LOW'].includes(v) ? v : dataConfidence;

  const dbData = {
    targetUserCount: safeInt(targetUserCount), currentDau: safeFloat(currentDau), currentUsers: safeInt(currentUsers),
    avgTokensPerUserPerDay: safeFloat(avgTokensPerUser), avgRequestsPerUserPerDay: safeFloat(avgRequestsPerUser),
    peakConcurrentRequests: safeInt(peakConcurrent), avgLatencyMs: safeFloatNull(avgLatencyMs),
    currentGpuInventory: gpuInventory as any, currentTotalVramGb: safeFloat(totalVramGb),
    currentAvgGpuUtil: safeFloatNull(avgGpuUtil), currentAvgKvCache: safeFloatNull(avgKvCache),
    predictedTotalVramGb: safeFloat(predictedTotalVram), predictedGpuCount: predictedGpuCount as any,
    predictedB300Units: safeInt(calculationDetails.result.b300Units), gapVramGb: safeFloat(gapVram),
    scalingFactor: safeFloat(growthAdjustedScaling), safetyMargin: safeFloat(SAFETY_MARGIN),
    aiAnalysis: String(aiAnalysis || ''), aiConfidence: safeConfidence(aiConfidence),
    modelId: modelId || 'none', calculationDetails: calculationDetails as any,
  };

  const prediction = await prisma.gpuCapacityPrediction.upsert({
    where: { date: today },
    update: dbData,
    create: { date: today, ...dbData },
  });

  console.log(`[GPU Capacity] Done: B300 ${calculationDetails.result.b300Units}장 (gap ${Math.round(gapVram)}GB, growth x${tokenGrowthMultiplier.toFixed(2)})`);
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
