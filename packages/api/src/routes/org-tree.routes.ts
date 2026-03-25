/**
 * Organization Tree Routes
 *
 * 조직도 트리 관리 엔드포인트
 * - GET  /admin/org-tree          — 전체 조직도 트리 조회 (ADMIN+)
 * - POST /admin/org-tree/sync     — users 기반 전체 동기화 (SUPER_ADMIN)
 * - POST /admin/org-tree/discover — 특정 부서 탐색 (SUPER_ADMIN)
 * - POST /admin/org-tree/refresh/:code — 특정 노드 Knox 재동기화 (SUPER_ADMIN)
 */

import { Router, RequestHandler } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, requireAdmin, AuthenticatedRequest } from '../middleware/auth.js';
import {
  getFullOrgTree,
  syncFromUsers,
  discoverDepartment,
  refreshNode,
  updateUserCounts,
} from '../services/orgTree.service.js';

export const orgTreeRoutes = Router();

orgTreeRoutes.use(authenticateToken);
orgTreeRoutes.use(requireAdmin as RequestHandler);

// ── Audit helper ──
async function recordAudit(
  req: AuthenticatedRequest,
  action: string,
  target: string | null,
  details?: Record<string, unknown>,
) {
  try {
    await prisma.auditLog.create({
      data: {
        loginid: req.user?.loginid || 'unknown',
        action,
        target,
        targetType: 'OrgTree',
        details: details ? JSON.parse(JSON.stringify(details)) : undefined,
        ipAddress: req.ip || (req.headers['x-forwarded-for'] as string) || undefined,
      },
    });
  } catch (err) {
    console.error('[AuditLog] Failed to record:', err);
  }
}

// ============================================
// GET /admin/org-tree
// 전체 조직도 트리 조회 (ADMIN 이상)
// ============================================
orgTreeRoutes.get('/org-tree', (async (req: AuthenticatedRequest, res) => {
  try {
    const tree = await getFullOrgTree();

    // 통계
    const totalNodes = await prisma.orgNode.count();
    const rootNodes = await prisma.orgNode.count({
      where: {
        OR: [
          { parentDepartmentCode: null },
          // parentDepartmentCode가 DB에 없는 노드도 root 취급 (트리 구축에서 처리됨)
        ],
      },
    });
    const nodesWithUsers = await prisma.orgNode.count({
      where: { userCount: { gt: 0 } },
    });

    res.json({
      tree,
      stats: {
        totalNodes,
        rootNodes,
        nodesWithUsers,
      },
    });
  } catch (error) {
    console.error('Get org tree error:', error);
    res.status(500).json({ error: 'Failed to get organization tree' });
  }
}) as RequestHandler);

// ============================================
// POST /admin/org-tree/sync
// users 테이블 기반 전체 동기화 (SUPER_ADMIN only)
// ============================================
orgTreeRoutes.post('/org-tree/sync', (async (req: AuthenticatedRequest, res) => {
  try {
    if (req.adminRole !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Super admin access required' });
      return;
    }

    const result = await syncFromUsers();

    recordAudit(req, 'SYNC_ORG_TREE', null, {
      total: result.total,
      discovered: result.discovered,
      alreadyExist: result.alreadyExist,
      errors: result.errors.length,
    }).catch(() => {});

    res.json(result);
  } catch (error) {
    console.error('Sync org tree error:', error);
    res.status(500).json({ error: 'Failed to sync organization tree' });
  }
}) as RequestHandler);

// ============================================
// POST /admin/org-tree/discover
// 특정 부서코드 탐색 (SUPER_ADMIN only)
// body: { departmentCode: string }
// ============================================
orgTreeRoutes.post('/org-tree/discover', (async (req: AuthenticatedRequest, res) => {
  try {
    if (req.adminRole !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Super admin access required' });
      return;
    }

    const { departmentCode } = req.body as { departmentCode?: string };
    if (!departmentCode) {
      res.status(400).json({ error: 'departmentCode is required' });
      return;
    }

    const discovered = await discoverDepartment(departmentCode);
    await updateUserCounts();

    recordAudit(req, 'DISCOVER_ORG_NODE', departmentCode, { discovered }).catch(() => {});

    res.json({ departmentCode, discovered });
  } catch (error) {
    console.error('Discover org node error:', error);
    res.status(500).json({ error: 'Failed to discover department' });
  }
}) as RequestHandler);

// ============================================
// POST /admin/org-tree/refresh/:code
// 특정 노드 Knox API로 재동기화 (SUPER_ADMIN only)
// ============================================
orgTreeRoutes.post('/org-tree/refresh/:code', (async (req: AuthenticatedRequest, res) => {
  try {
    if (req.adminRole !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Super admin access required' });
      return;
    }

    const code = req.params['code'] as string;
    const success = await refreshNode(code);

    if (!success) {
      res.status(404).json({ error: 'Department not found in Knox API' });
      return;
    }

    recordAudit(req, 'REFRESH_ORG_NODE', code).catch(() => {});

    res.json({ departmentCode: code, refreshed: true });
  } catch (error) {
    console.error('Refresh org node error:', error);
    res.status(500).json({ error: 'Failed to refresh node' });
  }
}) as RequestHandler);
