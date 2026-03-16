/**
 * Service Targets Routes
 *
 * 서비스 목표 관리 엔드포인트 (시스템 관리자 전용)
 * - GET  /admin/service-targets       — 관리 가능한 서비스 목록 + 목표/실적 조회
 * - PUT  /admin/service-targets/:id   — 서비스별 목표 M/M, Saved M/M 수정 (감사 로그 기록)
 */

import { Router, RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../index.js';
import { authenticateToken, requireAdmin, AuthenticatedRequest } from '../middleware/auth.js';
import { isTopLevelDivision } from '../services/knoxEmployee.service.js';

export const serviceTargetsRoutes = Router();

serviceTargetsRoutes.use(authenticateToken);
serviceTargetsRoutes.use(requireAdmin as RequestHandler);

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
        action,
        target,
        targetType,
        details: details ? JSON.parse(JSON.stringify(details)) : undefined,
        ipAddress: req.ip || (req.headers['x-forwarded-for'] as string) || undefined,
      },
    });
  } catch (err) {
    console.error('[AuditLog] Failed to record:', err);
  }
}

// ============================================
// GET /admin/service-targets
// 같은 팀원이 만든 서비스 목록 + 목표/실적
// SUPER_ADMIN: 전체 서비스
// ADMIN: 같은 부서 서비스
// ============================================
serviceTargetsRoutes.get('/service-targets', (async (req: AuthenticatedRequest, res) => {
  try {
    const where: Record<string, unknown> = {};

    if (req.adminRole === 'ADMIN') {
      // ADMIN은 같은 부서(팀)의 서비스만
      where.registeredByDept = req.adminDept || req.user?.deptname || '';
    }
    // SUPER_ADMIN: 모든 서비스

    const services = await prisma.service.findMany({
      where,
      select: {
        id: true,
        name: true,
        displayName: true,
        type: true,
        status: true,
        enabled: true,
        targetMM: true,
        savedMM: true,
        registeredBy: true,
        registeredByDept: true,
        team: true,
        center2Name: true,
        center1Name: true,
        createdAt: true,
      },
      orderBy: [{ registeredByDept: 'asc' }, { displayName: 'asc' }],
    });

    res.json({
      services: services.map(s => {
        let c2 = s.center2Name ?? null;
        let c1 = s.center1Name ?? null;
        if (c2 && isTopLevelDivision(c2)) { c2 = 'none'; c1 = 'none'; }
        else if (c1 && isTopLevelDivision(c1)) { c1 = 'none'; }
        return { ...s, center2Name: c2, center1Name: c1 };
      }),
    });
  } catch (error) {
    console.error('Get service targets error:', error);
    res.status(500).json({ error: 'Failed to get service targets' });
  }
}) as RequestHandler);

// ============================================
// PUT /admin/service-targets/:id
// 서비스별 목표 M/M, Saved M/M 수정
// 모든 변경은 감사 로그에 기록됨
// ============================================
const updateTargetSchema = z.object({
  targetMM: z.number().min(0).max(9999).optional().nullable(),
  savedMM: z.number().min(0).max(9999).optional().nullable(),
});

serviceTargetsRoutes.put('/service-targets/:id', (async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params['id'] as string;
    const validation = updateTargetSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Invalid request', details: validation.error.issues });
      return;
    }

    const service = await prisma.service.findUnique({
      where: { id },
      select: { id: true, name: true, displayName: true, targetMM: true, savedMM: true, registeredByDept: true },
    });

    if (!service) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }

    // ADMIN은 같은 부서 서비스만 수정 가능
    if (req.adminRole === 'ADMIN') {
      const adminDept = req.adminDept || req.user?.deptname || '';
      if (service.registeredByDept !== adminDept) {
        res.status(403).json({ error: 'You can only manage services in your department' });
        return;
      }
    }

    const updateData: Record<string, unknown> = {};
    const changes: Record<string, unknown> = { serviceName: service.name, serviceDisplayName: service.displayName };

    if (validation.data.targetMM !== undefined) {
      changes.targetMM_before = service.targetMM;
      changes.targetMM_after = validation.data.targetMM;
      updateData.targetMM = validation.data.targetMM;
    }

    if (validation.data.savedMM !== undefined) {
      changes.savedMM_before = service.savedMM;
      changes.savedMM_after = validation.data.savedMM;
      updateData.savedMM = validation.data.savedMM;
    }

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    const updated = await prisma.service.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        displayName: true,
        targetMM: true,
        savedMM: true,
      },
    });

    // 감사 로그 기록 (fire-and-forget: 업데이트 성공 응답이 감사 로그 실패에 영향받지 않도록)
    recordAudit(req, 'UPDATE_SERVICE_TARGET', service.id, 'ServiceTarget', changes).catch(() => {});

    res.json({ service: updated });
  } catch (error) {
    console.error('Update service target error:', error);
    res.status(500).json({ error: 'Failed to update service target' });
  }
}) as RequestHandler);
