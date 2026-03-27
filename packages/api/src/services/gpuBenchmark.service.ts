/**
 * GPU Benchmark Service
 *
 * 서버별 관측 피크 성능을 벤치마크로 저장.
 * 벤치마크 = "이 서버가 실제로 낼 수 있었던 최고 성능" (P95)
 *
 * 3차원:
 * - peakTps: 피크 처리량 (tok/s)
 * - peakKvPct: 피크 KV cache 사용률 (%)
 * - peakConcurrent: 피크 동시 요청 수
 *
 * 용도:
 * - 종합 용량 % = max(current/benchmark 각 차원) → 0-100% 체감 일치
 * - GPU 부족분 추정 = benchmark × scalingFactor (안정적, 매번 같은 결과)
 * - 성능 저하 감지 = 현재 관측 < 이전 벤치마크
 */

import { prisma, pgPool } from '../index.js';

const BENCHMARK_PREFIX = 'GPU_BENCHMARK_';

export interface GpuBenchmark {
  serverId: string;
  serverName: string;
  peakTps: number;
  peakKvPct: number;
  peakConcurrent: number;
  source: 'auto' | 'manual';
  updatedAt: string;
  sampleCount: number;
}

// ── 벤치마크 계산 (P95, 영업시간) ──
export async function computeBenchmark(serverId: string): Promise<GpuBenchmark | null> {
  const server = await prisma.gpuServer.findUnique({ where: { id: serverId } });
  if (!server) return null;

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 14); // 14일 범위로 더 넓게

  // 휴일 조회
  const holidays = await prisma.holiday.findMany({ where: { date: { gte: sevenDaysAgo } }, select: { date: true } });
  const holidayDates = holidays.map(h => h.date.toISOString().split('T')[0]);
  // $1=serverId, $2=sevenDaysAgo, $3+=holidays
  const holidayClause = holidayDates.length > 0
    ? `AND to_char(s.timestamp + INTERVAL '9 hours', 'YYYY-MM-DD') NOT IN (${holidayDates.map((_, i) => `$${i + 3}`).join(',')})`
    : '';
  const params = [sevenDaysAgo, ...holidayDates];

  // 스냅샷별 3차원 메트릭 추출 (영업시간만, pgPool 직접)
  const { rows } = await pgPool.query(`
    SELECT
      (SELECT SUM(COALESCE((l->>'promptThroughputTps')::float,0) + COALESCE((l->>'genThroughputTps')::float,0))
        FROM jsonb_array_elements(COALESCE(s.llm_metrics,'[]'::jsonb)) l) AS tps,
      (SELECT AVG((l->>'kvCacheUsagePct')::float)
        FROM jsonb_array_elements(COALESCE(s.llm_metrics,'[]'::jsonb)) l
        WHERE (l->>'kvCacheUsagePct') IS NOT NULL) AS kv,
      (SELECT SUM(COALESCE((l->>'runningRequests')::float,0) + COALESCE((l->>'waitingRequests')::float,0))
        FROM jsonb_array_elements(COALESCE(s.llm_metrics,'[]'::jsonb)) l) AS conc
    FROM gpu_metric_snapshots s
    WHERE s.server_id = $1 AND s.timestamp >= $2
      AND EXTRACT(HOUR FROM s.timestamp + INTERVAL '9 hours') BETWEEN 9 AND 17
      AND EXTRACT(DOW FROM s.timestamp + INTERVAL '9 hours') BETWEEN 1 AND 5
      ${holidayClause}
    ORDER BY s.timestamp ASC
  `, [serverId, ...params]);

  if (rows.length === 0) return null;

  // P95 계산
  const tpsArr = rows.map(r => +(r.tps || 0)).filter(v => v > 0).sort((a, b) => a - b);
  const kvArr = rows.map(r => +(r.kv || 0)).filter(v => v > 0).sort((a, b) => a - b);
  const concArr = rows.map(r => +(r.conc || 0)).filter(v => v > 0).sort((a, b) => a - b);

  const p95 = (arr: number[]) => arr.length > 0 ? arr[Math.min(Math.floor(arr.length * 0.95), arr.length - 1)] : 0;

  return {
    serverId,
    serverName: server.name,
    peakTps: Math.round(p95(tpsArr) * 10) / 10,
    peakKvPct: Math.round(p95(kvArr) * 10) / 10,
    peakConcurrent: Math.round(p95(concArr)),
    source: 'auto',
    updatedAt: new Date().toISOString(),
    sampleCount: rows.length,
  };
}

// ── 벤치마크 저장/조회 ──
export async function saveBenchmark(benchmark: GpuBenchmark, updatedBy = 'system'): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: `${BENCHMARK_PREFIX}${benchmark.serverId}` },
    update: { value: JSON.stringify(benchmark), updatedBy },
    create: { key: `${BENCHMARK_PREFIX}${benchmark.serverId}`, value: JSON.stringify(benchmark), updatedBy },
  });
}

export async function getBenchmark(serverId: string): Promise<GpuBenchmark | null> {
  const setting = await prisma.systemSetting.findUnique({ where: { key: `${BENCHMARK_PREFIX}${serverId}` } });
  if (!setting?.value) return null;
  try { return JSON.parse(setting.value); } catch { return null; }
}

export async function getAllBenchmarks(): Promise<Map<string, GpuBenchmark>> {
  const settings = await prisma.systemSetting.findMany({ where: { key: { startsWith: BENCHMARK_PREFIX } } });
  const map = new Map<string, GpuBenchmark>();
  for (const s of settings) {
    try {
      const bm: GpuBenchmark = JSON.parse(s.value);
      map.set(bm.serverId, bm);
    } catch {}
  }
  return map;
}

// ── 수동 오버라이드 ──
export async function setManualBenchmark(
  serverId: string,
  overrides: Partial<Pick<GpuBenchmark, 'peakTps' | 'peakKvPct' | 'peakConcurrent'>>,
  loginid: string,
): Promise<GpuBenchmark> {
  let existing = await getBenchmark(serverId);
  if (!existing) {
    existing = await computeBenchmark(serverId);
    if (!existing) {
      const server = await prisma.gpuServer.findUnique({ where: { id: serverId } });
      existing = { serverId, serverName: server?.name || 'unknown', peakTps: 0, peakKvPct: 0, peakConcurrent: 0, source: 'manual', updatedAt: new Date().toISOString(), sampleCount: 0 };
    }
  }
  const updated: GpuBenchmark = {
    ...existing,
    ...overrides,
    source: 'manual',
    updatedAt: new Date().toISOString(),
  };
  await saveBenchmark(updated, loginid);
  return updated;
}

// ── 전체 재산출 ──
export async function refreshAllBenchmarks(force = false): Promise<GpuBenchmark[]> {
  const servers = await prisma.gpuServer.findMany({ where: { enabled: true } });
  const results: GpuBenchmark[] = [];

  for (const server of servers) {
    // manual 벤치마크는 force가 아니면 보존
    if (!force) {
      const existing = await getBenchmark(server.id);
      if (existing?.source === 'manual') {
        results.push(existing);
        continue;
      }
    }

    const benchmark = await computeBenchmark(server.id);
    if (benchmark) {
      await saveBenchmark(benchmark);
      results.push(benchmark);
      console.log(`[Benchmark] ${server.name}: tps=${benchmark.peakTps}, kv=${benchmark.peakKvPct}%, conc=${benchmark.peakConcurrent} (${benchmark.sampleCount} samples)`);
    }
  }

  return results;
}

// ── 종합 용량 % 계산 (어디서든 호출 가능) ──
export function calcCompositeCapacity(
  currentTps: number,
  currentKvPct: number | null,
  currentConcurrent: number,
  benchmark: GpuBenchmark,
): { compositeCapacity: number; bottleneck: 'throughput' | 'kvMemory' | 'concurrency'; tokPct: number; kvPct: number; concPct: number } {
  const tokPct = benchmark.peakTps > 0 ? (currentTps / benchmark.peakTps) * 100 : 0;
  const kvPct = currentKvPct ?? 0; // KV는 이미 0-100%
  const concPct = benchmark.peakConcurrent > 0 ? (currentConcurrent / benchmark.peakConcurrent) * 100 : 0;

  const compositeCapacity = Math.max(tokPct, kvPct, concPct);
  const bottleneck = compositeCapacity === tokPct ? 'throughput' : compositeCapacity === kvPct ? 'kvMemory' : 'concurrency';

  return {
    compositeCapacity: Math.round(compositeCapacity * 10) / 10,
    bottleneck,
    tokPct: Math.round(tokPct * 10) / 10,
    kvPct: Math.round(kvPct * 10) / 10,
    concPct: Math.round(concPct * 10) / 10,
  };
}

// ── 크론 (매일 KST 02:00) ──
let cronInterval: ReturnType<typeof setInterval> | null = null;
let lastBenchmarkDate = '';

export function startBenchmarkCron() {
  cronInterval = setInterval(async () => {
    const now = new Date();
    const kstHour = (now.getUTCHours() + 9) % 24;
    const today = now.toISOString().split('T')[0];
    if (kstHour === 2 && lastBenchmarkDate !== today) {
      lastBenchmarkDate = today;
      try {
        console.log('[Benchmark] Daily refresh starting...');
        await refreshAllBenchmarks();
        console.log('[Benchmark] Daily refresh complete');
      } catch (err: any) {
        console.error('[Benchmark] Cron failed:', err.message);
      }
    }
  }, 60 * 60 * 1000); // 1시간마다 체크
  console.log('[Benchmark] Cron started (daily KST 02:00)');
}
