/**
 * Department-level Saved M/M Routes
 *
 * 부서별 서비스 Saved M/M 관리 엔드포인트 (관리자 전용)
 * - GET  /admin/dept-saved-mm            — 부서가 사용한 서비스 목록 + DAU/MAU + Saved M/M 조회
 * - PUT  /admin/dept-saved-mm/:serviceId — 부서별 Saved M/M 수정 (감사 로그 기록)
 */

import { Router, RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../index.js';
import { authenticateToken, requireAdmin, AuthenticatedRequest } from '../middleware/auth.js';

export const deptSavedMMRoutes = Router();

deptSavedMMRoutes.use(authenticateToken);
deptSavedMMRoutes.use(requireAdmin as RequestHandler);

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

// ── KST month boundary helpers ──

function getKSTNow(): Date {
  const now = new Date();
  return new Date(now.getTime() + 9 * 60 * 60 * 1000);
}

/** Returns [firstDayOfMonth (UTC), firstDayOfNextMonth (UTC)] in KST-adjusted boundaries */
function getMonthBoundariesKST(year: number, month: number): [Date, Date] {
  // First day of month at 00:00 KST = previous day 15:00 UTC
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0) - 9 * 60 * 60 * 1000);
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0) - 9 * 60 * 60 * 1000);
  return [start, end];
}

/** Count business days (exclude weekends + holidays) between two dates */
async function countBusinessDays(start: Date, end: Date): Promise<number> {
  const result = await prisma.$queryRaw<[{ cnt: bigint }]>`
    SELECT COUNT(*)::bigint as cnt
    FROM generate_series(${start}::date, ${end}::date - INTERVAL '1 day', '1 day'::interval) d
    WHERE EXTRACT(DOW FROM d) NOT IN (0, 6)
      AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = d::date)
  `;
  return Number(result[0]?.cnt || 0);
}

// ============================================
// GET /admin/dept-saved-mm
// 부서가 사용한 서비스 목록 + DAU/MAU + Saved M/M
// ADMIN: 자기 부서 서비스, SUPER_ADMIN: ?deptname=xxx
// ============================================
deptSavedMMRoutes.get('/dept-saved-mm', (async (req: AuthenticatedRequest, res) => {
  try {
    // Determine target department
    let deptname: string;
    if (req.adminRole === 'SUPER_ADMIN' && req.query['deptname']) {
      deptname = req.query['deptname'] as string;
    } else {
      deptname = req.adminDept || req.user?.deptname || '';
    }

    if (!deptname) {
      res.status(400).json({ error: 'Department name is required' });
      return;
    }

    // KST time calculations
    const kstNow = getKSTNow();
    const currentYear = kstNow.getUTCFullYear();
    const currentMonth = kstNow.getUTCMonth() + 1; // 1-based
    const currentDay = kstNow.getUTCDate();

    const lastMonthDate = new Date(Date.UTC(currentYear, currentMonth - 2, 1));
    const lastYear = lastMonthDate.getUTCFullYear();
    const lastMonth = lastMonthDate.getUTCMonth() + 1;

    const [lastMonthStart, lastMonthEnd] = getMonthBoundariesKST(lastYear, lastMonth);
    const [currentMonthStart, currentMonthEnd] = getMonthBoundariesKST(currentYear, currentMonth);

    // For "elapsed" current month: up to now
    const nowUtc = new Date();

    // Calculate business days
    const [lastMonthBizDaysTotal, currentMonthBizDaysTotal, currentMonthBizDaysElapsed] = await Promise.all([
      countBusinessDays(lastMonthStart, lastMonthEnd),
      countBusinessDays(currentMonthStart, currentMonthEnd),
      countBusinessDays(currentMonthStart, nowUtc < currentMonthEnd ? nowUtc : currentMonthEnd),
    ]);

    // 1. Find services used by at least one dept member (DEPLOYED only)
    const usedServices = await prisma.$queryRaw<Array<{
      service_id: string;
      dept_user_count: bigint;
    }>>`
      SELECT ul.service_id::text as service_id,
             COUNT(DISTINCT ul.user_id) as dept_user_count
      FROM usage_logs ul
      INNER JOIN users u ON ul.user_id = u.id
      INNER JOIN services s ON ul.service_id = s.id
      WHERE u.deptname = ${deptname}
        AND u.loginid != 'anonymous'
        AND ul.service_id IS NOT NULL
        AND s.status = 'DEPLOYED'
      GROUP BY ul.service_id
    `;

    if (usedServices.length === 0) {
      res.json({
        deptname,
        services: [],
        businessDays: {
          currentMonthBizDaysElapsed,
          currentMonthBizDaysTotal,
          lastMonthBizDaysTotal,
        },
      });
      return;
    }

    const serviceIds = usedServices.map(s => s.service_id);
    const deptUserCountMap = new Map(usedServices.map(s => [s.service_id, Number(s.dept_user_count)]));

    // 2. Last month avg DAU (business days only) per service
    const lastMonthDau = await prisma.$queryRaw<Array<{
      service_id: string;
      avg_dau: number;
    }>>`
      WITH daily_dau AS (
        SELECT ul.service_id::text as service_id, DATE(ul.timestamp) as d, COUNT(DISTINCT ul.user_id) as dau
        FROM usage_logs ul
        INNER JOIN users u ON ul.user_id = u.id
        WHERE ul.timestamp >= ${lastMonthStart} AND ul.timestamp < ${lastMonthEnd}
          AND u.deptname = ${deptname}
          AND u.loginid != 'anonymous'
          AND ul.service_id::text = ANY(${serviceIds})
          AND EXTRACT(DOW FROM ul.timestamp) NOT IN (0, 6)
          AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = DATE(ul.timestamp))
        GROUP BY ul.service_id, DATE(ul.timestamp)
      )
      SELECT service_id, COALESCE(AVG(dau), 0)::float as avg_dau FROM daily_dau GROUP BY service_id
    `;

    // 3. Last month MAU per service
    const lastMonthMau = await prisma.$queryRaw<Array<{
      service_id: string;
      mau: bigint;
    }>>`
      SELECT ul.service_id::text as service_id, COUNT(DISTINCT ul.user_id) as mau
      FROM usage_logs ul
      INNER JOIN users u ON ul.user_id = u.id
      WHERE ul.timestamp >= ${lastMonthStart} AND ul.timestamp < ${lastMonthEnd}
        AND u.deptname = ${deptname}
        AND u.loginid != 'anonymous'
        AND ul.service_id::text = ANY(${serviceIds})
      GROUP BY ul.service_id
    `;

    // 4. Current month avg DAU (business days only, elapsed)
    const currentMonthDau = await prisma.$queryRaw<Array<{
      service_id: string;
      avg_dau: number;
    }>>`
      WITH daily_dau AS (
        SELECT ul.service_id::text as service_id, DATE(ul.timestamp) as d, COUNT(DISTINCT ul.user_id) as dau
        FROM usage_logs ul
        INNER JOIN users u ON ul.user_id = u.id
        WHERE ul.timestamp >= ${currentMonthStart} AND ul.timestamp < ${nowUtc}
          AND u.deptname = ${deptname}
          AND u.loginid != 'anonymous'
          AND ul.service_id::text = ANY(${serviceIds})
          AND EXTRACT(DOW FROM ul.timestamp) NOT IN (0, 6)
          AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = DATE(ul.timestamp))
        GROUP BY ul.service_id, DATE(ul.timestamp)
      )
      SELECT service_id, COALESCE(AVG(dau), 0)::float as avg_dau FROM daily_dau GROUP BY service_id
    `;

    // 5. Current month MAU per service
    const currentMonthMauResult = await prisma.$queryRaw<Array<{
      service_id: string;
      mau: bigint;
    }>>`
      SELECT ul.service_id::text as service_id, COUNT(DISTINCT ul.user_id) as mau
      FROM usage_logs ul
      INNER JOIN users u ON ul.user_id = u.id
      WHERE ul.timestamp >= ${currentMonthStart} AND ul.timestamp < ${nowUtc}
        AND u.deptname = ${deptname}
        AND u.loginid != 'anonymous'
        AND ul.service_id::text = ANY(${serviceIds})
      GROUP BY ul.service_id
    `;

    // Build lookup maps
    const lastDauMap = new Map(lastMonthDau.map(r => [r.service_id, r.avg_dau]));
    const lastMauMap = new Map(lastMonthMau.map(r => [r.service_id, Number(r.mau)]));
    const curDauMap = new Map(currentMonthDau.map(r => [r.service_id, r.avg_dau]));
    const curMauMap = new Map(currentMonthMauResult.map(r => [r.service_id, Number(r.mau)]));

    // 6. Fetch service info
    const services = await prisma.service.findMany({
      where: { id: { in: serviceIds } },
      select: {
        id: true,
        name: true,
        displayName: true,
        type: true,
        status: true,
      },
    });
    const serviceMap = new Map(services.map(s => [s.id, s]));

    // 7. Fetch DeptServiceSavedMM entries for this dept
    const savedMMEntries = await prisma.deptServiceSavedMM.findMany({
      where: {
        serviceId: { in: serviceIds },
        deptname,
      },
    });
    const savedMMMap = new Map(savedMMEntries.map(e => [e.serviceId, e]));

    // 8. Build response (flat structure for frontend)
    const lastMonthStr = `${lastYear}-${String(lastMonth).padStart(2, '0')}`;
    const currentMonthStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

    const result = serviceIds.map(sid => {
      const svc = serviceMap.get(sid);
      if (!svc) return null;

      const smm = savedMMMap.get(sid);

      return {
        id: svc.id,
        name: svc.name,
        displayName: svc.displayName,
        type: svc.type,
        status: svc.status,
        deptUserCount: deptUserCountMap.get(sid) || 0,
        lastMonth: {
          avgDau: Math.round((lastDauMap.get(sid) || 0) * 100) / 100,
          mau: lastMauMap.get(sid) || 0,
        },
        currentMonth: {
          avgDau: Math.round((curDauMap.get(sid) || 0) * 100) / 100,
          mau: curMauMap.get(sid) || 0,
        },
        savedMM: smm?.savedMM ?? null,
        reason: smm?.reason ?? null,
        aiEstimatedMM: smm?.aiEstimatedMM ?? null,
        aiConfidence: smm?.aiConfidence ?? null,
        aiReasoning: smm?.aiReasoning ?? null,
        updatedBy: smm?.updatedBy ?? null,
        updatedAt: smm?.updatedAt ?? null,
      };
    }).filter(Boolean);

    res.json({
      deptname,
      currentMonth: currentMonthStr,
      lastMonth: lastMonthStr,
      currentMonthBizDays: {
        elapsed: currentMonthBizDaysElapsed,
        total: currentMonthBizDaysTotal,
      },
      lastMonthBizDays: {
        total: lastMonthBizDaysTotal,
      },
      services: result,
    });
  } catch (error) {
    console.error('Get dept saved MM error:', error);
    res.status(500).json({ error: 'Failed to get department saved MM data' });
  }
}) as RequestHandler);

// ============================================
// PUT /admin/dept-saved-mm/:serviceId
// 부서별 Saved M/M 수정 + Service.savedMM 재집계
// ============================================
const updateDeptSavedMMSchema = z.object({
  savedMM: z.number().min(0).max(9999).nullable(),
  reason: z.string().max(2000).nullable(),
});

deptSavedMMRoutes.put('/dept-saved-mm/:serviceId', (async (req: AuthenticatedRequest, res) => {
  try {
    const serviceId = req.params['serviceId'] as string;
    const validation = updateDeptSavedMMSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Invalid request', details: validation.error.issues });
      return;
    }

    // Determine target department
    let deptname: string;
    if (req.adminRole === 'SUPER_ADMIN' && req.query['deptname']) {
      deptname = req.query['deptname'] as string;
    } else if (req.adminRole === 'ADMIN') {
      deptname = req.adminDept || req.user?.deptname || '';
    } else {
      deptname = req.adminDept || req.user?.deptname || '';
    }

    if (!deptname) {
      res.status(400).json({ error: 'Department name is required' });
      return;
    }

    // Verify service exists
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      select: { id: true, name: true, displayName: true },
    });

    if (!service) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }

    // Get existing entry for audit log
    const existing = await prisma.deptServiceSavedMM.findUnique({
      where: { serviceId_deptname: { serviceId, deptname } },
    });

    // Upsert DeptServiceSavedMM
    const updated = await prisma.deptServiceSavedMM.upsert({
      where: { serviceId_deptname: { serviceId, deptname } },
      update: {
        savedMM: validation.data.savedMM,
        reason: validation.data.reason,
        updatedBy: req.user?.loginid || 'unknown',
      },
      create: {
        serviceId,
        deptname,
        savedMM: validation.data.savedMM,
        reason: validation.data.reason,
        updatedBy: req.user?.loginid || 'unknown',
      },
    });

    // Recalculate aggregated savedMM on Service table
    const aggResult = await prisma.$queryRaw<[{ total: number | null }]>`
      SELECT COALESCE(SUM(saved_mm), 0)::float as total
      FROM dept_service_saved_mm
      WHERE service_id = ${serviceId}
    `;
    const totalSavedMM = aggResult[0]?.total || 0;

    await prisma.service.update({
      where: { id: serviceId },
      data: { savedMM: totalSavedMM > 0 ? totalSavedMM : null },
    });

    // Fire-and-forget audit log
    recordAudit(req, 'UPDATE_DEPT_SAVED_MM', serviceId, 'DeptServiceSavedMM', {
      serviceName: service.name,
      serviceDisplayName: service.displayName,
      deptname,
      savedMM_before: existing?.savedMM ?? null,
      savedMM_after: validation.data.savedMM,
      reason_before: existing?.reason ?? null,
      reason_after: validation.data.reason,
      aggregatedServiceSavedMM: totalSavedMM,
    }).catch(() => {});

    res.json({
      entry: updated,
      aggregatedServiceSavedMM: totalSavedMM,
    });
  } catch (error) {
    console.error('Update dept saved MM error:', error);
    res.status(500).json({ error: 'Failed to update department saved MM' });
  }
}) as RequestHandler);
