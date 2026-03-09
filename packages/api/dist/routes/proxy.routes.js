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
import { Router } from 'express';
import { prisma, redis } from '../index.js';
import { incrementUsage, trackActiveUser } from '../services/redis.service.js';
import { validateProxyHeaders, canServiceAccessModel } from '../middleware/proxyAuth.js';
export const proxyRoutes = Router();
// 모든 /v1/* 요청에 헤더 검증 미들웨어 적용
proxyRoutes.use(validateProxyHeaders);
async function getModelEndpoints(modelId, parentEndpoint) {
    const subModels = await prisma.subModel.findMany({
        where: { parentId: modelId, enabled: true },
        orderBy: { sortOrder: 'asc' },
        select: { endpointUrl: true, apiKey: true, modelName: true, extraHeaders: true },
    });
    if (subModels.length === 0)
        return [parentEndpoint];
    return [
        parentEndpoint,
        ...subModels.map(s => ({
            endpointUrl: s.endpointUrl,
            apiKey: s.apiKey,
            modelName: s.modelName || parentEndpoint.modelName,
            extraHeaders: s.extraHeaders,
        })),
    ];
}
async function getRoundRobinIndex(modelId, endpointCount) {
    if (endpointCount <= 1)
        return 0;
    try {
        const key = `model_rr:${modelId}`;
        const index = await redis.incr(key);
        if (index === 1)
            await redis.expire(key, 7 * 24 * 60 * 60);
        return (index - 1) % endpointCount;
    }
    catch (error) {
        console.error('[RoundRobin] Redis error:', error);
        return 0;
    }
}
/**
 * URL 인코딩된 텍스트 디코딩
 */
function safeDecodeURIComponent(text) {
    if (!text)
        return text;
    try {
        if (!text.includes('%'))
            return text;
        return decodeURIComponent(text);
    }
    catch {
        return text;
    }
}
/**
 * 사용자 조회 또는 생성 (background가 아닌 경우만)
 */
async function getOrCreateUser(proxyReq) {
    if (proxyReq.isBackground || !proxyReq.userLoginId)
        return null;
    const loginid = proxyReq.userLoginId;
    const deptname = proxyReq.deptName;
    const businessUnit = proxyReq.businessUnit;
    const username = safeDecodeURIComponent(proxyReq.headers['x-user-name'] || loginid);
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
 * Usage 저장
 */
async function recordUsage(userId, loginid, modelId, inputTokens, outputTokens, serviceId, deptname, latencyMs) {
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
function buildChatCompletionsUrl(endpointUrl) {
    let url = endpointUrl.trim();
    if (url.endsWith('/chat/completions'))
        return url;
    if (url.endsWith('/'))
        url = url.slice(0, -1);
    if (url.endsWith('/v1'))
        return `${url}/chat/completions`;
    return `${url}/chat/completions`;
}
// ============================================
// GET /v1/models
// ============================================
proxyRoutes.get('/models', async (req, res) => {
    const proxyReq = req;
    try {
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
            },
            orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
        });
        // 서비스 등록 admin 권한에 따라 필터링
        const filtered = models.filter(model => canServiceAccessModel(proxyReq, model));
        res.json({
            object: 'list',
            data: filtered.map(model => ({
                id: model.name,
                object: 'model',
                created: Date.now(),
                owned_by: 'agent-dashboard',
                permission: [],
                root: model.name,
                parent: null,
                _nexus: {
                    id: model.id,
                    modelName: model.name,
                    displayName: model.displayName,
                    maxTokens: model.maxTokens,
                    supportsVision: model.supportsVision,
                },
            })),
        });
    }
    catch (error) {
        console.error('Get models error:', error);
        res.status(500).json({ error: 'Failed to get models' });
    }
});
// ============================================
// GET /v1/models/:modelName
// ============================================
proxyRoutes.get('/models/:modelName', async (req, res) => {
    const proxyReq = req;
    try {
        const { modelName } = req.params;
        const model = await prisma.model.findFirst({
            where: {
                OR: [{ name: modelName }, { id: modelName }],
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
            id: model.name,
            object: 'model',
            created: Date.now(),
            owned_by: 'agent-dashboard',
            permission: [],
            root: model.name,
            parent: null,
            _nexus: {
                id: model.id,
                modelName: model.name,
                displayName: model.displayName,
                maxTokens: model.maxTokens,
                supportsVision: model.supportsVision,
            },
        });
    }
    catch (error) {
        console.error('Get model error:', error);
        res.status(500).json({ error: 'Failed to get model' });
    }
});
// ============================================
// POST /v1/chat/completions
// ============================================
proxyRoutes.post('/chat/completions', async (req, res) => {
    const proxyReq = req;
    try {
        const { model: modelName, messages, stream, ...otherParams } = req.body;
        if (!modelName || !messages) {
            res.status(400).json({ error: 'model and messages are required' });
            return;
        }
        // 모델 조회
        const model = await prisma.model.findFirst({
            where: {
                OR: [{ name: modelName }, { id: modelName }],
                enabled: true,
            },
        });
        if (!model) {
            res.status(404).json({ error: `Model '${modelName}' not found or disabled` });
            return;
        }
        // 서비스 접근 권한 확인
        if (!canServiceAccessModel(proxyReq, model)) {
            res.status(403).json({
                error: `Model '${modelName}' is not accessible by service '${proxyReq.serviceName}'`,
                message: 'This model is not available for your service. Check the LLM visibility settings.',
            });
            return;
        }
        // 사용자 upsert (background가 아닌 경우)
        const user = await getOrCreateUser(proxyReq);
        // 라운드로빈 + Failover
        const endpoints = await getModelEndpoints(model.id, {
            endpointUrl: model.endpointUrl,
            apiKey: model.apiKey,
            modelName: model.name,
            extraHeaders: model.extraHeaders,
        });
        const startIdx = await getRoundRobinIndex(model.id, endpoints.length);
        if (endpoints.length > 1) {
            console.log(`[RoundRobin] Model "${model.name}" has ${endpoints.length} endpoints, starting at index ${startIdx}`);
        }
        let lastFailoverError;
        for (let attempt = 0; attempt < endpoints.length; attempt++) {
            const idx = (startIdx + attempt) % endpoints.length;
            const endpoint = endpoints[idx];
            if (attempt > 0) {
                console.log(`[Failover] Model "${model.name}" trying endpoint ${attempt + 1}/${endpoints.length}: ${endpoint.endpointUrl}`);
            }
            const llmRequestBody = {
                model: endpoint.modelName,
                messages,
                stream: stream || false,
                ...otherParams,
            };
            const headers = { 'Content-Type': 'application/json' };
            if (endpoint.apiKey)
                headers['Authorization'] = `Bearer ${endpoint.apiKey}`;
            if (endpoint.extraHeaders) {
                for (const [key, value] of Object.entries(endpoint.extraHeaders)) {
                    const lowerKey = key.toLowerCase();
                    if (lowerKey !== 'content-type' && lowerKey !== 'authorization') {
                        headers[key] = value;
                    }
                }
            }
            const effectiveModel = { ...model, endpointUrl: endpoint.endpointUrl, apiKey: endpoint.apiKey };
            let handled;
            if (stream) {
                handled = await handleStreamingRequest(res, effectiveModel, llmRequestBody, headers, user, proxyReq);
            }
            else {
                handled = await handleNonStreamingRequest(res, effectiveModel, llmRequestBody, headers, user, proxyReq);
            }
            if (handled)
                return;
            lastFailoverError = `Endpoint ${endpoint.endpointUrl} failed`;
        }
        console.error(`[Failover] All ${endpoints.length} endpoints failed for model "${model.name}"`);
        res.status(503).json({
            error: 'Service temporarily unavailable',
            message: `All ${endpoints.length} endpoint(s) failed. Please try again later.`,
            details: lastFailoverError,
        });
    }
    catch (error) {
        console.error('Chat completion proxy error:', error);
        res.status(500).json({ error: 'Failed to process chat completion' });
    }
});
// ============================================
// Request handling
// ============================================
const REQUEST_TIMEOUT_MS = 120000;
function isMaxTokensError(errorText) {
    return errorText.includes('max_tokens') && errorText.includes('must be at least');
}
function isContextWindowExceededError(errorText) {
    const lower = errorText.toLowerCase();
    return (lower.includes('contextwindowexceedederror') ||
        (lower.includes('max_tokens') && lower.includes('too large')) ||
        (lower.includes('max_completion_tokens') && lower.includes('too large')) ||
        (lower.includes('context length') && lower.includes('input tokens')));
}
function logLLMError(context, url, status, errorBody, requestBody, loginid, model, serviceId) {
    const messages = requestBody.messages || [];
    const messageSummary = messages.map((m, i) => {
        const contentLen = typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content || '').length;
        return `  [${i}] role=${m.role} content_len=${contentLen}`;
    }).join('\n');
    const truncatedError = errorBody.length > 2000
        ? errorBody.substring(0, 2000) + `... (truncated, total ${errorBody.length} chars)`
        : errorBody;
    console.error(`[LLM-Error] ${context}\n` +
        `  User: ${loginid}\n` +
        `  Model: ${model.name} | Service: ${serviceId}\n` +
        `  URL: ${url} | Status: ${status}\n` +
        `  Messages (${messages.length}):\n${messageSummary}\n` +
        `  stream: ${requestBody.stream || false} | max_tokens: ${requestBody.max_tokens || 'default'}\n` +
        `  LLM Response:\n${truncatedError}`);
}
async function handleNonStreamingRequest(res, model, requestBody, headers, user, proxyReq) {
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
                            const data = await retryResponse.json();
                            if (data.usage) {
                                recordUsage(user?.id || null, user?.loginid || null, model.id, data.usage.prompt_tokens || 0, data.usage.completion_tokens || 0, proxyReq.serviceId, proxyReq.deptName, retryLatencyMs).catch(console.error);
                            }
                            res.json(data);
                            return true;
                        }
                        const retryErrorText = await retryResponse.text();
                        res.status(retryResponse.status).json({ error: 'LLM request failed', details: retryErrorText });
                        return true;
                    }
                    catch { /* retry failed */ }
                }
                if (response.status >= 400 && response.status < 500) {
                    if (response.status === 400 && isMaxTokensError(errorText)) {
                        res.status(400).json({
                            error: { message: 'The input prompt exceeds the model\'s maximum context length.', type: 'invalid_request_error', code: 'context_length_exceeded' },
                        });
                    }
                    else {
                        res.status(response.status).json({ error: 'LLM request failed', details: errorText });
                    }
                    return true;
                }
                console.error(`[Failover] Endpoint ${url} returned ${response.status}`);
                return false;
            }
            const data = await response.json();
            if (data.usage) {
                recordUsage(user?.id || null, user?.loginid || null, model.id, data.usage.prompt_tokens || 0, data.usage.completion_tokens || 0, proxyReq.serviceId, proxyReq.deptName, latencyMs).catch(console.error);
            }
            res.json(data);
            return true;
        }
        catch (fetchError) {
            clearTimeout(timeoutId);
            throw fetchError;
        }
    }
    catch (error) {
        console.error(`[Failover] Endpoint ${url} connection failed:`, error instanceof Error ? error.message : error);
        return false;
    }
}
async function handleStreamingRequest(res, model, requestBody, headers, user, proxyReq) {
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
        let response;
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
                }
                else {
                    response = await fetch(url, {
                        method: 'POST', headers,
                        body: JSON.stringify(requestBody),
                        signal: controller.signal,
                    });
                }
            }
            clearTimeout(timeoutId);
        }
        catch (fetchError) {
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
                    }
                    else {
                        const retryErrorText = await retryResponse.text();
                        res.status(retryResponse.status).json({ error: 'LLM request failed', details: retryErrorText });
                        return true;
                    }
                }
                catch {
                    res.status(response.status).json({ error: 'LLM request failed', details: errorText });
                    return true;
                }
            }
            else {
                if (response.status >= 400 && response.status < 500) {
                    if (response.status === 400 && isMaxTokensError(errorText)) {
                        res.status(400).json({
                            error: { message: 'The input prompt exceeds the model\'s maximum context length.', type: 'invalid_request_error', code: 'context_length_exceeded' },
                        });
                    }
                    else {
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
        let usageData = null;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataStr = line.slice(6);
                        if (dataStr === '[DONE]') {
                            res.write('data: [DONE]\n\n');
                            continue;
                        }
                        try {
                            const parsed = JSON.parse(dataStr);
                            if (parsed.usage)
                                usageData = parsed.usage;
                        }
                        catch { /* not JSON */ }
                        res.write(`data: ${dataStr}\n\n`);
                    }
                    else if (line.trim()) {
                        res.write(`${line}\n`);
                    }
                }
            }
            if (buffer.trim())
                res.write(`${buffer}\n`);
        }
        finally {
            reader.releaseLock();
        }
        const latencyMs = Date.now() - startTime;
        if (usageData) {
            recordUsage(user?.id || null, user?.loginid || null, model.id, usageData.prompt_tokens || 0, usageData.completion_tokens || 0, proxyReq.serviceId, proxyReq.deptName, latencyMs).catch(console.error);
        }
        res.end();
        return true;
    }
    catch (error) {
        if (sseStarted) {
            console.error(`[Streaming] Error after SSE started:`, error instanceof Error ? error.message : error);
            try {
                res.end();
            }
            catch { }
            return true;
        }
        console.error(`[Failover] Endpoint ${url} connection failed:`, error instanceof Error ? error.message : error);
        return false;
    }
}
// Legacy completions
proxyRoutes.post('/completions', async (_req, res) => {
    res.status(501).json({ error: 'Legacy completions endpoint not implemented. Use /v1/chat/completions instead.' });
});
// Health check
proxyRoutes.get('/health', async (_req, res) => {
    try {
        await prisma.$queryRaw `SELECT 1`;
        res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    }
    catch (error) {
        res.status(503).json({ status: 'unhealthy', timestamp: new Date().toISOString() });
    }
});
//# sourceMappingURL=proxy.routes.js.map