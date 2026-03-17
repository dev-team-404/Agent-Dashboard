/**
 * System Settings & AI Estimation Routes
 *
 * - GET  /admin/system-settings/system-llm       — 시스템 LLM 설정 조회
 * - PUT  /admin/system-settings/system-llm       — 시스템 LLM 설정 변경 (SUPER_ADMIN)
 * - GET  /admin/system-settings/logo-model       — 로고 생성 모델 설정 조회
 * - PUT  /admin/system-settings/logo-model       — 로고 생성 모델 설정 변경 (SUPER_ADMIN)
 * - POST /admin/system-settings/generate-missing-logos — 로고 없는 서비스 일괄 생성 (SUPER_ADMIN)
 * - GET  /admin/ai-estimations                   — 최신 AI 추정 목록 (서비스별)
 * - POST /admin/ai-estimations/run               — AI 추정 수동 실행 (SUPER_ADMIN)
 */

import { Router, RequestHandler } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, requireAdmin, requireSuperAdmin, AuthenticatedRequest } from '../middleware/auth.js';
import { runAiEstimations } from '../services/aiEstimation.service.js';
import { generateMissingLogos } from '../services/logoGenerator.service.js';

export const systemSettingsRoutes = Router();

systemSettingsRoutes.use(authenticateToken);
systemSettingsRoutes.use(requireAdmin as RequestHandler);

const SYSTEM_LLM_KEY = 'SYSTEM_LLM_MODEL_ID';
const ERROR_ANALYSIS_LLM_KEY = 'ERROR_ANALYSIS_LLM_MODEL_ID';
const LOGO_MODEL_KEY = 'LOGO_GENERATION_MODEL_ID';

// 허용된 시스템 LLM 설정 키 목록
const ALLOWED_LLM_KEYS: Record<string, { label: string; chatOnly: boolean }> = {
  [SYSTEM_LLM_KEY]: { label: 'M/M 추적 (AI 추정)', chatOnly: true },
  [ERROR_ANALYSIS_LLM_KEY]: { label: '에러 초도분석', chatOnly: true },
};

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
// 모든 CHAT LLM 설정 조회 (액션별)
// ============================================
systemSettingsRoutes.get('/system-settings/system-llm', (async (_req: AuthenticatedRequest, res) => {
  try {
    const keys = Object.keys(ALLOWED_LLM_KEYS);
    const dbSettings = await prisma.systemSetting.findMany({ where: { key: { in: keys } } });
    const settingMap = new Map(dbSettings.map(s => [s.key, s]));

    const modelIds = dbSettings.map(s => s.value).filter(Boolean);
    const models = modelIds.length > 0
      ? await prisma.model.findMany({
          where: { id: { in: modelIds } },
          select: { id: true, name: true, displayName: true, type: true, enabled: true, endpointUrl: true },
        })
      : [];
    const modelMap = new Map(models.map(m => [m.id, m]));

    const settings = Object.entries(ALLOWED_LLM_KEYS).map(([key, meta]) => {
      const s = settingMap.get(key);
      return {
        key,
        label: meta.label,
        modelId: s?.value || null,
        model: s?.value ? modelMap.get(s.value) || null : null,
        updatedAt: s?.updatedAt || null,
        updatedBy: s?.updatedBy || null,
      };
    });

    // 하위 호환 (기존 코드용 — M/M 추적 LLM)
    const primary = settingMap.get(SYSTEM_LLM_KEY);
    res.json({
      settings,
      modelId: primary?.value || null,
      model: primary?.value ? modelMap.get(primary.value) || null : null,
      updatedAt: primary?.updatedAt || null,
      updatedBy: primary?.updatedBy || null,
    });
  } catch (error) {
    console.error('Get system LLM error:', error);
    res.status(500).json({ error: 'Failed to get system LLM setting' });
  }
}) as RequestHandler);

// ============================================
// PUT /admin/system-settings/system-llm
// 시스템 LLM 설정 변경 (SUPER_ADMIN 전용)
// body: { key?: string, modelId: string }
// key 미지정 시 기본 SYSTEM_LLM_MODEL_ID (M/M 추적)
// ============================================
systemSettingsRoutes.put('/system-settings/system-llm', requireSuperAdmin as RequestHandler, (async (req: AuthenticatedRequest, res) => {
  try {
    const { modelId, key: settingKey } = req.body;
    const key = settingKey || SYSTEM_LLM_KEY;

    if (!ALLOWED_LLM_KEYS[key]) {
      res.status(400).json({ error: `Invalid key. Allowed: ${Object.keys(ALLOWED_LLM_KEYS).join(', ')}` });
      return;
    }

    if (!modelId || typeof modelId !== 'string') {
      res.status(400).json({ error: 'modelId is required' });
      return;
    }

    const model = await prisma.model.findUnique({
      where: { id: modelId },
      select: { id: true, name: true, displayName: true, type: true, enabled: true },
    });

    if (!model) { res.status(404).json({ error: 'Model not found' }); return; }
    if (ALLOWED_LLM_KEYS[key].chatOnly && model.type !== 'CHAT') { res.status(400).json({ error: 'CHAT 타입 모델만 선택 가능합니다' }); return; }
    if (!model.enabled) { res.status(400).json({ error: '비활성화된 모델은 선택할 수 없습니다' }); return; }

    await prisma.systemSetting.upsert({
      where: { key },
      update: { value: modelId, updatedBy: req.user?.loginid || '' },
      create: { key, value: modelId, updatedBy: req.user?.loginid || '' },
    });

    recordAudit(req, 'UPDATE_SYSTEM_SETTING', key, 'SystemSetting', {
      key, label: ALLOWED_LLM_KEYS[key].label, modelId, modelName: model.displayName,
    }).catch(() => {});

    res.json({ key, modelId, model, updatedBy: req.user?.loginid || '' });
  } catch (error) {
    console.error('Set system LLM error:', error);
    res.status(500).json({ error: 'Failed to set system LLM' });
  }
}) as RequestHandler);

// ============================================
// GET /admin/system-settings/logo-model
// 로고 자동 생성에 사용할 IMAGE 모델 조회
// ============================================
systemSettingsRoutes.get('/system-settings/logo-model', (async (_req: AuthenticatedRequest, res) => {
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key: LOGO_MODEL_KEY } });

    if (!setting?.value) {
      res.json({ modelId: null, model: null });
      return;
    }

    const model = await prisma.model.findUnique({
      where: { id: setting.value },
      select: { id: true, name: true, displayName: true, type: true, imageProvider: true, enabled: true, endpointUrl: true },
    });

    res.json({
      modelId: setting.value,
      model,
      updatedAt: setting.updatedAt,
      updatedBy: setting.updatedBy,
    });
  } catch (error) {
    console.error('Get logo model error:', error);
    res.status(500).json({ error: 'Failed to get logo model setting' });
  }
}) as RequestHandler);

// ============================================
// PUT /admin/system-settings/logo-model
// 로고 자동 생성 모델 변경 (SUPER_ADMIN 전용)
// ============================================
systemSettingsRoutes.put('/system-settings/logo-model', requireSuperAdmin as RequestHandler, (async (req: AuthenticatedRequest, res) => {
  try {
    const { modelId } = req.body;

    if (!modelId || typeof modelId !== 'string') {
      res.status(400).json({ error: 'modelId is required' });
      return;
    }

    const model = await prisma.model.findUnique({
      where: { id: modelId },
      select: { id: true, name: true, displayName: true, type: true, imageProvider: true, enabled: true },
    });

    if (!model) {
      res.status(404).json({ error: 'Model not found' });
      return;
    }

    if (model.type !== 'IMAGE') {
      res.status(400).json({ error: 'IMAGE 타입 모델만 로고 생성에 사용할 수 있습니다' });
      return;
    }

    if (!model.enabled) {
      res.status(400).json({ error: '비활성화된 모델은 선택할 수 없습니다' });
      return;
    }

    await prisma.systemSetting.upsert({
      where: { key: LOGO_MODEL_KEY },
      update: { value: modelId, updatedBy: req.user?.loginid || '' },
      create: { key: LOGO_MODEL_KEY, value: modelId, updatedBy: req.user?.loginid || '' },
    });

    recordAudit(req, 'UPDATE_SYSTEM_SETTING', LOGO_MODEL_KEY, 'SystemSetting', {
      key: LOGO_MODEL_KEY,
      modelId,
      modelName: model.displayName,
      imageProvider: model.imageProvider,
    }).catch(() => {});

    res.json({ modelId, model, updatedBy: req.user?.loginid || '' });
  } catch (error) {
    console.error('Set logo model error:', error);
    res.status(500).json({ error: 'Failed to set logo model' });
  }
}) as RequestHandler);

// ============================================
// POST /admin/system-settings/generate-missing-logos
// 로고 없는 서비스 일괄 생성 (SUPER_ADMIN 전용)
// ============================================
systemSettingsRoutes.post('/system-settings/generate-missing-logos', requireSuperAdmin as RequestHandler, (async (req: AuthenticatedRequest, res) => {
  try {
    const host = req.headers.host || req.hostname;
    const protocol = req.protocol || 'http';

    // 비동기 실행 — 즉시 응답 후 백그라운드에서 처리
    res.json({ message: '로고 일괄 생성이 시작되었습니다. 완료까지 시간이 걸릴 수 있습니다.' });

    recordAudit(req, 'GENERATE_MISSING_LOGOS', null, 'SystemSetting', {}).catch(() => {});

    generateMissingLogos(host, protocol).then(result => {
      console.log(`[LogoGen] Batch result: ${result.success}/${result.total} success, ${result.errors} errors`);
    }).catch(err => {
      console.error('[LogoGen] Batch generation failed:', err);
    });
  } catch (error) {
    console.error('Generate missing logos error:', error);
    res.status(500).json({ error: 'Failed to start logo generation' });
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
