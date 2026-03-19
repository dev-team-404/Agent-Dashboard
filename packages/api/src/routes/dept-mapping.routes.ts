/**
 * Department Mapping Routes
 *
 * 부서 계층 매핑 관리 엔드포인트 (SUPER_ADMIN 전용)
 * - GET  /admin/dept-mapping       — 전체 부서 계층 목록
 * - PUT  /admin/dept-mapping/:id   — 부서 계층 수정
 * - POST /admin/dept-mapping/sync  — 미등록 부서 자동 동기화
 */

import { Router, RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../index.js';
import { authenticateToken, requireAdmin, AuthenticatedRequest } from '../middleware/auth.js';
import { getDepartmentHierarchy } from '../services/knoxEmployee.service.js';

export const deptMappingRoutes = Router();

deptMappingRoutes.use(authenticateToken);
deptMappingRoutes.use(requireAdmin as RequestHandler);

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
// GET /admin/dept-mapping
// 전체 부서 계층 목록 (SUPER_ADMIN only)
// ============================================
deptMappingRoutes.get('/dept-mapping', (async (req: AuthenticatedRequest, res) => {
  try {
    if (req.adminRole !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Super admin access required' });
      return;
    }

    const hierarchies = await prisma.departmentHierarchy.findMany({
      orderBy: [
        { center1Name: 'asc' },
        { center2Name: 'asc' },
        { team: 'asc' },
      ],
    });

    res.json({
      mappings: hierarchies.map(h => ({
        id: h.id,
        departmentCode: h.departmentCode,
        departmentName: h.departmentName,
        team: h.team,
        center2Name: h.center2Name,
        center1Name: h.center1Name,
        updatedAt: h.updatedAt,
      })),
    });
  } catch (error) {
    console.error('Get dept mapping error:', error);
    res.status(500).json({ error: 'Failed to get department mappings' });
  }
}) as RequestHandler);

// ============================================
// PUT /admin/dept-mapping/:id
// 부서 계층 수정 (SUPER_ADMIN only)
// ============================================
const updateMappingSchema = z.object({
  team: z.string().max(200).optional(),
  center2Name: z.string().max(200).optional(),
  center1Name: z.string().max(200).optional(),
});

deptMappingRoutes.put('/dept-mapping/:id', (async (req: AuthenticatedRequest, res) => {
  try {
    if (req.adminRole !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Super admin access required' });
      return;
    }

    const id = req.params['id'] as string;
    const validation = updateMappingSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ error: 'Invalid request', details: validation.error.issues });
      return;
    }

    const existing = await prisma.departmentHierarchy.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Department hierarchy entry not found' });
      return;
    }

    const updateData: Record<string, unknown> = {};
    const changes: Record<string, unknown> = {
      departmentCode: existing.departmentCode,
      departmentName: existing.departmentName,
    };

    if (validation.data.team !== undefined) {
      changes.team_before = existing.team;
      changes.team_after = validation.data.team;
      updateData.team = validation.data.team;
    }
    if (validation.data.center2Name !== undefined) {
      changes.center2Name_before = existing.center2Name;
      changes.center2Name_after = validation.data.center2Name;
      updateData.center2Name = validation.data.center2Name;
    }
    if (validation.data.center1Name !== undefined) {
      changes.center1Name_before = existing.center1Name;
      changes.center1Name_after = validation.data.center1Name;
      updateData.center1Name = validation.data.center1Name;
    }

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    const updated = await prisma.departmentHierarchy.update({
      where: { id },
      data: updateData,
    });

    // Fire-and-forget audit log
    recordAudit(req, 'UPDATE_DEPT_MAPPING', id, 'DepartmentHierarchy', changes).catch(() => {});

    res.json({
      mapping: {
        id: updated.id,
        departmentCode: updated.departmentCode,
        departmentName: updated.departmentName,
        team: updated.team,
        center2Name: updated.center2Name,
        center1Name: updated.center1Name,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    console.error('Update dept mapping error:', error);
    res.status(500).json({ error: 'Failed to update department mapping' });
  }
}) as RequestHandler);

// ============================================
// POST /admin/dept-mapping/sync
// 미등록 부서 자동 동기화 (SUPER_ADMIN only)
// users 테이블에서 department_code가 있지만
// department_hierarchies에 없는 항목을 Knox API로 생성
// ============================================
deptMappingRoutes.post('/dept-mapping/sync', (async (req: AuthenticatedRequest, res) => {
  try {
    if (req.adminRole !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Super admin access required' });
      return;
    }

    // Find unique departmentCodes from users that don't have a DepartmentHierarchy entry
    const missingDepts = await prisma.$queryRaw<Array<{
      department_code: string;
      deptname: string;
      en_dept_name: string | null;
    }>>`
      SELECT DISTINCT u.department_code, u.deptname, u.en_dept_name
      FROM users u
      WHERE u.department_code IS NOT NULL
        AND u.department_code != ''
        AND NOT EXISTS (
          SELECT 1 FROM department_hierarchies dh
          WHERE dh.department_code = u.department_code
        )
    `;

    let createdCount = 0;
    const errors: string[] = [];

    for (const dept of missingDepts) {
      try {
        const hierarchy = await getDepartmentHierarchy(
          dept.department_code,
          dept.deptname,
          dept.en_dept_name || '',
        );

        if (hierarchy) {
          createdCount++;
        } else {
          errors.push(`Failed to resolve hierarchy for ${dept.department_code} (${dept.deptname})`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Error for ${dept.department_code}: ${msg}`);
      }
    }

    // Audit log
    recordAudit(req, 'SYNC_DEPT_MAPPING', null, 'DepartmentHierarchy', {
      totalMissing: missingDepts.length,
      created: createdCount,
      errors: errors.length,
    }).catch(() => {});

    res.json({
      totalMissing: missingDepts.length,
      created: createdCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Sync dept mapping error:', error);
    res.status(500).json({ error: 'Failed to sync department mappings' });
  }
}) as RequestHandler);
