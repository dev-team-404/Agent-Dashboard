/**
 * Write Buffer Service
 *
 * 고빈도 INSERT (usage_logs, request_logs)를 메모리에 모아서
 * 주기적으로 bulk INSERT 실행. 300명 동시접속 × 실시간 LLM 요청 대응.
 *
 * 설계 원칙:
 * - 기존 recordUsage / recordRequestLog 인터페이스 100% 유지
 * - 버퍼 → flush 실패 시 다음 주기에 재시도 (데이터 유실 최소화)
 * - 프로세스 종료 시 잔여 버퍼 즉시 flush (graceful shutdown)
 * - UserService upsert, Redis 카운터는 즉시 실행 (실시간성 유지)
 */

import { prisma, pgPool } from '../index.js';
import { redis } from '../index.js';
import { incrementUsage, trackActiveUser } from './redis.service.js';

// ── UsageLog 버퍼 ──

interface UsageLogEntry {
  userId: string | null;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  serviceId: string | null;
  deptname: string | null;
  latencyMs: number | null;
  timestamp: Date;
}

interface RequestLogEntry {
  serviceId: string | null;
  userId: string | null;
  deptname: string | null;
  modelName: string;
  resolvedModel: string | null;
  method: string;
  path: string;
  statusCode: number;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  errorMessage: string | null;
  errorDetails: unknown;
  userAgent: string | null;
  ipAddress: string | null;
  stream: boolean;
  timestamp: Date;
}

let usageBuffer: UsageLogEntry[] = [];
let requestBuffer: RequestLogEntry[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

const FLUSH_INTERVAL_MS = 1_000;  // 1초마다 flush
const MAX_BUFFER_SIZE = 500;       // 버퍼가 이 크기 넘으면 즉시 flush

/**
 * Usage 기록 (버퍼링 버전)
 * - UsageLog: 버퍼에 추가 (bulk INSERT로 flush)
 * - UserService upsert: 즉시 실행 (세션 추적 실시간성)
 * - Redis 카운터: 즉시 실행 (대시보드 실시간성)
 */
export async function recordUsageBuffered(
  userId: string | null,
  loginid: string | null,
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  serviceId: string,
  deptname: string | null,
  latencyMs?: number,
  modelName?: string,
  serviceName?: string,
): Promise<void> {
  const totalTokens = inputTokens + outputTokens;

  // 1. UsageLog → 버퍼에 추가 (나중에 bulk INSERT)
  usageBuffer.push({
    userId,
    modelId,
    inputTokens,
    outputTokens,
    totalTokens,
    serviceId,
    deptname,
    latencyMs: latencyMs ?? null,
    timestamp: new Date(),
  });

  // 버퍼 크기 초과 시 즉시 flush
  if (usageBuffer.length >= MAX_BUFFER_SIZE) {
    flushUsageBuffer().catch(err => console.error('[WriteBuffer] Emergency flush error:', err));
  }

  // 2. UserService upsert — 즉시 실행 (실시간 세션 추적)
  if (userId && serviceId) {
    prisma.userService.upsert({
      where: { userId_serviceId: { userId, serviceId } },
      update: {
        lastActive: new Date(),
        requestCount: { increment: 1 },
      },
      create: {
        userId,
        serviceId,
        firstSeen: new Date(),
        lastActive: new Date(),
        requestCount: 1,
      },
    }).catch(err => console.error('[WriteBuffer] UserService upsert error:', err));
  }

  // 3. Redis 카운터 — 즉시 실행 (대시보드 실시간성)
  if (userId && loginid) {
    incrementUsage(redis, userId, modelId, inputTokens, outputTokens)
      .catch(err => console.error('[WriteBuffer] Redis increment error:', err));
    trackActiveUser(redis, loginid)
      .catch(err => console.error('[WriteBuffer] Redis trackActive error:', err));
  }

  console.log(`[Usage] user=${loginid || 'background'}, model=${modelName || modelId}, service=${serviceName || serviceId}, tokens=${totalTokens}, latency=${latencyMs || 'N/A'}ms`);
}

/**
 * RequestLog 기록 (버퍼링 버전)
 */
export function recordRequestLogBuffered(params: {
  serviceId: string;
  userId?: string | null;
  deptname?: string | null;
  modelName: string;
  resolvedModel?: string | null;
  method: string;
  path: string;
  statusCode: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
  errorMessage?: string | null;
  errorDetails?: Record<string, unknown> | null;
  userAgent?: string | null;
  ipAddress?: string | null;
  stream?: boolean;
}): void {
  requestBuffer.push({
    serviceId: params.serviceId || null,
    userId: params.userId || null,
    deptname: params.deptname || null,
    modelName: params.modelName,
    resolvedModel: params.resolvedModel || null,
    method: params.method,
    path: params.path,
    statusCode: params.statusCode,
    inputTokens: params.inputTokens ?? null,
    outputTokens: params.outputTokens ?? null,
    latencyMs: params.latencyMs ?? null,
    errorMessage: params.errorMessage ? params.errorMessage.substring(0, 2000) : null,
    errorDetails: params.errorDetails ? JSON.parse(JSON.stringify(params.errorDetails)) : null,
    userAgent: params.userAgent || null,
    ipAddress: params.ipAddress || null,
    stream: params.stream || false,
    timestamp: new Date(),
  });

  if (requestBuffer.length >= MAX_BUFFER_SIZE) {
    flushRequestBuffer().catch(err => console.error('[WriteBuffer] Emergency request flush error:', err));
  }
}

// ── Flush 로직 ──

async function flushUsageBuffer(): Promise<void> {
  if (usageBuffer.length === 0) return;

  // 버퍼를 교체 (새 요청은 새 배열에 쌓임)
  const batch = usageBuffer;
  usageBuffer = [];

  try {
    // Raw SQL bulk INSERT (Prisma createMany는 uuid 자동생성 미지원이므로 pgPool 사용)
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let idx = 1;

    for (const entry of batch) {
      placeholders.push(
        `(gen_random_uuid(), $${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7}, $${idx + 8}, $${idx + 9})`
      );
      values.push(
        entry.userId, entry.modelId, entry.inputTokens, entry.outputTokens,
        entry.totalTokens, 1, entry.latencyMs, entry.timestamp,
        entry.deptname, entry.serviceId,
      );
      idx += 10;
    }

    await pgPool.query(
      `INSERT INTO usage_logs (id, user_id, model_id, "inputTokens", "outputTokens", "totalTokens", request_count, latency_ms, timestamp, deptname, service_id)
       VALUES ${placeholders.join(', ')}`,
      values,
    );
  } catch (err) {
    console.error(`[WriteBuffer] UsageLog flush failed (${batch.length} rows):`, err);
    // 실패 시 버퍼 복원 (다음 flush에서 재시도)
    usageBuffer = batch.concat(usageBuffer);
  }
}

async function flushRequestBuffer(): Promise<void> {
  if (requestBuffer.length === 0) return;

  const batch = requestBuffer;
  requestBuffer = [];

  try {
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let idx = 1;

    for (const entry of batch) {
      placeholders.push(
        `(gen_random_uuid(), $${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7}, $${idx + 8}, $${idx + 9}, $${idx + 10}, $${idx + 11}, $${idx + 12}, $${idx + 13}, $${idx + 14}, $${idx + 15}, $${idx + 16})`
      );
      values.push(
        entry.serviceId, entry.userId, entry.deptname, entry.modelName,
        entry.resolvedModel, entry.method, entry.path, entry.statusCode,
        entry.inputTokens, entry.outputTokens, entry.latencyMs,
        entry.errorMessage, entry.errorDetails ? JSON.stringify(entry.errorDetails) : null,
        entry.userAgent, entry.ipAddress, entry.stream, entry.timestamp,
      );
      idx += 17;
    }

    await pgPool.query(
      `INSERT INTO request_logs (id, service_id, user_id, deptname, model_name, resolved_model, method, path, status_code, input_tokens, output_tokens, latency_ms, error_message, error_details, user_agent, ip_address, stream, timestamp)
       VALUES ${placeholders.join(', ')}`,
      values,
    );
  } catch (err) {
    console.error(`[WriteBuffer] RequestLog flush failed (${batch.length} rows):`, err);
    requestBuffer = batch.concat(requestBuffer);
  }
}

async function flushAll(): Promise<void> {
  await Promise.allSettled([
    flushUsageBuffer(),
    flushRequestBuffer(),
  ]);
}

// ── Lifecycle ──

export function startWriteBuffer(): void {
  console.log(`[WriteBuffer] Started (flush every ${FLUSH_INTERVAL_MS}ms, max buffer ${MAX_BUFFER_SIZE})`);
  flushTimer = setInterval(flushAll, FLUSH_INTERVAL_MS);
}

export async function stopWriteBuffer(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  // 잔여 버퍼 즉시 flush
  await flushAll();
  console.log('[WriteBuffer] Stopped (buffer flushed)');
}

/** 현재 버퍼 크기 (모니터링용) */
export function getBufferStats(): { usageBufferSize: number; requestBufferSize: number } {
  return { usageBufferSize: usageBuffer.length, requestBufferSize: requestBuffer.length };
}
