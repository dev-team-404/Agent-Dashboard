/**
 * Admin Request Routes
 *
 * 관리자 권한 신청/처리 엔드포인트
 * - GET    /admin-requests/super-admins   — 슈퍼 관리자 목록 (인증된 사용자)
 * - POST   /admin-requests               — 권한 신청 (인증된 사용자)
 * - GET    /admin-requests/my             — 내 신청 내역 (인증된 사용자)
 * - GET    /admin/admin-requests          — 신청 목록 조회 (시스템 관리자)
 * - PUT    /admin/admin-requests/:id      — 신청 승인/거부 (시스템 관리자)
 */

import { Router, RequestHandler } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, requireAdmin, AuthenticatedRequest, extractBusinessUnit } from '../middleware/auth.js';
import { lookupEmployee } from '../services/knoxEmployee.service.js';

export const adminRequestRoutes = Router();

// ── Audit helper ──
async function recordAudit(
  req: AuthenticatedRequest,
  action: string,
  target: string | null,
  targetType: string,
  details?: Record<string, unknown>,
) {
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
// GET /admin-requests/super-admins
// 슈퍼 관리자 연락처 목록 (인증된 사용자 누구나)
// ============================================
adminRequestRoutes.get('/admin-requests/super-admins', authenticateToken, (async (_req: AuthenticatedRequest, res) => {
  try {
    const superAdmins = await prisma.admin.findMany({
      where: { role: 'SUPER_ADMIN' },
      select: { loginid: true, deptname: true },
      orderBy: { loginid: 'asc' },
    });

    // 환경변수 슈퍼관리자 추가
    const hardcoded = (process.env['DEVELOPERS'] || 'syngha.han,young87.kim,byeongju.lee')
      .split(',').map(s => s.trim()).filter(Boolean);

    const allIds = new Set(superAdmins.map(a => a.loginid));
    for (const id of hardcoded) {
      if (!allIds.has(id)) {
        superAdmins.push({ loginid: id, deptname: '' });
      }
    }

    res.json({ superAdmins });
  } catch (error) {
    console.error('Get super admins error:', error);
    res.status(500).json({ error: 'Failed to get super admins' });
  }
}) as RequestHandler);

// ============================================
// POST /admin-requests
// 관리자 권한 신청 (인증된 사용자)
// ============================================
adminRequestRoutes.post('/admin-requests', authenticateToken, (async (req: AuthenticatedRequest, res) => {
  try {
    const loginid = req.user?.loginid || '';
    const { reason } = req.body;

    if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
      res.status(400).json({ error: '신청 사유를 5자 이상 입력해주세요.' });
      return;
    }

    // 이미 관리자인지 확인
    const existingAdmin = await prisma.admin.findUnique({ where: { loginid } });
    if (existingAdmin) {
      res.status(400).json({ error: '이미 관리자 권한이 있습니다.' });
      return;
    }

    // 이미 대기 중인 신청이 있는지 확인
    const pendingRequest = await prisma.adminRequest.findFirst({
      where: { loginid, status: 'PENDING' },
    });
    if (pendingRequest) {
      res.status(400).json({ error: '이미 대기 중인 신청이 있습니다.' });
      return;
    }

    // Knox에서 사원 정보 조회
    const employee = await lookupEmployee(loginid).catch(() => null);

    const user = await prisma.user.findUnique({
      where: { loginid },
      select: { username: true, deptname: true, businessUnit: true },
    });

    const request = await prisma.adminRequest.create({
      data: {
        loginid,
        username: employee?.fullName || user?.username || '',
        deptname: employee?.departmentName || user?.deptname || '',
        businessUnit: employee?.businessUnit || user?.businessUnit || extractBusinessUnit(user?.deptname || ''),
        titleName: employee?.titleName || null,
        reason: reason.trim(),
      },
    });

    res.status(201).json({ request });
  } catch (error) {
    console.error('Create admin request error:', error);
    res.status(500).json({ error: 'Failed to create admin request' });
  }
}) as RequestHandler);

// ============================================
// GET /admin-requests/my
// 내 신청 내역 (인증된 사용자)
// ============================================
adminRequestRoutes.get('/admin-requests/my', authenticateToken, (async (req: AuthenticatedRequest, res) => {
  try {
    const loginid = req.user?.loginid || '';
    const requests = await prisma.adminRequest.findMany({
      where: { loginid },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    res.json({ requests });
  } catch (error) {
    console.error('Get my admin requests error:', error);
    res.status(500).json({ error: 'Failed to get admin requests' });
  }
}) as RequestHandler);

// ============================================
// GET /admin/admin-requests
// 전체 신청 목록 (시스템 관리자)
// ============================================
adminRequestRoutes.get('/admin/admin-requests', authenticateToken, requireAdmin as RequestHandler, (async (req: AuthenticatedRequest, res) => {
  try {
    const status = (req.query['status'] as string) || undefined;
    const where: Record<string, unknown> = {};
    if (status) where.status = status;

    const requests = await prisma.adminRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ requests });
  } catch (error) {
    console.error('List admin requests error:', error);
    res.status(500).json({ error: 'Failed to list admin requests' });
  }
}) as RequestHandler);

// ============================================
// PUT /admin/admin-requests/:id
// 신청 승인/거부 (시스템 관리자)
// ============================================
adminRequestRoutes.put('/admin/admin-requests/:id', authenticateToken, requireAdmin as RequestHandler, (async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { action, reviewNote } = req.body;

    if (!action || !['APPROVED', 'REJECTED'].includes(action)) {
      res.status(400).json({ error: 'action must be APPROVED or REJECTED' });
      return;
    }

    const request = await prisma.adminRequest.findUnique({ where: { id } });
    if (!request) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }
    if (request.status !== 'PENDING') {
      res.status(400).json({ error: '이미 처리된 신청입니다.' });
      return;
    }

    // 승인 시 Admin 테이블에 추가
    if (action === 'APPROVED') {
      const user = await prisma.user.findFirst({ where: { loginid: request.loginid } });
      if (!user) {
        res.status(400).json({ error: '해당 사용자를 찾을 수 없습니다.' });
        return;
      }

      await prisma.admin.upsert({
        where: { loginid: request.loginid },
        update: {
          role: 'ADMIN',
          deptname: request.deptname || user.deptname || '',
          businessUnit: request.businessUnit || user.businessUnit || extractBusinessUnit(user.deptname || ''),
          designatedBy: req.user?.loginid || '',
        },
        create: {
          loginid: request.loginid,
          role: 'ADMIN',
          deptname: request.deptname || user.deptname || '',
          businessUnit: request.businessUnit || user.businessUnit || extractBusinessUnit(user.deptname || ''),
          designatedBy: req.user?.loginid || '',
        },
      });
    }

    const updated = await prisma.adminRequest.update({
      where: { id },
      data: {
        status: action,
        reviewedBy: req.user?.loginid || '',
        reviewedAt: new Date(),
        reviewNote: reviewNote || null,
      },
    });

    recordAudit(req, action === 'APPROVED' ? 'APPROVE_ADMIN_REQUEST' : 'REJECT_ADMIN_REQUEST',
      request.loginid, 'AdminRequest', {
        requestId: id,
        applicant: request.loginid,
        applicantName: request.username,
        reason: request.reason,
        reviewNote: reviewNote || null,
      }).catch(() => {});

    res.json({ request: updated });
  } catch (error) {
    console.error('Review admin request error:', error);
    res.status(500).json({ error: 'Failed to review admin request' });
  }
}) as RequestHandler);
