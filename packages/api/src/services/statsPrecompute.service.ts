/**
 * Stats Pre-computation Service
 *
 * 30초 주기로 느리게 변하는 globalOverview 통계를 백그라운드 연산하여 Redis에 저장.
 * - 전체 누적 (total users, tokens, requests)
 * - 30일 평균 DAU (전체 / 주말·공휴일 제외)
 * API 호출 시 Redis에서 즉시 반환, today 데이터만 라이브 쿼리.
 */

import { prisma, redis } from '../index.js';

const PRECOMPUTE_INTERVAL_MS = 30_000; // 30초
const REDIS_TTL_SECONDS = 120;         // 안전 TTL (cron 멈추면 자동 만료)

const KEY_PER_SERVICE = 'precomputed:overview:per_service';
const KEY_GLOBAL = 'precomputed:overview:global';
const KEY_UPDATED_AT = 'precomputed:overview:updated_at';

let timer: ReturnType<typeof setInterval> | null = null;

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

export async function startStatsPrecomputeCron(): Promise<void> {
  console.log('[StatsPrecompute] Starting background pre-computation (30s interval)');
  // Run immediately on startup
  await computeAndStore();
  // Then repeat every 30 seconds
  timer = setInterval(computeAndStore, PRECOMPUTE_INTERVAL_MS);
}

export function stopStatsPrecomputeCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[StatsPrecompute] Stopped');
  }
}
