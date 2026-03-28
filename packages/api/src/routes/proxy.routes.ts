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
import multer from 'multer';
import { prisma, redis } from '../index.js';
import { logErrorToRequestLog } from '../services/requestLog.js';
import { incrementUsage, trackActiveUser } from '../services/redis.service.js';
import { validateProxyHeaders, ProxyAuthRequest, checkDeployScope } from '../middleware/proxyAuth.js';
import { extractBusinessUnit } from '../middleware/auth.js';
import { generateImages } from '../services/imageProviders.service.js';
import { saveImage, buildImageUrl, IMAGE_STORAGE_PATH, ensureStorageDir } from '../services/imageStorage.service.js';
import { verifyAndRegisterUser } from '../services/knoxEmployee.service.js';

// ASR multipart 업로드 설정
const asrUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
});

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

// ============================================
// POST /v1/audio/transcriptions (ASR — multipart)
// multer → validateProxyHeaders 순서로 적용 (multipart body 파싱이 먼저 필요)
// ============================================

const ASR_TIMEOUT_MS = 600000; // 10분

function buildAudioTranscriptionsUrl(endpointUrl: string): string {
  let url = endpointUrl.trim();
  if (url.endsWith('/audio/transcriptions')) return url;
  if (url.endsWith('/')) url = url.slice(0, -1);
  if (url.endsWith('/v1')) return `${url}/audio/transcriptions`;
  url = url.replace(/\/(chat\/completions|embeddings|rerank|images\/generations)$/, '');
  return `${url}/audio/transcriptions`;
}

proxyRoutes.post(
  '/audio/transcriptions',
  asrUpload.single('file') as any,
  validateProxyHeaders as any,
  async (req: Request, res: Response) => {
    const proxyReq = req as ProxyAuthRequest;
    const startTime = Date.now();
    const userAgent = req.headers['user-agent'] || null;
    const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string) || null;

    try {
      const modelName = req.body?.model;
      if (!modelName) {
        logErrorToRequestLog({ req, statusCode: 400, errorMessage: 'model is required', serviceId: proxyReq.serviceId, deptname: proxyReq.deptName, path: '/v1/audio/transcriptions' }).catch(() => {});
        res.status(400).json({ error: 'model is required' });
        return;
      }
      if (!req.file) {
        logErrorToRequestLog({ req, statusCode: 400, errorMessage: 'audio file is required (field: "file")', serviceId: proxyReq.serviceId, deptname: proxyReq.deptName, modelName, path: '/v1/audio/transcriptions' }).catch(() => {});
        res.status(400).json({ error: 'audio file is required (field: "file")' });
        return;
      }

      // 모델 조회: 서비스 alias 기반
      const resolved = await resolveModelWithServiceRR(proxyReq.serviceId, modelName);
      if (!resolved.found || !resolved.model) {
        logErrorToRequestLog({ req, statusCode: 404, errorMessage: `Model '${modelName}' not found. Use a registered alias name from GET /v1/models`, serviceId: proxyReq.serviceId, deptname: proxyReq.deptName, modelName, path: '/v1/audio/transcriptions' }).catch(() => {});
        res.status(404).json({ error: `Model '${modelName}' not found. Use a registered alias name from GET /v1/models` });
        return;
      }
      const model = resolved.model;

      // 사용자 upsert + Knox 인증
      const { user, error: knoxError } = await getOrCreateUser(proxyReq, '/v1/audio/transcriptions');
      if (knoxError) {
        recordRequestLog({ serviceId: proxyReq.serviceId, deptname: proxyReq.deptName, modelName, resolvedModel: model.name, method: 'POST', path: '/v1/audio/transcriptions', statusCode: knoxError.status, latencyMs: Date.now() - startTime, errorMessage: (knoxError.body as Record<string, string>).message, userAgent, ipAddress, stream: false }).catch(() => {});
        res.status(knoxError.status).json(knoxError.body);
        return;
      }

      // Rate limit 체크
      const rateLimitResult = await checkRateLimit(user, proxyReq.serviceId);
      if (rateLimitResult) {
        recordRequestLog({ serviceId: proxyReq.serviceId, userId: user?.loginid, deptname: proxyReq.deptName, modelName, resolvedModel: model.name, method: 'POST', path: '/v1/audio/transcriptions', statusCode: rateLimitResult.status, latencyMs: Date.now() - startTime, errorMessage: 'Rate limit exceeded', userAgent, ipAddress, stream: false }).catch(() => {});
        res.status(rateLimitResult.status).json(rateLimitResult.body);
        return;
      }

      // 라운드로빈 + Failover
      const endpoints = await getModelEndpoints(model.id, {
        endpointUrl: model.endpointUrl,
        apiKey: model.apiKey,
        modelName: model.name,
        extraHeaders: model.extraHeaders as Record<string, string> | null,
        extraBody: model.extraBody as Record<string, any> | null,
      });
      const startIdx = await getRoundRobinIndex(model.id, endpoints.length);

      const isSingleEndpoint = endpoints.length === 1;
      const cfgRetries = resolved.maxRetries || 0;
    const maxAttempts = isSingleEndpoint ? (1 + cfgRetries) : endpoints.length;
      const asrFailoverAttempts: FailoverAttempt[] = [];

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const idx = isSingleEndpoint ? 0 : (startIdx + attempt) % endpoints.length;
        const endpoint = endpoints[idx]!;

        if (attempt > 0) {
          if (isSingleEndpoint) {
            console.log(`[Retry] ASR model "${model.name}" retry ${attempt}/${cfgRetries}`);
            await sleep(SINGLE_ENDPOINT_RETRY_DELAY_MS * attempt);
          } else {
            console.log(`[Failover] ASR model "${model.name}" trying endpoint ${attempt + 1}/${endpoints.length}: ${endpoint.endpointUrl}`);
          }
        }

        const url = buildAudioTranscriptionsUrl(endpoint.endpointUrl);
        const loginid = user?.loginid || proxyReq.serviceName;
        console.log(`[Proxy] user=${loginid} model=${model.name} endpoint=${url} fileSize=${req.file.size} (audio/transcriptions)`);

        // multipart FormData 구성
        const formData = new FormData();
        formData.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname || 'audio.wav');
        formData.append('model', endpoint.modelName);
        if (req.body.language) formData.append('language', req.body.language);
        if (req.body.prompt) formData.append('prompt', req.body.prompt);
        if (req.body.response_format) formData.append('response_format', req.body.response_format);
        if (req.body.temperature) formData.append('temperature', String(req.body.temperature));
        if (req.body.timestamp_granularities) {
          const granularities = Array.isArray(req.body.timestamp_granularities)
            ? req.body.timestamp_granularities
            : [req.body.timestamp_granularities];
          for (const g of granularities) {
            formData.append('timestamp_granularities[]', String(g));
          }
        }

        const headers: Record<string, string> = {};
        if (endpoint.apiKey) headers['Authorization'] = `Bearer ${endpoint.apiKey}`;
        if (endpoint.extraHeaders) {
          for (const [key, value] of Object.entries(endpoint.extraHeaders)) {
            const lowerKey = key.toLowerCase();
            if (lowerKey !== 'content-type' && lowerKey !== 'authorization') {
              headers[key] = value;
            }
          }
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), ASR_TIMEOUT_MS);
        const attemptStart = Date.now();

        try {
          const response = await fetch(url, {
            method: 'POST',
            headers,
            body: formData,
            signal: controller.signal,
          });

          clearTimeout(timeoutId);
          const latencyMs = Date.now() - attemptStart;

          if (!response.ok) {
            const errorText = await response.text();
            console.error(`[LLM-Error] ASR | user=${loginid} model=${model.name} url=${url} status=${response.status} error=${errorText.substring(0, 2000)}`);

            // 4xx는 즉시 반환 (재시도 안함)
            if (response.status >= 400 && response.status < 500) {
              try {
                const errorJson = JSON.parse(errorText);
                res.status(response.status).json(errorJson);
              } catch {
                res.status(response.status).send(errorText);
              }
              return;
            }

            console.error(`[Failover] ASR endpoint ${url} returned ${response.status}`);
            asrFailoverAttempts.push({
              endpoint: url,
              attempt: attempt + 1,
              statusCode: response.status,
              errorType: 'http_5xx',
              errorMessage: errorText.substring(0, 1000),
              latencyMs,
              modelName: model.name,
            });
            continue;
          }

          // 성공
          const responseText = await response.text();
          const latencyMsTotal = Date.now() - startTime;

          // Usage: Whisper 호환 API는 토큰 미반환 → 요청 건수 + latency로 추적
          recordUsage(user?.id || null, user?.loginid || null, model.id,
            0, 0, proxyReq.serviceId, proxyReq.deptName, latencyMsTotal, model.name, proxyReq.serviceName).catch(console.error);

          recordRequestLog({
            serviceId: proxyReq.serviceId, userId: user?.loginid, deptname: proxyReq.deptName,
            modelName, resolvedModel: model.name, method: 'POST', path: '/v1/audio/transcriptions',
            statusCode: 200, inputTokens: 0, outputTokens: 0, latencyMs: latencyMsTotal,
            userAgent, ipAddress, stream: false,
          }).catch(() => {});

          res.setHeader('Content-Type', 'application/json');
          res.status(200).send(responseText);
          return;

        } catch (error) {
          clearTimeout(timeoutId);
          const latencyMs = Date.now() - attemptStart;
          const isTimeout = error instanceof Error && error.name === 'AbortError';
          const errMsg = error instanceof Error ? error.message : 'Connection failed';
          console.error(`[Failover] ASR endpoint ${url} connection failed:`, errMsg);
          asrFailoverAttempts.push({
            endpoint: url,
            attempt: attempt + 1,
            statusCode: null,
            errorType: isTimeout ? 'timeout' : 'connection',
            errorMessage: isTimeout ? `Timeout after ${ASR_TIMEOUT_MS}ms` : errMsg,
            latencyMs,
            modelName: model.name,
          });
          continue;
        }
      }

      // 모든 시도 실패
      const label = isSingleEndpoint ? `after ${cfgRetries} retries` : `all ${endpoints.length} endpoints`;
      console.error(`[Failover] ${label} failed for ASR model "${model.name}"`);
      const asrPrimaryError = asrFailoverAttempts[0];
      const asrErrorTypeSummary = asrFailoverAttempts.map(a => a.errorType).join(', ');
      const asrSummaryMessage = `All endpoints failed (${asrErrorTypeSummary}): ${asrPrimaryError?.errorMessage || 'unknown'}`;
      recordRequestLog({ serviceId: proxyReq.serviceId, userId: user?.loginid, deptname: proxyReq.deptName, modelName, resolvedModel: model.name, method: 'POST', path: '/v1/audio/transcriptions', statusCode: 503, latencyMs: Date.now() - startTime, errorMessage: asrSummaryMessage.substring(0, 2000), errorDetails: { totalAttempts: asrFailoverAttempts.length, attempts: asrFailoverAttempts, timeoutMs: ASR_TIMEOUT_MS }, userAgent, ipAddress, stream: false }).catch(() => {});
      res.status(503).json({
        error: 'Service temporarily unavailable',
        message: `Failed ${label}. Please try again later.`,
      });

    } catch (error) {
      console.error('ASR transcription proxy error:', error);
      logErrorToRequestLog({ req, statusCode: 500, errorMessage: error instanceof Error ? error.message : 'Failed to process audio transcription request', serviceId: proxyReq.serviceId, deptname: proxyReq.deptName, path: '/v1/audio/transcriptions', latencyMs: Date.now() - startTime }).catch(() => {});
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to process audio transcription request' });
      }
    }
  },
);

// Multer 에러 핸들러 (파일 크기 초과 등)
proxyRoutes.use('/audio/transcriptions', ((err: any, _req: Request, res: Response, next: Function) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'Audio file too large. Maximum size is 500MB.' });
    return;
  }
  if (err && err.name === 'MulterError') {
    res.status(400).json({ error: err.message });
    return;
  }
  next(err);
}) as any);

// 모든 /v1/* 요청에 헤더 검증 미들웨어 적용 (위의 이미지 서빙, 오디오 전사 제외)
proxyRoutes.use(validateProxyHeaders as any);

// ============================================
// 라운드로빈 엔드포인트 선택
// ============================================

interface EndpointInfo {
  endpointUrl: string;
  apiKey: string | null;
  modelName: string;
  extraHeaders: Record<string, string> | null;
  extraBody: Record<string, any> | null;
}

// ============================================
// Failover 시도 상세 기록용 타입
// ============================================
interface FailoverAttempt {
  endpoint: string;         // 엔드포인트 URL (apiKey 마스킹)
  attempt: number;          // 시도 번호 (1-based)
  statusCode: number | null;// LLM 응답 코드 (timeout/connection 실패 시 null)
  errorType: 'timeout' | 'connection' | 'http_5xx' | 'http_4xx' | 'stream_error' | 'unknown';
  errorMessage: string;     // 에러 상세 (LLM 응답 바디 또는 에러 메시지)
  latencyMs: number;        // 이 시도의 소요 시간
  modelName: string;        // 실제 요청된 모델명
}

// 단일 엔드포인트 5xx retry 설정
// maxRetries는 ServiceModel.maxRetries에서 alias 그룹 단위로 설정 (기본 0)
const SINGLE_ENDPOINT_RETRY_DELAY_MS = 500; // 500ms → 1000ms → 1500ms (linear backoff)

async function getModelEndpoints(modelId: string, parentEndpoint: EndpointInfo): Promise<EndpointInfo[]> {
  const subModels = await prisma.subModel.findMany({
    where: { parentId: modelId, enabled: true },
    orderBy: { sortOrder: 'asc' },
    select: { endpointUrl: true, apiKey: true, modelName: true, extraHeaders: true, extraBody: true, weight: true },
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
      extraBody: s.extraBody as Record<string, any> | null,
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
 * 서비스에 등록된 alias 이름으로만 호출 가능. 전역 fallback 없음.
 */
type ResolvedModel = NonNullable<Awaited<ReturnType<typeof prisma.model.findFirst>>>;

async function resolveModelWithServiceRR(
  serviceId: string,
  modelName: string,
): Promise<
  | { found: true; model: ResolvedModel; fallbackModelId: string | null; maxRetries: number }
  | { found: false; model: null; fallbackModelId: null; maxRetries: number }
> {
  // aliasName으로 매칭하는 ServiceModel 조회 (유일한 경로)
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

  // alias 매칭 없음 → 모델 없음 (전역 fallback 없음)
  if (serviceModels.length === 0) {
    return { found: false, model: null, fallbackModelId: null, maxRetries: 0 };
  }

  // 그룹의 fallbackModelId (첫 번째 non-null 사용)
  const fallbackModelId = serviceModels.find(sm => sm.fallbackModelId)?.fallbackModelId || null;
  // 그룹의 maxRetries (첫 번째 값 사용, 기본 0)
  const maxRetries = serviceModels[0]?.maxRetries ?? 0;

  // 하나만 매칭 → 그대로 사용
  if (serviceModels.length === 1) {
    return { found: true, model: serviceModels[0]!.model, fallbackModelId, maxRetries };
  }

  // 여러 개 매칭 → weight 기반 라운드로빈
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
    return { found: true, model: selected, fallbackModelId, maxRetries };
  } catch (error) {
    console.error('[ServiceRR] Redis error, falling back to first model:', error);
    return { found: true, model: serviceModels[0]!.model, fallbackModelId, maxRetries };
  }
}

/**
 * Fallback 모델 resolve — 에러 시 fallbackModelId로 모델 조회
 */
async function resolveFallbackModel(fallbackModelId: string): Promise<ResolvedModel | null> {
  return prisma.model.findFirst({
    where: { id: fallbackModelId, enabled: true },
  });
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
 * 사용자 조회 또는 생성 + Knox 임직원 인증
 *
 * BACKGROUND 서비스: 인증 스킵
 * STANDARD 서비스:
 *   - DB에 있고 knoxVerified=true → DB deptname vs x-dept-name 비교 → 불일치 시 reject
 *   - DB에 있고 knoxVerified=false → Knox API 호출 → 인증+부서검증 → 마킹
 *   - DB에 없음 (최초) → Knox API 호출 → 인증+부서검증 → 생성+마킹
 */
// Knox 부서 정보 재검증 주기 (7일)
const KNOX_REVERIFY_TTL_SEC = 7 * 24 * 3600;

async function getOrCreateUser(
  proxyReq: ProxyAuthRequest,
  endpoint?: string,
): Promise<{ user: Awaited<ReturnType<typeof prisma.user.findUnique>> | null; error?: { status: number; body: Record<string, unknown> } }> {
  if (proxyReq.isBackground || !proxyReq.userLoginId) return { user: null };

  const loginid = proxyReq.userLoginId;
  const ipAddress = proxyReq.ip || (proxyReq.headers['x-forwarded-for'] as string) || undefined;

  // 0. 테스트 계정 체크 (서비스별, Knox 인증 우회)
  const testAccount = await prisma.testAccount.findUnique({
    where: { serviceId_loginid: { serviceId: proxyReq.serviceId, loginid } },
  });

  if (testAccount) {
    if (!testAccount.enabled) {
      return { user: null, error: { status: 403, body: { error: 'Test account disabled', message: `테스트 계정 '${loginid}'이(가) 비활성화되어 있습니다.` } } };
    }
    if (testAccount.expiresAt && testAccount.expiresAt < new Date()) {
      return { user: null, error: { status: 403, body: { error: 'Test account expired', message: `테스트 계정 '${loginid}'이(가) 만료되었습니다.` } } };
    }

    // 테스트 계정 부서 정보 세팅
    proxyReq.deptName = testAccount.deptname || '';
    proxyReq.teamName = proxyReq.deptName.match(/^([^(]+)/)?.[1]?.trim() || proxyReq.deptName;
    proxyReq.businessUnit = testAccount.businessUnit || extractBusinessUnit(proxyReq.deptName);
    proxyReq.userDeptCode = testAccount.departmentCode || '';

    // 배포 범위 접근 제어
    const scopeError = checkDeployScope(
      proxyReq.deployScope, proxyReq.deployScopeValue,
      proxyReq.userDeptCode, proxyReq.serviceName,
    );
    if (scopeError) {
      return { user: null, error: { status: 403, body: { error: 'Access denied', message: scopeError } } };
    }

    // 테스트 계정용 User upsert (사용량 추적용)
    const user = await prisma.user.upsert({
      where: { loginid },
      update: { lastActive: new Date() },
      create: {
        loginid,
        username: testAccount.username,
        deptname: testAccount.deptname,
        businessUnit: testAccount.businessUnit,
        departmentCode: testAccount.departmentCode,
        knoxVerified: false,
      },
    });
    return { user };
  }

  // 1. DB에서 사용자 조회
  const existingUser = await prisma.user.findUnique({ where: { loginid } });

  if (existingUser && existingUser.knoxVerified) {
    // ── 주기적 Knox 재검증: 부서 변경 자동 감지 + 조직도 갱신 ──
    // Redis TTL로 재검증 주기 관리 (기본 7일)
    let reverified = false;
    const reverifyKey = `knox:reverify:${loginid}`;
    const needsReverification = redis ? !(await redis.get(reverifyKey).catch(() => null)) : false;

    if (needsReverification) {
      const result = await verifyAndRegisterUser(loginid, '', 'PROXY', endpoint, ipAddress);

      if (result.success && result.user) {
        // ✅ 재검증 성공 → 부서 변경 시 DB 자동 업데이트됨 (verifyAndRegisterUser 내부 upsert)
        //    새 부서가 조직도에 없으면 discoverDepartment로 자동 등록
        proxyReq.deptName = result.user.deptname || '';
        proxyReq.teamName = proxyReq.deptName.match(/^([^(]+)/)?.[1]?.trim() || proxyReq.deptName;
        proxyReq.businessUnit = extractBusinessUnit(proxyReq.deptName);
        // 재검증 후 최신 departmentCode 조회
        const freshUser = await prisma.user.findUnique({ where: { id: result.user.id }, select: { departmentCode: true } });
        proxyReq.userDeptCode = freshUser?.departmentCode || '';
        reverified = true;
      } else if (!result.success) {
        // Knox 조회 실패: 퇴직/비활성 or API 오류
        // → 기존 인증 사용자는 즉시 차단하지 않고 경고 로그 (일시적 API 오류일 수 있음)
        console.warn(`[Knox Re-verify] Failed for ${loginid}: ${result.error}`);
      }
      // 재검증 타이머 리셋 (성공/실패 무관, 다음 주기에 재시도)
      if (redis) {
        redis.set(reverifyKey, '1', 'EX', KNOX_REVERIFY_TTL_SEC).catch(() => {});
      }
    }

    if (!reverified) {
      // 재검증 안 했거나 실패 → 기존 DB 부서 정보 사용
      proxyReq.deptName = existingUser.deptname || '';
      proxyReq.teamName = proxyReq.deptName.match(/^([^(]+)/)?.[1]?.trim() || proxyReq.deptName;
      proxyReq.businessUnit = existingUser.businessUnit || extractBusinessUnit(proxyReq.deptName);
      proxyReq.userDeptCode = existingUser.departmentCode || '';
    }

    // 배포 범위 접근 제어 (부서 확정 후)
    const scopeError = checkDeployScope(
      proxyReq.deployScope, proxyReq.deployScopeValue,
      proxyReq.userDeptCode, proxyReq.serviceName,
    );
    if (scopeError) {
      return { user: null, error: { status: 403, body: { error: 'Access denied', message: scopeError } } };
    }

    // lastActive 업데이트
    const user = await prisma.user.update({
      where: { id: existingUser.id },
      data: { lastActive: new Date() },
    });
    return { user };
  }

  // 2. 미인증 또는 최초 사용자 → Knox API 인증 (부서 자동 resolve)
  const result = await verifyAndRegisterUser(loginid, '', 'PROXY', endpoint, ipAddress);

  if (!result.success) {
    return {
      user: null,
      error: {
        status: 403,
        body: {
          error: 'Knox verification failed',
          message: result.error || '임직원 인증에 실패했습니다.',
        },
      },
    };
  }

  // Knox 인증 성공 → proxyReq에 부서 정보 세팅
  if (result.user) {
    proxyReq.deptName = result.user.deptname || '';
    proxyReq.teamName = proxyReq.deptName.match(/^([^(]+)/)?.[1]?.trim() || proxyReq.deptName;
    proxyReq.businessUnit = extractBusinessUnit(proxyReq.deptName);
    // 최초 인증된 사용자의 departmentCode 조회
    const newUser = await prisma.user.findUnique({ where: { id: result.user.id }, select: { departmentCode: true } });
    proxyReq.userDeptCode = newUser?.departmentCode || '';
  }

  // 배포 범위 접근 제어 (부서 확정 후)
  const scopeError = checkDeployScope(
    proxyReq.deployScope, proxyReq.deployScopeValue,
    proxyReq.userDeptCode, proxyReq.serviceName,
  );
  if (scopeError) {
    return { user: null, error: { status: 403, body: { error: 'Access denied', message: scopeError } } };
  }

  // Knox 인증 성공 → Redis 재검증 타이머 세팅
  if (redis) {
    redis.set(`knox:reverify:${loginid}`, '1', 'EX', KNOX_REVERIFY_TTL_SEC).catch(() => {});
  }

  const user = result.user ? await prisma.user.findUnique({ where: { id: result.user.id } }) : null;
  return { user };
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
  latencyMs?: number,
  modelName?: string,
  serviceName?: string
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

  console.log(`[Usage] user=${loginid || 'background'}, model=${modelName || modelId}, service=${serviceName || serviceId}, tokens=${totalTokens}, latency=${latencyMs || 'N/A'}ms`);
}

/**
 * RequestLog 저장 (요청 로그) — 메타데이터만 기록, 요청/응답 본문은 수집하지 않음
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
  errorDetails?: Record<string, unknown> | null;
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
        errorDetails: params.errorDetails ? JSON.parse(JSON.stringify(params.errorDetails)) : undefined,
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

    // 2) 서비스에 등록된 alias만 반환 (전역 fallback 없음)
    const aliasSet = new Set<string>();
    const result: { id: string; object: string; created: number; owned_by: string }[] = [];

    for (const sm of serviceModels) {
      if (aliasSet.has(sm.aliasName)) continue;
      aliasSet.add(sm.aliasName);
      result.push({
        id: sm.aliasName,
        object: 'model',
        created: Date.now(),
        owned_by: 'agent-registry',
      });
    }

    res.json({ object: 'list', data: result });
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

    // 서비스에 등록된 alias 이름으로만 조회
    const serviceModel = await prisma.serviceModel.findFirst({
      where: {
        serviceId: proxyReq.serviceId,
        aliasName: modelName,
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
    });

    if (!serviceModel) {
      res.status(404).json({
        error: `Model '${modelName}' not found. Use GET /v1/models to see available models for this service.`,
      });
      return;
    }

    res.json({
      id: serviceModel.aliasName,
      object: 'model',
      created: Date.now(),
      owned_by: 'agent-registry',
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

    // 모델 조회: 서비스 alias 기반 (전역 fallback 없음)
    const resolved = await resolveModelWithServiceRR(proxyReq.serviceId, modelName);
    if (!resolved.found || !resolved.model) {
      recordRequestLog({ serviceId: proxyReq.serviceId, deptname: proxyReq.deptName, modelName, method: 'POST', path: '/v1/chat/completions', statusCode: 404, latencyMs: Date.now() - reqStartTime, errorMessage: `Model '${modelName}' not found. Use a registered alias name from GET /v1/models`, userAgent, ipAddress }).catch(() => {});
      res.status(404).json({ error: `Model '${modelName}' not found. Use a registered alias name from GET /v1/models` });
      return;
    }
    const model = resolved.model;

    // ServiceModel 관계가 있으면 접근 허용 (visibility는 모델 할당 시 검증)

    // 사용자 upsert + Knox 인증 (background가 아닌 경우)
    const { user, error: knoxError } = await getOrCreateUser(proxyReq, '/v1/chat/completions');
    if (knoxError) {
      recordRequestLog({ serviceId: proxyReq.serviceId, deptname: proxyReq.deptName, modelName, resolvedModel: model.name, method: 'POST', path: '/v1/chat/completions', statusCode: knoxError.status, latencyMs: Date.now() - reqStartTime, errorMessage: (knoxError.body as Record<string, string>).message, userAgent, ipAddress, stream: stream || false }).catch(() => {});
      res.status(knoxError.status).json(knoxError.body);
      return;
    }

    // Rate limit 체크
    const rateLimitResult = await checkRateLimit(user, proxyReq.serviceId);
    if (rateLimitResult) {
      recordRequestLog({ serviceId: proxyReq.serviceId, userId: user?.loginid, deptname: proxyReq.deptName, modelName, resolvedModel: model.name, method: 'POST', path: '/v1/chat/completions', statusCode: rateLimitResult.status, latencyMs: Date.now() - reqStartTime, errorMessage: 'Rate limit exceeded', userAgent, ipAddress, stream: stream || false }).catch(() => {});
      res.status(rateLimitResult.status).json(rateLimitResult.body);
      return;
    }

    // 라운드로빈 + Failover
    const endpoints = await getModelEndpoints(model.id, {
      endpointUrl: model.endpointUrl,
      apiKey: model.apiKey,
      modelName: model.name,
      extraHeaders: model.extraHeaders as Record<string, string> | null,
      extraBody: model.extraBody as Record<string, any> | null,
    });
    const startIdx = await getRoundRobinIndex(model.id, endpoints.length);

    if (endpoints.length > 1) {
      console.log(`[RoundRobin] Model "${model.name}" has ${endpoints.length} endpoints (weighted), starting at index ${startIdx}`);
    }

    const isSingleEndpoint = endpoints.length === 1;
    const cfgRetries = resolved.maxRetries || 0;
    const maxAttempts = isSingleEndpoint ? (1 + cfgRetries) : endpoints.length;
    const failoverAttempts: FailoverAttempt[] = [];

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const idx = isSingleEndpoint ? 0 : (startIdx + attempt) % endpoints.length;
      const endpoint = endpoints[idx]!;

      if (attempt > 0) {
        if (isSingleEndpoint) {
          console.log(`[Retry] Model "${model.name}" retry ${attempt}/${cfgRetries}: ${endpoint.endpointUrl}`);
          await sleep(SINGLE_ENDPOINT_RETRY_DELAY_MS * attempt);
        } else {
          console.log(`[Failover] Model "${model.name}" trying endpoint ${attempt + 1}/${endpoints.length}: ${endpoint.endpointUrl}`);
        }
      }

      const llmRequestBody: Record<string, unknown> = {
        ...(endpoint.extraBody || {}),
        model: endpoint.modelName,
        messages,
        stream: stream || false,
        ...otherParams,
      };

      // 클라이언트가 max_tokens를 보내지 않으면 기본값 주입
      // (일부 LLM 백엔드가 미지정 시 전체 context window를 output에 할당하여 400 발생 방지)
      // 상한 32768: 에이전트 응답은 대부분 수천 토큰이므로 충분하며, 나머지를 입력 공간으로 확보
      if (!llmRequestBody.max_tokens && !llmRequestBody.max_completion_tokens && model.maxTokens) {
        const defaultMaxTokens = Math.min(Math.floor(model.maxTokens * 0.7), 32768);
        llmRequestBody.max_tokens = defaultMaxTokens;
        console.log(`[Proxy] Injected max_tokens=${defaultMaxTokens} (model context=${model.maxTokens})`);
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

      const effectiveModel = { ...model, endpointUrl: endpoint.endpointUrl, apiKey: endpoint.apiKey };

      let result: true | FailoverAttempt;
      if (stream) {
        result = await handleStreamingRequest(res, effectiveModel, llmRequestBody, headers, user, proxyReq);
      } else {
        result = await handleNonStreamingRequest(res, effectiveModel, llmRequestBody, headers, user, proxyReq);
      }

      if (result === true) return;
      // 실패: 시도 번호 설정 후 기록
      result.attempt = attempt + 1;
      failoverAttempts.push(result);
    }

    const label = isSingleEndpoint ? `after ${cfgRetries} retries` : `all ${endpoints.length} endpoints`;
    console.error(`[Failover] ${label} failed for model "${model.name}"`);

    // ── Fallback 모델 시도 ──
    if (resolved.fallbackModelId && resolved.fallbackModelId !== model.id) {
      const fbModel = await resolveFallbackModel(resolved.fallbackModelId);
      if (fbModel) {
        console.log(`[Fallback] Trying fallback model "${fbModel.displayName}" (${fbModel.id}) for alias "${modelName}"`);
        const fbEndpoints = await getModelEndpoints(fbModel.id, {
          endpointUrl: fbModel.endpointUrl,
          apiKey: fbModel.apiKey,
          modelName: fbModel.name,
          extraHeaders: fbModel.extraHeaders as Record<string, string> | null,
          extraBody: fbModel.extraBody as Record<string, any> | null,
        });
        const fbStartIdx = await getRoundRobinIndex(fbModel.id, fbEndpoints.length);

        for (let i = 0; i < fbEndpoints.length; i++) {
          const ep = fbEndpoints[(fbStartIdx + i) % fbEndpoints.length]!;
          const fbRequestBody: Record<string, unknown> = {
            ...(ep.extraBody || {}),
            model: ep.modelName,
            messages,
            stream: stream || false,
            ...otherParams,
          };
          // max_tokens 기본값 주입
          if (!fbRequestBody.max_tokens && !fbRequestBody.max_completion_tokens && fbModel.maxTokens) {
            fbRequestBody.max_tokens = Math.min(Math.floor(fbModel.maxTokens * 0.7), 32768);
          }
          const fbHeaders: Record<string, string> = { 'Content-Type': 'application/json', ...(ep.extraHeaders || {}) };
          if (ep.apiKey) fbHeaders['Authorization'] = `Bearer ${ep.apiKey}`;
          const fbEffective = { ...fbModel, endpointUrl: ep.endpointUrl, apiKey: ep.apiKey };

          let result: true | FailoverAttempt;
          if (stream) {
            result = await handleStreamingRequest(res, fbEffective, fbRequestBody, fbHeaders, user, proxyReq);
          } else {
            result = await handleNonStreamingRequest(res, fbEffective, fbRequestBody, fbHeaders, user, proxyReq);
          }
          if (result === true) {
            console.log(`[Fallback] Success with fallback model "${fbModel.displayName}"`);
            return;
          }
          result.attempt = maxAttempts + i + 1;
          failoverAttempts.push(result);
        }
        console.error(`[Fallback] Fallback model "${fbModel.displayName}" also failed`);
      }
    }

    // 실패 요약 메시지 생성
    const primaryError = failoverAttempts[0];
    const errorTypeSummary = failoverAttempts.map(a => a.errorType).join(', ');
    const summaryMessage = `All endpoints failed (${errorTypeSummary}): ${primaryError?.errorMessage || 'unknown'}`;

    recordRequestLog({ serviceId: proxyReq.serviceId, userId: user?.loginid, deptname: proxyReq.deptName, modelName, resolvedModel: model.name, method: 'POST', path: '/v1/chat/completions', statusCode: 503, latencyMs: Date.now() - reqStartTime, errorMessage: summaryMessage.substring(0, 2000), errorDetails: { totalAttempts: failoverAttempts.length, attempts: failoverAttempts, timeoutMs: REQUEST_TIMEOUT_MS }, userAgent, ipAddress, stream: stream || false }).catch(() => {});
    res.status(503).json({
      error: 'Service temporarily unavailable',
      message: `Failed ${label}. Please try again later.`,
      details: primaryError?.errorMessage || 'All endpoints failed',
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

const REQUEST_TIMEOUT_MS = 300000; // 5분

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

/**
 * Context window 에러에서 input_tokens, context_length를 파싱하여 적정 max_tokens 계산
 * 파싱 실패 시 null 반환 → max_tokens 제거 후 재시도 fallback
 */
function calcFittingMaxTokens(errorText: string): number | null {
  // "You passed 47176 input tokens and requested 110073 output tokens.
  //  However, the model's context length is only 157248 tokens"
  const inputMatch = errorText.match(/passed\s+(\d+)\s+input.?tokens/i);
  const contextMatch = errorText.match(/context.?length.+?(\d+)\s+tokens/i);
  if (inputMatch && contextMatch) {
    const inputTokens = parseInt(inputMatch[1]!, 10);
    const contextLength = parseInt(contextMatch[1]!, 10);
    const fitted = contextLength - inputTokens - 1; // 1토큰 여유
    return fitted > 0 ? fitted : null;
  }
  return null;
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
): Promise<true | FailoverAttempt> {
  const url = buildChatCompletionsUrl(model.endpointUrl);
  const loginid = user?.loginid || proxyReq.serviceName;
  console.log(`[Proxy] user=${loginid} model=${model.name} endpoint=${url} (non-streaming)`);

  const attemptStart = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST', headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - attemptStart;

      if (!response.ok) {
        const errorText = await response.text();
        logLLMError('Non-Streaming', url, response.status, errorText, requestBody, loginid, model, proxyReq.serviceId);

        // Context window 초과 재시도: 에러에서 적정 max_tokens 계산 후 재시도
        if (response.status === 400 && isContextWindowExceededError(errorText) && (requestBody.max_tokens || requestBody.max_completion_tokens)) {
          const { max_tokens: _mt, max_completion_tokens: _mct, ...bodyWithoutMaxTokens } = requestBody;
          const fittedMaxTokens = calcFittingMaxTokens(errorText);
          const retryBody = fittedMaxTokens
            ? { ...bodyWithoutMaxTokens, max_tokens: fittedMaxTokens }
            : bodyWithoutMaxTokens;
          if (fittedMaxTokens) {
            console.log(`[Proxy] Context window exceeded → retrying with max_tokens=${fittedMaxTokens} (was ${requestBody.max_tokens || requestBody.max_completion_tokens})`);
          }
          try {
            const retryController = new AbortController();
            const retryTimeoutId = setTimeout(() => retryController.abort(), REQUEST_TIMEOUT_MS);
            const retryResponse = await fetch(url, {
              method: 'POST', headers,
              body: JSON.stringify(retryBody),
              signal: retryController.signal,
            });
            clearTimeout(retryTimeoutId);
            const retryLatencyMs = Date.now() - attemptStart;

            if (retryResponse.ok) {
              const data = await retryResponse.json() as any;
              if (data.usage) {
                recordUsage(user?.id || null, user?.loginid || null, model.id,
                  data.usage.prompt_tokens || 0, data.usage.completion_tokens || 0,
                  proxyReq.serviceId, proxyReq.deptName, retryLatencyMs, model.name, proxyReq.serviceName).catch(console.error);
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

        const errorType = response.status >= 500 ? 'http_5xx' as const : 'http_4xx' as const;
        console.error(`[Failover] Endpoint ${url} returned ${response.status}`);
        return {
          endpoint: url,
          attempt: 0, // caller가 설정
          statusCode: response.status,
          errorType,
          errorMessage: errorText.substring(0, 1000),
          latencyMs,
          modelName: model.name,
        };
      }

      const data = await response.json() as any;
      if (data.usage) {
        recordUsage(user?.id || null, user?.loginid || null, model.id,
          data.usage.prompt_tokens || 0, data.usage.completion_tokens || 0,
          proxyReq.serviceId, proxyReq.deptName, latencyMs, model.name, proxyReq.serviceName).catch(console.error);
        recordRequestLog({
          serviceId: proxyReq.serviceId, userId: user?.loginid, deptname: proxyReq.deptName,
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
    const latencyMs = Date.now() - attemptStart;
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    const errMsg = error instanceof Error ? error.message : 'Connection failed';
    console.error(`[Failover] Endpoint ${url} connection failed:`, errMsg);
    return {
      endpoint: url,
      attempt: 0,
      statusCode: null,
      errorType: isTimeout ? 'timeout' : 'connection',
      errorMessage: isTimeout ? `Timeout after ${REQUEST_TIMEOUT_MS}ms` : errMsg,
      latencyMs,
      modelName: model.name,
    };
  }
}

async function handleStreamingRequest(
  res: Response,
  model: { id: string; name: string; endpointUrl: string; apiKey: string | null },
  requestBody: any,
  headers: Record<string, string>,
  user: { id: string; loginid: string } | null,
  proxyReq: ProxyAuthRequest
): Promise<true | FailoverAttempt> {
  const url = buildChatCompletionsUrl(model.endpointUrl);
  const loginid = user?.loginid || proxyReq.serviceName;
  console.log(`[Proxy] user=${loginid} model=${model.name} endpoint=${url} (streaming)`);

  const attemptStart = Date.now();
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
          const fittedMaxTokens = calcFittingMaxTokens(errorText);
          const retryBody = fittedMaxTokens
            ? { ...bodyWithoutMaxTokens, max_tokens: fittedMaxTokens, stream: true }
            : { ...bodyWithoutMaxTokens, stream: true };
          if (fittedMaxTokens) {
            console.log(`[Proxy] Context window exceeded → retrying stream with max_tokens=${fittedMaxTokens} (was ${requestBody.max_tokens || requestBody.max_completion_tokens})`);
          }
          response = await fetch(url, {
            method: 'POST', headers,
            body: JSON.stringify(retryBody),
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
        const fittedMaxTokens = calcFittingMaxTokens(errorText);
        const retryBody = fittedMaxTokens
          ? { ...bodyWithoutMaxTokens, max_tokens: fittedMaxTokens, stream: true }
          : { ...bodyWithoutMaxTokens, stream: true };
        if (fittedMaxTokens) {
          console.log(`[Proxy] Context window exceeded → retrying stream with max_tokens=${fittedMaxTokens} (was ${requestBody.max_tokens || requestBody.max_completion_tokens})`);
        }
        try {
          const retryController = new AbortController();
          const retryTimeoutId = setTimeout(() => retryController.abort(), REQUEST_TIMEOUT_MS);
          const retryResponse = await fetch(url, {
            method: 'POST', headers,
            body: JSON.stringify(retryBody),
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
        const errorType = response.status >= 500 ? 'http_5xx' as const : 'http_4xx' as const;
        console.error(`[Failover] Endpoint ${url} returned ${response.status}`);
        return {
          endpoint: url,
          attempt: 0,
          statusCode: response.status,
          errorType,
          errorMessage: errorText.substring(0, 1000),
          latencyMs: Date.now() - attemptStart,
          modelName: model.name,
        };
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

    const latencyMs = Date.now() - attemptStart;
    if (usageData) {
      recordUsage(user?.id || null, user?.loginid || null, model.id,
        usageData.prompt_tokens || 0, usageData.completion_tokens || 0,
        proxyReq.serviceId, proxyReq.deptName, latencyMs, model.name, proxyReq.serviceName).catch(console.error);
    }
    recordRequestLog({
      serviceId: proxyReq.serviceId, userId: user?.loginid, deptname: proxyReq.deptName,
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
    const latencyMs = Date.now() - attemptStart;
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    const errMsg = error instanceof Error ? error.message : 'Connection failed';
    console.error(`[Failover] Endpoint ${url} connection failed:`, errMsg);
    return {
      endpoint: url,
      attempt: 0,
      statusCode: null,
      errorType: isTimeout ? 'timeout' : 'connection',
      errorMessage: isTimeout ? `Timeout after ${REQUEST_TIMEOUT_MS}ms` : errMsg,
      latencyMs,
      modelName: model.name,
    };
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
      logErrorToRequestLog({ req, statusCode: 400, errorMessage: 'model and input are required', serviceId: proxyReq.serviceId, deptname: proxyReq.deptName, path: '/v1/embeddings' }).catch(() => {});
      res.status(400).json({ error: 'model and input are required' });
      return;
    }

    // 모델 조회: 서비스 alias 기반 (전역 fallback 없음)
    const resolved = await resolveModelWithServiceRR(proxyReq.serviceId, modelName);
    if (!resolved.found || !resolved.model) {
      logErrorToRequestLog({ req, statusCode: 404, errorMessage: `Model '${modelName}' not found. Use a registered alias name from GET /v1/models`, serviceId: proxyReq.serviceId, deptname: proxyReq.deptName, modelName, path: '/v1/embeddings' }).catch(() => {});
      res.status(404).json({ error: `Model '${modelName}' not found. Use a registered alias name from GET /v1/models` });
      return;
    }
    const model = resolved.model;

    const userAgent = (proxyReq as any).headers?.['user-agent'] || null;
    const ipAddress = (proxyReq as any).ip || null;

    // 사용자 upsert + Knox 인증
    const { user, error: knoxError } = await getOrCreateUser(proxyReq, '/v1/embeddings');
    if (knoxError) {
      recordRequestLog({ serviceId: proxyReq.serviceId, deptname: proxyReq.deptName, modelName, resolvedModel: model.name, method: 'POST', path: '/v1/embeddings', statusCode: knoxError.status, latencyMs: Date.now() - startTime, errorMessage: (knoxError.body as Record<string, string>).message, userAgent, ipAddress, stream: false }).catch(() => {});
      res.status(knoxError.status).json(knoxError.body);
      return;
    }

    // Rate limit 체크
    const rateLimitResult = await checkRateLimit(user, proxyReq.serviceId);
    if (rateLimitResult) {
      recordRequestLog({ serviceId: proxyReq.serviceId, userId: user?.loginid, deptname: proxyReq.deptName, modelName, resolvedModel: model.name, method: 'POST', path: '/v1/embeddings', statusCode: rateLimitResult.status, latencyMs: Date.now() - startTime, errorMessage: 'Rate limit exceeded', userAgent, ipAddress, stream: false }).catch(() => {});
      res.status(rateLimitResult.status).json(rateLimitResult.body);
      return;
    }

    // 라운드로빈 + Failover
    const endpoints = await getModelEndpoints(model.id, {
      endpointUrl: model.endpointUrl,
      apiKey: model.apiKey,
      modelName: model.name,
      extraHeaders: model.extraHeaders as Record<string, string> | null,
      extraBody: model.extraBody as Record<string, any> | null,
    });
    const startIdx = await getRoundRobinIndex(model.id, endpoints.length);

    const isSingleEndpoint = endpoints.length === 1;
    const cfgRetries = resolved.maxRetries || 0;
    const maxAttempts = isSingleEndpoint ? (1 + cfgRetries) : endpoints.length;
    const embFailoverAttempts: FailoverAttempt[] = [];

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const idx = isSingleEndpoint ? 0 : (startIdx + attempt) % endpoints.length;
      const endpoint = endpoints[idx]!;

      if (attempt > 0) {
        if (isSingleEndpoint) {
          console.log(`[Retry] Embeddings model "${model.name}" retry ${attempt}/${cfgRetries}`);
          await sleep(SINGLE_ENDPOINT_RETRY_DELAY_MS * attempt);
        } else {
          console.log(`[Failover] Embeddings model "${model.name}" trying endpoint ${attempt + 1}/${endpoints.length}: ${endpoint.endpointUrl}`);
        }
      }

      const url = buildEmbeddingsUrl(endpoint.endpointUrl);
      const loginid = user?.loginid || proxyReq.serviceName;
      console.log(`[Proxy] user=${loginid} model=${model.name} endpoint=${url} (embeddings)`);

      const embeddingsBody = {
        ...(endpoint.extraBody || {}),
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

      const attemptStart = Date.now();
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
            recordRequestLog({ serviceId: proxyReq.serviceId, userId: user?.loginid, deptname: proxyReq.deptName, modelName, resolvedModel: model.name, method: 'POST', path: '/v1/embeddings', statusCode: response.status, latencyMs, errorMessage: errorText.substring(0, 2000), userAgent, ipAddress, stream: false }).catch(() => {});
            try {
              const errorJson = JSON.parse(errorText);
              res.status(response.status).json(errorJson);
            } catch {
              res.status(response.status).send(errorText);
            }
            return;
          }

          console.error(`[Failover] Embeddings endpoint ${url} returned ${response.status}`);
          embFailoverAttempts.push({ endpoint: url, attempt: attempt + 1, statusCode: response.status, errorType: 'http_5xx', errorMessage: errorText.substring(0, 1000), latencyMs: Date.now() - attemptStart, modelName: model.name });
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
            inputTokens, 0, proxyReq.serviceId, proxyReq.deptName, latencyMs, model.name, proxyReq.serviceName).catch(console.error);
        }

        recordRequestLog({
          serviceId: proxyReq.serviceId, userId: user?.loginid, deptname: proxyReq.deptName,
          modelName: embeddingsBody.model, resolvedModel: model.name, method: 'POST', path: '/v1/embeddings',
          statusCode: 200, inputTokens, outputTokens: 0, latencyMs,
          userAgent, ipAddress, stream: false,
        }).catch(() => {});

        res.setHeader('Content-Type', 'application/json');
        res.status(200).send(responseText);
        return;

      } catch (error) {
        const attemptLatency = Date.now() - attemptStart;
        const isTimeout = error instanceof Error && error.name === 'AbortError';
        const errMsg = error instanceof Error ? error.message : 'Connection failed';
        console.error(`[Failover] Embeddings endpoint ${url} connection failed:`, errMsg);
        embFailoverAttempts.push({ endpoint: url, attempt: attempt + 1, statusCode: null, errorType: isTimeout ? 'timeout' : 'connection', errorMessage: isTimeout ? `Timeout after ${EMBEDDING_TIMEOUT_MS}ms` : errMsg, latencyMs: attemptLatency, modelName: model.name });
        continue;
      }
    }

    // 모든 시도 실패
    const label = isSingleEndpoint ? `after ${cfgRetries} retries` : `all ${endpoints.length} endpoints`;
    console.error(`[Failover] ${label} failed for embeddings model "${model.name}"`);
    const embPrimary = embFailoverAttempts[0];
    const embTypeSummary = embFailoverAttempts.map(a => a.errorType).join(', ');
    const embSummary = `All endpoints failed (${embTypeSummary}): ${embPrimary?.errorMessage || 'unknown'}`;
    recordRequestLog({ serviceId: proxyReq.serviceId, userId: user?.loginid, deptname: proxyReq.deptName, modelName, resolvedModel: model.name, method: 'POST', path: '/v1/embeddings', statusCode: 503, latencyMs: Date.now() - startTime, errorMessage: embSummary.substring(0, 2000), errorDetails: { totalAttempts: embFailoverAttempts.length, attempts: embFailoverAttempts, timeoutMs: EMBEDDING_TIMEOUT_MS }, userAgent, ipAddress, stream: false }).catch(() => {});
    res.status(503).json({
      error: 'Service temporarily unavailable',
      message: `Failed ${label}. Please try again later.`,
    });

  } catch (error) {
    console.error('Embeddings proxy error:', error);
    logErrorToRequestLog({ req, statusCode: 500, errorMessage: error instanceof Error ? error.message : 'Failed to process embeddings request', serviceId: proxyReq.serviceId, deptname: proxyReq.deptName, path: '/v1/embeddings', latencyMs: Date.now() - startTime }).catch(() => {});
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
      logErrorToRequestLog({ req, statusCode: 400, errorMessage: 'model is required', serviceId: proxyReq.serviceId, deptname: proxyReq.deptName, path: '/v1/rerank' }).catch(() => {});
      res.status(400).json({ error: 'model is required' });
      return;
    }
    if (!query || typeof query !== 'string') {
      logErrorToRequestLog({ req, statusCode: 400, errorMessage: 'query is required and must be a string', serviceId: proxyReq.serviceId, deptname: proxyReq.deptName, modelName, path: '/v1/rerank' }).catch(() => {});
      res.status(400).json({ error: 'query is required and must be a string' });
      return;
    }
    if (!documents || !Array.isArray(documents) || documents.length === 0) {
      logErrorToRequestLog({ req, statusCode: 400, errorMessage: 'documents is required and must be a non-empty array', serviceId: proxyReq.serviceId, deptname: proxyReq.deptName, modelName, path: '/v1/rerank' }).catch(() => {});
      res.status(400).json({ error: 'documents is required and must be a non-empty array' });
      return;
    }

    // 모델 조회: 서비스 alias 기반 (전역 fallback 없음)
    const resolved = await resolveModelWithServiceRR(proxyReq.serviceId, modelName);
    if (!resolved.found || !resolved.model) {
      logErrorToRequestLog({ req, statusCode: 404, errorMessage: `Model '${modelName}' not found. Use a registered alias name from GET /v1/models`, serviceId: proxyReq.serviceId, deptname: proxyReq.deptName, modelName, path: '/v1/rerank' }).catch(() => {});
      res.status(404).json({ error: `Model '${modelName}' not found. Use a registered alias name from GET /v1/models` });
      return;
    }
    const model = resolved.model;

    const rrUserAgent = (proxyReq as any).headers?.['user-agent'] || null;
    const rrIpAddress = (proxyReq as any).ip || null;

    // 사용자 upsert + Knox 인증
    const { user, error: knoxError } = await getOrCreateUser(proxyReq, '/v1/rerank');
    if (knoxError) {
      recordRequestLog({ serviceId: proxyReq.serviceId, deptname: proxyReq.deptName, modelName, resolvedModel: model.name, method: 'POST', path: '/v1/rerank', statusCode: knoxError.status, latencyMs: Date.now() - startTime, errorMessage: (knoxError.body as Record<string, string>).message, userAgent: rrUserAgent, ipAddress: rrIpAddress, stream: false }).catch(() => {});
      res.status(knoxError.status).json(knoxError.body);
      return;
    }

    // Rate limit 체크
    const rateLimitResult = await checkRateLimit(user, proxyReq.serviceId);
    if (rateLimitResult) {
      recordRequestLog({ serviceId: proxyReq.serviceId, userId: user?.loginid, deptname: proxyReq.deptName, modelName, resolvedModel: model.name, method: 'POST', path: '/v1/rerank', statusCode: rateLimitResult.status, latencyMs: Date.now() - startTime, errorMessage: 'Rate limit exceeded', userAgent: rrUserAgent, ipAddress: rrIpAddress, stream: false }).catch(() => {});
      res.status(rateLimitResult.status).json(rateLimitResult.body);
      return;
    }

    // 라운드로빈 + Failover
    const endpoints = await getModelEndpoints(model.id, {
      endpointUrl: model.endpointUrl,
      apiKey: model.apiKey,
      modelName: model.name,
      extraHeaders: model.extraHeaders as Record<string, string> | null,
      extraBody: model.extraBody as Record<string, any> | null,
    });
    const startIdx = await getRoundRobinIndex(model.id, endpoints.length);

    const isSingleEndpoint = endpoints.length === 1;
    const cfgRetries = resolved.maxRetries || 0;
    const maxAttempts = isSingleEndpoint ? (1 + cfgRetries) : endpoints.length;
    const rrFailoverAttempts: FailoverAttempt[] = [];

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const idx = isSingleEndpoint ? 0 : (startIdx + attempt) % endpoints.length;
      const endpoint = endpoints[idx]!;

      if (attempt > 0) {
        if (isSingleEndpoint) {
          console.log(`[Retry] Rerank model "${model.name}" retry ${attempt}/${cfgRetries}`);
          await sleep(SINGLE_ENDPOINT_RETRY_DELAY_MS * attempt);
        } else {
          console.log(`[Failover] Rerank model "${model.name}" trying endpoint ${attempt + 1}/${endpoints.length}: ${endpoint.endpointUrl}`);
        }
      }

      const url = buildRerankUrl(endpoint.endpointUrl);
      const loginid = user?.loginid || proxyReq.serviceName;
      console.log(`[Proxy] user=${loginid} model=${model.name} endpoint=${url} (rerank)`);

      const rerankBody: Record<string, unknown> = {
        ...(endpoint.extraBody || {}),
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

      const attemptStart = Date.now();
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
            recordRequestLog({ serviceId: proxyReq.serviceId, userId: user?.loginid, deptname: proxyReq.deptName, modelName, resolvedModel: model.name, method: 'POST', path: '/v1/rerank', statusCode: response.status, latencyMs, errorMessage: errorText.substring(0, 2000), userAgent: rrUserAgent, ipAddress: rrIpAddress, stream: false }).catch(() => {});
            try {
              const errorJson = JSON.parse(errorText);
              res.status(response.status).json(errorJson);
            } catch {
              res.status(response.status).send(errorText);
            }
            return;
          }

          console.error(`[Failover] Rerank endpoint ${url} returned ${response.status}`);
          rrFailoverAttempts.push({ endpoint: url, attempt: attempt + 1, statusCode: response.status, errorType: 'http_5xx', errorMessage: errorText.substring(0, 1000), latencyMs: Date.now() - attemptStart, modelName: model.name });
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
            inputTokens, 0, proxyReq.serviceId, proxyReq.deptName, latencyMs, model.name, proxyReq.serviceName).catch(console.error);
        }

        recordRequestLog({
          serviceId: proxyReq.serviceId, userId: user?.loginid, deptname: proxyReq.deptName,
          modelName: rerankBody.model as string, resolvedModel: model.name, method: 'POST', path: '/v1/rerank',
          statusCode: 200, inputTokens, outputTokens: 0, latencyMs,
          userAgent: rrUserAgent, ipAddress: rrIpAddress, stream: false,
        }).catch(() => {});

        res.setHeader('Content-Type', 'application/json');
        res.status(200).send(responseText);
        return;

      } catch (error) {
        const attemptLatency = Date.now() - attemptStart;
        const isTimeout = error instanceof Error && error.name === 'AbortError';
        const errMsg = error instanceof Error ? error.message : 'Connection failed';
        console.error(`[Failover] Rerank endpoint ${url} connection failed:`, errMsg);
        rrFailoverAttempts.push({ endpoint: url, attempt: attempt + 1, statusCode: null, errorType: isTimeout ? 'timeout' : 'connection', errorMessage: isTimeout ? `Timeout after ${REQUEST_TIMEOUT_MS}ms` : errMsg, latencyMs: attemptLatency, modelName: model.name });
        continue;
      }
    }

    // 모든 시도 실패
    const label = isSingleEndpoint ? `after ${cfgRetries} retries` : `all ${endpoints.length} endpoints`;
    console.error(`[Failover] ${label} failed for rerank model "${model.name}"`);
    const rrPrimary = rrFailoverAttempts[0];
    const rrTypeSummary = rrFailoverAttempts.map(a => a.errorType).join(', ');
    const rrSummary = `All endpoints failed (${rrTypeSummary}): ${rrPrimary?.errorMessage || 'unknown'}`;
    recordRequestLog({ serviceId: proxyReq.serviceId, userId: user?.loginid, deptname: proxyReq.deptName, modelName, resolvedModel: model.name, method: 'POST', path: '/v1/rerank', statusCode: 503, latencyMs: Date.now() - startTime, errorMessage: rrSummary.substring(0, 2000), errorDetails: { totalAttempts: rrFailoverAttempts.length, attempts: rrFailoverAttempts, timeoutMs: REQUEST_TIMEOUT_MS }, userAgent: rrUserAgent, ipAddress: rrIpAddress, stream: false }).catch(() => {});
    res.status(503).json({
      error: 'Service temporarily unavailable',
      message: `Failed ${label}. Please try again later.`,
    });

  } catch (error) {
    console.error('Rerank proxy error:', error);
    logErrorToRequestLog({ req, statusCode: 500, errorMessage: error instanceof Error ? error.message : 'Failed to process rerank request', serviceId: proxyReq.serviceId, deptname: proxyReq.deptName, path: '/v1/rerank', latencyMs: Date.now() - startTime }).catch(() => {});
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
      logErrorToRequestLog({ req, statusCode: 400, errorMessage: 'model and prompt are required', serviceId: proxyReq.serviceId, deptname: proxyReq.deptName, path: '/v1/images/generations' }).catch(() => {});
      res.status(400).json({ error: 'model and prompt are required' });
      return;
    }

    // 모델 조회: 서비스 alias 기반 (전역 fallback 없음)
    const resolved = await resolveModelWithServiceRR(proxyReq.serviceId, modelName);
    if (!resolved.found || !resolved.model) {
      logErrorToRequestLog({ req, statusCode: 404, errorMessage: `Model '${modelName}' not found. Use a registered alias name from GET /v1/models`, serviceId: proxyReq.serviceId, deptname: proxyReq.deptName, modelName, path: '/v1/images/generations' }).catch(() => {});
      res.status(404).json({ error: `Model '${modelName}' not found. Use a registered alias name from GET /v1/models` });
      return;
    }
    const model = resolved.model;

    if (model.type !== 'IMAGE') {
      logErrorToRequestLog({ req, statusCode: 400, errorMessage: `Model '${modelName}' is not an IMAGE model`, serviceId: proxyReq.serviceId, deptname: proxyReq.deptName, modelName, path: '/v1/images/generations' }).catch(() => {});
      res.status(400).json({ error: `Model '${modelName}' is not an IMAGE model` });
      return;
    }

    const imgUserAgent = (proxyReq as any).headers?.['user-agent'] || null;
    const imgIpAddress = (proxyReq as any).ip || null;

    // 사용자 upsert + Knox 인증
    const { user, error: knoxError } = await getOrCreateUser(proxyReq, '/v1/images/generations');
    if (knoxError) {
      recordRequestLog({ serviceId: proxyReq.serviceId, deptname: proxyReq.deptName, modelName, resolvedModel: model.name, method: 'POST', path: '/v1/images/generations', statusCode: knoxError.status, latencyMs: Date.now() - startTime, errorMessage: (knoxError.body as Record<string, string>).message, userAgent: imgUserAgent, ipAddress: imgIpAddress, stream: false }).catch(() => {});
      res.status(knoxError.status).json(knoxError.body);
      return;
    }

    // Rate limit 체크
    const rateLimitResult = await checkRateLimit(user, proxyReq.serviceId);
    if (rateLimitResult) {
      recordRequestLog({ serviceId: proxyReq.serviceId, userId: user?.loginid, deptname: proxyReq.deptName, modelName, resolvedModel: model.name, method: 'POST', path: '/v1/images/generations', statusCode: rateLimitResult.status, latencyMs: Date.now() - startTime, errorMessage: 'Rate limit exceeded', userAgent: imgUserAgent, ipAddress: imgIpAddress, stream: false }).catch(() => {});
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
      extraBody: model.extraBody as Record<string, any> | null,
    });
    const startIdx = await getRoundRobinIndex(model.id, endpoints.length);

    const isSingleEndpoint = endpoints.length === 1;
    const cfgRetries = resolved.maxRetries || 0;
    const maxAttempts = isSingleEndpoint ? (1 + cfgRetries) : endpoints.length;
    const imgFailoverAttempts: FailoverAttempt[] = [];

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const idx = isSingleEndpoint ? 0 : (startIdx + attempt) % endpoints.length;
      const endpoint = endpoints[idx]!;

      if (attempt > 0) {
        if (isSingleEndpoint) {
          console.log(`[Retry] Image model "${model.name}" retry ${attempt}/${cfgRetries}`);
          await sleep(SINGLE_ENDPOINT_RETRY_DELAY_MS * attempt);
        } else {
          console.log(`[Failover] Image model "${model.name}" trying endpoint ${attempt + 1}/${endpoints.length}: ${endpoint.endpointUrl}`);
        }
      }

      const provider = model.imageProvider || 'OPENAI';
      const loginid = user?.loginid || proxyReq.serviceName;
      console.log(`[Proxy] user=${loginid} model=${model.name} endpoint=${endpoint.endpointUrl} (image/${provider})`);

      const attemptStart = Date.now();
      try {
        const providerResults = await generateImages(provider, {
          endpointUrl: endpoint.endpointUrl,
          apiKey: endpoint.apiKey,
          modelName: endpoint.modelName,
          extraHeaders: endpoint.extraHeaders,
          extraBody: endpoint.extraBody,
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
          0, 0, proxyReq.serviceId, proxyReq.deptName, latencyMs, model.name, proxyReq.serviceName).catch(console.error);

        recordRequestLog({
          serviceId: proxyReq.serviceId, userId: user?.loginid, deptname: proxyReq.deptName,
          modelName, resolvedModel: model.name, method: 'POST', path: '/v1/images/generations',
          statusCode: 200, inputTokens: 0, outputTokens: 0, latencyMs,
          userAgent: imgUserAgent, ipAddress: imgIpAddress, stream: false,
        }).catch(() => {});

        return;

      } catch (fetchError: any) {
        const attemptLatency = Date.now() - attemptStart;
        const errMsg = fetchError.message || 'Unknown error';
        const isTimeout = fetchError.name === 'AbortError';
        console.error(`[ImageProxy] Provider ${model.imageProvider || 'OPENAI'} failed for ${endpoint.endpointUrl}: ${errMsg}`);
        imgFailoverAttempts.push({ endpoint: endpoint.endpointUrl, attempt: attempt + 1, statusCode: null, errorType: isTimeout ? 'timeout' : 'connection', errorMessage: errMsg.substring(0, 1000), latencyMs: attemptLatency, modelName: model.name });
        continue;
      }
    }

    // 모든 엔드포인트 실패
    const label = isSingleEndpoint
      ? `after ${cfgRetries} retries`
      : `all ${endpoints.length} endpoints`;
    const imgPrimary = imgFailoverAttempts[0];
    const imgTypeSummary = imgFailoverAttempts.map(a => a.errorType).join(', ');
    const imgSummary = `All endpoints failed (${imgTypeSummary}): ${imgPrimary?.errorMessage || 'unknown'}`;
    recordRequestLog({ serviceId: proxyReq.serviceId, userId: user?.loginid, deptname: proxyReq.deptName, modelName, resolvedModel: model.name, method: 'POST', path: '/v1/images/generations', statusCode: 503, latencyMs: Date.now() - startTime, errorMessage: imgSummary.substring(0, 2000), errorDetails: { totalAttempts: imgFailoverAttempts.length, attempts: imgFailoverAttempts, timeoutMs: REQUEST_TIMEOUT_MS }, userAgent: imgUserAgent, ipAddress: imgIpAddress, stream: false }).catch(() => {});
    res.status(503).json({
      error: 'Service temporarily unavailable',
      message: `Failed ${label}. Last error: ${imgPrimary?.errorMessage || 'unknown'}`,
    });

  } catch (error) {
    console.error('Image generation proxy error:', error);
    logErrorToRequestLog({ req, statusCode: 500, errorMessage: error instanceof Error ? error.message : 'Failed to process image generation request', serviceId: proxyReq.serviceId, deptname: proxyReq.deptName, path: '/v1/images/generations', latencyMs: Date.now() - startTime }).catch(() => {});
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
