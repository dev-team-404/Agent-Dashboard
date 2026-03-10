/**
 * Service Routes (v2)
 *
 * 서비스 등록/관리 - 누구나 서비스 생성 가능, 배포 후 서비스 마켓 노출
 * - Super Admin: 모든 서비스 CRUD
 * - Admin: 본인 dept 내 서비스 관리
 * - User: 본인 서비스 생성/관리, DEPLOYED 서비스 열람
 * - 서비스 ID(name)는 유니크 필수 → 중복 시 에러 + 대안 유도
 * - 서비스 타입: STANDARD / BACKGROUND
 * - 서비스 상태: DEVELOPMENT → DEPLOYED
 * - ServiceModel: 서비스에 LLM 모델 연결
 * - UserService 멤버 관리: OWNER, ADMIN, USER
 */

import { Router, RequestHandler } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, requireAdmin, AuthenticatedRequest, isModelVisibleTo, extractBusinessUnit } from '../middleware/auth.js';
import { z } from 'zod';

export const serviceRoutes = Router();

// ============================================
// Helper: 서비스 관리 권한 확인
// ============================================
async function canManageService(req: AuthenticatedRequest, serviceId: string): Promise<boolean> {
  if (req.adminRole === 'SUPER_ADMIN') return true;
  const loginid = req.user?.loginid || '';
  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service) return false;
  if (service.registeredBy === loginid) return true;
  // Check membership by loginid → userId
  const user = await prisma.user.findUnique({ where: { loginid } });
  if (!user) return false;
  const membership = await prisma.userService.findFirst({
    where: { serviceId, userId: user.id, role: { in: ['OWNER', 'ADMIN'] } }
  });
  return !!membership;
}

async function getUserIdByLoginid(loginid: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { loginid } });
  return user?.id || null;
}

// ============================================
// Schemas
// ============================================
const createServiceSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Service ID must be lowercase alphanumeric with hyphens only'),
  displayName: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  iconUrl: z.string().url().optional().nullable(),
  docsUrl: z.string().url().optional().nullable(),
  enabled: z.boolean().default(true),
  type: z.enum(['STANDARD', 'BACKGROUND']).default('STANDARD'),
  status: z.enum(['DEVELOPMENT', 'DEPLOYED']).default('DEVELOPMENT'),
});

const updateServiceSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional().nullable(),
  iconUrl: z.string().url().optional().nullable(),
  docsUrl: z.string().url().optional().nullable(),
  enabled: z.boolean().optional(),
  type: z.enum(['STANDARD', 'BACKGROUND']).optional(),
});

// ============================================
// GET /services
// 활성 서비스 목록 (인증된 사용자)
// Admin/Super Admin: 모든 서비스
// 일반 사용자: 본인 서비스 + DEPLOYED 서비스
// ============================================
serviceRoutes.get('/', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const isAdmin = req.adminRole === 'SUPER_ADMIN' || req.adminRole === 'ADMIN';
    let whereClause: any = { enabled: true };

    if (isAdmin) {
      // Admin은 본인 dept 서비스만
      if (req.adminRole === 'ADMIN') {
        whereClause.registeredByDept = req.adminDept || req.user?.deptname || '';
      }
      // Super Admin: 모든 서비스 (whereClause 그대로)
    } else {
      // 일반 사용자: 본인 서비스 OR DEPLOYED 서비스
      const loginid = req.user?.loginid || '';
      whereClause = {
        enabled: true,
        OR: [
          { registeredBy: loginid },
          { status: 'DEPLOYED' },
        ],
      };
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
        docsUrl: true,
        enabled: true,
        type: true,
        status: true,
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
    console.error('Get services error:', error);
    res.status(500).json({ error: 'Failed to get services' });
  }
});

// ============================================
// GET /services/all
// 모든 서비스 (비활성 포함) - Admin only
// ============================================
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
        docsUrl: true,
        enabled: true,
        type: true,
        status: true,
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

// ============================================
// GET /services/names
// DEPLOYED 서비스 이름 목록 (서비스 마켓용)
// ============================================
serviceRoutes.get('/names', authenticateToken, async (_req: AuthenticatedRequest, res) => {
  try {
    const services = await prisma.service.findMany({
      where: { enabled: true, status: 'DEPLOYED' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        displayName: true,
        description: true,
        iconUrl: true,
        docsUrl: true,
        type: true,
        status: true,
        registeredBy: true,
        registeredByDept: true,
        registeredByBusinessUnit: true,
        createdAt: true,
      },
    });
    res.json({ services });
  } catch (error) {
    console.error('Get service names error:', error);
    res.status(500).json({ error: 'Failed to get service names' });
  }
});

// ============================================
// GET /services/my
// 내 서비스 목록 (registeredBy 매칭)
// ============================================
serviceRoutes.get('/my', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const loginid = req.user?.loginid || '';
    const services = await prisma.service.findMany({
      where: { registeredBy: loginid },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        displayName: true,
        description: true,
        iconUrl: true,
        docsUrl: true,
        enabled: true,
        type: true,
        status: true,
        registeredBy: true,
        registeredByDept: true,
        registeredByBusinessUnit: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { usageLogs: true, userServices: true, serviceModels: true } },
      },
    });

    res.json({ services });
  } catch (error) {
    console.error('Get my services error:', error);
    res.status(500).json({ error: 'Failed to get my services' });
  }
});

// ============================================
// GET /services/search-users
// 사용자 검색 (멤버 추가용)
// ============================================
serviceRoutes.get('/search-users', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const q = (req.query.q as string || '').trim();
    if (!q || q.length < 2) {
      res.json({ users: [] });
      return;
    }

    const users = await prisma.user.findMany({
      where: {
        OR: [
          { loginid: { contains: q, mode: 'insensitive' } },
          { username: { contains: q, mode: 'insensitive' } },
        ],
        isActive: true,
      },
      take: 20,
      orderBy: { loginid: 'asc' },
      select: {
        id: true,
        loginid: true,
        username: true,
        deptname: true,
        businessUnit: true,
      },
    });

    res.json({ users });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

// ============================================
// GET /services/check-name/:name
// 서비스 ID 사용 가능 여부 확인 (실시간 중복 체크)
// ============================================
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

// ============================================
// GET /services/:id
// 서비스 상세
// 접근 조건: 소유자, 멤버, DEPLOYED 서비스, 또는 Admin
// ============================================
serviceRoutes.get('/:id', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id as string;
    const service = await prisma.service.findUnique({
      where: { id },
      include: {
        _count: { select: { usageLogs: true, userServices: true, serviceModels: true } },
      },
    });

    if (!service) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }

    const loginid = req.user?.loginid || '';
    const isAdmin = req.adminRole === 'SUPER_ADMIN' || req.adminRole === 'ADMIN';
    const isOwner = service.registeredBy === loginid;
    const isDeployed = service.status === 'DEPLOYED';

    // Admin dept check
    if (req.adminRole === 'ADMIN' && service.registeredByDept !== (req.adminDept || req.user?.deptname)) {
      // Admin이지만 다른 dept → 소유자/멤버/DEPLOYED 체크로 fallthrough
    } else if (isAdmin || isOwner || isDeployed) {
      res.json({ service });
      return;
    }

    // 멤버 여부 확인
    const currentUserId = await getUserIdByLoginid(loginid);
    const membership = currentUserId ? await prisma.userService.findFirst({
      where: { serviceId: id, userId: currentUserId },
    }) : null;
    if (membership) {
      res.json({ service });
      return;
    }

    // DEPLOYED는 이미 위에서 처리됨
    if (isDeployed) {
      res.json({ service });
      return;
    }

    res.status(403).json({ error: 'No access to this service' });
  } catch (error) {
    console.error('Get service error:', error);
    res.status(500).json({ error: 'Failed to get service' });
  }
});

// ============================================
// POST /services
// 서비스 생성 (인증된 사용자 누구나)
// ============================================
serviceRoutes.post('/', authenticateToken, async (req: AuthenticatedRequest, res) => {
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
        status: validation.data.status || 'DEVELOPMENT',
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

// ============================================
// POST /services/:id/deploy
// 서비스 배포 (소유자 또는 SUPER_ADMIN)
// ============================================
serviceRoutes.post('/:id/deploy', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id as string;
    const service = await prisma.service.findUnique({ where: { id } });
    if (!service) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }

    const loginid = req.user?.loginid || '';
    const isOwner = service.registeredBy === loginid;
    const isSuperAdmin = req.adminRole === 'SUPER_ADMIN';

    if (!isOwner && !isSuperAdmin) {
      res.status(403).json({ error: 'Only the service owner or Super Admin can deploy a service' });
      return;
    }

    const updated = await prisma.service.update({
      where: { id },
      data: { status: 'DEPLOYED' },
    });

    res.json({ service: updated, message: 'Service deployed successfully' });
  } catch (error) {
    console.error('Deploy service error:', error);
    res.status(500).json({ error: 'Failed to deploy service' });
  }
});

// ============================================
// PUT /services/:id
// 서비스 수정 (소유자/관리자)
// ============================================
serviceRoutes.put('/:id', authenticateToken, async (req: AuthenticatedRequest, res) => {
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

    if (!(await canManageService(req, id))) {
      // Fallback: admin dept check
      if (req.adminRole === 'ADMIN' && existing.registeredByDept === (req.adminDept || req.user?.deptname)) {
        // allowed
      } else {
        res.status(403).json({ error: 'You do not have permission to modify this service' });
        return;
      }
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

// ============================================
// DELETE /services/:id
// 서비스 삭제 (소유자/관리자)
// ============================================
serviceRoutes.delete('/:id', authenticateToken, async (req: AuthenticatedRequest, res) => {
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

    if (!(await canManageService(req, id))) {
      if (req.adminRole === 'ADMIN' && existing.registeredByDept === (req.adminDept || req.user?.deptname)) {
        // allowed
      } else {
        res.status(403).json({ error: 'You do not have permission to delete this service' });
        return;
      }
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

// ============================================
// POST /services/:id/reset-data
// 서비스 데이터 초기화 (Super Admin 전용)
// ============================================
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

// ============================================
// GET /services/:id/stats
// 서비스별 통계 (소유자/관리자)
// ============================================
serviceRoutes.get('/:id/stats', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id as string;
    const service = await prisma.service.findUnique({ where: { id } });
    if (!service) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }

    if (!(await canManageService(req, id))) {
      res.status(403).json({ error: 'No access to this service stats' });
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

// ============================================
// ServiceModel 관리 (서비스에 LLM 모델 연결)
// ============================================

/**
 * GET /services/:id/models
 * 서비스에 연결된 모델 목록
 */
serviceRoutes.get('/:id/models', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const serviceId = req.params.id as string;
    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }

    const serviceModels = await prisma.serviceModel.findMany({
      where: { serviceId },
      include: {
        model: {
          select: {
            id: true,
            name: true,
            displayName: true,
            type: true,
            enabled: true,
            visibility: true,
            visibilityScope: true,
            maxTokens: true,
            supportsVision: true,
          },
        },
      },
      orderBy: { addedAt: 'asc' },
    });

    res.json({ serviceModels });
  } catch (error) {
    console.error('Get service models error:', error);
    res.status(500).json({ error: 'Failed to get service models' });
  }
});

/**
 * POST /services/:id/models
 * 서비스에 모델 추가
 * 서비스 소유자/관리자 또는 글로벌 관리자만 가능
 * 사용자가 해당 모델에 접근 가능해야 함 (isModelVisibleTo)
 */
serviceRoutes.post('/:id/models', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const serviceId = req.params.id as string;
    const { modelId } = req.body;

    if (!modelId) {
      res.status(400).json({ error: 'modelId is required' });
      return;
    }

    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }

    if (!(await canManageService(req, serviceId))) {
      res.status(403).json({ error: 'You do not have permission to manage this service\'s models' });
      return;
    }

    // 모델 존재 확인
    const model = await prisma.model.findUnique({ where: { id: modelId } });
    if (!model) {
      res.status(404).json({ error: 'Model not found' });
      return;
    }

    // 모델 접근 가능 여부 확인
    const userDept = req.adminDept || req.user?.deptname || '';
    const userBU = req.adminBusinessUnit || extractBusinessUnit(userDept);
    const isAdmin = !!(req.adminRole);
    if (!isModelVisibleTo(model, userDept, userBU, isAdmin)) {
      res.status(403).json({ error: 'You do not have access to this model' });
      return;
    }

    // 중복 확인
    const existing = await prisma.serviceModel.findUnique({
      where: { serviceId_modelId: { serviceId, modelId } },
    });
    if (existing) {
      res.status(409).json({ error: 'Model is already assigned to this service' });
      return;
    }

    const serviceModel = await prisma.serviceModel.create({
      data: {
        serviceId,
        modelId,
        addedBy: req.user?.loginid || '',
      },
      include: {
        model: {
          select: {
            id: true,
            name: true,
            displayName: true,
            type: true,
            enabled: true,
          },
        },
      },
    });

    res.status(201).json({ serviceModel });
  } catch (error) {
    console.error('Add service model error:', error);
    res.status(500).json({ error: 'Failed to add model to service' });
  }
});

/**
 * DELETE /services/:id/models/:modelId
 * 서비스에서 모델 제거
 */
serviceRoutes.delete('/:id/models/:modelId', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const serviceId = req.params.id as string;
    const modelId = req.params.modelId as string;

    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }

    if (!(await canManageService(req, serviceId))) {
      res.status(403).json({ error: 'You do not have permission to manage this service\'s models' });
      return;
    }

    const existing = await prisma.serviceModel.findUnique({
      where: { serviceId_modelId: { serviceId, modelId } },
    });
    if (!existing) {
      res.status(404).json({ error: 'Model is not assigned to this service' });
      return;
    }

    await prisma.serviceModel.delete({
      where: { serviceId_modelId: { serviceId, modelId } },
    });

    res.json({ message: 'Model removed from service successfully' });
  } catch (error) {
    console.error('Remove service model error:', error);
    res.status(500).json({ error: 'Failed to remove model from service' });
  }
});

// ============================================
// 서비스 멤버 관리 (UserService)
// ============================================

/**
 * GET /services/:id/members
 * 서비스 멤버 목록
 */
serviceRoutes.get('/:id/members', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const serviceId = req.params.id as string;
    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }

    const members = await prisma.userService.findMany({
      where: { serviceId },
      include: {
        user: {
          select: {
            id: true,
            loginid: true,
            username: true,
            deptname: true,
            businessUnit: true,
          },
        },
      },
      orderBy: [{ role: 'asc' }, { firstSeen: 'asc' }],
    });

    res.json({ members });
  } catch (error) {
    console.error('Get service members error:', error);
    res.status(500).json({ error: 'Failed to get service members' });
  }
});

/**
 * POST /services/:id/members
 * 서비스에 멤버 추가
 * Body: { loginid, role? }  (기본 role: USER)
 * 서비스 OWNER/ADMIN 또는 글로벌 SUPER_ADMIN만 가능
 */
serviceRoutes.post('/:id/members', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const serviceId = req.params.id as string;
    const { loginid, role = 'USER' } = req.body;

    if (!loginid) {
      res.status(400).json({ error: 'loginid is required' });
      return;
    }

    if (!['OWNER', 'ADMIN', 'USER'].includes(role)) {
      res.status(400).json({ error: 'Invalid role. Must be OWNER, ADMIN, or USER' });
      return;
    }

    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }

    if (!(await canManageService(req, serviceId))) {
      res.status(403).json({ error: 'You do not have permission to manage this service\'s members' });
      return;
    }

    // 사용자 조회
    const user = await prisma.user.findUnique({ where: { loginid } });
    if (!user) {
      res.status(404).json({ error: `User '${loginid}' not found` });
      return;
    }

    // 이미 멤버인지 확인
    const existing = await prisma.userService.findUnique({
      where: { userId_serviceId: { userId: user.id, serviceId } },
    });
    if (existing) {
      res.status(409).json({ error: `User '${loginid}' is already a member of this service` });
      return;
    }

    const member = await prisma.userService.create({
      data: {
        userId: user.id,
        serviceId,
        role,
        firstSeen: new Date(),
        lastActive: new Date(),
      },
      include: {
        user: {
          select: {
            id: true,
            loginid: true,
            username: true,
            deptname: true,
            businessUnit: true,
          },
        },
      },
    });

    res.status(201).json({ member });
  } catch (error) {
    console.error('Add service member error:', error);
    res.status(500).json({ error: 'Failed to add member to service' });
  }
});

/**
 * PUT /services/:id/members/:userId/role
 * 멤버 역할 변경
 * Body: { role }
 */
serviceRoutes.put('/:id/members/:userId/role', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const serviceId = req.params.id as string;
    const userId = req.params.userId as string;
    const { role } = req.body;

    if (!role || !['OWNER', 'ADMIN', 'USER'].includes(role)) {
      res.status(400).json({ error: 'Invalid role. Must be OWNER, ADMIN, or USER' });
      return;
    }

    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }

    if (!(await canManageService(req, serviceId))) {
      res.status(403).json({ error: 'You do not have permission to manage this service\'s members' });
      return;
    }

    const existing = await prisma.userService.findFirst({
      where: { serviceId, userId },
    });
    if (!existing) {
      res.status(404).json({ error: 'Member not found in this service' });
      return;
    }

    const updated = await prisma.userService.update({
      where: { id: existing.id },
      data: { role },
      include: {
        user: {
          select: {
            id: true,
            loginid: true,
            username: true,
            deptname: true,
            businessUnit: true,
          },
        },
      },
    });

    res.json({ member: updated });
  } catch (error) {
    console.error('Update member role error:', error);
    res.status(500).json({ error: 'Failed to update member role' });
  }
});

/**
 * DELETE /services/:id/members/:userId
 * 멤버 제거
 */
serviceRoutes.delete('/:id/members/:userId', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const serviceId = req.params.id as string;
    const userId = req.params.userId as string;

    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }

    if (!(await canManageService(req, serviceId))) {
      res.status(403).json({ error: 'You do not have permission to manage this service\'s members' });
      return;
    }

    const existing = await prisma.userService.findFirst({
      where: { serviceId, userId },
    });
    if (!existing) {
      res.status(404).json({ error: 'Member not found in this service' });
      return;
    }

    await prisma.userService.delete({ where: { id: existing.id } });
    res.json({ message: 'Member removed from service successfully' });
  } catch (error) {
    console.error('Remove service member error:', error);
    res.status(500).json({ error: 'Failed to remove member from service' });
  }
});
