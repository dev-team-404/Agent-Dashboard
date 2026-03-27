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
import { B300_SPEC, lookupGpuSpec, calcTheoreticalMaxTps, calcBandwidthMaxTps, estimateModelParams, detectPrecision } from './gpuMonitor.service.js';
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

  // ── GPU 메트릭 (영업시간만, pg 직접 쿼리 — Prisma napi 완전 우회) ──
  const holidayDates = holidays.map(h => h.date.toISOString().split('T')[0]);
  const holidayClause = holidayDates.length > 0
    ? `AND to_char(s.timestamp + INTERVAL '9 hours', 'YYYY-MM-DD') NOT IN (${holidayDates.map((_, i) => `$${i + 2}`).join(',')})`
    : '';
  const bizParams = [sevenDaysAgo, ...holidayDates];

  const { rows: bizRows } = await pgPool.query(`
    SELECT
      (SELECT AVG((g->>'utilGpu')::float) FROM jsonb_array_elements(s.gpu_metrics) g) AS gpu,
      (SELECT AVG((l->>'kvCacheUsagePct')::float)
        FROM jsonb_array_elements(COALESCE(s.llm_metrics,'[]'::jsonb)) l
        WHERE (l->>'kvCacheUsagePct') IS NOT NULL) AS kv,
      (SELECT SUM(COALESCE((l->>'promptThroughputTps')::float,0)+COALESCE((l->>'genThroughputTps')::float,0))
        FROM jsonb_array_elements(COALESCE(s.llm_metrics,'[]'::jsonb)) l) AS tps,
      (SELECT SUM(COALESCE((l->>'runningRequests')::float,0)+COALESCE((l->>'waitingRequests')::float,0))
        FROM jsonb_array_elements(COALESCE(s.llm_metrics,'[]'::jsonb)) l) AS concurrent
    FROM gpu_metric_snapshots s
    WHERE s.timestamp >= $1
      AND EXTRACT(HOUR FROM s.timestamp + INTERVAL '9 hours') BETWEEN 9 AND 17
      AND EXTRACT(DOW FROM s.timestamp + INTERVAL '9 hours') BETWEEN 1 AND 5
      ${holidayClause}
  `, bizParams);

  let totalGpuUtilSum = 0, gpuUtilCount = 0, totalKvSum = 0, kvCount = 0;
  let totalTpSum = 0, tpCount = 0;
  const concurrents: number[] = [];
  for (const r of bizRows) {
    if (r.gpu != null) { totalGpuUtilSum += +r.gpu; gpuUtilCount++; }
    if (r.kv != null) { totalKvSum += +r.kv; kvCount++; }
    const tps = +(r.tps || 0);
    if (tps > 0) { totalTpSum += tps; tpCount++; }
    const conc = +(r.concurrent || 0);
    if (conc > 0) concurrents.push(conc);
  }
  concurrents.sort((a, b) => a - b);
  const peakConcurrent = concurrents.length > 0 ? Math.round(concurrents[Math.min(Math.floor(concurrents.length * 0.95), concurrents.length - 1)]) : 0;
  const avgGpuUtil = gpuUtilCount > 0 ? totalGpuUtilSum / gpuUtilCount : null;
  const avgKvCache = kvCount > 0 ? totalKvSum / kvCount : null;
  const avgThroughput = tpCount > 0 ? totalTpSum / tpCount : 0;

  // ── GPU 인벤토리 ──
  const servers = await prisma.gpuServer.findMany({ where: { enabled: true } });
  let latestSnaps: Array<{ serverId: string; gpuMetrics: any; llmMetrics: any }> = [];
  try {
    latestSnaps = await prisma.gpuMetricSnapshot.findMany({
      where: { serverId: { in: servers.map(s => s.id) } },
      orderBy: { timestamp: 'desc' }, distinct: ['serverId'],
      select: { serverId: true, gpuMetrics: true, llmMetrics: true },
    });
  } catch (snapErr: any) {
    console.error('[GPU Capacity] latestSnaps findMany failed, trying raw fallback:', snapErr.message);
    try {
      const serverIds = servers.map(s => s.id);
      if (serverIds.length > 0) {
        const rawSnaps = await prisma.$queryRaw<Array<{ server_id: string; gpu_metrics: string; llm_metrics: string }>>`
          SELECT DISTINCT ON (server_id) server_id, gpu_metrics::text, llm_metrics::text
          FROM gpu_metric_snapshots WHERE server_id = ANY(${serverIds}) ORDER BY server_id, timestamp DESC`;
        latestSnaps = rawSnaps.map(r => {
          try { return { serverId: r.server_id, gpuMetrics: JSON.parse(r.gpu_metrics || '[]'), llmMetrics: JSON.parse(r.llm_metrics || '[]') }; }
          catch { return { serverId: r.server_id, gpuMetrics: [], llmMetrics: [] }; }
        });
      }
    } catch (rawErr: any) {
      console.error('[GPU Capacity] Raw latestSnaps fallback also failed:', rawErr.message);
    }
  }

  const inventoryMap = new Map<string, { count: number; vramGb: number; spec: any }>();
  let totalVramGb = 0;
  const allModels: string[] = [];

  // GPU 인벤토리 수집 + 최신 precision 정보 수집
  const modelPrecisionMap = new Map<string, 'fp8' | 'fp16'>(); // 모델별 실제 precision
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
        // precision 필드가 있으면 사용 (SSH 수집 시 /v1/models에서 감지됨)
        const modelKey = names[0] || l.containerName || 'unknown';
        if (l.precision) modelPrecisionMap.set(modelKey, l.precision);
      }
    }
  }

  // ── 모델별 프로파일: 7일 영업시간 전체 스냅샷 기반 (최신 1개 아님) ──
  interface ModelProfile {
    name: string;
    params: number | null;
    precision: 'fp8' | 'fp16';
    avgTps: number;       // 영업시간 평균 throughput
    peakTps: number;      // 영업시간 피크 throughput
    avgKvPct: number;     // 영업시간 평균 KV cache
    gpuCount: number;     // 사용 GPU 수 (추정)
    tpsRatio: number;     // 전체 대비 throughput 비율
  }
  // 모델별 throughput/KV cache 수집 (pg 직접)
  const modelTpsMap = new Map<string, { totalTps: number; count: number; peakTps: number; totalKv: number; kvCount: number }>();

  const { rows: modelAggRows } = await pgPool.query(`
    SELECT
      COALESCE(l->'modelNames'->>0, l->>'containerName', 'unknown') AS model_key,
      SUM(COALESCE((l->>'promptThroughputTps')::float, 0) + COALESCE((l->>'genThroughputTps')::float, 0)) AS total_tps,
      COUNT(*) AS count,
      MAX(COALESCE((l->>'promptThroughputTps')::float, 0) + COALESCE((l->>'genThroughputTps')::float, 0)) AS peak_tps,
      AVG((l->>'kvCacheUsagePct')::float) FILTER (WHERE (l->>'kvCacheUsagePct') IS NOT NULL) AS avg_kv,
      COUNT(*) FILTER (WHERE (l->>'kvCacheUsagePct') IS NOT NULL) AS kv_count,
      MAX(l->>'precision') AS precision
    FROM gpu_metric_snapshots s, jsonb_array_elements(COALESCE(s.llm_metrics, '[]'::jsonb)) AS l
    WHERE s.timestamp >= $1
      AND EXTRACT(HOUR FROM s.timestamp + INTERVAL '9 hours') BETWEEN 9 AND 17
      AND EXTRACT(DOW FROM s.timestamp + INTERVAL '9 hours') BETWEEN 1 AND 5
      ${holidayClause}
    GROUP BY model_key
  `, bizParams);

  for (const row of modelAggRows) {
    modelTpsMap.set(row.model_key, {
      totalTps: Number(row.total_tps) || 0, count: Number(row.count), peakTps: Number(row.peak_tps) || 0,
      totalKv: (Number(row.avg_kv) || 0) * Number(row.kv_count), kvCount: Number(row.kv_count),
    });
    if (row.precision && !modelPrecisionMap.has(row.model_key)) {
      modelPrecisionMap.set(row.model_key, row.precision as 'fp8' | 'fp16');
    }
  }

  // 모델 프로파일 구축
  const totalModelTps = Array.from(modelTpsMap.values()).reduce((s, m) => s + (m.count > 0 ? m.totalTps / m.count : 0), 0);
  const modelProfiles: ModelProfile[] = [];
  for (const [name, data] of modelTpsMap) {
    const avgTps = data.count > 0 ? data.totalTps / data.count : 0;
    const params = estimateModelParams(name);
    // precision: 1) llmMetrics.precision 필드 → 2) 이름에서 감지
    const precision = modelPrecisionMap.get(name) || detectPrecision(name);
    modelProfiles.push({
      name, params, precision,
      avgTps, peakTps: data.peakTps,
      avgKvPct: data.kvCount > 0 ? data.totalKv / data.kvCount : 0,
      gpuCount: 0,
      tpsRatio: totalModelTps > 0 ? avgTps / totalModelTps : 1 / Math.max(modelTpsMap.size, 1),
    });
  }

  // GPU 배분 추정: params 비례 (크기가 큰 모델이 더 많은 GPU 사용)
  // params 없으면 tpsRatio fallback
  const totalGpuForModels = Array.from(inventoryMap.values()).reduce((s, v) => s + v.count, 0);
  if (modelProfiles.length > 0) {
    const totalParams = modelProfiles.reduce((s, m) => s + (m.params || 7), 0); // 없으면 7B 가정
    let allocated = 0;
    for (let i = 0; i < modelProfiles.length; i++) {
      if (i === modelProfiles.length - 1) {
        modelProfiles[i].gpuCount = Math.max(1, totalGpuForModels - allocated);
      } else {
        const ratio = (modelProfiles[i].params || 7) / totalParams;
        const cnt = Math.max(1, Math.round(totalGpuForModels * ratio));
        // 총합 캡: 남은 GPU에서 최소 1장은 다음 모델에 남겨야 함
        const remaining = modelProfiles.length - i - 1;
        const maxAllowable = totalGpuForModels - allocated - remaining;
        modelProfiles[i].gpuCount = Math.min(cnt, Math.max(1, maxAllowable));
        allocated += modelProfiles[i].gpuCount;
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
  //
  // 핵심 원리:
  // - GPU 추가가 필요한 이유는 처리량(throughput) 부족
  // - VRAM은 GPU 수에 따라 자동으로 따라옴
  // - 이론 최대(compute-bound)는 실제의 100-300배 → 직접 스케일링에 쓸 수 없음
  // - 대신 관측된 실제 피크 throughput 기반으로 계산
  //
  const dauRatio = currentUsers > 0 ? currentDau / currentUsers : 0.3;
  const targetDau = targetUserCount * dauRatio;
  const rawScaling = currentDau > 0 ? targetDau / currentDau : targetUserCount / Math.max(currentUsers, 1);
  const scalingFactor = Math.min(rawScaling, MAX_SCALING_FACTOR);

  // 성장률: 인당 토큰 소비 증가만 반영 (DAU 증가는 target에 이미 포함 — 이중 적용 방지)
  const tokenGrowthMultiplier = Math.pow(1 + Math.max(tokensPerUserGrowthRate, 0), 26); // 26주
  const growthAdjustedScaling = scalingFactor * Math.min(tokenGrowthMultiplier, 3);

  // ── 모델별 이론 최대 throughput (표시용, 스케일링에는 미사용) ──
  let weightedMaxTps = 0;
  let weightedBwMaxTps = 0;
  const modelBreakdown: Array<{ name: string; params: number | null; precision: string; tpsRatio: number; avgTps: number; peakTps: number; theoreticalMaxTps: number; bandwidthMaxTps: number; avgKvPct: number; gpuCount: number }> = [];

  let dominantSpec: any = null;
  let dominantCount = 0;
  for (const [, inv] of inventoryMap) { if (inv.count > dominantCount) { dominantCount = inv.count; dominantSpec = inv.spec; } }

  for (const mp of modelProfiles) {
    let modelMaxTps = 0;
    let modelBwMaxTps = 0;
    if (mp.params && dominantSpec) {
      modelMaxTps = calcTheoreticalMaxTps(dominantSpec, mp.gpuCount, mp.params, mp.precision);
      modelBwMaxTps = calcBandwidthMaxTps(dominantSpec, mp.gpuCount, mp.params, mp.precision);
    }
    weightedMaxTps += modelMaxTps;
    weightedBwMaxTps += modelBwMaxTps;
    modelBreakdown.push({
      name: mp.name, params: mp.params, precision: mp.precision,
      tpsRatio: Math.round(mp.tpsRatio * 1000) / 10,
      avgTps: Math.round(mp.avgTps * 10) / 10, peakTps: Math.round(mp.peakTps * 10) / 10,
      theoreticalMaxTps: Math.round(modelMaxTps * 10) / 10,
      bandwidthMaxTps: Math.round(modelBwMaxTps * 10) / 10,
      avgKvPct: Math.round(mp.avgKvPct * 10) / 10, gpuCount: mp.gpuCount,
    });
  }
  if (weightedMaxTps === 0 && dominantSpec) {
    const fbParams = modelProfiles.reduce((mx, m) => m.params && m.params > mx ? m.params : mx, 0) || 70;
    weightedMaxTps = calcTheoreticalMaxTps(dominantSpec, totalGpuCount, fbParams);
    weightedBwMaxTps = calcBandwidthMaxTps(dominantSpec, totalGpuCount, fbParams);
  }

  // ── 피크 throughput (7일, 영업시간, pg 직접) ──
  const { rows: peakTpsRows } = await pgPool.query(`
    SELECT MAX(snap_tps) AS peak_tps FROM (
      SELECT COALESCE(SUM(
        COALESCE((l->>'promptThroughputTps')::float, 0) + COALESCE((l->>'genThroughputTps')::float, 0)
      ), 0) AS snap_tps
      FROM gpu_metric_snapshots s
      LEFT JOIN jsonb_array_elements(COALESCE(s.llm_metrics, '[]'::jsonb)) AS l ON true
      WHERE s.timestamp >= $1
        AND EXTRACT(HOUR FROM s.timestamp + INTERVAL '9 hours') BETWEEN 9 AND 17
        AND EXTRACT(DOW FROM s.timestamp + INTERVAL '9 hours') BETWEEN 1 AND 5
        ${holidayClause}
      GROUP BY s.id
    ) sub
  `, bizParams);
  const peakThroughput = Number(peakTpsRows[0]?.peak_tps || 0);
  const avgHealthPct = weightedMaxTps > 0 && peakThroughput > 0
    ? Math.min((peakThroughput / weightedMaxTps) * 100, 100) : null;

  // 에러율 보정
  const errorMargin = errorRate > 0.05 ? 1 + errorRate : 1;

  // ──────────────────────────────────────────────────
  // Method A: 실측 피크 throughput 기반 GPU 수 산출
  // "현재 GPU N장이 피크 X tok/s를 내고 있다 → 목표에는 Y tok/s 필요 → GPU 몇 장?"
  // 관측된 실 처리량 사용 → 건강도/효율이 이미 반영됨 → healthMargin 불필요
  // ──────────────────────────────────────────────────
  let methodA_rawB300 = 0;
  let methodA_detail = '';
  if (peakThroughput > 0 && totalGpuCount > 0) {
    const observedTpsPerGpu = peakThroughput / totalGpuCount;
    const targetPeakTps = peakThroughput * growthAdjustedScaling;
    const targetGpuCount = Math.ceil(targetPeakTps / observedTpsPerGpu);
    const additionalGpuEquiv = Math.max(0, targetGpuCount - totalGpuCount);
    // B300은 현재 GPU보다 성능이 높음 → 더 적은 수로 동일 처리량
    const dominantTflops = dominantSpec?.fp16Tflops || 989;
    const b300Advantage = B300_SPEC.fp16Tflops / dominantTflops;
    methodA_rawB300 = Math.ceil(additionalGpuEquiv / b300Advantage);
    methodA_detail = `피크 ${peakThroughput.toFixed(1)} tok/s (GPU당 ${observedTpsPerGpu.toFixed(1)}) × ${growthAdjustedScaling.toFixed(1)}배 = ${targetPeakTps.toFixed(0)} tok/s → GPU ${targetGpuCount}장 (현재 ${totalGpuCount}) → B300 ${methodA_rawB300}장 (${b300Advantage.toFixed(1)}x 효율)`;
  } else {
    // 처리량 데이터 없으면 VRAM 선형 fallback (과소 추정 위험이므로 보수적)
    const additionalVram = totalVramGb * Math.max(growthAdjustedScaling - 1, 0);
    methodA_rawB300 = Math.ceil(additionalVram / B300_SPEC.vramGb);
    methodA_detail = 'LLM 처리량 데이터 없음 → VRAM 선형 스케일링 fallback (보수적)';
  }

  // ──────────────────────────────────────────────────
  // Method B: VRAM 복제 기반 (단순 선형)
  // "GPU를 N배로 늘리면 VRAM도 N배 → 추가분을 B300으로 변환"
  // 이론이 아닌 실 운영 관점: 동일 구성 복제
  // ──────────────────────────────────────────────────
  const totalVramNeeded = totalVramGb * growthAdjustedScaling;
  const vramGapB = Math.max(0, totalVramNeeded - totalVramGb);
  const methodB_rawB300 = Math.ceil(vramGapB / B300_SPEC.vramGb);

  // ──────────────────────────────────────────────────
  // 최종: 두 방법 중 보수적(큰 값) × 안전마진 × 에러보정
  // healthMargin 제거: 관측 피크 throughput에 이미 효율 반영됨
  // ──────────────────────────────────────────────────
  const rawB300 = Math.max(methodA_rawB300, methodB_rawB300);
  const b300Units = Math.ceil(rawB300 * SAFETY_MARGIN * errorMargin);
  const gapVram = b300Units * B300_SPEC.vramGb;
  const predictedTotalVram = totalVramGb + gapVram;

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
  // peakEffUtil = 피크 때 실효 사용률 (순환 참조 방지: avgHealthPct 대신 직접 계산)
  // 실효 사용률 = 실 처리량 / 실 처리 가능량
  // 실 처리 가능량 = 이론max × 건강도 = weightedMaxTps × avgHealthPct / 100
  // 하지만 avgHealthPct = peakThroughput / weightedMaxTps 이므로 순환됨
  //
  // 올바른 접근: 피크 부족은 throughput 관점 + KV cache 관점을 복합 판단
  //   1) throughput 관점: 피크 throughput이 이론 최대의 몇 %인지 (= avgHealthPct)
  //   2) KV cache 관점: 피크 때 KV cache가 몇 %까지 차는지
  //   3) 복합: 둘 중 하나라도 위험 수준이면 부족
  // 피크 KV cache + waiting/preemption (pg 직접)
  const { rows: peakShortageRows } = await pgPool.query(`
    SELECT
      MAX(sub.avg_kv) AS peak_kv,
      COUNT(*) FILTER (WHERE sub.total_waiting > 0) AS waiting_snaps,
      SUM(sub.total_preemption) AS preemption_total,
      COUNT(*) AS total_snaps
    FROM (
      SELECT
        AVG((l->>'kvCacheUsagePct')::float) FILTER (WHERE (l->>'kvCacheUsagePct') IS NOT NULL) AS avg_kv,
        SUM(COALESCE((l->>'waitingRequests')::float, 0)) AS total_waiting,
        SUM(COALESCE((l->>'preemptionCount')::float, 0)) AS total_preemption
      FROM gpu_metric_snapshots s
      LEFT JOIN jsonb_array_elements(COALESCE(s.llm_metrics, '[]'::jsonb)) AS l ON true
      WHERE s.timestamp >= $1
        AND EXTRACT(HOUR FROM s.timestamp + INTERVAL '9 hours') BETWEEN 9 AND 17
        AND EXTRACT(DOW FROM s.timestamp + INTERVAL '9 hours') BETWEEN 1 AND 5
        ${holidayClause}
      GROUP BY s.id
    ) sub
  `, bizParams);
  const peakShortageAgg = peakShortageRows;

  const peakKvMax = Number(peakShortageAgg[0]?.peak_kv || 0);
  const peakThroughputPct = weightedMaxTps > 0 ? (peakThroughput / weightedMaxTps) * 100 : null;
  const snapCountForPeak = Number(peakShortageAgg[0]?.total_snaps || 0);
  const peakWaitingCount = Number(peakShortageAgg[0]?.waiting_snaps || 0);
  const peakPreemptionTotal = Number(peakShortageAgg[0]?.preemption_total || 0);
  const waitingFrequencyPct = snapCountForPeak > 0 ? (peakWaitingCount / snapCountForPeak) * 100 : 0;

  // 복합 부족 판단: KV↑ OR waiting 빈발 OR preemption 빈발
  const isKvShort = peakKvMax >= 80;
  const isWaitingShort = waitingFrequencyPct >= 30; // 30% 이상의 스냅샷에서 대기 발생
  const isPreemptionShort = peakPreemptionTotal > 10;  // 7일간 preemption 10회 이상

  let currentPeakGapVram = 0;
  if (isKvShort) {
    // KV cache가 80% 이상이면: 80%를 안전선으로, 필요 추가 VRAM = 현재 × (피크KV/80 - 1) × 안전마진
    currentPeakGapVram = totalVramGb * (peakKvMax / 80 - 1) * SAFETY_MARGIN;
  }
  if (isWaitingShort || isPreemptionShort) {
    // waiting/preemption이 빈발하면 최소 20% 추가 여유 필요
    const waitMargin = totalVramGb * 0.2 * SAFETY_MARGIN;
    currentPeakGapVram = Math.max(currentPeakGapVram, waitMargin);
  }
  currentPeakGapVram = Math.max(0, currentPeakGapVram);
  const currentPeakB300Units = Math.ceil(currentPeakGapVram / B300_SPEC.vramGb);

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
    modelBreakdown,
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
      avgHealthPct: avgHealthPct ? Math.round(avgHealthPct * 10) / 10 : null,
      peakThroughput: Math.round(peakThroughput * 10) / 10,
      currentEffUtil: currentEffUtil ? Math.round(currentEffUtil * 10) / 10 : null,
      // 실용 사용률 (메모리 대역폭 기준)
      practicalUtilPct: weightedBwMaxTps > 0 ? Math.round((avgThroughput / weightedBwMaxTps) * 1000) / 10 : null,
      bandwidthMaxTps: Math.round(weightedBwMaxTps * 10) / 10,
      weeksUntilSaturated,
    },
    methodA: { b300: methodA_rawB300, detail: methodA_detail, note: '실측 피크 throughput/GPU → 목표 throughput → B300 변환 (B300 성능 우위 반영)' },
    methodB: { b300: methodB_rawB300, totalVramNeeded: Math.round(totalVramNeeded), note: '현재 구성 N배 복제 → VRAM gap → B300 변환' },
    currentPeakShortage: {
      peakKvMax: Math.round(peakKvMax * 10) / 10,
      peakThroughputPct: peakThroughputPct ? Math.round(peakThroughputPct * 10) / 10 : null,
      waitingFrequencyPct: Math.round(waitingFrequencyPct * 10) / 10,
      preemptionTotal: peakPreemptionTotal,
      isShort: isKvShort || isWaitingShort || isPreemptionShort,
      reasons: [
        ...(isKvShort ? [`KV cache 피크 ${Math.round(peakKvMax)}% (≥80%)`] : []),
        ...(isWaitingShort ? [`대기 요청 빈발 (${Math.round(waitingFrequencyPct)}% 스냅샷)`] : []),
        ...(isPreemptionShort ? [`Preemption ${peakPreemptionTotal}회 (7일)`] : []),
      ],
      gapVram: Math.round(currentPeakGapVram),
      b300Units: currentPeakB300Units,
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
- 6개월 스케일링 배율: x${tokenGrowthMultiplier.toFixed(2)} (참고용)

## 서비스별 토큰 소비 Top 5
${topServices.map((s, i) => `${i + 1}. ${s.name}: ${s.tokens.toLocaleString()} 토큰 (${s.requests.toLocaleString()}건)`).join('\n') || '데이터 없음'}

## GPU 인벤토리
${gpuInventory.map(g => `- ${g.type} x${g.count} (${g.vramGb}GB/장)`).join('\n') || '없음'}
- 총 VRAM: ${Math.round(totalVramGb)}GB, GPU 사용률: ${avgGpuUtil ? avgGpuUtil.toFixed(1) + '%' : 'N/A'}, KV Cache: ${avgKvCache ? avgKvCache.toFixed(1) + '%' : 'N/A'}
- 평균 throughput: ${avgThroughput.toFixed(1)} tok/s, 피크 throughput (영업시간): ${peakThroughput.toFixed(1)} tok/s
- 이론 최대 throughput (compute-bound): ${weightedMaxTps.toFixed(1)} tok/s
- 실용 최대 throughput (메모리 대역폭): ${weightedBwMaxTps.toFixed(1)} tok/s
- 실용 사용률 (대역폭 기준): ${weightedBwMaxTps > 0 ? ((avgThroughput / weightedBwMaxTps) * 100).toFixed(1) + '%' : 'N/A'}
- GPU 건강도 (피크/이론): ${avgHealthPct ? avgHealthPct.toFixed(1) + '%' : 'N/A'}
- 현재 실효 사용률 (compute-bound 기준): ${currentEffUtil ? currentEffUtil.toFixed(1) + '%' : 'N/A'}
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

## 현재 피크 기준 부족분 (target 무관, 7일 영업시간)
- 피크 KV Cache: ${peakKvMax.toFixed(1)}% ${peakKvMax >= 80 ? '⚠️ 메모리 부족!' : ''}
- 대기 요청 발생 빈도: ${waitingFrequencyPct.toFixed(1)}% (전체 스냅샷 중) ${waitingFrequencyPct >= 30 ? '⚠️ 빈발!' : ''}
- Preemption(밀려남): ${peakPreemptionTotal}회/7일 ${peakPreemptionTotal > 10 ? '⚠️ 빈발!' : ''}
- 피크 처리량: ${peakThroughput.toFixed(1)} tok/s / 이론max ${weightedMaxTps.toFixed(1)} tok/s (${peakThroughputPct ? peakThroughputPct.toFixed(1) + '%' : 'N/A'})
- 현재 피크 부족 VRAM: ${Math.round(currentPeakGapVram)}GB → B300 ${currentPeakB300Units}장
${(isKvShort || isWaitingShort || isPreemptionShort) ? '⚠️ 현재 피크에서도 이미 리소스 부족!' : '✅ 현재 피크에서는 여유 있음'}

## 예측 (목표 ${targetUserCount.toLocaleString()}명)
- 스케일링: x${scalingFactor.toFixed(1)} (DAU 비율) × 인당 토큰 성장 ${tokenGrowthMultiplier.toFixed(2)} = x${growthAdjustedScaling.toFixed(1)}
  (DAU 증가는 target 자체에 반영, 인당 토큰 소비 증가만 추가 반영)
- Method A (실측 피크 throughput 기반): B300 ${methodA_rawB300}장
  ${methodA_detail}
- Method B (VRAM 복제 기반): B300 ${methodB_rawB300}장
  현재 ${Math.round(totalVramGb)}GB → 필요 ${Math.round(totalVramNeeded)}GB (x${growthAdjustedScaling.toFixed(1)})
- 안전마진 x${SAFETY_MARGIN}, 에러보정 x${errorMargin.toFixed(2)} → 최종 B300 ${b300Units}장 (${Math.round(gapVram)}GB)
※ healthMargin 미적용: 실측 throughput에 효율 이미 반영

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
    aiAnalysis = `[자동] ${currentUsers}명(DAU ${Math.round(currentDau)}) → 목표 ${targetUserCount.toLocaleString()}명 기준 ${Math.round(predictedTotalVram)}GB 필요 (현재 ${Math.round(totalVramGb)}GB). 부족분: B300 ${calculationDetails.result.b300Units}장. ${currentPeakB300Units > 0 ? `현재 피크에서도 B300 ${currentPeakB300Units}장 부족.` : ''} 주간 성장률 ${(weeklyGrowthRate * 100).toFixed(1)}%.`;
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
