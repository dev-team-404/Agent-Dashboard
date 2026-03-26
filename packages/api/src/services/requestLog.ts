/**
 * RequestLog 공용 기록 유틸
 *
 * 미들웨어(proxyAuth, auth)에서도 에러 로그를 request_logs 테이블에
 * 기록할 수 있도록 분리한 헬퍼.
 */

import { Request } from 'express';
import { prisma } from '../index.js';

export async function logErrorToRequestLog(params: {
  req: Request;
  statusCode: number;
  errorMessage: string;
  serviceId?: string | null;
  deptname?: string | null;
  userId?: string | null;
  modelName?: string;
  resolvedModel?: string | null;
  path?: string;
  latencyMs?: number | null;
  stream?: boolean;
  errorDetails?: Record<string, unknown> | null;
}) {
  try {
    await prisma.requestLog.create({
      data: {
        serviceId: params.serviceId || null,
        userId: params.userId || null,
        deptname: params.deptname || null,
        modelName: params.modelName || '-',
        resolvedModel: params.resolvedModel || null,
        method: params.req.method,
        path: params.path || params.req.originalUrl || params.req.path,
        statusCode: params.statusCode,
        errorMessage: params.errorMessage.substring(0, 2000),
        errorDetails: params.errorDetails ? JSON.parse(JSON.stringify(params.errorDetails)) : undefined,
        userAgent: (params.req.headers['user-agent'] as string) || null,
        ipAddress: params.req.ip || (params.req.headers['x-forwarded-for'] as string) || null,
        latencyMs: params.latencyMs || null,
        stream: params.stream || false,
      },
    });
  } catch (err) {
    console.error('[RequestLog] Error log failed:', err);
  }
}
