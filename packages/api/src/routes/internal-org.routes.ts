/**
 * Internal Organization API
 *
 * Private endpoints for nexus-web to query organization data.
 * Separate from the admin org-tree routes (which require ADMIN auth).
 * No authentication required (internal network trust).
 *
 * Docs: /internal/docs
 */

import { Router } from 'express';
import { prisma } from '../index.js';

export const internalOrgRoutes = Router();

/**
 * GET /internal/org/tree
 * Full organization tree (hierarchical JSON)
 */
internalOrgRoutes.get('/tree', async (_req, res) => {
  try {
    const nodes = await prisma.orgNode.findMany({
      orderBy: { departmentCode: 'asc' },
    });

    // Build tree from flat list
    const nodeMap = new Map<string, any>();
    const roots: any[] = [];

    for (const node of nodes) {
      nodeMap.set(node.departmentCode, { ...node, children: [] });
    }

    for (const node of nodes) {
      const treeNode = nodeMap.get(node.departmentCode);
      if (node.parentDepartmentCode && nodeMap.has(node.parentDepartmentCode)) {
        nodeMap.get(node.parentDepartmentCode).children.push(treeNode);
      } else {
        roots.push(treeNode);
      }
    }

    res.json({ tree: roots, totalNodes: nodes.length });
  } catch (err) {
    console.error('[Internal Org] Tree error:', err);
    res.status(500).json({ error: 'Failed to get org tree' });
  }
});

/**
 * GET /internal/org/tree/:deptCode
 * Subtree for specific department
 */
internalOrgRoutes.get('/tree/:deptCode', async (req, res) => {
  try {
    const { deptCode } = req.params;
    const allNodes = await prisma.orgNode.findMany();
    const nodeMap = new Map<string, any>();

    for (const node of allNodes) {
      nodeMap.set(node.departmentCode, { ...node, children: [] });
    }

    for (const node of allNodes) {
      if (node.parentDepartmentCode && nodeMap.has(node.parentDepartmentCode)) {
        nodeMap.get(node.parentDepartmentCode).children.push(nodeMap.get(node.departmentCode));
      }
    }

    const target = nodeMap.get(deptCode);
    if (!target) {
      res.status(404).json({ error: 'Department not found' });
      return;
    }

    res.json(target);
  } catch (err) {
    console.error('[Internal Org] Subtree error:', err);
    res.status(500).json({ error: 'Failed to get subtree' });
  }
});

/**
 * GET /internal/org/user/:loginId
 * User department info + hierarchy chain
 */
internalOrgRoutes.get('/user/:loginId', async (req, res) => {
  try {
    const { loginId } = req.params;

    const user = await prisma.user.findFirst({
      where: { loginid: loginId },
      select: {
        loginid: true,
        username: true,
        enDeptName: true,
        departmentCode: true,
        knoxVerified: true,
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Get department hierarchy (leaf → root)
    const hierarchy: Array<{ code: string; name: string; enName?: string }> = [];
    if (user.departmentCode) {
      let currentCode: string | null = user.departmentCode;
      while (currentCode) {
        const node: { departmentCode: string; departmentName: string; enDepartmentName: string | null; parentDepartmentCode: string | null } | null = await prisma.orgNode.findUnique({
          where: { departmentCode: currentCode },
        });
        if (!node) break;
        hierarchy.push({
          code: node.departmentCode,
          name: node.departmentName,
          enName: node.enDepartmentName || undefined,
        });
        currentCode = node.parentDepartmentCode;
      }
    }

    res.json({
      user: {
        loginId: user.loginid,
        name: user.username,
        deptName: user.enDeptName,
        deptCode: user.departmentCode,
      },
      hierarchy: hierarchy.reverse(), // Root → Leaf order
    });
  } catch (err) {
    console.error('[Internal Org] User lookup error:', err);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

/**
 * GET /internal/org/search?q=keyword
 * Search departments by Korean or English name (min 2 chars)
 */
internalOrgRoutes.get('/search', async (req, res) => {
  try {
    const q = ((req.query.q as string) || '').trim();
    if (!q || q.length < 2) {
      res.status(400).json({ error: 'Query must be at least 2 characters' });
      return;
    }

    const results = await prisma.orgNode.findMany({
      where: {
        OR: [
          { departmentName: { contains: q, mode: 'insensitive' } },
          { enDepartmentName: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 50,
      orderBy: { departmentName: 'asc' },
    });

    res.json({ results, count: results.length });
  } catch (err) {
    console.error('[Internal Org] Search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

/**
 * GET /internal/org/departments
 * Flat list of all departments (for dropdown selectors)
 */
internalOrgRoutes.get('/departments', async (_req, res) => {
  try {
    const departments = await prisma.orgNode.findMany({
      select: {
        departmentCode: true,
        departmentName: true,
        enDepartmentName: true,
        parentDepartmentCode: true,
        userCount: true,
      },
      orderBy: { departmentName: 'asc' },
    });

    res.json({ departments, count: departments.length });
  } catch (err) {
    console.error('[Internal Org] Departments error:', err);
    res.status(500).json({ error: 'Failed to list departments' });
  }
});
