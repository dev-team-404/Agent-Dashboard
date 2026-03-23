/**
 * Error Logs Routes (슈퍼 관리자 전용)
 *
 * - GET  /admin/error-logs         — non-200 요청 로그 조회 (룰 기반 원인 태그 포함)
 * - POST /admin/error-logs/:id/analyze — 선택한 LLM으로 에러 원인 분석
 */

import { Router, RequestHandler } from 'express';
import { prisma } from '../index.js';
import { authenticateToken, requireSuperAdmin, AuthenticatedRequest } from '../middleware/auth.js';

export const errorLogsRoutes = Router();
errorLogsRoutes.use(authenticateToken);
errorLogsRoutes.use(requireSuperAdmin as RequestHandler);

// ============================================
// 룰 기반 에러 원인 매핑
// ============================================
const ERROR_RULES: Array<{ pattern: string; cause: string; category: string }> = [
  // 401 - 헤더 누락
  { pattern: 'x-service-id header is required', cause: 'x-service-id 헤더를 포함시키지 않았습니다', category: '헤더 누락' },
  { pattern: 'x-dept-name header is required', cause: 'x-dept-name 헤더를 포함시키지 않았습니다', category: '헤더 누락' },
  { pattern: 'x-user-id header is required', cause: 'STANDARD 서비스에서 x-user-id 헤더를 포함시키지 않았습니다', category: '헤더 누락' },
  // 403 - 인증/권한
  { pattern: 'is not registered', cause: '등록되지 않은 서비스 ID를 사용했습니다', category: '서비스 오류' },
  { pattern: 'is disabled', cause: '비활성화된 서비스를 호출했습니다', category: '서비스 오류' },
  { pattern: 'Department mismatch', cause: '부서 정보가 등록된 정보와 다릅니다', category: '인증 오류' },
  { pattern: 'Knox verification failed', cause: 'Knox 임직원 인증에 실패했습니다', category: '인증 오류' },
  { pattern: 'restricted to specific business units', cause: '해당 사업부에 공개되지 않은 서비스입니다', category: '접근 제한' },
  { pattern: 'restricted to specific teams', cause: '해당 팀에 공개되지 않은 서비스입니다', category: '접근 제한' },
  // 404 - Not Found
  { pattern: 'not found', cause: '존재하지 않는 모델 또는 서비스입니다', category: '모델/서비스 오류' },
  { pattern: 'Use a registered alias', cause: '등록되지 않은 모델 alias를 사용했습니다', category: '모델/서비스 오류' },
  // 429 - Rate Limit
  { pattern: 'Rate limit exceeded', cause: '토큰 사용량 한도를 초과했습니다', category: 'Rate Limit' },
  { pattern: 'Token rate limit', cause: '토큰 사용량 한도를 초과했습니다', category: 'Rate Limit' },
  // 400 - Bad Request
  { pattern: 'model and messages are required', cause: 'model 또는 messages 필드가 누락되었습니다', category: '요청 오류' },
  { pattern: 'model is required', cause: 'model 필드가 누락되었습니다', category: '요청 오류' },
  { pattern: 'model and input are required', cause: 'model 또는 input 필드가 누락되었습니다', category: '요청 오류' },
  { pattern: 'context_length_exceeded', cause: '입력이 모델의 최대 컨텍스트 길이를 초과했습니다', category: '요청 오류' },
  { pattern: 'is not an IMAGE model', cause: 'IMAGE 타입이 아닌 모델로 이미지 생성을 시도했습니다', category: '모델/서비스 오류' },
  { pattern: 'audio file is required', cause: '오디오 파일이 첨부되지 않았습니다', category: '요청 오류' },
  // 502/503 - Upstream
  { pattern: 'Service temporarily unavailable', cause: 'LLM 엔드포인트에 연결할 수 없습니다', category: 'LLM 장애' },
  { pattern: 'Connection failed', cause: 'LLM 엔드포인트 연결에 실패했습니다', category: 'LLM 장애' },
  { pattern: 'Timed out', cause: 'LLM 응답 시간이 초과되었습니다', category: 'LLM 장애' },
  { pattern: 'LLM request failed', cause: 'LLM 요청이 실패했습니다', category: 'LLM 장애' },
];

function matchErrorCause(errorMessage: string | null): { cause: string; category: string } | null {
  if (!errorMessage) return null;
  const lower = errorMessage.toLowerCase();
  for (const rule of ERROR_RULES) {
    if (lower.includes(rule.pattern.toLowerCase())) {
      return { cause: rule.cause, category: rule.category };
    }
  }
  return null;
}

/** 카테고리에 해당하는 에러 패턴들의 DB ILIKE 조건 생성 */
function getCategoryDbFilter(cat: string): Record<string, unknown> | null {
  if (cat === '미분류') {
    // 모든 룰 패턴에 매칭되지 않는 것 = AND NOT (ILIKE pattern1 OR ILIKE pattern2 ...)
    return {
      AND: ERROR_RULES.map(r => ({
        errorMessage: { not: { contains: r.pattern, mode: 'insensitive' as const } },
      })),
    };
  }
  const patterns = ERROR_RULES.filter(r => r.category === cat).map(r => r.pattern);
  if (patterns.length === 0) return null;
  return {
    OR: patterns.map(p => ({
      errorMessage: { contains: p, mode: 'insensitive' as const },
    })),
  };
}

// ============================================
// GET /admin/error-logs
// ============================================
errorLogsRoutes.get('/error-logs', (async (req: AuthenticatedRequest, res) => {
  try {
    const page = Math.max(1, parseInt(req.query['page'] as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query['limit'] as string) || 50));
    const skip = (page - 1) * limit;

    const statusCode = req.query['statusCode'] as string | undefined;
    const category = req.query['category'] as string | undefined;
    const serviceId = req.query['serviceId'] as string | undefined;
    const userId = req.query['userId'] as string | undefined;
    const startDate = req.query['startDate'] as string | undefined;
    const endDate = req.query['endDate'] as string | undefined;

    const where: Record<string, unknown> = {
      statusCode: { not: 200 },
    };

    if (statusCode) {
      const codes = statusCode.split(',').map(c => parseInt(c.trim())).filter(c => !isNaN(c));
      if (codes.length === 1) {
        where.statusCode = codes[0];
      } else if (codes.length > 1) {
        where.statusCode = { in: codes };
      }
    }
    if (serviceId) where.serviceId = serviceId;
    if (userId) where.userId = { contains: userId, mode: 'insensitive' };

    if (startDate || endDate) {
      const ts: Record<string, Date> = {};
      if (startDate) ts.gte = new Date(startDate);
      if (endDate) ts.lte = new Date(endDate + 'T23:59:59.999Z');
      where.timestamp = ts;
    }

    // 카테고리 필터를 DB 레벨로 적용 (정확한 pagination)
    if (category) {
      const catFilter = getCategoryDbFilter(category);
      if (catFilter) Object.assign(where, catFilter);
    }

    const [logs, total] = await Promise.all([
      prisma.requestLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          serviceId: true,
          userId: true,
          deptname: true,
          modelName: true,
          resolvedModel: true,
          method: true,
          path: true,
          statusCode: true,
          errorMessage: true,
          errorDetails: true,
          inputTokens: true,
          outputTokens: true,
          latencyMs: true,
          userAgent: true,
          ipAddress: true,
          stream: true,
          timestamp: true,
          service: { select: { name: true, displayName: true } },
        },
      }),
      prisma.requestLog.count({ where }),
    ]);

    // 룰 기반 원인 매핑
    const enriched = logs.map(log => {
      const matched = matchErrorCause(log.errorMessage);
      return {
        ...log,
        ruleCause: matched?.cause || null,
        ruleCategory: matched?.category || null,
        isAnalyzable: !matched,
      };
    });

    res.json({
      logs: enriched,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      categories: [
        '헤더 누락', '서비스 오류', '인증 오류', '접근 제한',
        '모델/서비스 오류', 'Rate Limit', '요청 오류', 'LLM 장애', '미분류',
      ],
    });
  } catch (error) {
    console.error('Get error logs error:', error);
    res.status(500).json({ error: 'Failed to get error logs' });
  }
}) as RequestHandler);

// ============================================
// POST /admin/error-logs/:id/analyze
// 선택한 LLM에 에러 컨텍스트 전송 → 원인 분석 JSON 응답
// ============================================
errorLogsRoutes.post('/error-logs/:id/analyze', (async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { modelId } = req.body;

    if (!modelId) {
      res.status(400).json({ error: 'modelId is required' });
      return;
    }

    // 1. 에러 로그 조회
    const errorLog = await prisma.requestLog.findUnique({
      where: { id },
      select: {
        id: true, serviceId: true, userId: true, deptname: true,
        modelName: true, resolvedModel: true, method: true, path: true,
        statusCode: true, errorMessage: true, errorDetails: true,
        latencyMs: true, userAgent: true, ipAddress: true, stream: true, timestamp: true,
        service: { select: { name: true, displayName: true, type: true } },
      },
    });

    if (!errorLog) {
      res.status(404).json({ error: 'Error log not found' });
      return;
    }

    // 1-b. 전후 context: 같은 사용자/서비스의 ±5분 이내 요청 로그 (최대 10건)
    const contextWindow = 5 * 60 * 1000; // 5분
    const contextLogs = await prisma.requestLog.findMany({
      where: {
        id: { not: errorLog.id },
        timestamp: {
          gte: new Date(errorLog.timestamp.getTime() - contextWindow),
          lte: new Date(errorLog.timestamp.getTime() + contextWindow),
        },
        ...(errorLog.userId ? { userId: errorLog.userId } : { serviceId: errorLog.serviceId }),
      },
      orderBy: { timestamp: 'asc' },
      take: 10,
      select: {
        timestamp: true, statusCode: true, modelName: true, path: true,
        latencyMs: true, errorMessage: true, stream: true,
      },
    });

    // 1-c. 같은 모델의 최근 에러 패턴 (최근 1시간, 최대 5건)
    const recentSimilarErrors = await prisma.requestLog.findMany({
      where: {
        id: { not: errorLog.id },
        modelName: errorLog.modelName,
        statusCode: { not: 200 },
        timestamp: {
          gte: new Date(errorLog.timestamp.getTime() - 60 * 60 * 1000),
          lte: errorLog.timestamp,
        },
      },
      orderBy: { timestamp: 'desc' },
      take: 5,
      select: {
        timestamp: true, statusCode: true, errorMessage: true, latencyMs: true, userId: true,
      },
    });

    // 1-d. 모델 설정 정보 (엔드포인트 수, failover 구성 확인용)
    const modelConfig = errorLog.resolvedModel ? await prisma.model.findFirst({
      where: { name: errorLog.resolvedModel },
      select: {
        name: true, displayName: true, type: true, endpointUrl: true,
        maxTokens: true,
        subModels: { where: { enabled: true }, select: { endpointUrl: true, modelName: true, weight: true } },
      },
    }) : null;

    // 2. 분석용 LLM 모델 조회
    const model = await prisma.model.findUnique({
      where: { id: modelId },
      select: { id: true, name: true, displayName: true, endpointUrl: true, apiKey: true, extraHeaders: true, type: true },
    });

    if (!model) {
      res.status(404).json({ error: 'Model not found' });
      return;
    }

    if (model.type !== 'CHAT') {
      res.status(400).json({ error: 'Only CHAT type models can be used for analysis' });
      return;
    }

    // 3. 분석 프롬프트 구성

    const errorContext = {
      timestamp: errorLog.timestamp,
      method: errorLog.method,
      path: errorLog.path,
      statusCode: errorLog.statusCode,
      errorMessage: errorLog.errorMessage,
      errorDetails: errorLog.errorDetails || null,
      modelName: errorLog.modelName,
      resolvedModel: errorLog.resolvedModel,
      service: errorLog.service ? { name: errorLog.service.name, displayName: errorLog.service.displayName, type: errorLog.service.type } : null,
      userId: errorLog.userId,
      deptname: errorLog.deptname,
      userAgent: errorLog.userAgent,
      latencyMs: errorLog.latencyMs,
      stream: errorLog.stream,
    };

    // 모델 구성 정보 (엔드포인트, sub-model 수, timeout 등)
    const modelInfo = modelConfig ? {
      displayName: modelConfig.displayName,
      type: modelConfig.type,
      endpointUrl: modelConfig.endpointUrl,
      maxTokens: modelConfig.maxTokens,
      subModelCount: modelConfig.subModels.length,
      subModels: modelConfig.subModels.map(s => ({ endpoint: s.endpointUrl, model: s.modelName, weight: s.weight })),
    } : null;

    const systemPrompt = `You are an expert API error analysis assistant for an LLM proxy system called "Agent Registry".

## System Architecture
This is an LLM proxy that routes requests to various LLM endpoints (OpenAI-compatible).
- Requests flow: Client → Proxy (header auth: x-service-id, x-user-id, x-dept-name) → LLM Endpoint
- Models can have multiple sub-endpoints with round-robin load balancing and failover
- On failure, the system tries each endpoint in order, then optionally a fallback model
- Chat requests timeout after 120 seconds (REQUEST_TIMEOUT_MS)
- ASR (audio) requests timeout after 600 seconds (ASR_TIMEOUT_MS)
- Streaming uses SSE (Server-Sent Events)

## Error Types to Diagnose
- **timeout**: Request exceeded timeout limit — could be slow LLM, large input, or network issue
- **connection**: TCP/DNS level failure — endpoint down, unreachable, or misconfigured URL
- **http_5xx**: LLM returned 500/502/503 — backend overloaded, model not loaded, GPU OOM
- **http_4xx**: Client-side error — bad request format, context length exceeded, invalid model
- **stream_error**: SSE stream started but broke mid-stream — connection dropped, backend crash

## Analysis Guidelines
- If errorDetails.attempts exists, analyze EACH attempt individually to find patterns
- If all attempts show timeout, focus on whether input was too large or LLM is genuinely slow
- If all attempts show connection errors, the endpoint URL is likely wrong or the service is down
- If mixed error types, the root cause may be different per endpoint
- Compare latencyMs with the timeout to determine if it was a genuine timeout
- Check if similar errors occurred recently (recentSimilarErrors) — indicates ongoing outage vs one-off

IMPORTANT: Respond ONLY with a valid JSON object (no markdown, no code blocks). Use this exact schema:
{
  "severity": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "cause": "Root cause in Korean (1-2 sentences)",
  "detail": "Detailed explanation in Korean (3-6 sentences covering each attempt if applicable)",
  "suggestion": "Recommended fix in Korean (1-3 sentences with specific actions)",
  "category": "One of: 클라이언트 오류, 인증/권한 오류, 모델 설정 오류, LLM 엔드포인트 장애, Rate Limit, 시스템 오류, 네트워크 장애, Timeout, 기타",
  "errorPattern": "One of: isolated(일회성), recurring(반복 발생), outage(서비스 장애)"
}`;

    const userPromptParts = [
      `## Error Log\n${JSON.stringify(errorContext, null, 2)}`,
    ];

    if (modelInfo) {
      userPromptParts.push(`\n## Model Configuration\n${JSON.stringify(modelInfo, null, 2)}`);
    }

    if (contextLogs.length > 0) {
      userPromptParts.push(`\n## Surrounding Requests (±5min, same user/service)\n${JSON.stringify(contextLogs, null, 2)}`);
    }

    if (recentSimilarErrors.length > 0) {
      userPromptParts.push(`\n## Recent Similar Errors (same model, last 1 hour)\n${JSON.stringify(recentSimilarErrors, null, 2)}`);
    }

    const userPrompt = userPromptParts.join('\n');

    // 4. LLM 호출
    let url = model.endpointUrl.trim().replace(/\/+$/, '');
    if (url.endsWith('/chat/completions')) { /* already correct */ }
    else if (url.endsWith('/completions')) { url = url.replace(/\/completions$/, '/chat/completions'); }
    else if (url.endsWith('/v1')) { url = `${url}/chat/completions`; }
    else { url = `${url}/chat/completions`; }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (model.apiKey) {
      headers['Authorization'] = `Bearer ${model.apiKey}`;
    }
    if (model.extraHeaders && typeof model.extraHeaders === 'object') {
      Object.assign(headers, model.extraHeaders);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const llmResponse = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: model.name,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.1,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!llmResponse.ok) {
        const errText = await llmResponse.text().catch(() => '');
        res.status(502).json({
          error: 'LLM analysis failed',
          detail: `LLM returned ${llmResponse.status}: ${errText.substring(0, 500)}`,
        });
        return;
      }

      const llmData = await llmResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = llmData.choices?.[0]?.message?.content;

      if (!content) {
        res.status(502).json({ error: 'LLM returned empty response' });
        return;
      }

      // JSON 파싱 (코드블록 제거)
      let analysis: Record<string, unknown>;
      try {
        const cleaned = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        analysis = JSON.parse(cleaned);
      } catch {
        res.status(502).json({
          error: 'LLM response is not valid JSON',
          rawContent: content.substring(0, 1000),
        });
        return;
      }

      res.json({
        analysis,
        model: { id: model.id, name: model.name, displayName: model.displayName },
        errorLogId: id,
      });
    } catch (fetchErr) {
      clearTimeout(timeout);
      const msg = fetchErr instanceof Error
        ? (fetchErr.name === 'AbortError' ? 'LLM 응답 시간 초과 (60초)' : fetchErr.message)
        : 'Unknown error';
      res.status(502).json({ error: 'LLM connection failed', detail: msg });
    }
  } catch (error) {
    console.error('Error log analyze error:', error);
    res.status(500).json({ error: 'Failed to analyze error log' });
  }
}) as RequestHandler);
