/**
 * Redis Service
 *
 * Handles Redis connection and caching operations
 */

import { Redis } from 'ioredis';

/**
 * Create Redis client with configuration
 */
export function createRedisClient(): Redis {
  const redisUrl = process.env['REDIS_URL'] || 'redis://localhost:6379';

  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  });

  client.on('error', (err: Error) => {
    console.error('Redis Client Error:', err);
  });

  client.on('connect', () => {
    console.log('Redis Client Connected');
  });

  return client;
}

/**
 * Get active user count (users active in last 5 minutes)
 */
export async function getActiveUserCount(redis: Redis): Promise<number> {
  const key = 'active_users';
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

  // Remove old entries
  await redis.zremrangebyscore(key, 0, fiveMinutesAgo);

  // Count remaining
  return redis.zcard(key);
}

/**
 * Track active user (record user activity)
 */
export async function trackActiveUser(redis: Redis, userId: string): Promise<void> {
  const key = 'active_users';
  await redis.zadd(key, Date.now(), userId);
}

/**
 * Helper: 로컬(KST) 기준 오늘 날짜 (YYYY-MM-DD)
 * toISOString()은 UTC 기반이라 KST 저녁에 날짜가 밀릴 수 있음
 */
function getTodayLocal(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Get today's usage stats
 */
export async function getTodayUsage(redis: Redis): Promise<{
  requests: number;
  inputTokens: number;
  outputTokens: number;
}> {
  const today = getTodayLocal();
  const key = `daily_usage:${today}`;

  const data = await redis.hgetall(key);

  return {
    requests: parseInt(data['requests'] || '0', 10),
    inputTokens: parseInt(data['inputTokens'] || '0', 10),
    outputTokens: parseInt(data['outputTokens'] || '0', 10),
  };
}

/**
 * Increment usage stats (per user/model and daily total)
 * Pipeline으로 9개 HINCRBY + 3개 EXPIRE를 1번의 라운드트립으로 처리
 */
export async function incrementUsage(
  redis: Redis,
  userId: string,
  modelId: string,
  inputTokens: number,
  outputTokens: number
): Promise<void> {
  const today = getTodayLocal();
  const dailyKey = `daily_usage:${today}`;
  const userKey = `user_usage:${userId}:${today}`;
  const modelKey = `model_usage:${modelId}:${today}`;
  const ttl = 7 * 24 * 60 * 60;

  const pipeline = redis.pipeline();

  // Daily total
  pipeline.hincrby(dailyKey, 'requests', 1);
  pipeline.hincrby(dailyKey, 'inputTokens', inputTokens);
  pipeline.hincrby(dailyKey, 'outputTokens', outputTokens);
  pipeline.expire(dailyKey, ttl);

  // Per user
  pipeline.hincrby(userKey, 'requests', 1);
  pipeline.hincrby(userKey, 'inputTokens', inputTokens);
  pipeline.hincrby(userKey, 'outputTokens', outputTokens);
  pipeline.expire(userKey, ttl);

  // Per model
  pipeline.hincrby(modelKey, 'requests', 1);
  pipeline.hincrby(modelKey, 'inputTokens', inputTokens);
  pipeline.hincrby(modelKey, 'outputTokens', outputTokens);
  pipeline.expire(modelKey, ttl);

  await pipeline.exec();
}

/**
 * Generic read-through cache
 * - 캐시 히트: Redis에서 즉시 반환
 * - 캐시 미스: compute() 실행 → 결과 캐싱 → 반환
 * - fail-open: Redis 장애 시 항상 compute() 폴백 (기존 동작 100% 보장)
 */
export async function withCache<T>(
  redis: Redis,
  key: string,
  ttlSeconds: number,
  compute: () => Promise<T>,
): Promise<T> {
  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached);
  } catch { /* fail-open */ }

  const result = await compute();

  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(result));
  } catch { /* fire-and-forget */ }

  return result;
}

/**
 * 캐시 무효화 — 쓰기 작업 후 관련 캐시 키 즉시 삭제
 * 패턴 매칭으로 prefix 기반 삭제 (예: 'cache:admin:unified-users:*')
 * fail-open: Redis 장애 시 무시 (다음 TTL 만료 시 자연 갱신)
 */
export async function invalidateCache(redis: Redis, ...patterns: string[]): Promise<void> {
  try {
    const pipeline = redis.pipeline();
    for (const pattern of patterns) {
      if (pattern.includes('*')) {
        // 와일드카드 패턴 → SCAN으로 키 찾아서 삭제
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
          for (const key of keys) pipeline.del(key);
        }
      } else {
        // 정확한 키 삭제
        pipeline.del(pattern);
      }
    }
    await pipeline.exec();
  } catch { /* fail-open */ }
}

/**
 * Increment today's usage stats (legacy function for compatibility)
 */
export async function incrementTodayUsage(
  redis: Redis,
  inputTokens: number,
  outputTokens: number
): Promise<void> {
  const today = getTodayLocal();
  const key = `daily_usage:${today}`;

  await redis.hincrby(key, 'requests', 1);
  await redis.hincrby(key, 'inputTokens', inputTokens);
  await redis.hincrby(key, 'outputTokens', outputTokens);

  // Set expiry to 7 days
  await redis.expire(key, 7 * 24 * 60 * 60);
}
