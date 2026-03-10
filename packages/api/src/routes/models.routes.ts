/**
 * Models Routes (v2)
 *
 * LLM 모델 CRUD (서비스와 독립)
 * - Super Admin: 모든 LLM CRUD
 * - Admin: LLM 등록 가능, 수정/삭제는 super admin이 등록하지 않은 + 본인 dept LLM만
 * - User: CRUD 불가 (사용만)
 *
 * Visibility: PUBLIC / BUSINESS_UNIT / TEAM / ADMIN_ONLY
 */

import { Router, RequestHandler } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, requireAdmin, AuthenticatedRequest, isModelVisibleTo, extractBusinessUnit } from '../middleware/auth.js';

export const modelsRoutes = Router();

/**
 * GET /models
 * 모델 목록 (권한에 따라 필터링)
 * Admin/SuperAdmin만 접근 가능 (Dashboard UI용)
 */
modelsRoutes.get('/', authenticateToken, requireAdmin as RequestHandler, async (req: AuthenticatedRequest, res) => {
  try {
    const models = await prisma.model.findMany({
      orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
    });

    // 권한에 따라 필터링
    const userDept = req.adminDept || req.user?.deptname || '';
    const userBU = req.adminBusinessUnit || extractBusinessUnit(userDept);
    const isSuper = req.adminRole === 'SUPER_ADMIN';

    const filtered = isSuper
      ? models  // Super Admin은 모든 모델 보임
      : models.filter(m => {
          // SUPER_ADMIN_ONLY models are only visible to super admins
          if (m.visibility === 'SUPER_ADMIN_ONLY') return false;
          return isModelVisibleTo(m, userDept, userBU, true);
        });

    res.json({ models: filtered });
  } catch (error) {
    console.error('List models error:', error);
    res.status(500).json({ error: 'Failed to list models' });
  }
});

/**
 * GET /models/:id
 */
modelsRoutes.get('/:id', authenticateToken, requireAdmin as RequestHandler, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const model = await prisma.model.findUnique({ where: { id } });

    if (!model) {
      res.status(404).json({ error: 'Model not found' });
      return;
    }

    // 권한 확인
    if (req.adminRole !== 'SUPER_ADMIN') {
      // SUPER_ADMIN_ONLY models are only visible to super admins
      if (model.visibility === 'SUPER_ADMIN_ONLY') {
        res.status(403).json({ error: 'No access to this model' });
        return;
      }
      const userDept = req.adminDept || req.user?.deptname || '';
      const userBU = req.adminBusinessUnit || extractBusinessUnit(userDept);
      if (!isModelVisibleTo(model, userDept, userBU, true)) {
        res.status(403).json({ error: 'No access to this model' });
        return;
      }
    }

    res.json({ model });
  } catch (error) {
    console.error('Get model error:', error);
    res.status(500).json({ error: 'Failed to get model' });
  }
});

/**
 * POST /models
 * 모델 생성 (Admin 이상)
 */
modelsRoutes.post('/', authenticateToken, requireAdmin as RequestHandler, async (req: AuthenticatedRequest, res) => {
  try {
    const { name, displayName, endpointUrl, apiKey, maxTokens, enabled,
            extraHeaders, extraBody, supportsVision, visibility, visibilityScope, sortOrder,
            type, imageProvider, adminVisible } = req.body;

    if (!name || !displayName || !endpointUrl) {
      res.status(400).json({ error: 'name, displayName, and endpointUrl are required' });
      return;
    }

    // 이름 중복 체크
    const existing = await prisma.model.findUnique({ where: { name } });
    if (existing) {
      res.status(409).json({ error: `Model name '${name}' is already taken` });
      return;
    }

    const deptname = req.adminDept || req.user?.deptname || '';
    const businessUnit = req.adminBusinessUnit || extractBusinessUnit(deptname);

    const model = await prisma.model.create({
      data: {
        name,
        displayName,
        endpointUrl,
        apiKey: apiKey || null,
        maxTokens: maxTokens || 128000,
        enabled: enabled !== false,
        extraHeaders: extraHeaders || null,
        extraBody: extraBody || null,
        supportsVision: supportsVision || false,
        visibility: visibility || 'PUBLIC',
        visibilityScope: visibilityScope || [],
        adminVisible: adminVisible || false,
        sortOrder: sortOrder || 0,
        type: type || 'CHAT',
        imageProvider: imageProvider || null,
        createdBy: req.adminId || null,
        createdByDept: deptname,
        createdByBusinessUnit: businessUnit,
        createdBySuperAdmin: req.adminRole === 'SUPER_ADMIN',
      },
    });

    res.status(201).json({ model });
  } catch (error) {
    console.error('Create model error:', error);
    res.status(500).json({ error: 'Failed to create model' });
  }
});

/**
 * PUT /models/:id
 * 모델 수정
 * Admin: super admin이 등록하지 않은 + 본인 dept LLM만
 */
modelsRoutes.put('/:id', authenticateToken, requireAdmin as RequestHandler, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const model = await prisma.model.findUnique({ where: { id } });

    if (!model) {
      res.status(404).json({ error: 'Model not found' });
      return;
    }

    // Admin 수정/삭제 권한 확인
    if (req.adminRole === 'ADMIN') {
      if (model.createdBySuperAdmin) {
        res.status(403).json({ error: 'Cannot modify models created by super admin' });
        return;
      }
      const adminDept = req.adminDept || req.user?.deptname || '';
      if (model.createdByDept && model.createdByDept !== adminDept) {
        res.status(403).json({ error: 'Can only modify models created by your department' });
        return;
      }
    }

    const { name, displayName, endpointUrl, apiKey, maxTokens, enabled,
            extraHeaders, extraBody, supportsVision, visibility, visibilityScope, sortOrder,
            type, imageProvider, adminVisible } = req.body;

    // 이름 변경 시 중복 체크
    if (name && name !== model.name) {
      const existing = await prisma.model.findUnique({ where: { name } });
      if (existing) {
        res.status(409).json({ error: `Model name '${name}' is already taken` });
        return;
      }
    }

    const updated = await prisma.model.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(displayName && { displayName }),
        ...(endpointUrl && { endpointUrl }),
        ...(apiKey !== undefined && { apiKey }),
        ...(maxTokens !== undefined && { maxTokens }),
        ...(enabled !== undefined && { enabled }),
        ...(extraHeaders !== undefined && { extraHeaders }),
        ...(extraBody !== undefined && { extraBody }),
        ...(supportsVision !== undefined && { supportsVision }),
        ...(visibility !== undefined && { visibility }),
        ...(visibilityScope !== undefined && { visibilityScope }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(type !== undefined && { type }),
        ...(imageProvider !== undefined && { imageProvider }),
        ...(adminVisible !== undefined && { adminVisible }),
      },
    });

    res.json({ model: updated });
  } catch (error) {
    console.error('Update model error:', error);
    res.status(500).json({ error: 'Failed to update model' });
  }
});

/**
 * DELETE /models/:id
 */
modelsRoutes.delete('/:id', authenticateToken, requireAdmin as RequestHandler, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const model = await prisma.model.findUnique({ where: { id } });

    if (!model) {
      res.status(404).json({ error: 'Model not found' });
      return;
    }

    if (req.adminRole === 'ADMIN') {
      if (model.createdBySuperAdmin) {
        res.status(403).json({ error: 'Cannot delete models created by super admin' });
        return;
      }
      const adminDept = req.adminDept || req.user?.deptname || '';
      if (model.createdByDept && model.createdByDept !== adminDept) {
        res.status(403).json({ error: 'Can only delete models created by your department' });
        return;
      }
    }

    // 관련 데이터 체크
    const usageCount = await prisma.usageLog.count({ where: { modelId: id } });
    const force = req.query['force'] === 'true';

    if (usageCount > 0 && !force) {
      res.status(409).json({
        error: 'Model has usage data. Use ?force=true to delete anyway.',
        usageCount,
      });
      return;
    }

    // SubModel, UsageLog 등 cascade 처리
    await prisma.$transaction([
      prisma.subModel.deleteMany({ where: { parentId: id } }),
      prisma.usageLog.deleteMany({ where: { modelId: id } }),
      prisma.dailyUsageStat.deleteMany({ where: { modelId: id } }),
      prisma.model.delete({ where: { id } }),
    ]);

    res.json({ success: true });
  } catch (error) {
    console.error('Delete model error:', error);
    res.status(500).json({ error: 'Failed to delete model' });
  }
});

/**
 * PATCH /models/:id/toggle
 */
modelsRoutes.patch('/:id/toggle', authenticateToken, requireAdmin as RequestHandler, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const model = await prisma.model.findUnique({ where: { id } });

    if (!model) {
      res.status(404).json({ error: 'Model not found' });
      return;
    }

    if (req.adminRole === 'ADMIN') {
      if (model.createdBySuperAdmin) {
        res.status(403).json({ error: 'Cannot toggle models created by super admin' });
        return;
      }
      const adminDept = req.adminDept || req.user?.deptname || '';
      if (model.createdByDept && model.createdByDept !== adminDept) {
        res.status(403).json({ error: 'Can only toggle models created by your department' });
        return;
      }
    }

    const updated = await prisma.model.update({
      where: { id },
      data: { enabled: !model.enabled },
    });

    res.json({ model: updated });
  } catch (error) {
    console.error('Toggle model error:', error);
    res.status(500).json({ error: 'Failed to toggle model' });
  }
});
