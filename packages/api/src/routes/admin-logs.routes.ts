/**
 * Admin Logs Routes
 *
 * Request Logs & Audit Logs 조회/관리 엔드포인트
 * - GET /admin/logs         — Request Logs 검색 (목록, body 제외)
 * - GET /admin/logs/:id     — Request Log 상세 (body 포함)
 * - DELETE /admin/logs/cleanup — 오래된 로그 삭제 (SUPER_ADMIN 전용)
 * - GET /admin/audit        — Audit Logs 검색
 */

import { Router, RequestHandler } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, requireAdmin, AuthenticatedRequest } from '../middleware/auth.js';

export const adminLogsRoutes = Router();

// Apply authentication and admin check to all routes
adminLogsRoutes.use(authenticateToken);
adminLogsRoutes.use(requireAdmin as RequestHandler);

// ==================== Helper ====================

function clampPage(value: unknown, defaultVal: number): number {
  const n = parseInt(value as string);
  return Number.isFinite(n) && n >= 1 ? n : defaultVal;
}

function clampLimit(value: unknown, defaultVal: number, max: number): number {
  const n = parseInt(value as string);
  if (!Number.isFinite(n) || n < 1) return defaultVal;
  return Math.min(n, max);
}

// ==================== Request Logs ====================

/**
 * GET /admin/logs
 * Search request logs (excludes requestBody & responseBody)
 */
adminLogsRoutes.get('/logs', (async (req: AuthenticatedRequest, res) => {
  try {
    const {
      userId,
      serviceId,
      modelName,
      statusCode,
      stream,
      startDate,
      endDate,
    } = req.query;

    const page = clampPage(req.query['page'], 1);
    const limit = clampLimit(req.query['limit'], 50, 100);
    const skip = (page - 1) * limit;

    // Build where clause
    const where: Record<string, unknown> = {};

    if (userId) {
      where.userId = userId as string;
    }
    if (serviceId) {
      where.serviceId = serviceId as string;
    }
    if (modelName) {
      where.modelName = { contains: modelName as string, mode: 'insensitive' };
    }
    if (statusCode) {
      const code = parseInt(statusCode as string);
      if (Number.isFinite(code)) {
        where.statusCode = code;
      }
    }
    if (stream !== undefined && stream !== '') {
      where.stream = stream === 'true';
    }

    // Date range
    if (startDate || endDate) {
      const timestampFilter: Record<string, Date> = {};
      if (startDate) {
        timestampFilter.gte = new Date(startDate as string);
      }
      if (endDate) {
        timestampFilter.lte = new Date(endDate as string);
      }
      where.timestamp = timestampFilter;
    }

    const [logs, total] = await Promise.all([
      prisma.requestLog.findMany({
        where,
        select: {
          id: true,
          serviceId: true,
          userId: true,
          deptname: true,
          modelName: true,
          resolvedModel: true,
          method: true,
          path: true,
          statusCode: true,
          inputTokens: true,
          outputTokens: true,
          latencyMs: true,
          errorMessage: true,
          userAgent: true,
          ipAddress: true,
          stream: true,
          timestamp: true,
          // requestBody, responseBody excluded
        },
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
      }),
      prisma.requestLog.count({ where }),
    ]);

    res.json({
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get request logs error:', error);
    res.status(500).json({ error: 'Failed to get request logs' });
  }
}) as RequestHandler);

/**
 * GET /admin/logs/:id
 * Get single request log detail (includes requestBody & responseBody)
 */
adminLogsRoutes.get('/logs/:id', (async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;

    const log = await prisma.requestLog.findUnique({
      where: { id },
    });

    if (!log) {
      res.status(404).json({ error: 'Log not found' });
      return;
    }

    res.json({ log });
  } catch (error) {
    console.error('Get request log detail error:', error);
    res.status(500).json({ error: 'Failed to get request log detail' });
  }
}) as RequestHandler);

/**
 * DELETE /admin/logs/cleanup
 * Cleanup old request logs (SUPER_ADMIN only)
 */
adminLogsRoutes.delete('/logs/cleanup', (async (req: AuthenticatedRequest, res) => {
  try {
    // SUPER_ADMIN check
    if (req.adminRole !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Super admin access required' });
      return;
    }

    const retentionDays = parseInt(req.query['retentionDays'] as string) || 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await prisma.requestLog.deleteMany({
      where: {
        timestamp: { lt: cutoffDate },
      },
    });

    // Create audit log entry
    await prisma.auditLog.create({
      data: {
        adminId: req.adminId || undefined,
        loginid: req.user!.loginid,
        action: 'CLEANUP_REQUEST_LOGS',
        target: `retentionDays=${retentionDays}`,
        targetType: 'RequestLog',
        details: {
          retentionDays,
          cutoffDate: cutoffDate.toISOString(),
          deletedCount: result.count,
        },
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
      },
    });

    res.json({
      message: `Deleted request logs older than ${retentionDays} days`,
      deletedCount: result.count,
    });
  } catch (error) {
    console.error('Cleanup request logs error:', error);
    res.status(500).json({ error: 'Failed to cleanup request logs' });
  }
}) as RequestHandler);

// ==================== Audit Logs ====================

/**
 * GET /admin/audit
 * Search audit logs
 */
adminLogsRoutes.get('/audit', (async (req: AuthenticatedRequest, res) => {
  try {
    const {
      loginid,
      action,
      targetType,
      startDate,
      endDate,
    } = req.query;

    const page = clampPage(req.query['page'], 1);
    const limit = clampLimit(req.query['limit'], 50, 100);
    const skip = (page - 1) * limit;

    // Build where clause
    const where: Record<string, unknown> = {};

    if (loginid) {
      where.loginid = { contains: loginid as string, mode: 'insensitive' };
    }
    if (action) {
      where.action = action as string;
    }
    if (targetType) {
      where.targetType = targetType as string;
    }

    // Date range
    if (startDate || endDate) {
      const timestampFilter: Record<string, Date> = {};
      if (startDate) {
        timestampFilter.gte = new Date(startDate as string);
      }
      if (endDate) {
        timestampFilter.lte = new Date(endDate as string);
      }
      where.timestamp = timestampFilter;
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({ error: 'Failed to get audit logs' });
  }
}) as RequestHandler);
