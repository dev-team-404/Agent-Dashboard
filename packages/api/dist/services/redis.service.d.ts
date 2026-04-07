/**
 * Redis Service
 *
 * Handles Redis connection and caching operations
 */
import { Redis } from 'ioredis';
/**
 * Create Redis client with configuration
 */
export declare function createRedisClient(): Redis;
/**
 * Get active user count (users active in last 5 minutes)
 */
export declare function getActiveUserCount(redis: Redis): Promise<number>;
/**
 * Track active user (record user activity)
 */
export declare function trackActiveUser(redis: Redis, userId: string): Promise<void>;
/**
 * Get today's usage stats
 */
export declare function getTodayUsage(redis: Redis): Promise<{
    requests: number;
    inputTokens: number;
    outputTokens: number;
}>;
/**
 * Increment usage stats (per user/model and daily total)
 * Pipeline으로 9개 HINCRBY + 3개 EXPIRE를 1번의 라운드트립으로 처리
 */
export declare function incrementUsage(redis: Redis, userId: string, modelId: string, inputTokens: number, outputTokens: number): Promise<void>;
/**
 * Generic read-through cache
 * - 캐시 히트: Redis에서 즉시 반환
 * - 캐시 미스: compute() 실행 → 결과 캐싱 → 반환
 * - fail-open: Redis 장애 시 항상 compute() 폴백 (기존 동작 100% 보장)
 */
export declare function withCache<T>(redis: Redis, key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T>;
/**
 * 캐시 무효화 — 쓰기 작업 후 관련 캐시 키 즉시 삭제
 * 패턴 매칭으로 prefix 기반 삭제 (예: 'cache:admin:unified-users:*')
 * fail-open: Redis 장애 시 무시 (다음 TTL 만료 시 자연 갱신)
 */
export declare function invalidateCache(redis: Redis, ...patterns: string[]): Promise<void>;
/**
 * Increment today's usage stats (legacy function for compatibility)
 */
export declare function incrementTodayUsage(redis: Redis, inputTokens: number, outputTokens: number): Promise<void>;
//# sourceMappingURL=redis.service.d.ts.map