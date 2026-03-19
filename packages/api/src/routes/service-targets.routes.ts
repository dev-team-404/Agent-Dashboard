/**
 * Service Targets Routes
 *
 * 서비스 목표 관리 엔드포인트 (시스템 관리자 전용)
 * - GET  /admin/service-targets       — 관리 가능한 서비스 목록 + 목표/실적 + 부서별 breakdown 조회
 * - PUT  /admin/service-targets/:id   — 서비스별 목표 M/M 수정 (감사 로그 기록)
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

// ── KST 기준 지난달 경계 계산 ──
function getLastMonthBoundariesKST(): { start: Date; end: Date; bizDaysCount: number } {
  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const kstYear = kstNow.getUTCFullYear();
  const kstMonth = kstNow.getUTCMonth(); // 0-indexed, current month

  // 지난달 1일 00:00:00 KST → UTC
  const lastMonthYear = kstMonth === 0 ? kstYear - 1 : kstYear;
  const lastMonth = kstMonth === 0 ? 11 : kstMonth - 1;
  const start = new Date(Date.UTC(lastMonthYear, lastMonth, 1, -9, 0, 0)); // KST 00:00 → UTC

  // 이번달 1일 00:00:00 KST → UTC (exclusive end)
  const end = new Date(Date.UTC(kstYear, kstMonth, 1, -9, 0, 0));

  // 지난달 영업일 수 계산 (주말 제외, 공휴일은 SQL에서 제외)
  let bizDaysCount = 0;
  const cursor = new Date(Date.UTC(lastMonthYear, lastMonth, 1));
  const endDay = new Date(Date.UTC(kstYear, kstMonth, 1));
  while (cursor < endDay) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) bizDaysCount++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return { start, end, bizDaysCount };
}

// ============================================
// GET /admin/service-targets
// 같은 팀원이 만든 서비스 목록 + 목표/실적
// + 부서별 savedMM/aiEstimatedMM breakdown
// + 부서별 DAU/MAU
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

    // 모든 서비스 ID 목록
    const serviceIds = services.map(s => s.id);

    // 부서별 Saved M/M 전체 조회
    const allDeptSavedMMs = serviceIds.length > 0
      ? await prisma.deptServiceSavedMM.findMany({
          where: { serviceId: { in: serviceIds } },
          select: {
            serviceId: true,
            deptname: true,
            savedMM: true,
            aiEstimatedMM: true,
            aiConfidence: true,
            aiReasoning: true,
          },
        })
      : [];

    // 서비스별로 그룹핑
    const deptSavedByService = new Map<string, typeof allDeptSavedMMs>();
    for (const d of allDeptSavedMMs) {
      const arr = deptSavedByService.get(d.serviceId) || [];
      arr.push(d);
      deptSavedByService.set(d.serviceId, arr);
    }

    // 지난달 DAU/MAU 계산 (raw SQL)
    const { start: lastMonthStart, end: lastMonthEnd, bizDaysCount } = getLastMonthBoundariesKST();

    // MAU: 지난달 서비스별 고유 사용자 수 (anonymous 제외, 주말/공휴일 제외)
    const mauRows = serviceIds.length > 0
      ? await prisma.$queryRaw<Array<{ service_id: string; mau: bigint }>>`
          SELECT ul.service_id::text as service_id,
                 COUNT(DISTINCT ul.user_id) as mau
          FROM usage_logs ul
          INNER JOIN users u ON ul.user_id = u.id
          WHERE ul.timestamp >= ${lastMonthStart} AND ul.timestamp < ${lastMonthEnd}
            AND u.loginid != 'anonymous'
            AND ul.service_id IS NOT NULL
            AND EXTRACT(DOW FROM ul.timestamp) NOT IN (0, 6)
            AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = DATE(ul.timestamp))
          GROUP BY ul.service_id
        `
      : [];

    // DAU: 지난달 서비스별 일별 고유 사용자 수 합계 (anonymous 제외, 주말/공휴일 제외)
    const dauRows = serviceIds.length > 0
      ? await prisma.$queryRaw<Array<{ service_id: string; total_dau: bigint }>>`
          SELECT service_id::text as service_id, SUM(daily_dau) as total_dau
          FROM (
            SELECT ul.service_id,
                   COUNT(DISTINCT ul.user_id) as daily_dau
            FROM usage_logs ul
            INNER JOIN users u ON ul.user_id = u.id
            WHERE ul.timestamp >= ${lastMonthStart} AND ul.timestamp < ${lastMonthEnd}
              AND u.loginid != 'anonymous'
              AND ul.service_id IS NOT NULL
              AND EXTRACT(DOW FROM ul.timestamp) NOT IN (0, 6)
              AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = DATE(ul.timestamp))
            GROUP BY ul.service_id, DATE(ul.timestamp)
          ) sub
          GROUP BY service_id
        `
      : [];

    // 공휴일 수 (지난달, 평일에 해당하는 공휴일만)
    const holidayRows = await prisma.$queryRaw<Array<{ cnt: bigint }>>`
      SELECT COUNT(*) as cnt FROM holidays
      WHERE date >= ${lastMonthStart} AND date < ${lastMonthEnd}
        AND EXTRACT(DOW FROM date) NOT IN (0, 6)
    `;
    const holidayCount = Number(holidayRows[0]?.cnt || 0);
    const actualBizDays = Math.max(bizDaysCount - holidayCount, 1);

    const mauMap = new Map<string, number>();
    for (const r of mauRows) mauMap.set(r.service_id, Number(r.mau));

    const dauAvgMap = new Map<string, number>();
    for (const r of dauRows) dauAvgMap.set(r.service_id, Math.round(Number(r.total_dau) / actualBizDays * 10) / 10);

    res.json({
      services: services.map(s => {
        let c2 = s.center2Name ?? null;
        let c1 = s.center1Name ?? null;
        if (c2 && isTopLevelDivision(c2)) { c2 = 'none'; c1 = 'none'; }
        else if (c1 && isTopLevelDivision(c1)) { c1 = 'none'; }

        const deptEntries = deptSavedByService.get(s.id) || [];

        // Aggregated savedMM = SUM of dept savedMMs
        const aggregatedSavedMM = deptEntries.reduce((sum, d) => sum + (d.savedMM ?? 0), 0);
        const aggregatedAiEstimatedMM = deptEntries.reduce((sum, d) => sum + (d.aiEstimatedMM ?? 0), 0);

        // Breakdown arrays
        const savedMMBreakdown = deptEntries
          .filter(d => d.savedMM != null || d.aiEstimatedMM != null)
          .map(d => ({
            deptname: d.deptname,
            savedMM: d.savedMM,
            aiEstimatedMM: d.aiEstimatedMM,
          }));

        const aiEstimatedMMBreakdown = deptEntries
          .filter(d => d.aiEstimatedMM != null)
          .map(d => ({
            deptname: d.deptname,
            aiEstimatedMM: d.aiEstimatedMM,
          }));

        return {
          ...s,
          center2Name: c2,
          center1Name: c1,
          aggregatedSavedMM: Math.round(aggregatedSavedMM * 10) / 10,
          aggregatedAiEstimatedMM: Math.round(aggregatedAiEstimatedMM * 10) / 10,
          savedMMBreakdown,
          aiEstimatedMMBreakdown,
          totalMauLastMonth: mauMap.get(s.id) ?? 0,
          totalDauAvgLastMonth: dauAvgMap.get(s.id) ?? 0,
        };
      }),
    });
  } catch (error) {
    console.error('Get service targets error:', error);
    res.status(500).json({ error: 'Failed to get service targets' });
  }
}) as RequestHandler);

// ============================================
// PUT /admin/service-targets/:id
// 서비스별 목표 M/M 수정 (savedMM은 DeptServiceSavedMM에서 자동 계산)
// 모든 변경은 감사 로그에 기록됨
// ============================================
const updateTargetSchema = z.object({
  targetMM: z.number().min(0).max(9999).optional().nullable(),
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
