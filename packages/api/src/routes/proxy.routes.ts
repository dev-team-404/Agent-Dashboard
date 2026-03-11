/**
 * LLM Proxy Routes (v2)
 *
 * 헤더 기반 인증 (Bearer token 폐지):
 * - 일반 서비스: x-service-id, x-user-id, x-dept-name
 * - 백그라운드 서비스: x-service-id, x-dept-name
 *
 * 서비스는 등록한 admin의 LLM 접근 권한을 자동 계승
 * LLM visibility: PUBLIC / BUSINESS_UNIT / TEAM / ADMIN_ONLY
 */

import { Router, Request, Response } from 'express';
import path from 'node:path';
import { prisma, redis } from '../index.js';
import { incrementUsage, trackActiveUser } from '../services/redis.service.js';
import { validateProxyHeaders, canServiceAccessModel, ProxyAuthRequest } from '../middleware/proxyAuth.js';
import { extractBusinessUnit } from '../middleware/auth.js';
import { generateImages } from '../services/imageProviders.service.js';
import { saveImage, buildImageUrl, IMAGE_STORAGE_PATH, ensureStorageDir } from '../services/imageStorage.service.js';

export const proxyRoutes = Router();

// 이미지 파일 서빙 — 인증 불필요 (UUID 파일명으로 보안)
proxyRoutes.get('/images/files/:fileName', async (req: Request, res: Response) => {
  try {
    const { fileName } = req.params;

    if (!fileName || fileName.includes('..') || fileName.includes('/')) {
      res.status(400).json({ error: 'Invalid file name' });
      return;
    }

    const record = await prisma.generatedImage.findUnique({
      where: { fileName },
      select: { mimeType: true, expiresAt: true },
    });

    if (!record) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }

    if (record.expiresAt < new Date()) {
      res.status(410).json({ error: 'Image has expired' });
      return;
    }

    const filePath = path.resolve(IMAGE_STORAGE_PATH, fileName);
    res.setHeader('Content-Type', record.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) {
        console.error(`[ImageServe] Failed to send file ${fileName}:`, err);
        res.status(404).json({ error: 'Image file not found on disk' });
      }
    });
  } catch (error) {
    console.error('Image file serve error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to serve image' });
    }
  }
});

// 모든 /v1/* 요청에 헤더 검증 미들웨어 적용 (위의 이미지 서빙 제외)
proxyRoutes.use(validateProxyHeaders as any);

// ============================================
// 라운드로빈 엔드포인트 선택
// ============================================

interface EndpointInfo {
  endpointUrl: string;
  apiKey: string | null;
  modelName: string;
  extraHeaders: Record<string, string> | null;
}

// 단일 엔드포인트 5xx retry 설정
const SINGLE_ENDPOINT_MAX_RETRIES = 3;
const SINGLE_ENDPOINT_RETRY_DELAY_MS = 500; // 500ms → 1000ms → 1500ms (linear backoff)

async function getModelEndpoints(modelId: string, parentEndpoint: EndpointInfo): Promise<EndpointInfo[]> {
  const subModels = await prisma.subModel.findMany({
    where: { parentId: modelId, enabled: true },
    orderBy: { sortOrder: 'asc' },
    select: { endpointUrl: true, apiKey: true, modelName: true, extraHeaders: true, weight: true },
  });

  if (subModels.length === 0) return [parentEndpoint];

  // 가중치 라운드로빈: weight=2면 배열에 2번 포함
  const endpoints: EndpointInfo[] = [];

  // parent는 weight=1 (기본)
  endpoints.push(parentEndpoint);

  for (const s of subModels) {
    const ep: EndpointInfo = {
      endpointUrl: s.endpointUrl,
      apiKey: s.apiKey,
      modelName: s.modelName || parentEndpoint.modelName,
      extraHeaders: s.extraHeaders as Record<string, string> | null,
    };
    const weight = Math.max(1, Math.min(s.weight, 10)); // clamp 1~10
    for (let w = 0; w < weight; w++) {
      endpoints.push(ep);
    }
  }

  return endpoints;
}

async function getRoundRobinIndex(modelId: string, endpointCount: number): Promise<number> {
  if (endpointCount <= 1) return 0;
  try {
    const key = `model_rr:${modelId}`;
    const index = await redis.incr(key);
    if (index === 1) await redis.expire(key, 7 * 24 * 60 * 60);
    return (index - 1) % endpointCount;
  } catch (error) {
    console.error('[RoundRobin] Redis error:', error);
    return 0;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Service-level round-robin: aliasName 기반 모델 해석
 * 서비스에 등록된 ServiceModel 중 aliasName이 일치하는 모델들을
 * weight 기반 라운드로빈으로 선택한다.
 *
 * fallback: ServiceModel이 없으면 기존처럼 전역 Model 조회.
 */
async function resolveModelWithServiceRR(
  serviceId: string,
  modelName: string,
): Promise<
  | { found: true; model: NonNullable<Awaited<ReturnType<typeof prisma.model.findFirst>>> }
  | { found: false; model: null }
> {
  // 1) aliasName으로 매칭하는 ServiceModel 조회
  const serviceModels = await prisma.serviceModel.findMany({
    where: {
      serviceId,
      aliasName: modelName,
      enabled: true,
      model: { enabled: true },
    },
    include: { model: true },
    orderBy: { sortOrder: 'asc' },
  });

  // 2) aliasName 매칭이 없으면 기존 전역 조회로 fallback
  if (serviceModels.length === 0) {
    // 기존 model name/displayName 기반으로도 시도
    const fallbackSM = await prisma.serviceModel.findMany({
      where: {
        serviceId,
        enabled: true,
        model: {
          OR: [{ name: modelName }, { displayName: modelName }],
          enabled: true,
        },
      },
      include: { model: true },
      orderBy: { sortOrder: 'asc' },
    });

    if (fallbackSM.length > 0) {
      if (fallbackSM.length === 1) return { found: true, model: fallbackSM[0]!.model };
      // 여러 개면 weight 기반 RR
      const weightedModels: typeof fallbackSM[number]['model'][] = [];
      for (const sm of fallbackSM) {
        const w = Math.max(1, Math.min(sm.weight, 10));
        for (let i = 0; i < w; i++) weightedModels.push(sm.model);
      }
      try {
        const rrKey = `svc_rr:${serviceId}:${modelName}`;
        const idx = await redis.incr(rrKey);
        if (idx === 1) await redis.expire(rrKey, 3600);
        return { found: true, model: weightedModels[(idx - 1) % weightedModels.length]! };
      } catch {
        return { found: true, model: fallbackSM[0]!.model };
      }
    }

    // 전역 Model 조회 fallback
    const model = await prisma.model.findFirst({
      where: {
        OR: [{ name: modelName }, { id: modelName }, { displayName: modelName }],
        enabled: true,
      },
    });
    if (!model) return { found: false, model: null };
    return { found: true, model };
  }

  // 3) 하나만 매칭 → 그대로 사용
  if (serviceModels.length === 1) {
    return { found: true, model: serviceModels[0]!.model };
  }

  // 4) 여러 개 매칭 → weight 기반 라운드로빈
  const weightedModels: typeof serviceModels[number]['model'][] = [];
  for (const sm of serviceModels) {
    const w = Math.max(1, Math.min(sm.weight, 10));
    for (let i = 0; i < w; i++) weightedModels.push(sm.model);
  }

  try {
    const rrKey = `svc_rr:${serviceId}:${modelName}`;
    const idx = await redis.incr(rrKey);
    if (idx === 1) await redis.expire(rrKey, 3600);
    const selected = weightedModels[(idx - 1) % weightedModels.length]!;
    console.log(`[ServiceRR] service=${serviceId} alias="${modelName}" → selected model.id=${selected.id} (${serviceModels.length} candidates, ${weightedModels.length} weighted slots, idx=${idx})`);
    return { found: true, model: selected };
  } catch (error) {
    console.error('[ServiceRR] Redis error, falling back to first model:', error);
    return { found: true, model: serviceModels[0]!.model };
  }
}

/**
 * URL 인코딩된 텍스트 디코딩
 */
function safeDecodeURIComponent(text: string): string {
  if (!text) return text;
  try {
    if (!text.includes('%')) return text;
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * 사용자 조회 또는 생성 (background가 아닌 경우만)
 */
async function getOrCreateUser(proxyReq: ProxyAuthRequest) {
  if (proxyReq.isBackground || !proxyReq.userLoginId) return null;

  const loginid = proxyReq.userLoginId;
  const deptname = proxyReq.deptName;
  const businessUnit = proxyReq.businessUnit;
  const username = safeDecodeURIComponent((proxyReq.headers['x-user-name'] as string) || loginid);

  const user = await prisma.user.upsert({
    where: { loginid },
    update: {
      lastActive: new Date(),
      deptname,
      businessUnit,
    },
    create: {
      loginid,
      username,
      deptname,
      businessUnit,
    },
  });

  return user;
}

/**
 * Rate limit 체크 (user가 있는 경우만)
 * @returns 429 응답 객체 or null (통과)
 */
async function checkRateLimit(
  user: { id: string } | null,
  serviceId: string,
): Promise<{ status: 429; body: Record<string, unknown> } | null> {
  if (!user) return null;

  // 1) 개별 사용자 rate limit 우선 확인
  const userLimit = await prisma.userRateLimit.findUnique({
    where: { userId_serviceId: { userId: user.id, serviceId } },
  });

  // 2) 개별 설정이 없으면 서비스 공통 rate limit 적용
  let effectiveLimit: { maxTokens: number; window: 'FIVE_HOURS' | 'DAY'; enabled: boolean } | null = null;
  if (userLimit) {
    effectiveLimit = userLimit;
  } else {
    const serviceLimit = await prisma.serviceRateLimit.findUnique({
      where: { serviceId },
    });
    if (serviceLimit) effectiveLimit = serviceLimit;
  }

  if (!effectiveLimit || !effectiveLimit.enabled) return null;

  const rateLimit = effectiveLimit;

  const windowMs = rateLimit.window === 'FIVE_HOURS' ? 5 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const windowStart = new Date(Date.now() - windowMs);

  const usage = await prisma.usageLog.aggregate({
    where: {
      userId: user.id,
      serviceId,
      timestamp: { gte: windowStart },
    },
    _sum: { totalTokens: true },
  });

  const usedTokens = usage._sum.totalTokens || 0;
  if (usedTokens < rateLimit.maxTokens) return null;

  const oldestLog = await prisma.usageLog.findFirst({
    where: {
      userId: user.id,
      serviceId,
      timestamp: { gte: windowStart },
    },
    orderBy: { timestamp: 'asc' },
    select: { timestamp: true },
  });
  const retryAfterSec = oldestLog
    ? Math.max(1, Math.ceil((oldestLog.timestamp.getTime() + windowMs - Date.now()) / 1000))
    : Math.ceil(windowMs / 1000);

  const windowLabel = rateLimit.window === 'FIVE_HOURS' ? '5시간' : '24시간';
  return {
    status: 429,
    body: {
      error: 'Rate limit exceeded',
      message: `Token rate limit exceeded. Used ${usedTokens.toLocaleString()} / ${rateLimit.maxTokens.toLocaleString()} tokens in the last ${windowLabel}.`,
      limit: rateLimit.maxTokens,
      used: usedTokens,
      window: rateLimit.window,
      retryAfter: retryAfterSec,
    },
  };
}

/**
 * Usage 저장
 */
async function recordUsage(
  userId: string | null,
  loginid: string | null,
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  serviceId: string,
  deptname: string | null,
  latencyMs?: number
) {
  const totalTokens = inputTokens + outputTokens;

  await prisma.usageLog.create({
    data: {
      userId,
      modelId,
      inputTokens,
      outputTokens,
      totalTokens,
      serviceId,
      deptname,
      latencyMs,
    },
  });

  // UserService 업데이트 (user가 있을 때만)
  if (userId && serviceId) {
    await prisma.userService.upsert({
      where: { userId_serviceId: { userId, serviceId } },
      update: {
        lastActive: new Date(),
        requestCount: { increment: 1 },
      },
      create: {
        userId,
        serviceId,
        firstSeen: new Date(),
        lastActive: new Date(),
        requestCount: 1,
      },
    });
  }

  // Redis 카운터
  if (userId && loginid) {
    await incrementUsage(redis, userId, modelId, inputTokens, outputTokens);
    await trackActiveUser(redis, loginid);
  }

  console.log(`[Usage] user=${loginid || 'background'}, model=${modelId}, service=${serviceId}, tokens=${totalTokens}, latency=${latencyMs || 'N/A'}ms`);
}

/**
 * RequestLog 저장 (요청 로그)
 */
async function recordRequestLog(params: {
  serviceId: string;
  userId?: string | null;
  deptname?: string | null;
  modelName: string;
  resolvedModel?: string | null;
  method: string;
  path: string;
  statusCode: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
  errorMessage?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
  stream?: boolean;
}) {
  try {
    await prisma.requestLog.create({
      data: {
        serviceId: params.serviceId,
        userId: params.userId || null,
        deptname: params.deptname || null,
        modelName: params.modelName,
        resolvedModel: params.resolvedModel || null,
        method: params.method,
        path: params.path,
        statusCode: params.statusCode,
        inputTokens: params.inputTokens || null,
        outputTokens: params.outputTokens || null,
        latencyMs: params.latencyMs || null,
        errorMessage: params.errorMessage ? params.errorMessage.substring(0, 2000) : null,
        userAgent: params.userAgent || null,
        ipAddress: params.ipAddress || null,
        stream: params.stream || false,
      },
    });
  } catch (err) {
    console.error('[RequestLog] Failed to record:', err);
  }
}

function buildChatCompletionsUrl(endpointUrl: string): string {
  let url = endpointUrl.trim();
  if (url.endsWith('/chat/completions')) return url;
  if (url.endsWith('/')) url = url.slice(0, -1);
  if (url.endsWith('/v1')) return `${url}/chat/completions`;
  return `${url}/chat/completions`;
}

// ============================================
// GET /v1/models (서비스별 alias 기반)
// ============================================
proxyRoutes.get('/models', async (req: Request, res: Response) => {
  const proxyReq = req as ProxyAuthRequest;

  try {
    // 1) 서비스에 등록된 ServiceModel 조회 (aliasName 기반)
    const serviceModels = await prisma.serviceModel.findMany({
      where: {
        serviceId: proxyReq.serviceId,
        enabled: true,
        model: { enabled: true },
      },
      include: {
        model: {
          select: {
            id: true,
            name: true,
            displayName: true,
            maxTokens: true,
            supportsVision: true,
            visibility: true,
            visibilityScope: true,
            adminVisible: true,
          },
        },
      },
      orderBy: [{ sortOrder: 'asc' }],
    });

    // 2) 서비스에 모델이 등록되어 있으면 aliasName 기준으로 반환
    if (serviceModels.length > 0) {
      // 접근 가능한 모델만 필터 + 고유 aliasName 추출
      const aliasSet = new Set<string>();
      const result: { id: string; object: string; created: number; owned_by: string }[] = [];

      for (const sm of serviceModels) {
        if (aliasSet.has(sm.aliasName)) continue;
        if (!canServiceAccessModel(proxyReq, sm.model)) continue;
        aliasSet.add(sm.aliasName);
        result.push({
          id: sm.aliasName,
          object: 'model',
          created: Date.now(),
          owned_by: 'agent-dashboard',
        });
      }

      res.json({ object: 'list', data: result });
      return;
    }

    // 3) ServiceModel이 없으면 기존 전역 모델 목록 fallback
    const models = await prisma.model.findMany({
      where: { enabled: true },
      select: {
        id: true,
        name: true,
        displayName: true,
        maxTokens: true,
        sortOrder: true,
        supportsVision: true,
        visibility: true,
        visibilityScope: true,
        adminVisible: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
    });

    const filtered = models.filter(model =>
      canServiceAccessModel(proxyReq, model)
    );

    res.json({
      object: 'list',
      data: filtered.map(model => ({
        id: model.displayName || model.name,
        object: 'model',
        created: Date.now(),
        owned_by: 'agent-dashboard',
      })),
    });
  } catch (error) {
    console.error('Get models error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to get models' });
  }
});

// ============================================
// GET /v1/models/:modelName
// ============================================
proxyRoutes.get('/models/:modelName', async (req: Request, res: Response) => {
  const proxyReq = req as ProxyAuthRequest;

  try {
    const { modelName } = req.params;

    const model = await prisma.model.findFirst({
      where: {
        OR: [{ name: modelName }, { id: modelName }, { displayName: modelName }],
        enabled: true,
      },
      select: {
        id: true,
        name: true,
        displayName: true,
        maxTokens: true,
        supportsVision: true,
        visibility: true,
        visibilityScope: true,
        adminVisible: true,
      },
    });

    if (!model) {
      res.status(404).json({ error: 'Model not found' });
      return;
    }

    // 서비스 접근 권한 확인
    if (!canServiceAccessModel(proxyReq, model)) {
      res.status(403).json({ error: `Model '${modelName}' is not accessible by this service` });
      return;
    }

    res.json({
      id: model.displayName || model.name,
      object: 'model',
      created: Date.now(),
      owned_by: 'agent-dashboard',
    });
  } catch (error) {
    console.error('Get model error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to get model' });
  }
});

// ============================================
// POST /v1/chat/completions
// ============================================
proxyRoutes.post('/chat/completions', async (req: Request, res: Response) => {
  const proxyReq = req as ProxyAuthRequest;
  const reqStartTime = Date.now();
  const userAgent = req.headers['user-agent'] || null;
  const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || null;

  try {
    const { model: modelName, messages, stream, ...otherParams } = req.body;

    if (!modelName || !messages) {
      recordRequestLog({ serviceId: proxyReq.serviceId, deptname: proxyReq.deptName, modelName: modelName || 'unknown', method: 'POST', path: '/v1/chat/completions', statusCode: 400, latencyMs: Date.now() - reqStartTime, errorMessage: 'model and messages are required', userAgent, ipAddress }).catch(() => {});
      res.status(400).json({ error: 'model and messages are required' });
      return;
    }

    // 모델 조회: Service-level round-robin 우선, fallback으로 전역 조회
    const resolved = await resolveModelWithServiceRR(proxyReq.serviceId, modelName);
    if (!resolved.found || !resolved.model) {
      recordRequestLog({ serviceId: proxyReq.serviceId, deptname: proxyReq.deptName, modelName, method: 'POST', path: '/v1/chat/completions', statusCode: 404, latencyMs: Date.now() - reqStartTime, errorMessage: `Model '${modelName}' not found or disabled`, userAgent, ipAddress }).catch(() => {});
      res.status(404).json({ error: `Model '${modelName}' not found or disabled` });
      return;
    }
    const model = resolved.model;

    // 서비스 접근 권한 확인
    if (!canServiceAccessModel(proxyReq, model)) {
      recordRequestLog({ serviceId: proxyReq.serviceId, deptname: proxyReq.deptName, modelName, resolvedModel: model.name, method: 'POST', path: '/v1/chat/completions', statusCode: 403, latencyMs: Date.now() - reqStartTime, errorMessage: 'Model not accessible by service', userAgent, ipAddress }).catch(() => {});
      res.status(403).json({
        error: `Model '${modelName}' is not accessible by service '${proxyReq.serviceName}'`,
        message: 'This model is not available for your service. Check the LLM visibility settings.',
      });
      return;
    }

    // 사용자 upsert (background가 아닌 경우)
    const user = await getOrCreateUser(proxyReq);

    // Rate limit 체크
    const rateLimitResult = await checkRateLimit(user, proxyReq.serviceId);
    if (rateLimitResult) {
      recordRequestLog({ serviceId: proxyReq.serviceId, userId: user?.id, deptname: proxyReq.deptName, modelName, resolvedModel: model.name, method: 'POST', path: '/v1/chat/completions', statusCode: rateLimitResult.status, latencyMs: Date.now() - reqStartTime, errorMessage: 'Rate limit exceeded', userAgent, ipAddress, stream: stream || false }).catch(() => {});
      res.status(rateLimitResult.status).json(rateLimitResult.body);
      return;
    }

    // 라운드로빈 + Failover
    const endpoints = await getModelEndpoints(model.id, {
      endpointUrl: model.endpointUrl,
      apiKey: model.apiKey,
      modelName: model.name,
      extraHeaders: model.extraHeaders as Record<string, string> | null,
    });
    const startIdx = await getRoundRobinIndex(model.id, endpoints.length);

    if (endpoints.length > 1) {
      console.log(`[RoundRobin] Model "${model.name}" has ${endpoints.length} endpoints (weighted), starting at index ${startIdx}`);
    }

    const isSingleEndpoint = endpoints.length === 1;
    const maxAttempts = isSingleEndpoint ? SINGLE_ENDPOINT_MAX_RETRIES : endpoints.length;
    let lastFailoverError: string | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const idx = isSingleEndpoint ? 0 : (startIdx + attempt) % endpoints.length;
      const endpoint = endpoints[idx]!;

      if (attempt > 0) {
        if (isSingleEndpoint) {
          console.log(`[Retry] Model "${model.name}" retry ${attempt}/${SINGLE_ENDPOINT_MAX_RETRIES - 1}: ${endpoint.endpointUrl}`);
          await sleep(SINGLE_ENDPOINT_RETRY_DELAY_MS * attempt);
        } else {
          console.log(`[Failover] Model "${model.name}" trying endpoint ${attempt + 1}/${endpoints.length}: ${endpoint.endpointUrl}`);
        }
      }

      const llmRequestBody = {
        model: endpoint.modelName,
        messages,
        stream: stream || false,
        ...otherParams,
      };

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (endpoint.apiKey) headers['Authorization'] = `Bearer ${endpoint.apiKey}`;
      if (endpoint.extraHeaders) {
        for (const [key, value] of Object.entries(endpoint.extraHeaders)) {
          const lowerKey = key.toLowerCase();
          if (lowerKey !== 'content-type' && lowerKey !== 'authorization') {
            headers[key] = value;
          }
        }
      }

      const effectiveModel = { ...model, endpointUrl: endpoint.endpointUrl, apiKey: endpoint.apiKey };

      let handled: boolean;
      if (stream) {
        handled = await handleStreamingRequest(res, effectiveModel, llmRequestBody, headers, user, proxyReq);
      } else {
        handled = await handleNonStreamingRequest(res, effectiveModel, llmRequestBody, headers, user, proxyReq);
      }

      if (handled) return;
      lastFailoverError = `Endpoint ${endpoint.endpointUrl} failed`;
    }

    const label = isSingleEndpoint ? `after ${SINGLE_ENDPOINT_MAX_RETRIES} retries` : `all ${endpoints.length} endpoints`;
    console.error(`[Failover] ${label} failed for model "${model.name}"`);
    recordRequestLog({ serviceId: proxyReq.serviceId, userId: user?.id, deptname: proxyReq.deptName, modelName, resolvedModel: model.name, method: 'POST', path: '/v1/chat/completions', statusCode: 503, latencyMs: Date.now() - reqStartTime, errorMessage: `All endpoints failed: ${lastFailoverError}`, userAgent, ipAddress, stream: stream || false }).catch(() => {});
    res.status(503).json({
      error: 'Service temporarily unavailable',
      message: `Failed ${label}. Please try again later.`,
      details: lastFailoverError,
    });
  } catch (error) {
    console.error('Chat completion proxy error:', error);
    recordRequestLog({ serviceId: proxyReq.serviceId, deptname: proxyReq.deptName, modelName: req.body?.model || 'unknown', method: 'POST', path: '/v1/chat/completions', statusCode: 500, latencyMs: Date.now() - reqStartTime, errorMessage: error instanceof Error ? error.message : 'Unknown error', userAgent, ipAddress, stream: req.body?.stream || false }).catch(() => {});
    if (!res.headersSent) res.status(500).json({ error: 'Failed to process chat completion' });
  }
});

// ============================================
// Request handling
// ============================================

const REQUEST_TIMEOUT_MS = 120000;

function isMaxTokensError(errorText: string): boolean {
  return errorText.includes('max_tokens') && errorText.includes('must be at least');
}

function isContextWindowExceededError(errorText: string): boolean {
  const lower = errorText.toLowerCase();
  return (
    lower.includes('contextwindowexceedederror') ||
    (lower.includes('max_tokens') && lower.includes('too large')) ||
    (lower.includes('max_completion_tokens') && lower.includes('too large')) ||
    (lower.includes('context length') && lower.includes('input tokens'))
  );
}

function logLLMError(
  context: string, url: string, status: number, errorBody: string,
  requestBody: any, loginid: string, model: { name: string }, serviceId: string
) {
  const messages = requestBody.messages || [];
  const messageSummary = messages.map((m: any, i: number) => {
    const contentLen = typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content || '').length;
    return `  [${i}] role=${m.role} content_len=${contentLen}`;
  }).join('\n');

  const truncatedError = errorBody.length > 2000
    ? errorBody.substring(0, 2000) + `... (truncated, total ${errorBody.length} chars)`
    : errorBody;

  console.error(
    `[LLM-Error] ${context}\n` +
    `  User: ${loginid}\n` +
    `  Model: ${model.name} | Service: ${serviceId}\n` +
    `  URL: ${url} | Status: ${status}\n` +
    `  Messages (${messages.length}):\n${messageSummary}\n` +
    `  stream: ${requestBody.stream || false} | max_tokens: ${requestBody.max_tokens || 'default'}\n` +
    `  LLM Response:\n${truncatedError}`
  );
}

async function handleNonStreamingRequest(
  res: Response,
  model: { id: string; name: string; endpointUrl: string; apiKey: string | null },
  requestBody: any,
  headers: Record<string, string>,
  user: { id: string; loginid: string } | null,
  proxyReq: ProxyAuthRequest
): Promise<boolean> {
  const url = buildChatCompletionsUrl(model.endpointUrl);
  const loginid = user?.loginid || proxyReq.serviceName;
  console.log(`[Proxy] user=${loginid} model=${model.name} endpoint=${url} (non-streaming)`);

  try {
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST', headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        logLLMError('Non-Streaming', url, response.status, errorText, requestBody, loginid, model, proxyReq.serviceId);

        // Context window 초과 재시도
        if (response.status === 400 && isContextWindowExceededError(errorText) && (requestBody.max_tokens || requestBody.max_completion_tokens)) {
          const { max_tokens: _mt, max_completion_tokens: _mct, ...bodyWithoutMaxTokens } = requestBody;
          try {
            const retryController = new AbortController();
            const retryTimeoutId = setTimeout(() => retryController.abort(), REQUEST_TIMEOUT_MS);
            const retryResponse = await fetch(url, {
              method: 'POST', headers,
              body: JSON.stringify(bodyWithoutMaxTokens),
              signal: retryController.signal,
            });
            clearTimeout(retryTimeoutId);
            const retryLatencyMs = Date.now() - startTime;

            if (retryResponse.ok) {
              const data = await retryResponse.json() as any;
              if (data.usage) {
                recordUsage(user?.id || null, user?.loginid || null, model.id,
                  data.usage.prompt_tokens || 0, data.usage.completion_tokens || 0,
                  proxyReq.serviceId, proxyReq.deptName, retryLatencyMs).catch(console.error);
              }
              res.json(data);
              return true;
            }
            const retryErrorText = await retryResponse.text();
            res.status(retryResponse.status).json({ error: 'LLM request failed', details: retryErrorText });
            return true;
          } catch { /* retry failed */ }
        }

        if (response.status >= 400 && response.status < 500) {
          if (response.status === 400 && isMaxTokensError(errorText)) {
            res.status(400).json({
              error: { message: 'The input prompt exceeds the model\'s maximum context length.', type: 'invalid_request_error', code: 'context_length_exceeded' },
            });
          } else {
            res.status(response.status).json({ error: 'LLM request failed', details: errorText });
          }
          return true;
        }

        console.error(`[Failover] Endpoint ${url} returned ${response.status}`);
        return false;
      }

      const data = await response.json() as any;
      if (data.usage) {
        recordUsage(user?.id || null, user?.loginid || null, model.id,
          data.usage.prompt_tokens || 0, data.usage.completion_tokens || 0,
          proxyReq.serviceId, proxyReq.deptName, latencyMs).catch(console.error);
        recordRequestLog({
          serviceId: proxyReq.serviceId, userId: user?.id, deptname: proxyReq.deptName,
          modelName: requestBody.model, resolvedModel: model.name, method: 'POST', path: '/v1/chat/completions',
          statusCode: 200, inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens,
          latencyMs, userAgent: (proxyReq as any).headers?.['user-agent'], ipAddress: (proxyReq as any).ip, stream: false,
        }).catch(() => {});
      }
      res.json(data);
      return true;

    } catch (fetchError) {
      clearTimeout(timeoutId);
      throw fetchError;
    }
  } catch (error) {
    console.error(`[Failover] Endpoint ${url} connection failed:`, error instanceof Error ? error.message : error);
    return false;
  }
}

async function handleStreamingRequest(
  res: Response,
  model: { id: string; name: string; endpointUrl: string; apiKey: string | null },
  requestBody: any,
  headers: Record<string, string>,
  user: { id: string; loginid: string } | null,
  proxyReq: ProxyAuthRequest
): Promise<boolean> {
  const url = buildChatCompletionsUrl(model.endpointUrl);
  const loginid = user?.loginid || proxyReq.serviceName;
  console.log(`[Proxy] user=${loginid} model=${model.name} endpoint=${url} (streaming)`);

  const startTime = Date.now();
  let sseStarted = false;

  try {
    let contextWindowRetried = false;
    const requestWithUsage = { ...requestBody, stream_options: { include_usage: true } };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: globalThis.Response;

    try {
      response = await fetch(url, {
        method: 'POST', headers,
        body: JSON.stringify(requestWithUsage),
        signal: controller.signal,
      });

      if (!response.ok && response.status === 400) {
        const errorText = await response.text();
        if (isMaxTokensError(errorText)) {
          clearTimeout(timeoutId);
          res.status(400).json({
            error: { message: 'The input prompt exceeds the model\'s maximum context length.', type: 'invalid_request_error', code: 'context_length_exceeded' },
          });
          return true;
        }
        if (isContextWindowExceededError(errorText) && (requestBody.max_tokens || requestBody.max_completion_tokens)) {
          contextWindowRetried = true;
          const { max_tokens: _mt, max_completion_tokens: _mct, stream_options: _so, ...bodyWithoutMaxTokens } = requestBody;
          response = await fetch(url, {
            method: 'POST', headers,
            body: JSON.stringify({ ...bodyWithoutMaxTokens, stream: true }),
            signal: controller.signal,
          });
        } else {
          response = await fetch(url, {
            method: 'POST', headers,
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          });
        }
      }
      clearTimeout(timeoutId);
    } catch (fetchError) {
      clearTimeout(timeoutId);
      throw fetchError;
    }

    if (!response.ok) {
      const errorText = await response.text();
      logLLMError('Streaming', url, response.status, errorText, requestBody, loginid, model, proxyReq.serviceId);

      if (!contextWindowRetried && response.status === 400 && isContextWindowExceededError(errorText) && (requestBody.max_tokens || requestBody.max_completion_tokens)) {
        const { max_tokens: _mt, max_completion_tokens: _mct, ...bodyWithoutMaxTokens } = requestBody;
        try {
          const retryController = new AbortController();
          const retryTimeoutId = setTimeout(() => retryController.abort(), REQUEST_TIMEOUT_MS);
          const retryResponse = await fetch(url, {
            method: 'POST', headers,
            body: JSON.stringify({ ...bodyWithoutMaxTokens, stream: true }),
            signal: retryController.signal,
          });
          clearTimeout(retryTimeoutId);
          if (retryResponse.ok) {
            response = retryResponse;
          } else {
            const retryErrorText = await retryResponse.text();
            res.status(retryResponse.status).json({ error: 'LLM request failed', details: retryErrorText });
            return true;
          }
        } catch {
          res.status(response.status).json({ error: 'LLM request failed', details: errorText });
          return true;
        }
      } else {
        if (response.status >= 400 && response.status < 500) {
          if (response.status === 400 && isMaxTokensError(errorText)) {
            res.status(400).json({
              error: { message: 'The input prompt exceeds the model\'s maximum context length.', type: 'invalid_request_error', code: 'context_length_exceeded' },
            });
          } else {
            res.status(response.status).json({ error: 'LLM request failed', details: errorText });
          }
          return true;
        }
        console.error(`[Failover] Endpoint ${url} returned ${response.status}`);
        return false;
      }
    }

    // SSE 스트리밍 시작
    sseStarted = true;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = response.body?.getReader();
    if (!reader) {
      res.status(500).json({ error: 'Failed to get response stream' });
      return true;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let usageData: { prompt_tokens?: number; completion_tokens?: number } | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            if (dataStr === '[DONE]') { res.write('data: [DONE]\n\n'); continue; }
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.usage) usageData = parsed.usage;
            } catch { /* not JSON */ }
            res.write(`data: ${dataStr}\n\n`);
          } else if (line.trim()) {
            res.write(`${line}\n`);
          }
        }
      }
      if (buffer.trim()) res.write(`${buffer}\n`);
    } finally {
      reader.releaseLock();
    }

    const latencyMs = Date.now() - startTime;
    if (usageData) {
      recordUsage(user?.id || null, user?.loginid || null, model.id,
        usageData.prompt_tokens || 0, usageData.completion_tokens || 0,
        proxyReq.serviceId, proxyReq.deptName, latencyMs).catch(console.error);
    }
    recordRequestLog({
      serviceId: proxyReq.serviceId, userId: user?.id, deptname: proxyReq.deptName,
      modelName: requestBody.model, resolvedModel: model.name, method: 'POST', path: '/v1/chat/completions',
      statusCode: 200, inputTokens: usageData?.prompt_tokens, outputTokens: usageData?.completion_tokens,
      latencyMs, userAgent: (proxyReq as any).headers?.['user-agent'], ipAddress: (proxyReq as any).ip, stream: true,
    }).catch(() => {});
    res.end();
    return true;

  } catch (error) {
    if (sseStarted) {
      console.error(`[Streaming] Error after SSE started:`, error instanceof Error ? error.message : error);
      try { res.end(); } catch {}
      return true;
    }
    console.error(`[Failover] Endpoint ${url} connection failed:`, error instanceof Error ? error.message : error);
    return false;
  }
}

// ============================================
// POST /v1/embeddings
// ============================================

const EMBEDDING_TIMEOUT_MS = 1800000; // 30 minutes

function buildEmbeddingsUrl(endpointUrl: string): string {
  let url = endpointUrl.trim();
  if (url.endsWith('/embeddings')) return url;
  if (url.endsWith('/')) url = url.slice(0, -1);
  if (url.endsWith('/v1')) return `${url}/embeddings`;
  if (url.endsWith('/chat/completions')) {
    url = url.replace(/\/chat\/completions$/, '');
  }
  return `${url}/embeddings`;
}

proxyRoutes.post('/embeddings', async (req: Request, res: Response) => {
  const proxyReq = req as ProxyAuthRequest;
  const startTime = Date.now();

  try {
    const { model: modelName, input, ...otherParams } = req.body;

    if (!modelName || !input) {
      res.status(400).json({ error: 'model and input are required' });
      return;
    }

    // 모델 조회: Service-level round-robin 우선, fallback으로 전역 조회
    const resolved = await resolveModelWithServiceRR(proxyReq.serviceId, modelName);
    if (!resolved.found || !resolved.model) {
      res.status(404).json({ error: `Model '${modelName}' not found or disabled` });
      return;
    }
    const model = resolved.model;

    // 서비스 접근 권한 확인
    if (!canServiceAccessModel(proxyReq, model)) {
      res.status(403).json({
        error: `Model '${modelName}' is not accessible by service '${proxyReq.serviceName}'`,
      });
      return;
    }

    // 사용자 upsert
    const user = await getOrCreateUser(proxyReq);

    // Rate limit 체크
    const rateLimitResult = await checkRateLimit(user, proxyReq.serviceId);
    if (rateLimitResult) {
      res.status(rateLimitResult.status).json(rateLimitResult.body);
      return;
    }

    // 라운드로빈 + Failover
    const endpoints = await getModelEndpoints(model.id, {
      endpointUrl: model.endpointUrl,
      apiKey: model.apiKey,
      modelName: model.name,
      extraHeaders: model.extraHeaders as Record<string, string> | null,
    });
    const startIdx = await getRoundRobinIndex(model.id, endpoints.length);

    const isSingleEndpoint = endpoints.length === 1;
    const maxAttempts = isSingleEndpoint ? SINGLE_ENDPOINT_MAX_RETRIES : endpoints.length;
    let lastError: string | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const idx = isSingleEndpoint ? 0 : (startIdx + attempt) % endpoints.length;
      const endpoint = endpoints[idx]!;

      if (attempt > 0) {
        if (isSingleEndpoint) {
          console.log(`[Retry] Embeddings model "${model.name}" retry ${attempt}/${SINGLE_ENDPOINT_MAX_RETRIES - 1}`);
          await sleep(SINGLE_ENDPOINT_RETRY_DELAY_MS * attempt);
        } else {
          console.log(`[Failover] Embeddings model "${model.name}" trying endpoint ${attempt + 1}/${endpoints.length}: ${endpoint.endpointUrl}`);
        }
      }

      const url = buildEmbeddingsUrl(endpoint.endpointUrl);
      const loginid = user?.loginid || proxyReq.serviceName;
      console.log(`[Proxy] user=${loginid} model=${model.name} endpoint=${url} (embeddings)`);

      const embeddingsBody = {
        model: endpoint.modelName,
        input,
        ...otherParams,
      };

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (endpoint.apiKey) headers['Authorization'] = `Bearer ${endpoint.apiKey}`;
      if (endpoint.extraHeaders) {
        for (const [key, value] of Object.entries(endpoint.extraHeaders)) {
          const lowerKey = key.toLowerCase();
          if (lowerKey !== 'content-type' && lowerKey !== 'authorization') {
            headers[key] = value;
          }
        }
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(embeddingsBody),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const latencyMs = Date.now() - startTime;

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[LLM-Error] Embeddings | user=${loginid} model=${model.name} url=${url} status=${response.status} error=${errorText.substring(0, 2000)}`);

          if (response.status >= 400 && response.status < 500) {
            try {
              const errorJson = JSON.parse(errorText);
              res.status(response.status).json(errorJson);
            } catch {
              res.status(response.status).send(errorText);
            }
            return;
          }

          console.error(`[Failover] Embeddings endpoint ${url} returned ${response.status}`);
          lastError = errorText;
          continue;
        }

        // 성공 — raw text 그대로 전달 (대용량 임베딩 응답 JSON 재파싱 방지)
        const responseText = await response.text();

        // regex로 usage 추출 (full JSON parse 없이)
        let inputTokens = 0;
        const promptMatch = responseText.match(/"prompt_tokens"\s*:\s*(\d+)/);
        if (promptMatch) {
          inputTokens = parseInt(promptMatch[1]!, 10);
        } else {
          const totalMatch = responseText.match(/"total_tokens"\s*:\s*(\d+)/);
          if (totalMatch) inputTokens = parseInt(totalMatch[1]!, 10);
        }

        if (inputTokens > 0) {
          recordUsage(user?.id || null, user?.loginid || null, model.id,
            inputTokens, 0, proxyReq.serviceId, proxyReq.deptName, latencyMs).catch(console.error);
        }

        res.setHeader('Content-Type', 'application/json');
        res.status(200).send(responseText);
        return;

      } catch (error) {
        console.error(`[Failover] Embeddings endpoint ${url} connection failed:`, error instanceof Error ? error.message : error);
        lastError = error instanceof Error ? error.message : 'Connection failed';
        continue;
      }
    }

    // 모든 시도 실패
    const label = isSingleEndpoint ? `after ${SINGLE_ENDPOINT_MAX_RETRIES} retries` : `all ${endpoints.length} endpoints`;
    console.error(`[Failover] ${label} failed for embeddings model "${model.name}"`);
    res.status(503).json({
      error: 'Service temporarily unavailable',
      message: `Failed ${label}. Please try again later.`,
    });

  } catch (error) {
    console.error('Embeddings proxy error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to process embeddings request' });
    }
  }
});

// ============================================
// POST /v1/rerank
// ============================================

function buildRerankUrl(endpointUrl: string): string {
  let url = endpointUrl.trim();
  if (url.endsWith('/rerank')) return url;
  if (url.endsWith('/')) url = url.slice(0, -1);
  if (url.endsWith('/v1')) return `${url}/rerank`;
  if (url.endsWith('/chat/completions')) {
    url = url.replace(/\/chat\/completions$/, '');
  } else if (url.endsWith('/embeddings')) {
    url = url.replace(/\/embeddings$/, '');
  }
  return `${url}/rerank`;
}

proxyRoutes.post('/rerank', async (req: Request, res: Response) => {
  const proxyReq = req as ProxyAuthRequest;
  const startTime = Date.now();

  try {
    const { model: modelName, query, documents, top_n, return_documents, ...otherParams } = req.body;

    if (!modelName) {
      res.status(400).json({ error: 'model is required' });
      return;
    }
    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'query is required and must be a string' });
      return;
    }
    if (!documents || !Array.isArray(documents) || documents.length === 0) {
      res.status(400).json({ error: 'documents is required and must be a non-empty array' });
      return;
    }

    // 모델 조회: Service-level round-robin 우선, fallback으로 전역 조회
    const resolved = await resolveModelWithServiceRR(proxyReq.serviceId, modelName);
    if (!resolved.found || !resolved.model) {
      res.status(404).json({ error: `Model '${modelName}' not found or disabled` });
      return;
    }
    const model = resolved.model;

    // 서비스 접근 권한 확인
    if (!canServiceAccessModel(proxyReq, model)) {
      res.status(403).json({
        error: `Model '${modelName}' is not accessible by service '${proxyReq.serviceName}'`,
      });
      return;
    }

    // 사용자 upsert
    const user = await getOrCreateUser(proxyReq);

    // Rate limit 체크
    const rateLimitResult = await checkRateLimit(user, proxyReq.serviceId);
    if (rateLimitResult) {
      res.status(rateLimitResult.status).json(rateLimitResult.body);
      return;
    }

    // 라운드로빈 + Failover
    const endpoints = await getModelEndpoints(model.id, {
      endpointUrl: model.endpointUrl,
      apiKey: model.apiKey,
      modelName: model.name,
      extraHeaders: model.extraHeaders as Record<string, string> | null,
    });
    const startIdx = await getRoundRobinIndex(model.id, endpoints.length);

    const isSingleEndpoint = endpoints.length === 1;
    const maxAttempts = isSingleEndpoint ? SINGLE_ENDPOINT_MAX_RETRIES : endpoints.length;
    let lastError: string | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const idx = isSingleEndpoint ? 0 : (startIdx + attempt) % endpoints.length;
      const endpoint = endpoints[idx]!;

      if (attempt > 0) {
        if (isSingleEndpoint) {
          console.log(`[Retry] Rerank model "${model.name}" retry ${attempt}/${SINGLE_ENDPOINT_MAX_RETRIES - 1}`);
          await sleep(SINGLE_ENDPOINT_RETRY_DELAY_MS * attempt);
        } else {
          console.log(`[Failover] Rerank model "${model.name}" trying endpoint ${attempt + 1}/${endpoints.length}: ${endpoint.endpointUrl}`);
        }
      }

      const url = buildRerankUrl(endpoint.endpointUrl);
      const loginid = user?.loginid || proxyReq.serviceName;
      console.log(`[Proxy] user=${loginid} model=${model.name} endpoint=${url} (rerank)`);

      const rerankBody: Record<string, unknown> = {
        model: endpoint.modelName,
        query,
        documents,
      };
      if (top_n !== undefined) rerankBody.top_n = top_n;
      if (return_documents !== undefined) rerankBody.return_documents = return_documents;
      for (const [key, value] of Object.entries(otherParams)) {
        if (!(key in rerankBody)) rerankBody[key] = value;
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (endpoint.apiKey) headers['Authorization'] = `Bearer ${endpoint.apiKey}`;
      if (endpoint.extraHeaders) {
        for (const [key, value] of Object.entries(endpoint.extraHeaders)) {
          const lowerKey = key.toLowerCase();
          if (lowerKey !== 'content-type' && lowerKey !== 'authorization') {
            headers[key] = value;
          }
        }
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(rerankBody),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const latencyMs = Date.now() - startTime;

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[LLM-Error] Rerank | user=${loginid} model=${model.name} url=${url} status=${response.status} error=${errorText.substring(0, 2000)}`);

          if (response.status >= 400 && response.status < 500) {
            try {
              const errorJson = JSON.parse(errorText);
              res.status(response.status).json(errorJson);
            } catch {
              res.status(response.status).send(errorText);
            }
            return;
          }

          console.error(`[Failover] Rerank endpoint ${url} returned ${response.status}`);
          lastError = errorText;
          continue;
        }

        // 성공 — raw text 그대로 전달
        const responseText = await response.text();

        // regex로 usage 추출
        let inputTokens = 0;
        const promptMatch = responseText.match(/"prompt_tokens"\s*:\s*(\d+)/);
        if (promptMatch) {
          inputTokens = parseInt(promptMatch[1]!, 10);
        } else {
          const totalMatch = responseText.match(/"total_tokens"\s*:\s*(\d+)/);
          if (totalMatch) inputTokens = parseInt(totalMatch[1]!, 10);
        }

        if (inputTokens > 0) {
          recordUsage(user?.id || null, user?.loginid || null, model.id,
            inputTokens, 0, proxyReq.serviceId, proxyReq.deptName, latencyMs).catch(console.error);
        }

        res.setHeader('Content-Type', 'application/json');
        res.status(200).send(responseText);
        return;

      } catch (error) {
        console.error(`[Failover] Rerank endpoint ${url} connection failed:`, error instanceof Error ? error.message : error);
        lastError = error instanceof Error ? error.message : 'Connection failed';
        continue;
      }
    }

    // 모든 시도 실패
    const label = isSingleEndpoint ? `after ${SINGLE_ENDPOINT_MAX_RETRIES} retries` : `all ${endpoints.length} endpoints`;
    console.error(`[Failover] ${label} failed for rerank model "${model.name}"`);
    res.status(503).json({
      error: 'Service temporarily unavailable',
      message: `Failed ${label}. Please try again later.`,
    });

  } catch (error) {
    console.error('Rerank proxy error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to process rerank request' });
    }
  }
});

// ============================================
// POST /v1/images/generations
// ============================================

proxyRoutes.post('/images/generations', async (req: Request, res: Response) => {
  const proxyReq = req as ProxyAuthRequest;
  const startTime = Date.now();

  try {
    const { model: modelName, prompt, n, size, quality, style, ...otherParams } = req.body;

    if (!modelName || !prompt) {
      res.status(400).json({ error: 'model and prompt are required' });
      return;
    }

    // 모델 조회: Service-level round-robin 우선, fallback으로 전역 조회
    const resolved = await resolveModelWithServiceRR(proxyReq.serviceId, modelName);
    if (!resolved.found || !resolved.model) {
      res.status(404).json({ error: `Model '${modelName}' not found or disabled` });
      return;
    }
    const model = resolved.model;

    if (model.type !== 'IMAGE') {
      res.status(400).json({ error: `Model '${modelName}' is not an IMAGE model` });
      return;
    }

    // 서비스 접근 권한 확인
    if (!canServiceAccessModel(proxyReq, model)) {
      res.status(403).json({
        error: `Model '${modelName}' is not accessible by service '${proxyReq.serviceName}'`,
      });
      return;
    }

    // 사용자 upsert
    const user = await getOrCreateUser(proxyReq);

    // Rate limit 체크
    const rateLimitResult = await checkRateLimit(user, proxyReq.serviceId);
    if (rateLimitResult) {
      res.status(rateLimitResult.status).json(rateLimitResult.body);
      return;
    }

    // 저장 디렉토리 확인
    ensureStorageDir();

    // 라운드로빈 + Failover
    const endpoints = await getModelEndpoints(model.id, {
      endpointUrl: model.endpointUrl,
      apiKey: model.apiKey,
      modelName: model.name,
      extraHeaders: model.extraHeaders as Record<string, string> | null,
    });
    const startIdx = await getRoundRobinIndex(model.id, endpoints.length);

    const isSingleEndpoint = endpoints.length === 1;
    const maxAttempts = isSingleEndpoint ? SINGLE_ENDPOINT_MAX_RETRIES : endpoints.length;
    let lastError: string | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const idx = isSingleEndpoint ? 0 : (startIdx + attempt) % endpoints.length;
      const endpoint = endpoints[idx]!;

      if (attempt > 0) {
        if (isSingleEndpoint) {
          console.log(`[Retry] Image model "${model.name}" retry ${attempt}/${SINGLE_ENDPOINT_MAX_RETRIES - 1}`);
          await sleep(SINGLE_ENDPOINT_RETRY_DELAY_MS * attempt);
        } else {
          console.log(`[Failover] Image model "${model.name}" trying endpoint ${attempt + 1}/${endpoints.length}: ${endpoint.endpointUrl}`);
        }
      }

      const provider = model.imageProvider || 'OPENAI';
      const loginid = user?.loginid || proxyReq.serviceName;
      console.log(`[Proxy] user=${loginid} model=${model.name} endpoint=${endpoint.endpointUrl} (image/${provider})`);

      try {
        const providerResults = await generateImages(provider, {
          endpointUrl: endpoint.endpointUrl,
          apiKey: endpoint.apiKey,
          modelName: endpoint.modelName,
          extraHeaders: endpoint.extraHeaders,
          extraBody: model.extraBody as Record<string, any> | null,
        }, {
          prompt,
          n: n || undefined,
          size: size || undefined,
          quality: quality || undefined,
          style: style || undefined,
          negativePrompt: otherParams.negative_prompt || undefined,
        });

        // 이미지 로컬 저장 + URL 재작성
        const reqHost = req.headers['host'] || undefined;
        const reqProtocol = req.protocol || 'http';
        const rewrittenData: Array<{ url: string; revised_prompt?: string }> = [];

        for (const result of providerResults) {
          const saved = await saveImage(result.imageBuffer, {
            mimeType: result.mimeType,
            modelId: model.id,
            userId: user?.id || undefined,
            serviceId: proxyReq.serviceId,
            prompt,
          });

          rewrittenData.push({
            url: buildImageUrl(saved.fileName, reqHost, reqProtocol),
            revised_prompt: result.revisedPrompt,
          });
        }

        const latencyMs = Date.now() - startTime;

        res.json({
          created: Math.floor(Date.now() / 1000),
          data: rewrittenData,
        });

        // Usage 기록 (이미지는 토큰 0, 요청 횟수만 트래킹)
        recordUsage(user?.id || null, user?.loginid || null, model.id,
          0, 0, proxyReq.serviceId, proxyReq.deptName, latencyMs).catch(console.error);

        return;

      } catch (fetchError: any) {
        const errMsg = fetchError.message || 'Unknown error';
        console.error(`[ImageProxy] Provider ${model.imageProvider || 'OPENAI'} failed for ${endpoint.endpointUrl}: ${errMsg}`);
        lastError = errMsg;
        continue;
      }
    }

    // 모든 엔드포인트 실패
    const label = isSingleEndpoint
      ? `after ${SINGLE_ENDPOINT_MAX_RETRIES} retries`
      : `all ${endpoints.length} endpoints`;
    res.status(503).json({
      error: 'Service temporarily unavailable',
      message: `Failed ${label}. Last error: ${lastError || 'unknown'}`,
    });

  } catch (error) {
    console.error('Image generation proxy error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to process image generation request' });
    }
  }
});

// Legacy completions
proxyRoutes.post('/completions', async (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Legacy completions endpoint not implemented. Use /v1/chat/completions instead.' });
});

// Health check
proxyRoutes.get('/health', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Health check error:', error);
    if (!res.headersSent) res.status(503).json({ status: 'unhealthy', timestamp: new Date().toISOString() });
  }
});
