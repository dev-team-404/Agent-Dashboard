/**
 * Stats Pre-computation Service
 *
 * 1) 30초 주기: globalOverview 통계를 백그라운드 연산하여 Redis에 저장
 *    - 전체 누적 (total users, tokens, requests)
 *    - 30일 평균 DAU (전체 / 주말·공휴일 제외)
 *    API 호출 시 Redis에서 즉시 반환, today 데이터만 라이브 쿼리.
 *
 * 2) 60초 주기: withCache 캐시 워밍 (MainDashboard batch 엔드포인트)
 *    - batch가 호출하는 10개 엔드포인트의 캐시를 사전에 채움
 *    - thundering herd 문제 완전 제거 (첫 요청도 캐시 히트)
 *    - 내부 HTTP 호출로 엔드포인트 로직을 그대로 재사용
 */

import { prisma, redis } from '../index.js';

const PRECOMPUTE_INTERVAL_MS = 30_000;    // 30초 — overview precompute
const CACHE_WARM_INTERVAL_MS = 60_000;    // 60초 — batch 캐시 워밍
const REDIS_TTL_SECONDS = 120;            // 안전 TTL (cron 멈추면 자동 만료)

const KEY_PER_SERVICE = 'precomputed:overview:per_service';
const KEY_GLOBAL = 'precomputed:overview:global';
const KEY_UPDATED_AT = 'precomputed:overview:updated_at';

let timer: ReturnType<typeof setInterval> | null = null;
let warmTimer: ReturnType<typeof setInterval> | null = null;

interface PerServicePrecomputed {
  totalUsers: number;
  totalTokens: number;
  totalRequests: number;
  avgDau30d: number;
  avgDau30dExcl: number;
}

interface GlobalPrecomputed {
  totalUniqueUsers: number;
  avgDailyActive30d: number;
  avgDailyActive30dExcl: number;
}

async function computeAndStore(): Promise<void> {
  try {
    const [perServiceTotals, perServiceAvg30d, perServiceAvg30dExcl, globalTotals, globalAvg] = await Promise.all([
      // Per-service all-time: total_users (excl anonymous), total_tokens, total_requests
      prisma.$queryRaw<Array<{ service_id: string; total_users: bigint; total_tokens: bigint; total_requests: bigint }>>`
        SELECT
          ul.service_id::text as service_id,
          COUNT(DISTINCT CASE WHEN u.loginid != 'anonymous' THEN ul.user_id END) as total_users,
          COALESCE(SUM(ul."totalTokens"), 0) as total_tokens,
          COALESCE(SUM(ul.request_count), 0) as total_requests
        FROM usage_logs ul
        LEFT JOIN users u ON ul.user_id = u.id
        WHERE ul.service_id IS NOT NULL
        GROUP BY ul.service_id
      `,

      // Per-service avg daily active users (30d)
      prisma.$queryRaw<Array<{ service_id: string; avg_users: number }>>`
        SELECT service_id::text as service_id, COALESCE(AVG(user_count), 0)::float as avg_users
        FROM (
          SELECT ul.service_id, DATE(ul.timestamp), COUNT(DISTINCT ul.user_id) as user_count
          FROM usage_logs ul
          INNER JOIN users u ON ul.user_id = u.id
          WHERE ul.service_id IS NOT NULL
            AND ul.timestamp >= NOW() - INTERVAL '30 days'
            AND u.loginid != 'anonymous'
          GROUP BY ul.service_id, DATE(ul.timestamp)
        ) daily_counts
        GROUP BY service_id
      `,

      // Per-service avg daily active users (30d, excl weekends/holidays)
      prisma.$queryRaw<Array<{ service_id: string; avg_users: number }>>`
        SELECT service_id::text as service_id, COALESCE(AVG(user_count), 0)::float as avg_users
        FROM (
          SELECT ul.service_id, DATE(ul.timestamp) as log_date, COUNT(DISTINCT ul.user_id) as user_count
          FROM usage_logs ul
          INNER JOIN users u ON ul.user_id = u.id
          WHERE ul.service_id IS NOT NULL
            AND ul.timestamp >= NOW() - INTERVAL '30 days'
            AND u.loginid != 'anonymous'
            AND EXTRACT(DOW FROM ul.timestamp) NOT IN (0, 6)
            AND NOT EXISTS (
              SELECT 1 FROM holidays h
              WHERE h.date = DATE(ul.timestamp)
            )
          GROUP BY ul.service_id, DATE(ul.timestamp)
        ) daily_counts
        GROUP BY service_id
      `,

      // Global dedup: total unique users
      prisma.$queryRaw<Array<{ total_unique_users: bigint }>>`
        SELECT COUNT(DISTINCT ul.user_id) as total_unique_users
        FROM usage_logs ul
        INNER JOIN users u ON ul.user_id = u.id
        WHERE u.loginid != 'anonymous'
      `,

      // Global avg daily active (all + excl weekends/holidays)
      prisma.$queryRaw<Array<{ avg_all: number; avg_excl: number }>>`
        SELECT
          (SELECT COALESCE(AVG(user_count), 0)::float FROM (
            SELECT DATE(ul.timestamp), COUNT(DISTINCT ul.user_id) as user_count
            FROM usage_logs ul INNER JOIN users u ON ul.user_id = u.id
            WHERE u.loginid != 'anonymous' AND ul.timestamp >= NOW() - INTERVAL '30 days'
            GROUP BY DATE(ul.timestamp)
          ) dc) as avg_all,
          (SELECT COALESCE(AVG(user_count), 0)::float FROM (
            SELECT DATE(ul.timestamp) as ld, COUNT(DISTINCT ul.user_id) as user_count
            FROM usage_logs ul INNER JOIN users u ON ul.user_id = u.id
            WHERE u.loginid != 'anonymous' AND ul.timestamp >= NOW() - INTERVAL '30 days'
              AND EXTRACT(DOW FROM ul.timestamp) NOT IN (0, 6)
              AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = DATE(ul.timestamp))
            GROUP BY DATE(ul.timestamp)
          ) dc2) as avg_excl
      `,
    ]);

    // Build per-service map
    const avg30dMap = new Map(perServiceAvg30d.map(r => [r.service_id, r.avg_users]));
    const avg30dExclMap = new Map(perServiceAvg30dExcl.map(r => [r.service_id, r.avg_users]));
    const perServiceMap: Record<string, PerServicePrecomputed> = {};
    for (const r of perServiceTotals) {
      perServiceMap[r.service_id] = {
        totalUsers: Number(r.total_users || 0),
        totalTokens: Number(r.total_tokens || 0),
        totalRequests: Number(r.total_requests || 0),
        avgDau30d: Math.round(avg30dMap.get(r.service_id) || 0),
        avgDau30dExcl: Math.round(avg30dExclMap.get(r.service_id) || 0),
      };
    }

    // Build global
    const globalData: GlobalPrecomputed = {
      totalUniqueUsers: Number(globalTotals[0]?.total_unique_users || 0),
      avgDailyActive30d: Math.round(globalAvg[0]?.avg_all || 0),
      avgDailyActive30dExcl: Math.round(globalAvg[0]?.avg_excl || 0),
    };

    // Store in Redis with TTL
    const pipeline = redis.pipeline();
    pipeline.set(KEY_PER_SERVICE, JSON.stringify(perServiceMap), 'EX', REDIS_TTL_SECONDS);
    pipeline.set(KEY_GLOBAL, JSON.stringify(globalData), 'EX', REDIS_TTL_SECONDS);
    pipeline.set(KEY_UPDATED_AT, new Date().toISOString(), 'EX', REDIS_TTL_SECONDS);
    await pipeline.exec();
  } catch (err) {
    console.error('[StatsPrecompute] Error:', err);
  }
}

/**
 * Get pre-computed per-service stats from Redis.
 * Returns null if not available (caller should fall back to live query).
 */
export async function getPrecomputedPerService(): Promise<Record<string, PerServicePrecomputed> | null> {
  try {
    const raw = await redis.get(KEY_PER_SERVICE);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Get pre-computed global stats from Redis.
 * Returns null if not available (caller should fall back to live query).
 */
export async function getPrecomputedGlobal(): Promise<GlobalPrecomputed | null> {
  try {
    const raw = await redis.get(KEY_GLOBAL);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Cache Warming: MainDashboard batch 엔드포인트 사전 캐싱
 *
 * 내부 HTTP 호출로 withCache가 적용된 엔드포인트를 트리거하여
 * 캐시를 사전에 채운다. 이로써:
 * - 유저가 대시보드를 열 때 모든 데이터가 이미 캐시에 있음
 * - thundering herd 완전 방지 (cache miss 자체가 발생하지 않음)
 * - DB 부하가 유저 수와 무관하게 일정 (60초에 1번만 쿼리)
 */
async function warmBatchCache(): Promise<void> {
  // 인증이 필요한 엔드포인트를 내부 호출할 수 없으므로,
  // withCache와 동일한 Redis 키를 직접 갱신한다.

  const warmTargets: Array<{ key: string; ttl: number; compute: () => Promise<unknown> }> = [];

  // 1. global/by-service (days=30) — 서비스별 시계열
  warmTargets.push({
    key: 'cache:admin:stats:global:by-service:30',
    ttl: 120,
    compute: async () => {
      const days = 30;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      startDate.setHours(0, 0, 0, 0);

      const services = await prisma.service.findMany({
        where: { enabled: true },
        select: { id: true, name: true, displayName: true },
      });

      const dailyStats = await prisma.$queryRaw<
        Array<{ date: Date | string; service_id: string; total_tokens: bigint; req_count: bigint }>
      >`
        SELECT DATE(timestamp) as date, service_id, SUM("totalTokens") as total_tokens, COALESCE(SUM(request_count), 0) as req_count
        FROM usage_logs
        WHERE timestamp >= ${startDate}
          AND service_id IS NOT NULL
        GROUP BY DATE(timestamp), service_id
        ORDER BY date ASC
      `;

      const serviceIds = services.map(s => s.id);
      const dateMap = new Map<string, Record<string, number>>();
      const endDate = new Date();
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dateStr = toLocalDate(d);
        const init: Record<string, number> = {};
        for (const sid of serviceIds) init[sid] = 0;
        dateMap.set(dateStr, init);
      }
      for (const stat of dailyStats) {
        const dateStr = fmtDate(stat.date);
        const existing = dateMap.get(dateStr);
        if (existing && stat.service_id) existing[stat.service_id] = Number(stat.total_tokens);
      }
      const chartData = Array.from(dateMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, usage]) => ({ date, ...usage }));

      const serviceMap = new Map(services.map(s => [s.id, s]));
      const dailyData: Array<{ date: string; serviceId: string; serviceName: string; requests: number; totalTokens: number }> = [];
      for (const stat of dailyStats) {
        const dateStr = fmtDate(stat.date);
        const svc = serviceMap.get(stat.service_id);
        if (svc) dailyData.push({ date: dateStr, serviceId: svc.id, serviceName: svc.displayName || svc.name, requests: Number(stat.req_count), totalTokens: Number(stat.total_tokens) });
      }

      return { services: services.map(s => ({ id: s.id, name: s.name, displayName: s.displayName })), chartData, dailyData };
    },
  });

  // 2. error-rate (days=10) — 에러 빈도
  warmTargets.push({
    key: 'cache:admin:stats:error-rate:10',
    ttl: 300,
    compute: async () => {
      const days = 10;
      const calendarDays = days * 2;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - calendarDays);
      startDate.setHours(0, 0, 0, 0);

      const rows = await prisma.$queryRawUnsafe<Array<{
        day: Date; model_name: string; error_type: string; cnt: bigint;
      }>>(
        `SELECT date_trunc('day', r.timestamp) as day,
         COALESCE(m."displayName", r.resolved_model, r.model_name) as model_name,
         CASE
           WHEN r.error_message ILIKE '%timed out%' OR r.error_message ILIKE '%timeout%' OR r.error_message ILIKE '%aborted%' THEN 'Timeout'
           WHEN r.status_code = 500 THEN '500' WHEN r.status_code = 502 THEN '502'
           WHEN r.status_code = 503 THEN '503' WHEN r.status_code = 504 THEN '504'
           WHEN r.status_code >= 400 AND r.status_code < 500 THEN '4xx' ELSE 'Other'
         END as error_type, COUNT(*) as cnt
         FROM request_logs r LEFT JOIN models m ON m.name = COALESCE(r.resolved_model, r.model_name)
         WHERE r.status_code != 200 AND r.timestamp >= $1
         GROUP BY day, COALESCE(m."displayName", r.resolved_model, r.model_name), error_type
         ORDER BY day, model_name, error_type`, startDate
      );

      type DayEntry = { day: string; byModel: Record<string, Record<string, number>> };
      const dayMap = new Map<string, DayEntry>();
      for (const row of rows) {
        const dayStr = row.day.toISOString().split('T')[0]!;
        if (!dayMap.has(dayStr)) dayMap.set(dayStr, { day: dayStr, byModel: {} });
        const entry = dayMap.get(dayStr)!;
        if (!entry.byModel[row.model_name]) entry.byModel[row.model_name] = {};
        entry.byModel[row.model_name][row.error_type] = Number(row.cnt);
      }
      const daily = [...dayMap.values()].sort((a, b) => a.day.localeCompare(b.day));

      // 모델별 대표 에러 원인 조회 (topErrors)
      const topErrors = await prisma.$queryRawUnsafe<Array<{
        model_name: string; error_type: string; error_cause: string; cnt: bigint;
      }>>(
        `SELECT
          COALESCE(m."displayName", r.resolved_model, r.model_name) as model_name,
          CASE
            WHEN r.error_message ILIKE '%timed out%' OR r.error_message ILIKE '%timeout%' OR r.error_message ILIKE '%aborted%' THEN 'Timeout'
            WHEN r.status_code = 500 THEN '500' WHEN r.status_code = 502 THEN '502'
            WHEN r.status_code = 503 THEN '503' WHEN r.status_code = 504 THEN '504'
            WHEN r.status_code >= 400 AND r.status_code < 500 THEN '4xx' ELSE 'Other'
          END as error_type,
          CASE
            WHEN r.error_message ILIKE '%timed out%' OR r.error_message ILIKE '%timeout%' OR r.error_message ILIKE '%aborted%' THEN 'LLM 응답 시간 초과'
            WHEN r.error_message ILIKE '%ECONNREFUSED%' THEN '엔드포인트 연결 거부'
            WHEN r.error_message ILIKE '%ECONNRESET%' THEN '연결 초기화됨'
            WHEN r.error_message ILIKE '%ENOTFOUND%' THEN 'DNS 조회 실패'
            WHEN r.error_message ILIKE '%fetch failed%' THEN '네트워크 연결 실패'
            WHEN r.error_message ILIKE '%rate limit%' THEN 'Rate Limit 초과'
            WHEN r.error_message ILIKE '%unauthorized%' OR r.status_code = 401 THEN '인증 실패'
            WHEN r.error_message ILIKE '%forbidden%' OR r.status_code = 403 THEN '접근 거부'
            WHEN r.error_message ILIKE '%not found%' OR r.status_code = 404 THEN '리소스 없음'
            WHEN r.error_message ILIKE '%bad gateway%' OR r.status_code = 502 THEN 'Bad Gateway'
            WHEN r.error_message ILIKE '%service unavailable%' OR r.status_code = 503 THEN '서비스 일시 중단'
            WHEN r.error_message ILIKE '%gateway timeout%' OR r.status_code = 504 THEN 'Gateway Timeout'
            WHEN r.status_code = 500 THEN 'Internal Server Error'
            ELSE '기타 에러'
          END as error_cause,
          COUNT(*) as cnt
        FROM request_logs r
        LEFT JOIN models m ON m.name = COALESCE(r.resolved_model, r.model_name)
        WHERE r.status_code != 200 AND r.timestamp >= $1
        GROUP BY COALESCE(m."displayName", r.resolved_model, r.model_name), error_type, error_cause
        ORDER BY COALESCE(m."displayName", r.resolved_model, r.model_name), cnt DESC`, startDate
      );

      const modelErrorTypes: Record<string, Array<{ type: string; cause: string; count: number }>> = {};
      for (const row of topErrors) {
        if (!modelErrorTypes[row.model_name]) modelErrorTypes[row.model_name] = [];
        modelErrorTypes[row.model_name].push({ type: row.error_type, cause: row.error_cause, count: Number(row.cnt) });
      }

      const modelTotals: Record<string, Record<string, number>> = {};
      for (const entry of daily) {
        for (const [model, types] of Object.entries(entry.byModel)) {
          if (!modelTotals[model]) modelTotals[model] = {};
          for (const [type, cnt] of Object.entries(types)) {
            modelTotals[model][type] = (modelTotals[model][type] || 0) + cnt;
          }
        }
      }
      const summary = Object.entries(modelTotals).map(([model, types]) => ({
        model, totalErrors: Object.values(types).reduce((s, c) => s + c, 0), errorTypes: (modelErrorTypes[model] || []), byType: types,
      })).sort((a, b) => b.totalErrors - a.totalErrors);

      return { daily, summary, days };
    },
  });

  // 3. health-status — 모델 헬스체크 최신 결과
  warmTargets.push({
    key: 'cache:admin:stats:health-status',
    ttl: 120,
    compute: async () => {
      const latestChecks: Array<{
        model_id: string; model_name: string; latency_ms: number | null;
        success: boolean; error_message: string | null; checked_at: Date;
      }> = await prisma.$queryRaw`
        SELECT DISTINCT ON (h.model_id) h.model_id, m."displayName" as model_name,
          h.latency_ms, h.success, h.error_message, h.checked_at
        FROM health_check_logs h INNER JOIN models m ON h.model_id = m.id
        ORDER BY h.model_id, h.checked_at DESC
      `;
      const totalEnabled = await prisma.model.count({
        where: { enabled: true, endpointUrl: { not: 'external://auto-created' } },
      });
      const statuses: Record<string, { modelName: string; success: boolean; latencyMs: number | null; checkedAt: string; errorMessage: string | null }> = {};
      for (const c of latestChecks) {
        statuses[c.model_id] = { modelName: c.model_name, success: c.success, latencyMs: c.latency_ms, checkedAt: c.checked_at.toISOString(), errorMessage: c.error_message };
      }
      return { statuses, totalEnabledModels: totalEnabled };
    },
  });

  // 실행: 병렬로 모든 타겟을 워밍 (하나 실패해도 나머지 계속)
  const results = await Promise.allSettled(
    warmTargets.map(async (target) => {
      const data = await target.compute();
      await redis.setex(target.key, target.ttl, JSON.stringify(data));
    })
  );

  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;
  if (failed > 0) {
    console.warn(`[CacheWarm] ${succeeded} ok, ${failed} failed`);
    for (const r of results) {
      if (r.status === 'rejected') console.warn('[CacheWarm] Error:', r.reason);
    }
  }
}

/** Helper: Date → YYYY-MM-DD (로컬) */
function toLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Helper: Date|string → YYYY-MM-DD */
function fmtDate(date: Date | string): string {
  if (typeof date === 'string') return date.split('T')[0] || date;
  return toLocalDate(date);
}

export async function startStatsPrecomputeCron(): Promise<void> {
  console.log('[StatsPrecompute] Starting background pre-computation (30s interval)');
  console.log('[CacheWarm] Starting batch cache warming (60s interval)');

  // Run immediately on startup
  await computeAndStore();
  // Then repeat every 30 seconds
  timer = setInterval(computeAndStore, PRECOMPUTE_INTERVAL_MS);

  // 캐시 워밍: 10초 후 첫 실행 (DB 연결 안정화 대기), 이후 60초 간격
  setTimeout(async () => {
    try {
      await warmBatchCache();
    } catch (err) {
      console.error('[CacheWarm] Initial warm failed:', err);
    }
    warmTimer = setInterval(async () => {
      try {
        await warmBatchCache();
      } catch (err) {
        console.error('[CacheWarm] Error:', err);
      }
    }, CACHE_WARM_INTERVAL_MS);
  }, 10_000);
}

export function stopStatsPrecomputeCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (warmTimer) {
    clearInterval(warmTimer);
    warmTimer = null;
  }
  console.log('[StatsPrecompute] Stopped');
}
