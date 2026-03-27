/**
 * Service Routes (v2)
 *
 * 서비스 등록/관리 - 누구나 서비스 생성 가능, 배포 후 서비스 목록 노출
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
import { isUnderAnyScope } from '../services/orgAncestorCache.js';
import { prisma } from '../index.js';
import { authenticateToken, requireAdmin, AuthenticatedRequest, isModelVisibleTo, extractBusinessUnit, isSuperAdminByEnv } from '../middleware/auth.js';
import { lookupEmployee, isTopLevelDivision } from '../services/knoxEmployee.service.js';
import { getHierarchyFromOrgTree } from '../services/orgTree.service.js';
import { generateLogoForService } from '../services/logoGenerator.service.js';

/**
 * API 응답 시 최상위 사업부를 "none"으로 변환
 * DB에는 원본 저장, API에서만 필터
 */
function filterServiceHierarchy<T extends Record<string, unknown>>(service: T): T {
  const c2 = (service as any).center2Name as string | null | undefined;
  const c1 = (service as any).center1Name as string | null | undefined;
  if (c2 == null && c1 == null) return service;
  let nc2 = c2 ?? null;
  let nc1 = c1 ?? null;
  if (nc2 && isTopLevelDivision(nc2)) { nc2 = 'none'; nc1 = 'none'; }
  else if (nc1 && isTopLevelDivision(nc1)) { nc1 = 'none'; }
  return { ...service, center2Name: nc2, center1Name: nc1 };
}
import { z } from 'zod';

export const serviceRoutes = Router();

// ============================================
// Helper: 감사 로그
// ============================================
async function recordAudit(req: AuthenticatedRequest, action: string, target: string | null, targetType: string, details?: Record<string, unknown>) {
  try {
    await prisma.auditLog.create({
      data: {
        loginid: req.user?.loginid || 'unknown',
        action, target, targetType,
        details: details ? JSON.parse(JSON.stringify(details)) : undefined,
        ipAddress: req.ip || (req.headers['x-forwarded-for'] as string) || undefined,
      },
    });
  } catch (err) {
    console.error('[AuditLog] Failed to record:', err);
  }
}

// ============================================
// Helper: 관리자 정보 자동 감지 (requireAdmin 대신 non-blocking)
// ============================================
async function detectAdminInfo(req: AuthenticatedRequest): Promise<void> {
  if (!req.user || req.adminRole) return; // 이미 설정되었으면 스킵
  if (isSuperAdminByEnv(req.user.loginid)) {
    req.isAdmin = true;
    req.isSuperAdmin = true;
    req.adminRole = 'SUPER_ADMIN';
    req.adminDept = req.user.deptname;
    req.adminBusinessUnit = extractBusinessUnit(req.user.deptname);
    return;
  }
  const admin = await prisma.admin.findUnique({ where: { loginid: req.user.loginid } });
  if (admin) {
    req.isAdmin = true;
    req.isSuperAdmin = admin.role === 'SUPER_ADMIN';
    req.adminRole = admin.role as 'SUPER_ADMIN' | 'ADMIN';
    req.adminId = admin.id;
    req.adminDept = admin.deptname || req.user.deptname;
    req.adminBusinessUnit = admin.businessUnit || extractBusinessUnit(req.user.deptname);
  }
}

// ============================================
// Helper: 서비스 관리 권한 확인
// ============================================
async function canManageService(req: AuthenticatedRequest, serviceId: string): Promise<boolean> {
  // 먼저 admin 정보 감지
  await detectAdminInfo(req);
  // System Super Admin: 전체 서비스 관리 가능
  if (req.adminRole === 'SUPER_ADMIN') return true;
  const loginid = req.user?.loginid || '';
  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service) return false;
  // 서비스 소유자 (생성자)
  if (service.registeredBy === loginid) return true;
  // System Admin: 같은 부서 서비스 관리 가능
  if (req.adminRole === 'ADMIN') {
    const adminDept = req.adminDept || req.user?.deptname || '';
    if (adminDept && service.registeredByDept === adminDept) return true;
  }
  // Service Admin: UserService에서 OWNER/ADMIN 역할
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
const SERVICE_CATEGORIES = [
  '설계 자동화 및 최적화',
  '코드개발/분석/검증 지원',
  '디버깅 및 분석 자동화',
  '문서 및 요구사항 지능형 처리',
  'Agent플랫폼 및 개발 생태계',
  '데이터 기반 인사이트 및 대시보드',
  '인프라/도구/협력 요청',
] as const;

const flexibleUrlSchema = z.union([z.string().url(), z.string().startsWith('/'), z.literal('')]).optional().nullable().transform(v => v === '' ? null : v);

const createServiceSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Service ID must be lowercase alphanumeric with hyphens only'),
  displayName: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  iconUrl: flexibleUrlSchema,
  docsUrl: flexibleUrlSchema,
  serviceUrl: flexibleUrlSchema,
  enabled: z.boolean().default(true),
  type: z.enum(['STANDARD', 'BACKGROUND']).default('STANDARD'),
  status: z.enum(['DEVELOPMENT', 'DEPLOYED']).default('DEVELOPMENT'),
  apiOnly: z.boolean().default(false),
  // targetMM → 서비스 생성 후 /admin/service-targets 에서 설정 (감사 로그 기록 필수)
  serviceCategory: z.array(z.string()).optional().default([]),
  jiraTicket: z.union([z.string().url(), z.literal('')]).optional().nullable().transform(v => v === '' ? null : v),
});

const updateServiceSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Service ID must be lowercase alphanumeric with hyphens only').optional(),
  displayName: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional().nullable(),
  iconUrl: flexibleUrlSchema,
  docsUrl: flexibleUrlSchema,
  serviceUrl: flexibleUrlSchema,
  enabled: z.boolean().optional(),
  type: z.enum(['STANDARD', 'BACKGROUND']).optional(),
  apiOnly: z.boolean().optional(),
  deployScope: z.enum(['ALL', 'BUSINESS_UNIT', 'TEAM']).optional(),
  deployScopeValue: z.array(z.string()).optional(),
  // targetMM, savedMM → /admin/service-targets 전용 (감사 로그 기록 필수)
  serviceCategory: z.array(z.string()).optional().default([]),
  jiraTicket: z.union([z.string().url(), z.literal('')]).optional().nullable().transform(v => v === '' ? null : v),
  registeredBy: z.string().min(1).max(100).optional(),
});

const deployServiceSchema = z.object({
  deployScope: z.enum(['ALL', 'BUSINESS_UNIT', 'TEAM']).default('ALL'),
  deployScopeValue: z.array(z.string()).default([]),
});

// Helper: 사용자에게 서비스가 deployScope 기준으로 보이는지 확인
function isServiceVisibleByScope(
  service: { deployScope: string; deployScopeValue: string[]; registeredBy: string | null },
  loginid: string,
  userDeptCode: string,
): boolean {
  // Owner always sees their own service
  if (service.registeredBy === loginid) return true;

  switch (service.deployScope) {
    case 'ALL':
      return true;
    case 'BUSINESS_UNIT':
      return isUnderAnyScope(userDeptCode, service.deployScopeValue);
    case 'TEAM':
      return service.deployScopeValue.includes(userDeptCode);
    default:
      return true;
  }
}

// ============================================
// GET /services/employees/search
// 직원 검색 (loginid 기반 Knox 조회)
// ============================================
serviceRoutes.get('/employees/search', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const q = (req.query['q'] as string || '').trim();
    if (!q || q.length < 2) {
      res.json({ employees: [] });
      return;
    }

    // 1차: DB User 테이블에서 loginid/username 검색
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { loginid: { contains: q, mode: 'insensitive' } },
          { username: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { loginid: true, username: true, deptname: true },
      take: 10,
    });

    // 2차: 정확한 loginid로 Knox 조회 (DB에 없는 경우)
    if (users.length === 0) {
      const employee = await lookupEmployee(q);
      if (employee) {
        res.json({ employees: [{
          loginid: employee.userId,
          username: employee.fullName,
          deptname: employee.departmentName,
        }] });
        return;
      }
    }

    res.json({ employees: users });
  } catch (error) {
    console.error('Employee search error:', error);
    res.status(500).json({ error: 'Failed to search employees' });
  }
});

// ============================================
// GET /services
// 활성 서비스 목록 (인증된 사용자)
// Admin/Super Admin: 모든 서비스
// 일반 사용자: 본인 서비스 + DEPLOYED 서비스
// ============================================
serviceRoutes.get('/', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const loginid = req.user?.loginid || '';
    const userDeptCode = req.adminDeptCode || '';
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
        serviceUrl: true,
        targetMM: true, serviceCategory: true, jiraTicket: true,
        enabled: true,
        type: true,
        apiOnly: true,
        status: true,
        deployScope: true,
        deployScopeValue: true,
        registeredBy: true,
        registeredByDept: true,
        registeredByBusinessUnit: true,
        team: true,
        center2Name: true,
        center1Name: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { usageLogs: true } },
      },
    });

    // Filter DEPLOYED services by deployScope (non-admins and ADMIN)
    // SUPER_ADMIN sees everything; owners always see their own
    const filtered = req.adminRole === 'SUPER_ADMIN'
      ? services
      : services.filter((s: any) => {
          // Non-DEPLOYED services: already filtered by ownership or admin dept above
          if (s.status !== 'DEPLOYED') return true;
          // ADMIN sees their dept's scoped services
          if (req.adminRole === 'ADMIN') {
            return isServiceVisibleByScope(s, loginid, userDeptCode);
          }
          // Regular user: check scope
          return isServiceVisibleByScope(s, loginid, userDeptCode);
        });

    res.json({ services: filtered.map(filterServiceHierarchy) });
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
        serviceUrl: true,
        targetMM: true, serviceCategory: true, jiraTicket: true,
        enabled: true,
        type: true,
        apiOnly: true,
        status: true,
        deployScope: true,
        deployScopeValue: true,
        registeredBy: true,
        registeredByDept: true,
        registeredByBusinessUnit: true,
        team: true,
        center2Name: true,
        center1Name: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { usageLogs: true } },
      },
    });

    res.json({ services: services.map(filterServiceHierarchy) });
  } catch (error) {
    console.error('Get all services error:', error);
    res.status(500).json({ error: 'Failed to get services' });
  }
});

// ============================================
// GET /services/names
// DEPLOYED 서비스 이름 목록 (서비스 목록용)
// ============================================
serviceRoutes.get('/names', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const loginid = req.user?.loginid || '';
    const userDeptCode = req.adminDeptCode || '';

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
        serviceUrl: true,
        targetMM: true, serviceCategory: true, jiraTicket: true,
        type: true,
        apiOnly: true,
        status: true,
        deployScope: true,
        deployScopeValue: true,
        registeredBy: true,
        registeredByDept: true,
        registeredByBusinessUnit: true,
        team: true,
        center2Name: true,
        center1Name: true,
        createdAt: true,
        _count: { select: { usageLogs: true, userServices: true, serviceModels: true } },
      },
    });

    // 최근 7영업일 ≈ 10일 전부터 (주말 감안)
    const since = new Date();
    since.setDate(since.getDate() - 10);

    // Aggregate token + request count per service (최근 7영업일)
    const tokenAggs = await prisma.usageLog.groupBy({
      by: ['serviceId'],
      where: { serviceId: { in: services.map(s => s.id) }, timestamp: { gte: since } },
      _sum: { totalTokens: true },
      _count: true,
    });
    const tokenMap = new Map(tokenAggs.map(a => [a.serviceId, a._sum?.totalTokens || 0]));
    const reqCountMap = new Map(tokenAggs.map(a => [a.serviceId, a._count || 0]));

    // SUPER_ADMIN sees all; others filtered by deployScope
    const filtered = req.adminRole === 'SUPER_ADMIN'
      ? services
      : services.filter((s: any) => isServiceVisibleByScope(s, loginid, userDeptCode));

    // Attach stats
    const result = filtered.map(s => ({
      ...s,
      totalTokens: tokenMap.get(s.id) || 0,
      recentRequests: reqCountMap.get(s.id) || 0,
    }));

    res.json({ services: result.map(filterServiceHierarchy) });
  } catch (error) {
    console.error('Get service names error:', error);
    res.status(500).json({ error: 'Failed to get service names' });
  }
});

// ============================================
// GET /services/my
// 서비스 관리 목록
// - SUPER_ADMIN: 전체 서비스
// - System ADMIN: 내가 만든 서비스 + 내 팀 서비스 + 내가 서비스 관리자인 서비스
// - User: 내가 만든 서비스 + 내가 서비스 관리자(OWNER/ADMIN)인 서비스
// ============================================
serviceRoutes.get('/my', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const loginid = req.user?.loginid || '';
    await detectAdminInfo(req);

    // 현재 사용자 ID 조회
    const currentUser = await prisma.user.findUnique({ where: { loginid } });

    // strict=true: SUPER_ADMIN도 직접 관리 서비스만 조회 (모델 복사 등)
    const strict = req.query.strict === 'true';
    const isSuperAdmin = req.adminRole === 'SUPER_ADMIN';
    let whereClause: Record<string, unknown> = {};

    if (!isSuperAdmin || strict) {
      const whereConditions: Record<string, unknown>[] = [];
      // 내가 만든 서비스
      whereConditions.push({ registeredBy: loginid });

      // 내가 서비스 관리자(OWNER/ADMIN)인 서비스
      if (currentUser) {
        whereConditions.push({
          userServices: {
            some: { userId: currentUser.id, role: { in: ['OWNER', 'ADMIN'] } },
          },
        });
      }

      // System ADMIN: 내 팀 서비스
      if (req.adminRole === 'ADMIN' || (isSuperAdmin && strict)) {
        const dept = req.adminDept || req.user?.deptname || '';
        if (dept) {
          whereConditions.push({ registeredByDept: dept });
        }
      }

      whereClause = { OR: whereConditions };
    }
    // SUPER_ADMIN (strict 아님): whereClause stays {} → no filter → all services

    const services = await prisma.service.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        displayName: true,
        description: true,
        iconUrl: true,
        docsUrl: true,
        serviceUrl: true,
        targetMM: true, serviceCategory: true, jiraTicket: true,
        enabled: true,
        type: true,
        apiOnly: true,
        status: true,
        deployScope: true,
        deployScopeValue: true,
        registeredBy: true,
        registeredByDept: true,
        registeredByBusinessUnit: true,
        team: true,
        center2Name: true,
        center1Name: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { usageLogs: true, userServices: true, serviceModels: true } },
      },
    });

    // 서비스 관리자 여부 플래그 추가
    let serviceAdminIds = new Set<string>();
    if (currentUser) {
      const memberships = await prisma.userService.findMany({
        where: { userId: currentUser.id, role: { in: ['OWNER', 'ADMIN'] } },
        select: { serviceId: true },
      });
      serviceAdminIds = new Set(memberships.map((m: { serviceId: string }) => m.serviceId));
    }

    const enriched = services.map((s: { id: string; registeredBy: string | null }) => ({
      ...s,
      _isServiceAdmin: serviceAdminIds.has(s.id),
      _isCreator: s.registeredBy === loginid,
    }));

    res.json({ services: enriched.map(filterServiceHierarchy) });
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
    await detectAdminInfo(req);
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
      res.json({ service: filterServiceHierarchy(service) });
      return;
    }

    // 멤버 여부 확인
    const currentUserId = await getUserIdByLoginid(loginid);
    const membership = currentUserId ? await prisma.userService.findFirst({
      where: { serviceId: id, userId: currentUserId },
    }) : null;
    if (membership) {
      res.json({ service: filterServiceHierarchy(service) });
      return;
    }

    // DEPLOYED는 이미 위에서 처리됨
    if (isDeployed) {
      res.json({ service: filterServiceHierarchy(service) });
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

    // 등록자의 조직 계층 정보 조회 (DB 캐시 우선, 없으면 Knox API fallback)
    let team: string | null = null;
    let center2Name: string | null = null;
    let center1Name: string | null = null;
    try {
      const loginid = req.user?.loginid || '';
      const user = await prisma.user.findUnique({ where: { loginid } });
      let departmentCode = user?.departmentCode || '';
      let enDeptName = user?.enDeptName || '';

      // departmentCode가 없으면 Knox Employee API로 조회 (첫 사용자 대비)
      if (!departmentCode) {
        const employee = await lookupEmployee(loginid);
        if (employee) {
          departmentCode = employee.departmentCode;
          enDeptName = employee.enDepartmentName;
          // User DB에도 저장
          if (user) {
            await prisma.user.update({
              where: { id: user.id },
              data: { departmentCode, enDeptName },
            });
          }
        }
      }

      if (departmentCode && enDeptName) {
        const hierarchy = await getHierarchyFromOrgTree(departmentCode);
        if (hierarchy) {
          team = hierarchy.team || null;
          center2Name = hierarchy.center2Name || null;
          center1Name = hierarchy.center1Name || null;
        }
      }
    } catch (err) {
      console.error('[Service] Failed to lookup dept hierarchy:', err);
    }

    // displayName 중복 체크
    const existingDisplayName = await prisma.service.findUnique({ where: { displayName: validation.data.displayName } });
    if (existingDisplayName) {
      res.status(409).json({ error: `Display name "${validation.data.displayName}" is already in use. / 이미 사용 중인 서비스 표시 이름입니다.` });
      return;
    }

    const service = await prisma.service.create({
      data: {
        ...validation.data,
        status: validation.data.status || 'DEVELOPMENT',
        registeredBy: req.user?.loginid || '',
        registeredByDept: deptname,
        registeredByBusinessUnit: businessUnit,
        team,
        center2Name,
        center1Name,
      },
    });

    recordAudit(req, 'CREATE_SERVICE', service.id, 'Service', { name: service.name, displayName: service.displayName }).catch(() => {});

    // 로고 URL이 없으면 async로 자동 생성 (fire-and-forget)
    if (!service.iconUrl) {
      generateLogoForService(service.id).catch(err =>
        console.error(`[LogoGen] Async logo generation failed for ${service.name}:`, err)
      );
    }

    res.status(201).json({ service: filterServiceHierarchy(service) });
  } catch (error) {
    console.error('Create service error:', error);
    res.status(500).json({ error: 'Failed to create service' });
  }
});

// ============================================
// POST /services/:id/regenerate-logo
// 서비스 로고 재생성 (서비스 관리 권한 보유자)
// ============================================
serviceRoutes.post('/:id/regenerate-logo', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id as string;
    const service = await prisma.service.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!service) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }

    if (!(await canManageService(req, id))) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    // iconUrl 초기화 후 재생성
    await prisma.service.update({ where: { id }, data: { iconUrl: null } });

    const result = await generateLogoForService(id);
    if (result.success) {
      res.json({ iconUrl: result.iconUrl });
    } else {
      res.status(500).json({ error: result.error || 'Logo generation failed' });
    }
  } catch (error) {
    console.error('Regenerate logo error:', error);
    res.status(500).json({ error: 'Failed to regenerate logo' });
  }
});

// ============================================
// POST /services/:id/deploy
// 서비스 배포 (서비스 관리 권한 보유자)
// ============================================
serviceRoutes.post('/:id/deploy', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id as string;
    const service = await prisma.service.findUnique({ where: { id } });
    if (!service) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }

    if (!(await canManageService(req, id))) {
      res.status(403).json({ error: 'You do not have permission to deploy this service' });
      return;
    }

    // Validate deployScope from body (defaults to ALL with empty array)
    const validation = deployServiceSchema.safeParse(req.body || {});
    if (!validation.success) {
      res.status(400).json({ error: 'Invalid deploy scope', details: validation.error.issues });
      return;
    }

    const { deployScope, deployScopeValue } = validation.data;

    const updated = await prisma.service.update({
      where: { id },
      data: {
        status: 'DEPLOYED',
        deployScope,
        deployScopeValue,
      },
    });

    recordAudit(req, 'DEPLOY_SERVICE', id, 'Service', { deployScope, deployScopeValue }).catch(() => {});
    res.json({ service: filterServiceHierarchy(updated), message: 'Service deployed successfully' });
  } catch (error) {
    console.error('Deploy service error:', error);
    res.status(500).json({ error: 'Failed to deploy service' });
  }
});

// ============================================
// POST /services/:id/undeploy
// 서비스 배포 취소 → 개발 상태로 되돌리기 (서비스 관리 권한 보유자)
// ============================================
serviceRoutes.post('/:id/undeploy', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id as string;
    const service = await prisma.service.findUnique({ where: { id } });
    if (!service) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }

    if (!(await canManageService(req, id))) {
      res.status(403).json({ error: 'You do not have permission to undeploy this service' });
      return;
    }

    if (service.status !== 'DEPLOYED') {
      res.status(400).json({ error: 'Service is not deployed' });
      return;
    }

    const updated = await prisma.service.update({
      where: { id },
      data: { status: 'DEVELOPMENT' },
    });

    recordAudit(req, 'UNDEPLOY_SERVICE', id, 'Service', {}).catch(() => {});
    res.json({ service: filterServiceHierarchy(updated), message: 'Service reverted to development' });
  } catch (error) {
    console.error('Undeploy service error:', error);
    res.status(500).json({ error: 'Failed to undeploy service' });
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
      res.status(403).json({ error: 'You do not have permission to modify this service' });
      return;
    }

    // DEPLOYED 상태: name, displayName, type 변경 차단 (프록시 연동 보호)
    if (existing.status === 'DEPLOYED') {
      if (validation.data.name && validation.data.name !== existing.name) {
        res.status(400).json({ error: '배포 중인 서비스의 서비스 코드는 변경할 수 없습니다.' });
        return;
      }
      if (validation.data.displayName && validation.data.displayName !== existing.displayName) {
        res.status(400).json({ error: '배포 중인 서비스의 표시 이름은 변경할 수 없습니다.' });
        return;
      }
      if (validation.data.type && validation.data.type !== existing.type) {
        res.status(400).json({ error: '배포 중인 서비스의 타입(STANDARD/BACKGROUND)은 변경할 수 없습니다.' });
        return;
      }
    }

    // name 변경 시 중복 체크
    if (validation.data.name && validation.data.name !== existing.name) {
      const dup = await prisma.service.findUnique({ where: { name: validation.data.name } });
      if (dup) {
        res.status(409).json({ error: `서비스 코드 '${validation.data.name}'은(는) 이미 사용 중입니다.` });
        return;
      }
    }

    // displayName 변경 시 중복 체크
    if (validation.data.displayName && validation.data.displayName !== existing.displayName) {
      const dupDisplay = await prisma.service.findUnique({ where: { displayName: validation.data.displayName } });
      if (dupDisplay) {
        res.status(409).json({ error: `서비스 표시 이름 '${validation.data.displayName}'은(는) 이미 사용 중입니다.` });
        return;
      }
    }

    // registeredBy 변경 시 Knox 조회하여 부서 정보도 갱신
    const updateData: Record<string, unknown> = { ...validation.data };
    if (validation.data.registeredBy && validation.data.registeredBy !== existing.registeredBy) {
      const employee = await lookupEmployee(validation.data.registeredBy);
      if (!employee) {
        res.status(400).json({ error: `직원 '${validation.data.registeredBy}'을(를) 찾을 수 없습니다.` });
        return;
      }
      updateData.registeredByDept = employee.departmentName;
      updateData.registeredByBusinessUnit = extractBusinessUnit(employee.departmentName) || existing.registeredByBusinessUnit;
      // 조직 계층 갱신
      try {
        const hierarchy = await getHierarchyFromOrgTree(employee.departmentCode);
        if (hierarchy) {
          updateData.team = hierarchy.team || null;
          updateData.center2Name = hierarchy.center2Name || null;
          updateData.center1Name = hierarchy.center1Name || null;
        }
      } catch (err) {
        console.error('[Service] Failed to lookup dept hierarchy for new owner:', err);
      }
    }

    const service = await prisma.service.update({
      where: { id },
      data: updateData,
    });

    // 변경 내역 감사 로그
    const changedFields: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(validation.data)) {
      if ((existing as Record<string, unknown>)[key] !== val) {
        changedFields[key] = { from: (existing as Record<string, unknown>)[key], to: val };
      }
    }
    if (Object.keys(changedFields).length > 0) {
      recordAudit(req, 'UPDATE_SERVICE', id, 'Service', { name: service.name, changes: changedFields }).catch(() => {});
    }

    res.json({ service: filterServiceHierarchy(service) });
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
    const force = req.query['force'] === 'true';
    const existing = await prisma.service.findUnique({
      where: { id },
      include: { _count: { select: { usageLogs: true } } },
    }) as any;

    if (!existing) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }

    if (!(await canManageService(req, id))) {
      res.status(403).json({ error: 'You do not have permission to delete this service' });
      return;
    }

    if (existing._count.usageLogs > 0 && !force) {
      res.status(409).json({
        error: 'Cannot delete service with existing usage data. Use ?force=true to force delete.',
        details: { usageLogs: existing._count.usageLogs },
      });
      return;
    }

    // Cascade 삭제: 관련 데이터 정리
    await prisma.$transaction([
      prisma.usageLog.deleteMany({ where: { serviceId: id } }),
      prisma.serviceModel.deleteMany({ where: { serviceId: id } }),
      prisma.userService.deleteMany({ where: { serviceId: id } }),
      prisma.userRateLimit.deleteMany({ where: { serviceId: id } }),
      prisma.serviceRateLimit.deleteMany({ where: { serviceId: id } }),
      prisma.ratingFeedback.deleteMany({ where: { serviceId: id } }),
      prisma.requestLog.updateMany({ where: { serviceId: id }, data: { serviceId: null } }),
      prisma.service.delete({ where: { id } }),
    ]);

    recordAudit(req, 'DELETE_SERVICE', id, 'Service', { name: existing.name }).catch(() => {});
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

    const [usageLogs, ratings, userServices] = await prisma.$transaction([
      prisma.usageLog.deleteMany({ where: { serviceId: id } }),
      prisma.ratingFeedback.deleteMany({ where: { serviceId: id } }),
      prisma.userService.deleteMany({ where: { serviceId: id } }),
    ]);

    res.json({
      message: 'Service data reset successfully',
      deleted: {
        usageLogs: usageLogs.count,
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
      prisma.usageLog.aggregate({ where: { serviceId: id }, _sum: { requestCount: true } }).then(r => r._sum?.requestCount || 0),
      prisma.usageLog.aggregate({ where: { serviceId: id, timestamp: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } }, _sum: { requestCount: true } }).then(r => r._sum?.requestCount || 0),
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

    // 현재 사용자의 모델 접근 권한 확인을 위해 admin 정보 감지
    await detectAdminInfo(req);
    const userDeptCode = req.adminDeptCode || '';
    const isAdmin = !!(req.adminRole);

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
            adminVisible: true,
            maxTokens: true,
            supportsVision: true,
          },
        },
        fallbackModel: {
          select: { id: true, name: true, displayName: true, type: true },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { addedAt: 'asc' }],
    });

    // Include sortOrder, weight, enabled + 접근 가능 여부 표시
    const result = serviceModels.map((sm: any) => {
      const accessible = req.adminRole === 'SUPER_ADMIN'
        ? true  // SUPER_ADMIN은 모든 모델 접근 가능
        : sm.model.visibility === 'SUPER_ADMIN_ONLY'
          ? false
          : isModelVisibleTo(sm.model, userDeptCode, isAdmin);
      return {
        id: sm.id,
        serviceId: sm.serviceId,
        modelId: sm.modelId,
        aliasName: sm.aliasName,
        sortOrder: sm.sortOrder,
        weight: sm.weight,
        enabled: sm.enabled,
        addedBy: sm.addedBy,
        addedAt: sm.addedAt,
        fallbackModelId: sm.fallbackModelId,
        fallbackModel: sm.fallbackModel,
        maxRetries: sm.maxRetries,
        model: sm.model,
        accessible, // 현재 사용자가 이 모델에 접근 가능한지
      };
    });

    res.json({ serviceModels: result });
  } catch (error) {
    console.error('Get service models error:', error);
    res.status(500).json({ error: 'Failed to get service models' });
  }
});

/**
 * GET /services/:id/available-models
 * 서비스에 추가 가능한 모델 목록 (사용자 권한 기준 필터링)
 * - SUPER_ADMIN: 전체 모델
 * - SYSTEM ADMIN: dept/BU 스코프 기준 + SUPER_ADMIN_ONLY 제외
 * - SERVICE OWNER/ADMIN (비관리자): PUBLIC + 본인 팀/사업부 스코프 모델
 */
serviceRoutes.get('/:id/available-models', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const serviceId = req.params.id as string;
    if (!(await canManageService(req, serviceId))) {
      res.status(403).json({ error: 'You do not have permission to manage this service' });
      return;
    }

    const models = await prisma.model.findMany({
      where: {
        endpointUrl: { not: 'external://auto-created' },
      },
      orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
    });

    const isSuper = req.adminRole === 'SUPER_ADMIN';
    const userDeptCode = req.adminDeptCode || '';
    const isAdmin = !!(req.adminRole);

    const filtered = isSuper
      ? models
      : models.filter(m => {
          if (m.visibility === 'SUPER_ADMIN_ONLY') return false;
          return isModelVisibleTo(m, userDeptCode, isAdmin);
        });

    res.json({ models: filtered });
  } catch (error) {
    console.error('Get available models error:', error);
    res.status(500).json({ error: 'Failed to get available models' });
  }
});

/**
 * POST /services/:id/models
 * 서비스에 모델 추가
 * 서비스 소유자/관리자 또는 글로벌 관리자만 가능
 * 사용자가 해당 모델에 접근 가능해야 함 (isModelVisibleTo)
 */
const addServiceModelSchema = z.object({
  modelId: z.string().min(1, 'modelId is required'),
  aliasName: z.string().min(1, 'aliasName is required'),
  weight: z.number().int().min(1).max(10).default(1),
  sortOrder: z.number().int().min(0).default(0),
  enabled: z.boolean().default(true),
  fallbackModelId: z.string().nullable().optional(),
});

serviceRoutes.post('/:id/models', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const serviceId = req.params.id as string;
    const validation = addServiceModelSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Invalid request', details: validation.error.issues });
      return;
    }
    const { modelId, aliasName, weight, sortOrder, enabled, fallbackModelId } = validation.data;

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

    // 모델 접근 가능 여부 확인 (admin 정보는 canManageService에서 이미 감지됨)
    // SUPER_ADMIN은 모든 모델에 접근 가능
    if (req.adminRole !== 'SUPER_ADMIN') {
      const userDeptCode = req.adminDeptCode || '';
      const isAdmin = !!(req.adminRole);
      if (model.visibility === 'SUPER_ADMIN_ONLY') {
        res.status(403).json({ error: 'You do not have access to this model' });
        return;
      } else if (!isModelVisibleTo(model, userDeptCode, isAdmin)) {
        res.status(403).json({ error: 'You do not have access to this model' });
        return;
      }
    }

    // 중복 확인 (같은 서비스 + 같은 모델 + 같은 alias)
    const existing = await prisma.serviceModel.findUnique({
      where: { serviceId_modelId_aliasName: { serviceId, modelId, aliasName } },
    });
    if (existing) {
      res.status(409).json({ error: 'This model is already assigned to this alias' });
      return;
    }

    const serviceModel = await prisma.serviceModel.create({
      data: {
        serviceId,
        modelId,
        aliasName,
        weight,
        sortOrder,
        enabled,
        fallbackModelId: fallbackModelId || null,
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
 * PUT /services/:id/models/reorder
 * 서비스 모델 일괄 순서 변경 (batch reorder)
 * Body: { items: [{ id: string, sortOrder: number }] }
 */
const reorderServiceModelsSchema = z.object({
  items: z.array(z.object({
    id: z.string().min(1),
    sortOrder: z.number().int().min(0),
  })).min(1),
});

serviceRoutes.put('/:id/models/reorder', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const serviceId = req.params.id as string;
    const validation = reorderServiceModelsSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Invalid request', details: validation.error.issues });
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

    const { items } = validation.data;

    // Verify all items belong to this service
    const existingModels = await prisma.serviceModel.findMany({
      where: { serviceId, id: { in: items.map((i) => i.id) } },
      select: { id: true },
    });
    const existingIds = new Set(existingModels.map((m: any) => m.id));
    const invalidIds = items.filter((i) => !existingIds.has(i.id));
    if (invalidIds.length > 0) {
      res.status(400).json({
        error: 'Some ServiceModel IDs do not belong to this service',
        invalidIds: invalidIds.map((i) => i.id),
      });
      return;
    }

    // Batch update in transaction
    await prisma.$transaction(
      items.map((item) =>
        prisma.serviceModel.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder },
        })
      )
    );

    // Return updated list
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
          },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { addedAt: 'asc' }],
    });

    res.json({ serviceModels });
  } catch (error) {
    console.error('Reorder service models error:', error);
    res.status(500).json({ error: 'Failed to reorder service models' });
  }
});

/**
 * PUT /services/:id/models/fallback
 * 별칭(alias) 그룹의 폴백 모델 설정/해제
 * 같은 alias의 모든 ServiceModel에 fallbackModelId를 일괄 적용
 */
serviceRoutes.put('/:id/models/fallback', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const serviceId = req.params.id as string;
    const schema = z.object({
      aliasName: z.string().min(1),
      fallbackModelId: z.string().nullable(), // null이면 해제
    });
    const validation = schema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Invalid request', details: validation.error.issues });
      return;
    }
    const { aliasName, fallbackModelId } = validation.data;

    if (!(await canManageService(req, serviceId))) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    // 폴백 모델 존재 + 권한 확인
    if (fallbackModelId) {
      const fbModel = await prisma.model.findUnique({ where: { id: fallbackModelId } });
      if (!fbModel) {
        res.status(404).json({ error: 'Fallback model not found' });
        return;
      }
      if (req.adminRole !== 'SUPER_ADMIN') {
        const fbDeptCode = req.adminDeptCode || '';
        if (fbModel.visibility === 'SUPER_ADMIN_ONLY' || !isModelVisibleTo(fbModel, fbDeptCode, !!req.adminRole)) {
          res.status(403).json({ error: 'You do not have access to this model' });
          return;
        }
      }
    }

    // alias 그룹 전체에 일괄 적용
    const updated = await prisma.serviceModel.updateMany({
      where: { serviceId, aliasName },
      data: { fallbackModelId },
    });

    res.json({ message: `Fallback ${fallbackModelId ? 'set' : 'cleared'} for alias "${aliasName}"`, updated: updated.count });
  } catch (error) {
    console.error('Set fallback model error:', error);
    res.status(500).json({ error: 'Failed to set fallback model' });
  }
});

/**
 * PUT /services/:id/models/max-retries
 * 별칭(alias) 그룹의 재시도 횟수 설정
 */
serviceRoutes.put('/:id/models/max-retries', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const serviceId = req.params.id as string;
    const schema = z.object({
      aliasName: z.string().min(1),
      maxRetries: z.number().int().min(0).max(10),
    });
    const validation = schema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Invalid request', details: validation.error.issues });
      return;
    }
    const { aliasName, maxRetries } = validation.data;

    if (!(await canManageService(req, serviceId))) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    const updated = await prisma.serviceModel.updateMany({
      where: { serviceId, aliasName },
      data: { maxRetries },
    });

    res.json({ message: `maxRetries set to ${maxRetries} for alias "${aliasName}"`, updated: updated.count });
  } catch (error) {
    console.error('Set max retries error:', error);
    res.status(500).json({ error: 'Failed to set max retries' });
  }
});

/**
 * PUT /services/:id/models/:serviceModelId
 * 개별 ServiceModel 속성 수정 (weight, sortOrder, enabled)
 */
const updateServiceModelSchema = z.object({
  weight: z.number().int().min(1).max(10).optional(),
  sortOrder: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field (weight, sortOrder, enabled) must be provided',
});

serviceRoutes.put('/:id/models/:serviceModelId', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const serviceId = req.params.id as string;
    const serviceModelId = req.params.serviceModelId as string;

    const validation = updateServiceModelSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Invalid request', details: validation.error.issues });
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

    const existing = await prisma.serviceModel.findFirst({
      where: { id: serviceModelId, serviceId },
    });
    if (!existing) {
      res.status(404).json({ error: 'ServiceModel not found for this service' });
      return;
    }

    const updated = await prisma.serviceModel.update({
      where: { id: serviceModelId },
      data: validation.data,
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

    res.json({ serviceModel: updated });
  } catch (error) {
    console.error('Update service model error:', error);
    res.status(500).json({ error: 'Failed to update service model' });
  }
});

/**
 * DELETE /services/:id/models/:modelId
 * 서비스에서 모델 제거 (by modelId - composite key)
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

    const existing = await prisma.serviceModel.findMany({
      where: { serviceId, modelId },
    });
    if (existing.length === 0) {
      res.status(404).json({ error: 'Model is not assigned to this service' });
      return;
    }

    await prisma.serviceModel.deleteMany({
      where: { serviceId, modelId },
    });

    res.json({ message: 'Model removed from service successfully' });
  } catch (error) {
    console.error('Remove service model error:', error);
    res.status(500).json({ error: 'Failed to remove model from service' });
  }
});

/**
 * DELETE /services/:id/service-models/:serviceModelId
 * 서비스에서 모델 제거 (by ServiceModel ID)
 * 동일 모델이 다른 설정으로 추가된 경우 개별 삭제용
 */
serviceRoutes.delete('/:id/service-models/:serviceModelId', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const serviceId = req.params.id as string;
    const serviceModelId = req.params.serviceModelId as string;

    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }

    if (!(await canManageService(req, serviceId))) {
      res.status(403).json({ error: 'You do not have permission to manage this service\'s models' });
      return;
    }

    const existing = await prisma.serviceModel.findFirst({
      where: { id: serviceModelId, serviceId },
    });
    if (!existing) {
      res.status(404).json({ error: 'ServiceModel not found for this service' });
      return;
    }

    await prisma.serviceModel.delete({ where: { id: serviceModelId } });
    res.json({ message: 'ServiceModel removed from service successfully' });
  } catch (error) {
    console.error('Remove service model by id error:', error);
    res.status(500).json({ error: 'Failed to remove service model' });
  }
});

// ============================================
// 서비스 모델 복사 (Copy from another service)
// ============================================

/**
 * POST /services/:id/models/copy-from/:sourceId
 * 소스 서비스의 모델 설정을 대상 서비스에 복사
 * 양쪽 서비스 모두 관리 권한 필요
 * mode: 'merge' (기존 유지 + 추가) | 'replace' (기존 삭제 후 복사)
 */
serviceRoutes.post('/:id/models/copy-from/:sourceId', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const targetId = req.params.id as string;
    const sourceId = req.params.sourceId as string;
    const mode = (req.body?.mode || 'merge') as 'merge' | 'replace';

    if (targetId === sourceId) {
      res.status(400).json({ error: '같은 서비스에서 복사할 수 없습니다.' });
      return;
    }

    // 양쪽 서비스 존재 확인
    const [targetService, sourceService] = await Promise.all([
      prisma.service.findUnique({ where: { id: targetId } }),
      prisma.service.findUnique({ where: { id: sourceId } }),
    ]);
    if (!targetService) { res.status(404).json({ error: '대상 서비스를 찾을 수 없습니다.' }); return; }
    if (!sourceService) { res.status(404).json({ error: '소스 서비스를 찾을 수 없습니다.' }); return; }

    // 양쪽 서비스 모두 관리 권한 확인
    if (!(await canManageService(req, targetId))) {
      res.status(403).json({ error: '대상 서비스에 대한 관리 권한이 없습니다.' });
      return;
    }
    if (!(await canManageService(req, sourceId))) {
      res.status(403).json({ error: '소스 서비스에 대한 관리 권한이 없습니다.' });
      return;
    }

    // 소스 서비스의 모델 설정 가져오기
    const sourceModels = await prisma.serviceModel.findMany({
      where: { serviceId: sourceId },
      include: { model: { select: { id: true, enabled: true, visibility: true } } },
    });

    if (sourceModels.length === 0) {
      res.status(400).json({ error: '소스 서비스에 설정된 모델이 없습니다.' });
      return;
    }

    // replace 모드: 기존 모델 설정 삭제
    if (mode === 'replace') {
      await prisma.serviceModel.deleteMany({ where: { serviceId: targetId } });
    }

    let copied = 0;
    let skipped = 0;
    const skippedReasons: string[] = [];

    for (const sm of sourceModels) {
      // 모델 접근 가능 여부 확인
      if (!sm.model.enabled) {
        skipped++;
        skippedReasons.push(`${sm.aliasName}/${sm.model.id}: 비활성 모델`);
        continue;
      }

      // 중복 확인 (merge 모드에서)
      if (mode === 'merge') {
        const existing = await prisma.serviceModel.findUnique({
          where: { serviceId_modelId_aliasName: { serviceId: targetId, modelId: sm.modelId, aliasName: sm.aliasName } },
        });
        if (existing) {
          skipped++;
          skippedReasons.push(`${sm.aliasName}/${sm.model.id}: 이미 존재`);
          continue;
        }
      }

      await prisma.serviceModel.create({
        data: {
          serviceId: targetId,
          modelId: sm.modelId,
          aliasName: sm.aliasName,
          weight: sm.weight,
          sortOrder: sm.sortOrder,
          enabled: sm.enabled,
          addedBy: req.user?.loginid || '',
        },
      });
      copied++;
    }

    await recordAudit(req, 'COPY_SERVICE_MODELS', targetId, 'SERVICE', {
      sourceServiceId: sourceId,
      sourceServiceName: sourceService.name,
      targetServiceName: targetService.name,
      mode,
      copied,
      skipped,
    });

    res.json({
      message: `${copied}개 모델 설정이 복사되었습니다.`,
      copied,
      skipped,
      skippedReasons: skippedReasons.length > 0 ? skippedReasons : undefined,
    });
  } catch (error) {
    console.error('Copy service models error:', error);
    res.status(500).json({ error: '모델 설정 복사에 실패했습니다.' });
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

// ============================================
// Rate Limit Management (Service Owner/Admin)
// ============================================

/**
 * GET /services/:id/rate-limits
 * 서비스의 전체 사용자 rate limit 목록 조회
 * 권한: Service OWNER, Service ADMIN, System Admin
 */
serviceRoutes.get('/:id/rate-limits', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const serviceId = req.params.id as string;
    if (!(await canManageService(req, serviceId))) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    const rateLimits = await prisma.userRateLimit.findMany({
      where: { serviceId },
      include: {
        user: { select: { id: true, loginid: true, username: true, deptname: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ rateLimits });
  } catch (error) {
    console.error('Get service rate limits error:', error);
    res.status(500).json({ error: 'Failed to get rate limits' });
  }
});

/**
 * PUT /services/:id/rate-limits/:userId
 * 사용자의 서비스별 rate limit 설정/수정
 * 권한: Service OWNER, Service ADMIN, System Admin
 * Body: { maxTokens, window: 'FIVE_HOURS' | 'DAY', enabled? }
 */
serviceRoutes.put('/:id/rate-limits/:userId', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const serviceId = req.params.id as string;
    const userId = req.params.userId as string;

    if (!(await canManageService(req, serviceId))) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    const { maxTokens, window: windowType, enabled } = req.body;

    if (maxTokens === undefined || maxTokens === null || !windowType) {
      res.status(400).json({ error: 'maxTokens and window are required' });
      return;
    }

    if (!['FIVE_HOURS', 'DAY'].includes(windowType)) {
      res.status(400).json({ error: 'window must be FIVE_HOURS or DAY' });
      return;
    }

    if (typeof maxTokens !== 'number' || maxTokens < 1) {
      res.status(400).json({ error: 'maxTokens must be at least 1' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const rateLimit = await prisma.userRateLimit.upsert({
      where: { userId_serviceId: { userId, serviceId } },
      update: {
        maxTokens,
        window: windowType,
        enabled: enabled !== undefined ? enabled : true,
        createdBy: req.user!.loginid,
      },
      create: {
        userId,
        serviceId,
        maxTokens,
        window: windowType,
        enabled: enabled !== undefined ? enabled : true,
        createdBy: req.user!.loginid,
      },
    });

    res.json({ rateLimit, message: 'Rate limit updated' });
  } catch (error) {
    console.error('Set service user rate limit error:', error);
    res.status(500).json({ error: 'Failed to set rate limit' });
  }
});

/**
 * DELETE /services/:id/rate-limits/:userId
 * 사용자의 서비스별 rate limit 삭제 (무제한으로 복원)
 * 권한: Service OWNER, Service ADMIN, System Admin
 */
serviceRoutes.delete('/:id/rate-limits/:userId', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const serviceId = req.params.id as string;
    const userId = req.params.userId as string;

    if (!(await canManageService(req, serviceId))) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    const existing = await prisma.userRateLimit.findUnique({
      where: { userId_serviceId: { userId, serviceId } },
    });

    if (!existing) {
      res.status(404).json({ error: 'Rate limit not found' });
      return;
    }

    await prisma.userRateLimit.delete({
      where: { userId_serviceId: { userId, serviceId } },
    });

    res.json({ success: true, message: 'Rate limit removed (unlimited)' });
  } catch (error) {
    console.error('Delete service user rate limit error:', error);
    res.status(500).json({ error: 'Failed to delete rate limit' });
  }
});

/**
 * GET /services/:id/service-rate-limit
 * 서비스의 공통 rate limit 조회
 * 권한: Service OWNER, Service ADMIN, System Admin
 */
serviceRoutes.get('/:id/service-rate-limit', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const serviceId = req.params.id as string;
    if (!(await canManageService(req, serviceId))) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    const rateLimit = await prisma.serviceRateLimit.findUnique({
      where: { serviceId },
    });

    res.json({ rateLimit: rateLimit || null });
  } catch (error) {
    console.error('Get service rate limit error:', error);
    res.status(500).json({ error: 'Failed to get service rate limit' });
  }
});

/**
 * PUT /services/:id/service-rate-limit
 * 서비스의 공통 rate limit 설정/수정
 * 권한: Service OWNER, Service ADMIN, System Admin
 * Body: { maxTokens, window: 'FIVE_HOURS' | 'DAY', enabled? }
 */
serviceRoutes.put('/:id/service-rate-limit', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const serviceId = req.params.id as string;
    if (!(await canManageService(req, serviceId))) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    const { maxTokens, window: windowType, enabled } = req.body;

    if (maxTokens === undefined || maxTokens === null || !windowType) {
      res.status(400).json({ error: 'maxTokens and window are required' });
      return;
    }

    if (!['FIVE_HOURS', 'DAY'].includes(windowType)) {
      res.status(400).json({ error: 'window must be FIVE_HOURS or DAY' });
      return;
    }

    if (typeof maxTokens !== 'number' || maxTokens < 1) {
      res.status(400).json({ error: 'maxTokens must be at least 1' });
      return;
    }

    const rateLimit = await prisma.serviceRateLimit.upsert({
      where: { serviceId },
      update: {
        maxTokens,
        window: windowType,
        enabled: enabled !== undefined ? enabled : true,
        createdBy: req.user!.loginid,
      },
      create: {
        serviceId,
        maxTokens,
        window: windowType,
        enabled: enabled !== undefined ? enabled : true,
        createdBy: req.user!.loginid,
      },
    });

    res.json({ rateLimit, message: 'Service rate limit updated' });
  } catch (error) {
    console.error('Set service common rate limit error:', error);
    res.status(500).json({ error: 'Failed to set service rate limit' });
  }
});

/**
 * DELETE /services/:id/service-rate-limit
 * 서비스의 공통 rate limit 삭제 (무제한으로 복원)
 * 권한: Service OWNER, Service ADMIN, System Admin
 */
serviceRoutes.delete('/:id/service-rate-limit', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const serviceId = req.params.id as string;
    if (!(await canManageService(req, serviceId))) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    const existing = await prisma.serviceRateLimit.findUnique({ where: { serviceId } });
    if (!existing) {
      res.status(404).json({ error: 'Service rate limit not found' });
      return;
    }

    await prisma.serviceRateLimit.delete({ where: { serviceId } });
    res.json({ success: true, message: 'Service rate limit removed (unlimited)' });
  } catch (error) {
    console.error('Delete service common rate limit error:', error);
    res.status(500).json({ error: 'Failed to delete service rate limit' });
  }
});

// ============================================
// 서비스별 에러 로그 조회
// ============================================

const SERVICE_ERROR_RULES: Array<{ pattern: string; cause: string; category: string }> = [
  { pattern: 'x-service-id header is required', cause: 'x-service-id 헤더를 포함시키지 않았습니다', category: '헤더 누락' },
  { pattern: 'x-dept-name header is required', cause: 'x-dept-name 헤더를 포함시키지 않았습니다', category: '헤더 누락' },
  { pattern: 'x-user-id header is required', cause: 'STANDARD 서비스에서 x-user-id 헤더를 포함시키지 않았습니다', category: '헤더 누락' },
  { pattern: 'is not registered', cause: '등록되지 않은 서비스 ID를 사용했습니다', category: '서비스 오류' },
  { pattern: 'is disabled', cause: '비활성화된 서비스를 호출했습니다', category: '서비스 오류' },
  { pattern: 'Department mismatch', cause: '부서 정보가 등록된 정보와 다릅니다', category: '인증 오류' },
  { pattern: 'Knox verification failed', cause: 'Knox 임직원 인증에 실패했습니다', category: '인증 오류' },
  { pattern: 'restricted to specific business units', cause: '해당 사업부에 공개되지 않은 서비스입니다', category: '접근 제한' },
  { pattern: 'restricted to specific teams', cause: '해당 팀에 공개되지 않은 서비스입니다', category: '접근 제한' },
  { pattern: 'not found', cause: '존재하지 않는 모델 또는 서비스입니다', category: '모델/서비스 오류' },
  { pattern: 'Use a registered alias', cause: '등록되지 않은 모델 alias를 사용했습니다', category: '모델/서비스 오류' },
  { pattern: 'Rate limit exceeded', cause: '토큰 사용량 한도를 초과했습니다', category: 'Rate Limit' },
  { pattern: 'Token rate limit', cause: '토큰 사용량 한도를 초과했습니다', category: 'Rate Limit' },
  { pattern: 'model and messages are required', cause: 'model 또는 messages 필드가 누락되었습니다', category: '요청 오류' },
  { pattern: 'model is required', cause: 'model 필드가 누락되었습니다', category: '요청 오류' },
  { pattern: 'model and input are required', cause: 'model 또는 input 필드가 누락되었습니다', category: '요청 오류' },
  { pattern: 'context_length_exceeded', cause: '입력이 모델의 최대 컨텍스트 길이를 초과했습니다', category: '요청 오류' },
  { pattern: 'is not an IMAGE model', cause: 'IMAGE 타입이 아닌 모델로 이미지 생성을 시도했습니다', category: '모델/서비스 오류' },
  { pattern: 'audio file is required', cause: '오디오 파일이 첨부되지 않았습니다', category: '요청 오류' },
  { pattern: 'Service temporarily unavailable', cause: 'LLM 엔드포인트에 연결할 수 없습니다', category: 'LLM 장애' },
  { pattern: 'Connection failed', cause: 'LLM 엔드포인트 연결에 실패했습니다', category: 'LLM 장애' },
  { pattern: 'Timed out', cause: 'LLM 응답 시간이 초과되었습니다', category: 'LLM 장애' },
  { pattern: 'LLM request failed', cause: 'LLM 요청이 실패했습니다', category: 'LLM 장애' },
];

function matchServiceErrorCause(errorMessage: string | null): { cause: string; category: string } | null {
  if (!errorMessage) return null;
  const lower = errorMessage.toLowerCase();
  for (const rule of SERVICE_ERROR_RULES) {
    if (lower.includes(rule.pattern.toLowerCase())) {
      return { cause: rule.cause, category: rule.category };
    }
  }
  return null;
}

function getServiceCategoryDbFilter(cat: string): Record<string, unknown> | null {
  if (cat === '미분류') {
    return {
      AND: SERVICE_ERROR_RULES.map(r => ({
        errorMessage: { not: { contains: r.pattern, mode: 'insensitive' as const } },
      })),
    };
  }
  const patterns = SERVICE_ERROR_RULES.filter(r => r.category === cat).map(r => r.pattern);
  if (patterns.length === 0) return null;
  return {
    OR: patterns.map(p => ({
      errorMessage: { contains: p, mode: 'insensitive' as const },
    })),
  };
}

/**
 * GET /services/:id/error-logs
 * 서비스별 에러 로그 조회
 * 권한: Service OWNER/ADMIN 또는 System Super Admin
 */
serviceRoutes.get('/:id/error-logs', authenticateToken, (async (req: AuthenticatedRequest, res) => {
  try {
    const serviceId = req.params.id as string;

    if (!(await canManageService(req, serviceId))) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    const page = Math.max(1, parseInt(req.query['page'] as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query['limit'] as string) || 50));
    const skip = (page - 1) * limit;

    const statusCode = req.query['statusCode'] as string | undefined;
    const category = req.query['category'] as string | undefined;
    const userId = req.query['userId'] as string | undefined;
    const startDate = req.query['startDate'] as string | undefined;
    const endDate = req.query['endDate'] as string | undefined;

    const where: Record<string, unknown> = {
      serviceId,
      statusCode: { not: 200 },
    };

    if (statusCode) {
      const codes = statusCode.split(',').map(c => parseInt(c.trim())).filter(c => !isNaN(c));
      if (codes.length === 1) {
        where.statusCode = codes[0];
      } else if (codes.length > 1) {
        where.statusCode = { in: codes };
      }
    }
    if (userId) where.userId = { contains: userId, mode: 'insensitive' };

    if (startDate || endDate) {
      const ts: Record<string, Date> = {};
      if (startDate) ts.gte = new Date(startDate);
      if (endDate) ts.lte = new Date(endDate + 'T23:59:59.999Z');
      where.timestamp = ts;
    }

    if (category) {
      const catFilter = getServiceCategoryDbFilter(category);
      if (catFilter) Object.assign(where, catFilter);
    }

    const [logs, total] = await Promise.all([
      prisma.requestLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
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
          errorMessage: true,
          errorDetails: true,
          inputTokens: true,
          outputTokens: true,
          latencyMs: true,
          userAgent: true,
          ipAddress: true,
          stream: true,
          timestamp: true,
          service: { select: { name: true, displayName: true } },
        },
      }),
      prisma.requestLog.count({ where }),
    ]);

    const enriched = logs.map(log => {
      const matched = matchServiceErrorCause(log.errorMessage);
      return {
        ...log,
        ruleCause: matched?.cause || null,
        ruleCategory: matched?.category || null,
        isAnalyzable: !matched,
      };
    });

    res.json({
      logs: enriched,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      categories: [
        '헤더 누락', '서비스 오류', '인증 오류', '접근 제한',
        '모델/서비스 오류', 'Rate Limit', '요청 오류', 'LLM 장애', '미분류',
      ],
    });
  } catch (error) {
    console.error('Get service error logs error:', error);
    res.status(500).json({ error: 'Failed to get service error logs' });
  }
}) as RequestHandler);

