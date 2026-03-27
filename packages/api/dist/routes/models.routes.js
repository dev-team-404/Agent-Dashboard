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
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../index.js';
import { authenticateToken, requireAdmin, isModelVisibleTo, extractBusinessUnit } from '../middleware/auth.js';
const AGENT_REGISTRY_SERVICE_NAME = 'agent-registry';
export const modelsRoutes = Router();
async function recordAudit(req, action, target, targetType, details) {
    try {
        await prisma.auditLog.create({
            data: {
                adminId: req.adminId || undefined,
                loginid: req.user?.loginid || 'unknown',
                action, target, targetType,
                details: details ? JSON.parse(JSON.stringify(details)) : undefined,
                ipAddress: req.ip || req.headers['x-forwarded-for'] || undefined,
            },
        });
    }
    catch (err) {
        console.error('[AuditLog] Failed to record:', err);
    }
}
/**
 * GET /models/browse
 * 모델 공개 목록 (모든 인증 사용자 접근 가능)
 * - ADMIN_ONLY, SUPER_ADMIN_ONLY 제외
 * - 민감 정보 마스킹 (apiKey, endpointUrl)
 * - 팀/사업부 태그 포함
 */
modelsRoutes.get('/browse', authenticateToken, async (req, res) => {
    try {
        const models = await prisma.model.findMany({
            where: {
                enabled: true,
                visibility: { notIn: ['ADMIN_ONLY', 'SUPER_ADMIN_ONLY'] },
                endpointUrl: { not: 'external://auto-created' },
            },
            orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
        });
        // Mask sensitive fields for public viewing
        const publicModels = models.map(m => ({
            id: m.id,
            name: m.name,
            displayName: m.displayName,
            type: m.type,
            supportsVision: m.supportsVision,
            visibility: m.visibility,
            visibilityScope: m.visibilityScope,
            maxTokens: m.maxTokens,
            enabled: m.enabled,
            sortOrder: m.sortOrder,
            createdByDept: m.createdByDept,
            createdByBusinessUnit: m.createdByBusinessUnit,
            createdBySuperAdmin: m.createdBySuperAdmin,
            createdAt: m.createdAt,
        }));
        res.json({ models: publicModels });
    }
    catch (error) {
        console.error('Browse models error:', error);
        res.status(500).json({ error: 'Failed to browse models' });
    }
});
/**
 * GET /models
 * 모델 목록 (권한에 따라 필터링)
 * Admin/SuperAdmin만 접근 가능 (Dashboard UI용)
 */
modelsRoutes.get('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const models = await prisma.model.findMany({
            where: {
                endpointUrl: { not: 'external://auto-created' },
            },
            orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
        });
        // 권한에 따라 필터링
        const userDeptCode = req.adminDeptCode || '';
        const isSuper = req.adminRole === 'SUPER_ADMIN';
        const filtered = isSuper
            ? models // Super Admin은 모든 모델 보임
            : models.filter(m => {
                // SUPER_ADMIN_ONLY models are only visible to super admins
                if (m.visibility === 'SUPER_ADMIN_ONLY')
                    return false;
                return isModelVisibleTo(m, userDeptCode, true);
            });
        res.json({ models: filtered });
    }
    catch (error) {
        console.error('List models error:', error);
        res.status(500).json({ error: 'Failed to list models' });
    }
});
/**
 * GET /models/:id
 */
modelsRoutes.get('/:id', authenticateToken, requireAdmin, async (req, res) => {
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
            if (!isModelVisibleTo(model, req.adminDeptCode || '', true)) {
                res.status(403).json({ error: 'No access to this model' });
                return;
            }
        }
        res.json({ model });
    }
    catch (error) {
        console.error('Get model error:', error);
        res.status(500).json({ error: 'Failed to get model' });
    }
});
/**
 * POST /models
 * 모델 생성 (Admin 이상)
 */
modelsRoutes.post('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { name, displayName, endpointUrl, apiKey, maxTokens, enabled, extraHeaders, extraBody, supportsVision, visibility, visibilityScope, sortOrder, type, imageProvider, adminVisible } = req.body;
        if (!name || !displayName || !endpointUrl) {
            res.status(400).json({ error: 'name, displayName, and endpointUrl are required' });
            return;
        }
        const deptname = req.adminDept || req.user?.deptname || '';
        const businessUnit = req.adminBusinessUnit || extractBusinessUnit(deptname);
        const creatorDeptCode = req.adminDeptCode || '';
        // visibilityScope가 비어있으면 creator의 departmentCode 기준으로 자동 채움
        const effectiveVisibility = visibility || 'PUBLIC';
        let effectiveScope = visibilityScope || [];
        if (effectiveScope.length === 0 && creatorDeptCode) {
            if (effectiveVisibility === 'TEAM' || effectiveVisibility === 'BUSINESS_UNIT') {
                effectiveScope = [creatorDeptCode];
            }
        }
        // 완전 동일한 모델 중복 탐지 (모든 설정 값이 같은 경우)
        const duplicateWhere = {
            name,
            displayName,
            endpointUrl,
            apiKey: apiKey || null,
            maxTokens: maxTokens || 128000,
            enabled: enabled !== false,
            supportsVision: supportsVision || false,
            visibility: effectiveVisibility,
            sortOrder: sortOrder || 0,
            type: type || 'CHAT',
            imageProvider: imageProvider || null,
            adminVisible: adminVisible || false,
        };
        // Prisma JSON 필드: 값이 있으면 equals로, null이면 DbNull로 비교
        duplicateWhere.extraHeaders = { equals: extraHeaders ? extraHeaders : Prisma.DbNull };
        duplicateWhere.extraBody = { equals: extraBody ? extraBody : Prisma.DbNull };
        const existing = await prisma.model.findFirst({ where: duplicateWhere });
        if (existing) {
            res.status(409).json({
                error: '동일한 설정의 모델이 이미 존재합니다.',
                existingModel: { id: existing.id, name: existing.name, displayName: existing.displayName },
            });
            return;
        }
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
                visibility: effectiveVisibility,
                visibilityScope: effectiveScope,
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
        recordAudit(req, 'CREATE_MODEL', model.id, 'Model', { name: model.name, displayName: model.displayName, visibility: model.visibility }).catch(() => { });
        // agent-registry 서비스에 자동 등록 (내부 사용량 추적용)
        prisma.service.findUnique({ where: { name: AGENT_REGISTRY_SERVICE_NAME }, select: { id: true } })
            .then(svc => {
            if (!svc)
                return;
            return prisma.serviceModel.create({
                data: { serviceId: svc.id, modelId: model.id, aliasName: '', weight: 1, enabled: true, addedBy: 'system' },
            });
        })
            .catch(() => { }); // 중복이면 unique constraint로 조용히 실패
        res.status(201).json({ model });
    }
    catch (error) {
        console.error('Create model error:', error);
        res.status(500).json({ error: 'Failed to create model' });
    }
});
/**
 * PUT /models/:id
 * 모델 수정
 * Admin: super admin이 등록하지 않은 + 본인 dept LLM만
 */
modelsRoutes.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
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
        const { name, displayName, endpointUrl, apiKey, maxTokens, enabled, extraHeaders, extraBody, supportsVision, visibility, visibilityScope, sortOrder, type, imageProvider, adminVisible } = req.body;
        // visibility 변경 시 scope가 비어있으면 creator의 departmentCode 기준으로 자동 채움
        let effectiveScope = visibilityScope;
        if (visibility !== undefined && (visibilityScope === undefined || (Array.isArray(visibilityScope) && visibilityScope.length === 0))) {
            const ownerDeptCode = req.adminDeptCode || '';
            if ((visibility === 'TEAM' || visibility === 'BUSINESS_UNIT') && ownerDeptCode) {
                effectiveScope = [ownerDeptCode];
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
                ...(effectiveScope !== undefined && { visibilityScope: effectiveScope }),
                ...(sortOrder !== undefined && { sortOrder }),
                ...(type !== undefined && { type }),
                ...(imageProvider !== undefined && { imageProvider }),
                ...(adminVisible !== undefined && { adminVisible }),
            },
        });
        // displayName이 변경된 경우 로그 테이블들의 스냅샷도 일괄 갱신
        if (displayName && model.displayName !== displayName) {
            const oldName = model.displayName;
            await Promise.all([
                prisma.healthCheckLog.updateMany({
                    where: { modelId: id },
                    data: { modelName: displayName },
                }),
                prisma.requestLog.updateMany({
                    where: { modelName: oldName },
                    data: { modelName: displayName },
                }),
                prisma.ratingFeedback.updateMany({
                    where: { modelName: oldName },
                    data: { modelName: displayName },
                }),
            ]);
            console.log(`[Model] displayName changed: "${oldName}" → "${displayName}" — updated logs`);
        }
        recordAudit(req, 'UPDATE_MODEL', updated.id, 'Model', { name: updated.name, changes: Object.keys(req.body) }).catch(() => { });
        res.json({ model: updated });
    }
    catch (error) {
        console.error('Update model error:', error);
        res.status(500).json({ error: 'Failed to update model' });
    }
});
/**
 * DELETE /models/:id
 */
modelsRoutes.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
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
        const modelName = model.name;
        // SubModel, UsageLog 등 cascade 처리
        await prisma.$transaction([
            prisma.subModel.deleteMany({ where: { parentId: id } }),
            prisma.usageLog.deleteMany({ where: { modelId: id } }),
            prisma.model.delete({ where: { id } }),
        ]);
        recordAudit(req, 'DELETE_MODEL', id, 'Model', { name: modelName }).catch(() => { });
        res.json({ success: true });
    }
    catch (error) {
        console.error('Delete model error:', error);
        res.status(500).json({ error: 'Failed to delete model' });
    }
});
/**
 * PATCH /models/:id/toggle
 */
modelsRoutes.patch('/:id/toggle', authenticateToken, requireAdmin, async (req, res) => {
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
    }
    catch (error) {
        console.error('Toggle model error:', error);
        res.status(500).json({ error: 'Failed to toggle model' });
    }
});
//# sourceMappingURL=models.routes.js.map