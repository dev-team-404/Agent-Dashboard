/**
 * Service Routes (v2)
 *
 * 서비스 등록/관리 - Admin이 Dashboard UI에서 등록
 * - Super Admin: 모든 서비스 CRUD
 * - Admin: 본인 dept 내 서비스만 CRUD
 * - 서비스 ID(name)는 유니크 필수 → 중복 시 에러 + 대안 유도
 * - 서비스 타입: STANDARD / BACKGROUND
 * - 서비스는 등록한 admin의 LLM 권한을 자동 계승
 */

import { Router, RequestHandler } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, requireAdmin, AuthenticatedRequest, extractBusinessUnit } from '../middleware/auth.js';
import { z } from 'zod';

export const serviceRoutes = Router();

const createServiceSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Service ID must be lowercase alphanumeric with hyphens only'),
  displayName: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  iconUrl: z.string().url().optional().nullable(),
  enabled: z.boolean().default(true),
  type: z.enum(['STANDARD', 'BACKGROUND']).default('STANDARD'),
});

const updateServiceSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional().nullable(),
  iconUrl: z.string().url().optional().nullable(),
  enabled: z.boolean().optional(),
  type: z.enum(['STANDARD', 'BACKGROUND']).optional(),
});

/**
 * GET /services
 * 활성 서비스 목록 (인증된 사용자)
 * Super Admin: 모든 서비스
 * Admin: 본인 dept 서비스만
 */
serviceRoutes.get('/', authenticateToken, requireAdmin as RequestHandler, async (req: AuthenticatedRequest, res) => {
  try {
    const whereClause: any = { enabled: true };

    // Admin은 본인 dept 서비스만
    if (req.adminRole === 'ADMIN') {
      whereClause.registeredByDept = req.adminDept || req.user?.deptname || '';
    }

    const services = await prisma.service.findMany({
      where: whereClause,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        displayName: true,
        description: true,
        iconUrl: true,
        enabled: true,
        type: true,
        registeredBy: true,
        registeredByDept: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { usageLogs: true } },
      },
    });

    res.json({ services });
  } catch (error) {
    console.error('Get services error:', error);
    res.status(500).json({ error: 'Failed to get services' });
  }
});

/**
 * GET /services/all
 * 모든 서비스 (비활성 포함)
 */
serviceRoutes.get('/all', authenticateToken, requireAdmin as RequestHandler, async (req: AuthenticatedRequest, res) => {
  try {
    const whereClause: any = {};
    if (req.adminRole === 'ADMIN') {
      whereClause.registeredByDept = req.adminDept || req.user?.deptname || '';
    }

    const services = await prisma.service.findMany({
      where: whereClause,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        displayName: true,
        description: true,
        iconUrl: true,
        enabled: true,
        type: true,
        registeredBy: true,
        registeredByDept: true,
        registeredByBusinessUnit: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { usageLogs: true } },
      },
    });

    res.json({ services });
  } catch (error) {
    console.error('Get all services error:', error);
    res.status(500).json({ error: 'Failed to get services' });
  }
});

/**
 * GET /services/names
 * 활성 서비스 이름 목록 (인증된 사용자 누구나 접근 가능 — 관리자 아니어도 OK)
 * MyUsage 등에서 서비스 필터 셀렉터용
 */
serviceRoutes.get('/names', authenticateToken, async (_req: AuthenticatedRequest, res) => {
  try {
    const services = await prisma.service.findMany({
      where: { enabled: true },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        displayName: true,
      },
    });
    res.json({ services });
  } catch (error) {
    console.error('Get service names error:', error);
    res.status(500).json({ error: 'Failed to get service names' });
  }
});

/**
 * GET /services/check-name/:name
 * 서비스 ID 사용 가능 여부 확인 (실시간 중복 체크)
 */
serviceRoutes.get('/check-name/:name', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const name = req.params.name as string;
    const existing = await prisma.service.findUnique({ where: { name } });
    res.json({
      available: !existing,
      message: existing
        ? `Service ID '${name}' is already taken. Try: ${name}-2, ${name}-${Date.now().toString(36)}`
        : `Service ID '${name}' is available.`,
    });
  } catch (error) {
    console.error('Check service name error:', error);
    res.status(500).json({ error: 'Failed to check service name' });
  }
});

/**
 * GET /services/:id
 * 서비스 상세
 */
serviceRoutes.get('/:id', authenticateToken, requireAdmin as RequestHandler, async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id as string;
    const service = await prisma.service.findUnique({
      where: { id },
      include: {
        _count: { select: { usageLogs: true } },
      },
    });

    if (!service) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }

    // Admin은 본인 dept만
    if (req.adminRole === 'ADMIN' && service.registeredByDept !== (req.adminDept || req.user?.deptname)) {
      res.status(403).json({ error: 'No access to this service' });
      return;
    }

    res.json({ service });
  } catch (error) {
    console.error('Get service error:', error);
    res.status(500).json({ error: 'Failed to get service' });
  }
});

/**
 * POST /services
 * 서비스 생성 (Admin 이상)
 * Admin: 본인 dept 서비스만 생성 가능
 * 서비스 ID 중복 시 에러 + 대안 제안
 */
serviceRoutes.post('/', authenticateToken, requireAdmin as RequestHandler, async (req: AuthenticatedRequest, res) => {
  try {
    const validation = createServiceSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Invalid request', details: validation.error.issues });
      return;
    }

    // 서비스 ID 중복 체크
    const existing = await prisma.service.findUnique({
      where: { name: validation.data.name },
    });
    if (existing) {
      const suggestions = [
        `${validation.data.name}-2`,
        `${validation.data.name}-${Date.now().toString(36)}`,
        `${validation.data.name}-${Math.random().toString(36).slice(2, 6)}`,
      ];
      res.status(409).json({
        error: `Service ID '${validation.data.name}' is already taken`,
        message: `Please use a different service ID. Suggestions: ${suggestions.join(', ')}`,
        suggestions,
      });
      return;
    }

    const deptname = req.adminDept || req.user?.deptname || '';
    const businessUnit = req.adminBusinessUnit || extractBusinessUnit(deptname);

    const service = await prisma.service.create({
      data: {
        ...validation.data,
        registeredBy: req.user?.loginid || '',
        registeredByDept: deptname,
        registeredByBusinessUnit: businessUnit,
      },
    });

    res.status(201).json({ service });
  } catch (error) {
    console.error('Create service error:', error);
    res.status(500).json({ error: 'Failed to create service' });
  }
});

/**
 * PUT /services/:id
 * 서비스 수정
 * Admin: 본인 dept 서비스만
 * Super Admin: 모든 서비스
 */
serviceRoutes.put('/:id', authenticateToken, requireAdmin as RequestHandler, async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id as string;
    const validation = updateServiceSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Invalid request', details: validation.error.issues });
      return;
    }

    const existing = await prisma.service.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }

    // Admin은 본인 dept만
    if (req.adminRole === 'ADMIN' && existing.registeredByDept !== (req.adminDept || req.user?.deptname)) {
      res.status(403).json({ error: 'You can only modify services registered by your department' });
      return;
    }

    const service = await prisma.service.update({
      where: { id },
      data: validation.data,
    });

    res.json({ service });
  } catch (error) {
    console.error('Update service error:', error);
    res.status(500).json({ error: 'Failed to update service' });
  }
});

/**
 * DELETE /services/:id
 * 서비스 삭제
 */
serviceRoutes.delete('/:id', authenticateToken, requireAdmin as RequestHandler, async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.service.findUnique({
      where: { id },
      include: { _count: { select: { usageLogs: true } } },
    }) as any;

    if (!existing) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }

    if (req.adminRole === 'ADMIN' && existing.registeredByDept !== (req.adminDept || req.user?.deptname)) {
      res.status(403).json({ error: 'You can only delete services registered by your department' });
      return;
    }

    if (existing._count.usageLogs > 0) {
      res.status(409).json({
        error: 'Cannot delete service with existing usage data',
        details: { usageLogs: existing._count.usageLogs },
      });
      return;
    }

    await prisma.service.delete({ where: { id } });
    res.json({ message: 'Service deleted successfully' });
  } catch (error) {
    console.error('Delete service error:', error);
    res.status(500).json({ error: 'Failed to delete service' });
  }
});

/**
 * POST /services/:id/reset-data
 * 서비스 데이터 초기화 (Super Admin 전용)
 */
serviceRoutes.post('/:id/reset-data', authenticateToken, requireAdmin as RequestHandler, async (req: AuthenticatedRequest, res) => {
  try {
    if (req.adminRole !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Super admin access required' });
      return;
    }

    const id = req.params.id as string;
    const existing = await prisma.service.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }

    const [usageLogs, dailyStats, ratings, userServices] = await prisma.$transaction([
      prisma.usageLog.deleteMany({ where: { serviceId: id } }),
      prisma.dailyUsageStat.deleteMany({ where: { serviceId: id } }),
      prisma.ratingFeedback.deleteMany({ where: { serviceId: id } }),
      prisma.userService.deleteMany({ where: { serviceId: id } }),
    ]);

    res.json({
      message: 'Service data reset successfully',
      deleted: {
        usageLogs: usageLogs.count,
        dailyStats: dailyStats.count,
        ratings: ratings.count,
        userServices: userServices.count,
      },
    });
  } catch (error) {
    console.error('Reset service data error:', error);
    res.status(500).json({ error: 'Failed to reset service data' });
  }
});

/**
 * GET /services/:id/stats
 * 서비스별 통계
 */
serviceRoutes.get('/:id/stats', authenticateToken, requireAdmin as RequestHandler, async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id as string;
    const service = await prisma.service.findUnique({ where: { id } });
    if (!service) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }

    const [totalUsers, totalRequests, todayRequests] = await Promise.all([
      prisma.usageLog.groupBy({
        by: ['userId'],
        where: { serviceId: id, userId: { not: null } },
      }).then(r => r.length),
      prisma.usageLog.count({ where: { serviceId: id } }),
      prisma.usageLog.count({
        where: {
          serviceId: id,
          timestamp: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
    ]);

    const tokenUsage = await prisma.usageLog.aggregate({
      where: { serviceId: id },
      _sum: { inputTokens: true, outputTokens: true, totalTokens: true },
    });

    res.json({
      serviceId: id,
      stats: {
        totalUsers,
        totalRequests,
        todayRequests,
        totalInputTokens: tokenUsage._sum?.inputTokens || 0,
        totalOutputTokens: tokenUsage._sum?.outputTokens || 0,
        totalTokens: tokenUsage._sum?.totalTokens || 0,
      },
    });
  } catch (error) {
    console.error('Get service stats error:', error);
    res.status(500).json({ error: 'Failed to get service stats' });
  }
});
