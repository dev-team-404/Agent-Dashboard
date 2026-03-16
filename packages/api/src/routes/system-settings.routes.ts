/**
 * System Settings & AI Estimation Routes
 *
 * - GET  /admin/system-settings/system-llm   — 시스템 LLM 설정 조회
 * - PUT  /admin/system-settings/system-llm   — 시스템 LLM 설정 변경 (SUPER_ADMIN)
 * - GET  /admin/ai-estimations               — 최신 AI 추정 목록 (서비스별)
 * - POST /admin/ai-estimations/run           — AI 추정 수동 실행 (SUPER_ADMIN)
 */

import { Router, RequestHandler } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, requireAdmin, requireSuperAdmin, AuthenticatedRequest } from '../middleware/auth.js';
import { runAiEstimations } from '../services/aiEstimation.service.js';

export const systemSettingsRoutes = Router();

systemSettingsRoutes.use(authenticateToken);
systemSettingsRoutes.use(requireAdmin as RequestHandler);

const SYSTEM_LLM_KEY = 'SYSTEM_LLM_MODEL_ID';

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
// GET /admin/system-settings/system-llm
// 현재 시스템 LLM 설정 조회
// ============================================
systemSettingsRoutes.get('/system-settings/system-llm', (async (_req: AuthenticatedRequest, res) => {
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key: SYSTEM_LLM_KEY } });

    if (!setting?.value) {
      res.json({ modelId: null, model: null });
      return;
    }

    const model = await prisma.model.findUnique({
      where: { id: setting.value },
      select: { id: true, name: true, displayName: true, type: true, enabled: true, endpointUrl: true },
    });

    res.json({
      modelId: setting.value,
      model,
      updatedAt: setting.updatedAt,
      updatedBy: setting.updatedBy,
    });
  } catch (error) {
    console.error('Get system LLM error:', error);
    res.status(500).json({ error: 'Failed to get system LLM setting' });
  }
}) as RequestHandler);

// ============================================
// PUT /admin/system-settings/system-llm
// 시스템 LLM 설정 변경 (SUPER_ADMIN 전용)
// ============================================
systemSettingsRoutes.put('/system-settings/system-llm', requireSuperAdmin as RequestHandler, (async (req: AuthenticatedRequest, res) => {
  try {
    const { modelId } = req.body;

    if (!modelId || typeof modelId !== 'string') {
      res.status(400).json({ error: 'modelId is required' });
      return;
    }

    const model = await prisma.model.findUnique({
      where: { id: modelId },
      select: { id: true, name: true, displayName: true, type: true, enabled: true },
    });

    if (!model) {
      res.status(404).json({ error: 'Model not found' });
      return;
    }

    if (model.type !== 'CHAT') {
      res.status(400).json({ error: 'Only CHAT type models can be used as system LLM' });
      return;
    }

    if (!model.enabled) {
      res.status(400).json({ error: 'Cannot select a disabled model' });
      return;
    }

    await prisma.systemSetting.upsert({
      where: { key: SYSTEM_LLM_KEY },
      update: { value: modelId, updatedBy: req.user?.loginid || '' },
      create: { key: SYSTEM_LLM_KEY, value: modelId, updatedBy: req.user?.loginid || '' },
    });

    recordAudit(req, 'UPDATE_SYSTEM_SETTING', SYSTEM_LLM_KEY, 'SystemSetting', {
      key: SYSTEM_LLM_KEY,
      modelId,
      modelName: model.displayName,
    }).catch(() => {});

    res.json({ modelId, model, updatedBy: req.user?.loginid || '' });
  } catch (error) {
    console.error('Set system LLM error:', error);
    res.status(500).json({ error: 'Failed to set system LLM' });
  }
}) as RequestHandler);

// ============================================
// GET /admin/ai-estimations
// 최신 AI 추정 목록 (서비스별 가장 최근 1건)
// ============================================
systemSettingsRoutes.get('/ai-estimations', (async (_req: AuthenticatedRequest, res) => {
  try {
    // 서비스별 가장 최근 추정
    const estimations = await prisma.$queryRaw<
      Array<{
        id: string;
        service_id: string;
        date: Date;
        estimated_mm: number;
        confidence: string;
        reasoning: string;
        dau_used: number;
        is_estimated_dau: boolean;
        total_calls: number;
        created_at: Date;
      }>
    >`
      SELECT DISTINCT ON (service_id)
        id, service_id, date, estimated_mm, confidence, reasoning,
        dau_used, is_estimated_dau, total_calls, created_at
      FROM ai_estimations
      ORDER BY service_id, date DESC
    `;

    res.json({
      estimations: estimations.map(e => ({
        id: e.id,
        serviceId: e.service_id,
        date: e.date,
        estimatedMM: e.estimated_mm,
        confidence: e.confidence,
        reasoning: e.reasoning,
        dauUsed: e.dau_used,
        isEstimatedDau: e.is_estimated_dau,
        totalCalls: e.total_calls,
        createdAt: e.created_at,
      })),
    });
  } catch (error) {
    console.error('Get AI estimations error:', error);
    res.status(500).json({ error: 'Failed to get AI estimations' });
  }
}) as RequestHandler);

// ============================================
// POST /admin/ai-estimations/run
// AI 추정 수동 실행 (SUPER_ADMIN 전용)
// ============================================
systemSettingsRoutes.post('/ai-estimations/run', requireSuperAdmin as RequestHandler, (async (req: AuthenticatedRequest, res) => {
  try {
    const result = await runAiEstimations();

    recordAudit(req, 'RUN_AI_ESTIMATION', null, 'SystemSetting', {
      processed: result.processed,
      errors: result.errors,
    }).catch(() => {});

    res.json(result);
  } catch (error) {
    console.error('Run AI estimation error:', error);
    res.status(500).json({ error: 'Failed to run AI estimation' });
  }
}) as RequestHandler);
