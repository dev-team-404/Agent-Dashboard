/**
 * Admin Routes (v2)
 *
 * Protected endpoints for admin dashboard
 * - 3-tier admin system: SUPER_ADMIN / ADMIN (dept-scoped)
 * - Models are independent of services (no serviceId on Model)
 * - Model visibility: PUBLIC / BUSINESS_UNIT / TEAM / ADMIN_ONLY
 * - Admin has deptname, businessUnit, designatedBy
 */
import { Router } from 'express';
import { prisma } from '../index.js';
import { redis } from '../index.js';
import { authenticateToken, requireAdmin, requireSuperAdmin, isSuperAdminByEnv, isModelVisibleTo, extractBusinessUnit } from '../middleware/auth.js';
import { getActiveUserCount, getTodayUsage } from '../services/redis.service.js';
import { z } from 'zod';
import { lookupEmployee, verifyAndRegisterUser } from '../services/knoxEmployee.service.js';
import { generateImages } from '../services/imageProviders.service.js';
/**
 * Helper: PostgreSQL DATE() 결과를 YYYY-MM-DD 문자열로 변환
 * KST(Asia/Seoul) 기준으로 통일 — toISOString()은 UTC 기반이라 날짜 경계에서 1일 밀릴 수 있음
 */
function formatDateToString(date) {
    if (typeof date === 'string') {
        return date.split('T')[0] || date;
    }
    return toLocalDateString(date);
}
/**
 * Helper: JS Date를 로컬(KST) 기준 YYYY-MM-DD 문자열로 변환
 * toISOString()은 UTC 기반이라 KST에서 날짜가 1일 밀릴 수 있으므로
 * getFullYear/getMonth/getDate (로컬 TZ 기준) 사용
 */
function toLocalDateString(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
/**
 * Helper: serviceId 필터 조건 생성
 */
function getServiceFilter(serviceId) {
    return serviceId ? { serviceId } : {};
}
export const adminRoutes = Router();
// Apply authentication and admin check to all routes
adminRoutes.use(authenticateToken);
adminRoutes.use(requireAdmin);
/**
 * Helper: 감사 로그 기록
 */
async function recordAudit(req, action, target, targetType, details) {
    try {
        await prisma.auditLog.create({
            data: {
                adminId: req.adminId || undefined,
                loginid: req.user?.loginid || 'unknown',
                action,
                target,
                targetType,
                details: details ? JSON.parse(JSON.stringify(details)) : undefined,
                ipAddress: req.ip || req.headers['x-forwarded-for'] || undefined,
            },
        });
    }
    catch (err) {
        console.error('[AuditLog] Failed to record:', err);
    }
}
// ==================== Models Management ====================
/**
 * 모델 엔드포인트 Health Check
 * 실제 chat completion 및 tool call 요청을 보내서 정상 동작 확인
 */
const HEALTH_CHECK_TIMEOUT_MS = 30000; // 30초 (chat completion 테스트)
const TOOL_CALL_TIMEOUT_MS = 600000; // 10분 (tool call 테스트 — 일부 모델 응답 느림)
/**
 * endpointUrl에서 chat completions URL 구성
 */
/**
 * endpointUrl → /chat/completions URL
 */
function buildChatCompletionsUrl(endpointUrl) {
    let url = endpointUrl.trim().replace(/\/+$/, '');
    if (url.endsWith('/chat/completions'))
        return url;
    if (url.endsWith('/completions'))
        return url.replace(/\/completions$/, '/chat/completions');
    if (url.endsWith('/v1'))
        return `${url}/chat/completions`;
    return `${url}/chat/completions`;
}
/**
 * endpointUrl → /embeddings URL
 */
function buildEmbeddingsUrl(endpointUrl) {
    let url = endpointUrl.trim().replace(/\/+$/, '');
    if (url.endsWith('/embeddings'))
        return url;
    if (url.endsWith('/v1'))
        return `${url}/embeddings`;
    // Strip known suffixes
    url = url.replace(/\/(chat\/completions|rerank|images\/generations)$/, '');
    return `${url}/embeddings`;
}
/**
 * endpointUrl → /rerank URL
 */
function buildRerankUrl(endpointUrl) {
    let url = endpointUrl.trim().replace(/\/+$/, '');
    if (url.endsWith('/rerank'))
        return url;
    if (url.endsWith('/v1'))
        return `${url}/rerank`;
    url = url.replace(/\/(chat\/completions|embeddings|images\/generations)$/, '');
    return `${url}/rerank`;
}
function buildAudioTranscriptionsUrl(endpointUrl) {
    let url = endpointUrl.trim().replace(/\/+$/, '');
    if (url.endsWith('/audio/transcriptions'))
        return url;
    if (url.endsWith('/v1'))
        return `${url}/audio/transcriptions`;
    url = url.replace(/\/(chat\/completions|embeddings|rerank|images\/generations)$/, '');
    return `${url}/audio/transcriptions`;
}
/**
 * 1초 무음 WAV 파일 생성 (16kHz mono 16-bit PCM)
 */
function generateSilentWavBuffer(durationSec) {
    const sampleRate = 16000;
    const numSamples = sampleRate * durationSec;
    const dataSize = numSamples * 2;
    const buffer = Buffer.alloc(44 + dataSize);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20); // PCM
    buffer.writeUInt16LE(1, 22); // mono
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32); // block align
    buffer.writeUInt16LE(16, 34); // bits per sample
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    return buffer;
}
/**
 * endpointUrl → /images/generations URL
 */
function buildImagesGenerationsUrl(endpointUrl) {
    let url = endpointUrl.trim().replace(/\/+$/, '');
    if (url.endsWith('/images/generations'))
        return url;
    if (url.endsWith('/v1'))
        return `${url}/images/generations`;
    url = url.replace(/\/(chat\/completions|embeddings|rerank)$/, '');
    return `${url}/images/generations`;
}
// backward compat alias
const buildHealthCheckUrl = buildChatCompletionsUrl;
/**
 * fetch 요청 with timeout
 */
async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeoutId);
        return response;
    }
    catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}
/**
 * Health Check 상세 로그 (요청/응답 전부 출력)
 */
function logHealthCheckDetail(step, modelName, url, requestBody, result, responseBody) {
    const reqStr = JSON.stringify(requestBody, null, 2);
    const maxLen = 2000;
    const truncatedReq = reqStr.length > maxLen ? reqStr.substring(0, maxLen) + `... (${reqStr.length} chars)` : reqStr;
    const truncatedRes = responseBody && responseBody.length > maxLen
        ? responseBody.substring(0, maxLen) + `... (${responseBody.length} chars)`
        : (responseBody || '(empty)');
    console.log(`[HealthCheck] ${step} ${result.passed ? 'PASS' : 'FAIL'} (${result.latencyMs}ms)\n` +
        `  Model: ${modelName}\n` +
        `  URL: ${url}\n` +
        `  Status: ${result.status || 'N/A'}\n` +
        `  Request:\n${truncatedReq}\n` +
        `  Response:\n${truncatedRes}`);
}
/**
 * 1단계: Chat Completion 테스트
 */
async function testChatCompletion(url, modelName, headers) {
    const startTime = Date.now();
    const requestBody = {
        model: modelName,
        messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
        temperature: 0,
    };
    try {
        const response = await fetchWithTimeout(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody),
        }, HEALTH_CHECK_TIMEOUT_MS);
        const latencyMs = Date.now() - startTime;
        const responseText = await response.text();
        if (!response.ok) {
            const result = { passed: false, status: response.status, message: '', latencyMs };
            if (response.status === 401 || response.status === 403) {
                result.message = `Authentication failed (${response.status}). Check API key.`;
            }
            else {
                result.message = `Chat completion failed with status ${response.status}`;
            }
            logHealthCheckDetail('Chat Completion', modelName, url, requestBody, result, responseText);
            return result;
        }
        let data;
        try {
            data = JSON.parse(responseText);
        }
        catch {
            const result = { passed: false, status: response.status, message: 'Response is not valid JSON', latencyMs };
            logHealthCheckDetail('Chat Completion', modelName, url, requestBody, result, responseText);
            return result;
        }
        const content = data.choices?.[0]?.message?.content;
        if (!content && !data.choices?.[0]?.message) {
            const result = { passed: false, status: response.status, message: 'No message in response choices', latencyMs };
            logHealthCheckDetail('Chat Completion', modelName, url, requestBody, result, responseText);
            return result;
        }
        const result = { passed: true, status: response.status, message: `OK: "${(content || '').slice(0, 100)}"`, latencyMs };
        logHealthCheckDetail('Chat Completion', modelName, url, requestBody, result, responseText.length > 500 ? responseText.substring(0, 500) + '...' : responseText);
        return result;
    }
    catch (error) {
        const latencyMs = Date.now() - startTime;
        const errMsg = error instanceof Error
            ? (error.name === 'AbortError' ? `Timed out after ${HEALTH_CHECK_TIMEOUT_MS / 1000}s` : `Connection failed: ${error.message}`)
            : 'Unknown error';
        const result = { passed: false, message: errMsg, latencyMs };
        logHealthCheckDetail('Chat Completion', modelName, url, requestBody, result, errMsg);
        return result;
    }
}
/**
 * 2단계: Tool Call 테스트
 */
async function testToolCall(url, modelName, headers) {
    const startTime = Date.now();
    const requestBody = {
        model: modelName,
        messages: [{ role: 'user', content: 'What is the current time? Use the get_current_time tool.' }],
        tools: [{
                type: 'function',
                function: {
                    name: 'get_current_time',
                    description: 'Get the current time',
                    parameters: { type: 'object', properties: {}, required: [] },
                },
            }],
        tool_choice: 'required',
    };
    try {
        const response = await fetchWithTimeout(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody),
        }, HEALTH_CHECK_TIMEOUT_MS);
        const latencyMs = Date.now() - startTime;
        const responseText = await response.text();
        if (!response.ok) {
            const result = { passed: false, status: response.status, message: `Tool call failed with status ${response.status}`, latencyMs };
            logHealthCheckDetail('Tool Call', modelName, url, requestBody, result, responseText);
            return result;
        }
        let data;
        try {
            data = JSON.parse(responseText);
        }
        catch {
            const result = { passed: false, status: response.status, message: 'Response is not valid JSON', latencyMs };
            logHealthCheckDetail('Tool Call', modelName, url, requestBody, result, responseText);
            return result;
        }
        const toolCalls = data.choices?.[0]?.message?.tool_calls;
        if (toolCalls && toolCalls.length > 0) {
            const toolName = toolCalls[0]?.function?.name || 'unknown';
            const result = { passed: true, status: response.status, message: `OK: called "${toolName}"`, latencyMs };
            logHealthCheckDetail('Tool Call', modelName, url, requestBody, result, responseText.length > 500 ? responseText.substring(0, 500) + '...' : responseText);
            return result;
        }
        const result = { passed: false, status: response.status, message: 'Model responded but did not invoke tool call. Tool calling may not be supported.', latencyMs };
        logHealthCheckDetail('Tool Call', modelName, url, requestBody, result, responseText);
        return result;
    }
    catch (error) {
        const latencyMs = Date.now() - startTime;
        const errMsg = error instanceof Error
            ? (error.name === 'AbortError' ? `Timed out after ${HEALTH_CHECK_TIMEOUT_MS / 1000}s` : `Connection failed: ${error.message}`)
            : 'Unknown error';
        const result = { passed: false, message: errMsg, latencyMs };
        logHealthCheckDetail('Tool Call', modelName, url, requestBody, result, errMsg);
        return result;
    }
}
/**
 * 전체 Health Check 실행
 * chatCompletion -> toolCall 순서로 테스트
 * chatCompletion 실패 시 toolCall은 건너뜀
 */
async function checkModelEndpointHealth(endpointUrl, modelName, apiKey, extraHeaders) {
    const totalStart = Date.now();
    const url = buildHealthCheckUrl(endpointUrl);
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }
    if (extraHeaders) {
        for (const [key, value] of Object.entries(extraHeaders)) {
            const lowerKey = key.toLowerCase();
            if (lowerKey !== 'content-type' && lowerKey !== 'authorization') {
                headers[key] = value;
            }
        }
    }
    // 1단계: Chat Completion 테스트
    const chatResult = await testChatCompletion(url, modelName, headers);
    console.log(`[HealthCheck] Chat Completion: ${chatResult.passed ? 'PASS' : 'FAIL'} (${chatResult.latencyMs}ms) ${chatResult.message}`);
    if (!chatResult.passed) {
        return {
            healthy: false,
            checks: {
                chatCompletion: chatResult,
                toolCall: { passed: false, message: 'Skipped (chat completion failed)', latencyMs: 0 },
            },
            message: `Chat completion failed: ${chatResult.message}`,
            totalLatencyMs: Date.now() - totalStart,
        };
    }
    // 2단계: Tool Call 테스트
    const toolResult = await testToolCall(url, modelName, headers);
    console.log(`[HealthCheck] Tool Call: ${toolResult.passed ? 'PASS' : 'FAIL'} (${toolResult.latencyMs}ms) ${toolResult.message}`);
    const allPassed = chatResult.passed && toolResult.passed;
    return {
        healthy: allPassed,
        checks: { chatCompletion: chatResult, toolCall: toolResult },
        message: allPassed
            ? 'All checks passed'
            : `Tool call check failed: ${toolResult.message}`,
        totalLatencyMs: Date.now() - totalStart,
    };
}
// ==================== Model Schema ====================
const modelSchema = z.object({
    name: z.string().min(1).max(100),
    displayName: z.string().min(1).max(200),
    endpointUrl: z.string().url(),
    apiKey: z.string().optional(),
    extraHeaders: z.record(z.string()).optional(),
    extraBody: z.any().optional(),
    maxTokens: z.number().int().min(1).max(1000000).default(128000),
    enabled: z.boolean().default(true),
    supportsVision: z.boolean().default(false),
    visibility: z.enum(['PUBLIC', 'BUSINESS_UNIT', 'TEAM', 'ADMIN_ONLY', 'SUPER_ADMIN_ONLY']).default('PUBLIC'),
    visibilityScope: z.array(z.string()).default([]),
    type: z.enum(['CHAT', 'IMAGE', 'EMBEDDING', 'RERANKING', 'ASR']).optional(),
    imageProvider: z.string().optional(),
    asrMethod: z.enum(['AUDIO_URL', 'OPENAI_TRANSCRIBE']).optional(),
});
/**
 * GET /admin/models
 * Get all models (including disabled)
 * - SUPER_ADMIN: all models
 * - ADMIN: models visible to their dept/BU
 */
adminRoutes.get('/models', async (req, res) => {
    try {
        const models = await prisma.model.findMany({
            where: {
                endpointUrl: { not: 'external://auto-created' },
            },
            include: {
                creator: {
                    select: { loginid: true },
                },
                subModels: {
                    orderBy: { sortOrder: 'asc' },
                    select: { id: true, modelName: true, endpointUrl: true, apiKey: true, extraHeaders: true, enabled: true, sortOrder: true, createdAt: true },
                },
            },
            orderBy: [
                { sortOrder: 'asc' },
                { displayName: 'asc' },
            ],
        });
        // For non-super admins, filter by visibility
        let filteredModels = models;
        if (!req.isSuperAdmin) {
            filteredModels = models.filter((m) => {
                // SUPER_ADMIN_ONLY models are only visible to super admins
                if (m.visibility === 'SUPER_ADMIN_ONLY')
                    return false;
                return isModelVisibleTo({ visibility: m.visibility, visibilityScope: m.visibilityScope, adminVisible: m.adminVisible }, req.adminDept || '', req.adminBusinessUnit || '', true);
            });
        }
        // Mask API keys (parent and subModels)
        const maskedModels = filteredModels.map((m) => ({
            ...m,
            apiKey: m.apiKey ? '***' + m.apiKey.slice(-4) : null,
            subModels: m.subModels.map((s) => ({
                ...s,
                apiKey: s.apiKey ? '***' + s.apiKey.slice(-4) : null,
            })),
        }));
        res.json({ models: maskedModels });
    }
    catch (error) {
        console.error('Get admin models error:', error);
        res.status(500).json({ error: 'Failed to get models' });
    }
});
/**
 * POST /admin/models
 * Create a new model
 */
adminRoutes.post('/models', async (req, res) => {
    try {
        const validation = modelSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid request', details: validation.error.issues });
            return;
        }
        // Health check: 엔드포인트 연결 확인 (ASR/IMAGE는 별도 테스트 필요 → 스킵)
        const skipHealthCheck = req.query['skipHealthCheck'] === 'true' || validation.data.type === 'ASR' || validation.data.type === 'IMAGE';
        if (!skipHealthCheck) {
            const healthResult = await checkModelEndpointHealth(validation.data.endpointUrl, validation.data.name, validation.data.apiKey, validation.data.extraHeaders);
            console.log(`[HealthCheck] Model "${validation.data.name}" -> ${healthResult.healthy ? 'OK' : 'FAIL'} (${healthResult.totalLatencyMs}ms) ${healthResult.message}`);
            if (!healthResult.healthy) {
                res.status(400).json({
                    error: 'Endpoint health check failed',
                    healthCheck: healthResult,
                });
                return;
            }
        }
        const admin = await prisma.admin.findUnique({
            where: { loginid: req.user.loginid },
        });
        const model = await prisma.model.create({
            data: {
                ...validation.data,
                createdBy: admin?.id,
                createdByDept: req.adminDept || req.user.deptname,
                createdByBusinessUnit: req.adminBusinessUnit || extractBusinessUnit(req.user.deptname),
                createdBySuperAdmin: !!req.isSuperAdmin,
            },
        });
        res.status(201).json({ model });
    }
    catch (error) {
        console.error('Create model error:', error);
        res.status(500).json({ error: 'Failed to create model' });
    }
});
/**
 * PUT /admin/models/reorder
 * Reorder models (must be before :id route)
 * Body: { modelIds: string[] }
 */
adminRoutes.put('/models/reorder', async (req, res) => {
    try {
        const { modelIds } = req.body;
        if (!Array.isArray(modelIds) || modelIds.length === 0) {
            res.status(400).json({ error: 'modelIds must be a non-empty array' });
            return;
        }
        // Verify all model IDs exist first
        const existingModels = await prisma.model.findMany({
            where: { id: { in: modelIds } },
            select: { id: true },
        });
        const existingIds = new Set(existingModels.map(m => m.id));
        const validModelIds = modelIds.filter((id) => existingIds.has(id));
        if (validModelIds.length === 0) {
            res.status(400).json({ error: 'No valid model IDs provided' });
            return;
        }
        // Update sort order for each valid model
        const updates = validModelIds.map((id, index) => prisma.model.update({
            where: { id },
            data: { sortOrder: index },
        }));
        await prisma.$transaction(updates);
        res.json({ success: true, count: validModelIds.length });
    }
    catch (error) {
        console.error('Reorder models error:', error);
        res.status(500).json({ error: 'Failed to reorder models' });
    }
});
/**
 * PUT /admin/models/:id
 * Update a model
 * - ADMIN can only update models they created (same dept)
 */
adminRoutes.put('/models/:id', async (req, res) => {
    try {
        const { id } = req.params;
        // Dept-scoped admins can only update models created by their dept
        if (!req.isSuperAdmin) {
            const existingModel = await prisma.model.findUnique({
                where: { id },
                select: { createdByDept: true, createdByBusinessUnit: true, createdBySuperAdmin: true },
            });
            if (!existingModel) {
                res.status(404).json({ error: 'Model not found' });
                return;
            }
            // ADMIN can only update models from their own dept/BU, not super admin models
            if (existingModel.createdBySuperAdmin || existingModel.createdByBusinessUnit !== req.adminBusinessUnit) {
                res.status(403).json({ error: 'No access to update this model' });
                return;
            }
        }
        const validation = modelSchema.partial().safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid request', details: validation.error.issues });
            return;
        }
        // Health check: endpointUrl, apiKey, name, extraHeaders 중 실제로 변경된 경우만 연결 확인
        // ASR/IMAGE 타입은 별도 테스트 엔드포인트 사용 → chat/completions 기반 헬스체크 스킵
        const skipHealthCheck = req.query['skipHealthCheck'] === 'true' || validation.data.type === 'ASR' || validation.data.type === 'IMAGE';
        if (!skipHealthCheck) {
            const existing = await prisma.model.findUnique({ where: { id }, select: { endpointUrl: true, apiKey: true, name: true, extraHeaders: true, type: true } });
            // 기존 모델이 ASR/IMAGE인 경우에도 스킵
            if (existing && existing.type !== 'ASR' && existing.type !== 'IMAGE') {
                const endpointChanged = validation.data.endpointUrl !== undefined && validation.data.endpointUrl !== existing.endpointUrl;
                const apiKeyChanged = validation.data.apiKey !== undefined && validation.data.apiKey !== (existing.apiKey || undefined);
                const nameChanged = validation.data.name !== undefined && validation.data.name !== existing.name;
                const extraHeadersChanged = validation.data.extraHeaders !== undefined &&
                    JSON.stringify(validation.data.extraHeaders) !== JSON.stringify(existing.extraHeaders || undefined);
                if (endpointChanged || apiKeyChanged || nameChanged || extraHeadersChanged) {
                    const endpointUrl = validation.data.endpointUrl || existing.endpointUrl;
                    const apiKey = validation.data.apiKey !== undefined ? validation.data.apiKey : (existing.apiKey || undefined);
                    const modelName = validation.data.name || existing.name;
                    const extraHeaders = validation.data.extraHeaders !== undefined ? validation.data.extraHeaders : (existing.extraHeaders || undefined);
                    const healthResult = await checkModelEndpointHealth(endpointUrl, modelName, apiKey, extraHeaders);
                    console.log(`[HealthCheck] Model "${modelName}" update -> ${healthResult.healthy ? 'OK' : 'FAIL'} (${healthResult.totalLatencyMs}ms) ${healthResult.message}`);
                    if (!healthResult.healthy) {
                        res.status(400).json({
                            error: 'Endpoint health check failed',
                            healthCheck: healthResult,
                        });
                        return;
                    }
                }
            }
        }
        const oldModel = await prisma.model.findUnique({ where: { id }, select: { displayName: true } });
        const model = await prisma.model.update({
            where: { id },
            data: validation.data,
        });
        // displayName이 변경된 경우 로그 테이블들의 스냅샷도 일괄 갱신
        if (oldModel && validation.data.displayName && validation.data.displayName !== oldModel.displayName) {
            const oldName = oldModel.displayName;
            const newName = validation.data.displayName;
            await Promise.all([
                prisma.healthCheckLog.updateMany({
                    where: { modelId: id },
                    data: { modelName: newName },
                }),
                prisma.requestLog.updateMany({
                    where: { modelName: oldName },
                    data: { modelName: newName },
                }),
                prisma.ratingFeedback.updateMany({
                    where: { modelName: oldName },
                    data: { modelName: newName },
                }),
            ]);
            console.log(`[Model] displayName changed: "${oldName}" → "${newName}" — updated logs`);
        }
        res.json({ model });
    }
    catch (error) {
        console.error('Update model error:', error);
        res.status(500).json({ error: 'Failed to update model' });
    }
});
/**
 * DELETE /admin/models/:id
 * Delete a model (SUPER_ADMIN only)
 * Query: ?force=true - 사용 기록이 있어도 강제 삭제
 */
adminRoutes.delete('/models/:id', requireSuperAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const force = req.query['force'] === 'true';
        // Check if model has usage logs
        const usageCount = await prisma.usageLog.count({
            where: { modelId: id },
        });
        if (usageCount > 0 && !force) {
            res.status(400).json({
                error: `이 모델에 ${usageCount.toLocaleString()}개의 사용 기록이 있습니다. 삭제하려면 force=true 옵션을 사용하세요.`,
                usageCount,
                hint: 'Add ?force=true to delete model and all its usage logs',
            });
            return;
        }
        // If force delete, delete usage logs first
        if (force && usageCount > 0) {
            await prisma.usageLog.deleteMany({
                where: { modelId: id },
            });
            console.log(`Force deleted ${usageCount} usage logs for model ${id}`);
        }
        await prisma.model.delete({
            where: { id },
        });
        res.json({
            success: true,
            deletedUsageLogs: force ? usageCount : 0,
        });
    }
    catch (error) {
        console.error('Delete model error:', error);
        res.status(500).json({ error: 'Failed to delete model' });
    }
});
// ==================== SubModel Management (로드밸런싱) ====================
const subModelSchema = z.object({
    modelName: z.string().optional(),
    endpointUrl: z.string().url(),
    apiKey: z.string().optional(),
    extraHeaders: z.record(z.string()).optional(),
    enabled: z.boolean().default(true),
    sortOrder: z.number().int().default(0),
    weight: z.number().int().min(1).max(10).default(1),
});
/**
 * GET /admin/models/:modelId/sub-models
 * 특정 모델의 서브모델 목록 조회
 */
adminRoutes.get('/models/:modelId/sub-models', async (req, res) => {
    try {
        const { modelId } = req.params;
        const model = await prisma.model.findUnique({
            where: { id: modelId },
            select: { id: true, visibility: true, visibilityScope: true, adminVisible: true },
        });
        if (!model) {
            res.status(404).json({ error: 'Model not found' });
            return;
        }
        // Check visibility for non-super admins
        if (!req.isSuperAdmin) {
            if (!isModelVisibleTo({ visibility: model.visibility, visibilityScope: model.visibilityScope, adminVisible: model.adminVisible }, req.adminDept || '', req.adminBusinessUnit || '', true)) {
                res.status(403).json({ error: 'No access to this model' });
                return;
            }
        }
        const subModels = await prisma.subModel.findMany({
            where: { parentId: modelId },
            orderBy: { sortOrder: 'asc' },
        });
        // Mask API keys
        const maskedSubModels = subModels.map((s) => ({
            ...s,
            apiKey: s.apiKey ? '***' + s.apiKey.slice(-4) : null,
        }));
        res.json({ subModels: maskedSubModels });
    }
    catch (error) {
        console.error('Get sub-models error:', error);
        res.status(500).json({ error: 'Failed to get sub-models' });
    }
});
/**
 * POST /admin/models/:modelId/sub-models
 * 서브모델 추가 (health check 포함)
 */
adminRoutes.post('/models/:modelId/sub-models', async (req, res) => {
    try {
        const { modelId } = req.params;
        const model = await prisma.model.findUnique({
            where: { id: modelId },
            select: { id: true, name: true, createdByBusinessUnit: true, createdBySuperAdmin: true },
        });
        if (!model) {
            res.status(404).json({ error: 'Model not found' });
            return;
        }
        // Dept-scoped admins can only manage sub-models of models from their dept/BU
        if (!req.isSuperAdmin) {
            if (model.createdBySuperAdmin || model.createdByBusinessUnit !== req.adminBusinessUnit) {
                res.status(403).json({ error: 'No access to add sub-models for this model' });
                return;
            }
        }
        const validation = subModelSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid request', details: validation.error.issues });
            return;
        }
        // Health check
        const skipHealthCheck = req.query['skipHealthCheck'] === 'true';
        if (!skipHealthCheck) {
            const healthCheckModelName = validation.data.modelName || model.name;
            const healthResult = await checkModelEndpointHealth(validation.data.endpointUrl, healthCheckModelName, validation.data.apiKey, validation.data.extraHeaders);
            console.log(`[HealthCheck] SubModel for "${model.name}" (model=${healthCheckModelName}) -> ${healthResult.healthy ? 'OK' : 'FAIL'} (${healthResult.totalLatencyMs}ms) ${healthResult.message}`);
            if (!healthResult.healthy) {
                res.status(400).json({
                    error: 'Endpoint health check failed',
                    healthCheck: healthResult,
                });
                return;
            }
        }
        const subModel = await prisma.subModel.create({
            data: {
                parentId: modelId,
                ...validation.data,
            },
        });
        res.status(201).json({
            subModel: {
                ...subModel,
                apiKey: subModel.apiKey ? '***' + subModel.apiKey.slice(-4) : null,
            },
        });
    }
    catch (error) {
        console.error('Create sub-model error:', error);
        res.status(500).json({ error: 'Failed to create sub-model' });
    }
});
/**
 * PUT /admin/models/:modelId/sub-models/:subModelId
 * 서브모델 수정
 */
adminRoutes.put('/models/:modelId/sub-models/:subModelId', async (req, res) => {
    try {
        const { modelId, subModelId } = req.params;
        const model = await prisma.model.findUnique({
            where: { id: modelId },
            select: { id: true, name: true, createdByBusinessUnit: true, createdBySuperAdmin: true },
        });
        if (!model) {
            res.status(404).json({ error: 'Model not found' });
            return;
        }
        // Dept-scoped access check
        if (!req.isSuperAdmin) {
            if (model.createdBySuperAdmin || model.createdByBusinessUnit !== req.adminBusinessUnit) {
                res.status(403).json({ error: 'No access to update sub-models for this model' });
                return;
            }
        }
        const existing = await prisma.subModel.findUnique({ where: { id: subModelId } });
        if (!existing || existing.parentId !== modelId) {
            res.status(404).json({ error: 'Sub-model not found' });
            return;
        }
        const validation = subModelSchema.partial().safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid request', details: validation.error.issues });
            return;
        }
        // Health check: 실제로 변경된 필드가 있는 경우만 연결 확인
        const skipHealthCheck = req.query['skipHealthCheck'] === 'true';
        if (!skipHealthCheck) {
            const endpointChanged = validation.data.endpointUrl !== undefined && validation.data.endpointUrl !== existing.endpointUrl;
            const apiKeyChanged = validation.data.apiKey !== undefined && validation.data.apiKey !== (existing.apiKey || undefined);
            const modelNameChanged = validation.data.modelName !== undefined && validation.data.modelName !== (existing.modelName || undefined);
            const extraHeadersChanged = validation.data.extraHeaders !== undefined &&
                JSON.stringify(validation.data.extraHeaders) !== JSON.stringify(existing.extraHeaders || undefined);
            if (endpointChanged || apiKeyChanged || modelNameChanged || extraHeadersChanged) {
                const endpointUrl = validation.data.endpointUrl || existing.endpointUrl;
                const apiKey = validation.data.apiKey !== undefined ? validation.data.apiKey : (existing.apiKey || undefined);
                const extraHeaders = validation.data.extraHeaders !== undefined ? validation.data.extraHeaders : (existing.extraHeaders || undefined);
                const healthCheckModelName = validation.data.modelName || existing.modelName || model.name;
                const healthResult = await checkModelEndpointHealth(endpointUrl, healthCheckModelName, apiKey, extraHeaders);
                console.log(`[HealthCheck] SubModel update for "${model.name}" (model=${healthCheckModelName}) -> ${healthResult.healthy ? 'OK' : 'FAIL'} (${healthResult.totalLatencyMs}ms) ${healthResult.message}`);
                if (!healthResult.healthy) {
                    res.status(400).json({
                        error: 'Endpoint health check failed',
                        healthCheck: healthResult,
                    });
                    return;
                }
            }
        }
        const subModel = await prisma.subModel.update({
            where: { id: subModelId },
            data: validation.data,
        });
        res.json({
            subModel: {
                ...subModel,
                apiKey: subModel.apiKey ? '***' + subModel.apiKey.slice(-4) : null,
            },
        });
    }
    catch (error) {
        console.error('Update sub-model error:', error);
        res.status(500).json({ error: 'Failed to update sub-model' });
    }
});
/**
 * DELETE /admin/models/:modelId/sub-models/:subModelId
 * 서브모델 삭제
 */
adminRoutes.delete('/models/:modelId/sub-models/:subModelId', async (req, res) => {
    try {
        const { modelId, subModelId } = req.params;
        const model = await prisma.model.findUnique({
            where: { id: modelId },
            select: { id: true, createdByBusinessUnit: true, createdBySuperAdmin: true },
        });
        if (!model) {
            res.status(404).json({ error: 'Model not found' });
            return;
        }
        // Dept-scoped access check
        if (!req.isSuperAdmin) {
            if (model.createdBySuperAdmin || model.createdByBusinessUnit !== req.adminBusinessUnit) {
                res.status(403).json({ error: 'No access to delete sub-models for this model' });
                return;
            }
        }
        const existing = await prisma.subModel.findUnique({ where: { id: subModelId } });
        if (!existing || existing.parentId !== modelId) {
            res.status(404).json({ error: 'Sub-model not found' });
            return;
        }
        await prisma.subModel.delete({ where: { id: subModelId } });
        res.json({ success: true });
    }
    catch (error) {
        console.error('Delete sub-model error:', error);
        res.status(500).json({ error: 'Failed to delete sub-model' });
    }
});
/**
 * POST /admin/models/test
 * 모델 엔드포인트 테스트 (저장 전 독립 테스트용)
 * chatCompletion + 4개 toolCall 시나리오 (A/B/C/D)
 * Body: { endpointUrl, modelName, apiKey?, extraHeaders? }
 */
adminRoutes.post('/models/test', async (req, res) => {
    try {
        const testSchema = z.object({
            endpointUrl: z.string().url(),
            modelName: z.string().min(1),
            apiKey: z.string().optional(),
            extraHeaders: z.record(z.string()).optional(),
        });
        const validation = testSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid request', details: validation.error.issues });
            return;
        }
        const { endpointUrl, modelName, apiKey, extraHeaders } = validation.data;
        const totalStart = Date.now();
        const url = buildHealthCheckUrl(endpointUrl);
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }
        if (extraHeaders) {
            for (const [key, value] of Object.entries(extraHeaders)) {
                const lowerKey = key.toLowerCase();
                if (lowerKey !== 'content-type' && lowerKey !== 'authorization') {
                    headers[key] = value;
                }
            }
        }
        // Tool definition for tool call tests
        const weatherTool = {
            type: 'function',
            function: {
                name: 'get_weather',
                description: 'Get the current weather in a location',
                parameters: {
                    type: 'object',
                    properties: {
                        location: { type: 'string', description: 'City name' },
                        unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
                    },
                    required: ['location'],
                },
            },
        };
        const toolCallPrompt = "What's the weather in Seoul?";
        // Helper: run a single tool call test scenario
        async function runToolCallTest(label, opts) {
            const startTime = Date.now();
            const requestBody = {
                model: modelName,
                messages: [{ role: 'user', content: toolCallPrompt }],
                tools: [weatherTool],
                tool_choice: opts.tool_choice,
            };
            if (opts.temperature !== undefined) {
                requestBody.temperature = opts.temperature;
            }
            try {
                const response = await fetchWithTimeout(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(requestBody),
                }, TOOL_CALL_TIMEOUT_MS);
                const latencyMs = Date.now() - startTime;
                const responseText = await response.text();
                if (!response.ok) {
                    const result = { passed: false, status: response.status, message: `${label} failed with status ${response.status}`, latencyMs };
                    logHealthCheckDetail(label, modelName, url, requestBody, result, responseText);
                    return result;
                }
                let data;
                try {
                    data = JSON.parse(responseText);
                }
                catch {
                    const result = { passed: false, status: response.status, message: 'Response is not valid JSON', latencyMs };
                    logHealthCheckDetail(label, modelName, url, requestBody, result, responseText);
                    return result;
                }
                // Validate tool_calls
                const toolCalls = data.choices?.[0]?.message?.tool_calls;
                if (!toolCalls || !Array.isArray(toolCalls) || toolCalls.length === 0) {
                    const result = { passed: false, status: response.status, message: 'No tool_calls in response', latencyMs };
                    logHealthCheckDetail(label, modelName, url, requestBody, result, responseText);
                    return result;
                }
                // Validate each tool call has function.name and function.arguments (valid JSON)
                for (const tc of toolCalls) {
                    if (!tc.function?.name) {
                        const result = { passed: false, status: response.status, message: 'tool_call missing function.name', latencyMs };
                        logHealthCheckDetail(label, modelName, url, requestBody, result, responseText);
                        return result;
                    }
                    if (!tc.function?.arguments) {
                        const result = { passed: false, status: response.status, message: 'tool_call missing function.arguments', latencyMs };
                        logHealthCheckDetail(label, modelName, url, requestBody, result, responseText);
                        return result;
                    }
                    try {
                        JSON.parse(tc.function.arguments);
                    }
                    catch {
                        const result = { passed: false, status: response.status, message: `tool_call arguments is not valid JSON: ${tc.function.arguments}`, latencyMs };
                        logHealthCheckDetail(label, modelName, url, requestBody, result, responseText);
                        return result;
                    }
                }
                const toolName = toolCalls[0]?.function?.name || 'unknown';
                const result = { passed: true, status: response.status, message: `OK: called "${toolName}"`, latencyMs };
                logHealthCheckDetail(label, modelName, url, requestBody, result, responseText.length > 500 ? responseText.substring(0, 500) + '...' : responseText);
                return result;
            }
            catch (error) {
                const latencyMs = Date.now() - startTime;
                const errMsg = error instanceof Error
                    ? (error.name === 'AbortError' ? `Timed out after ${TOOL_CALL_TIMEOUT_MS / 1000}s` : `Connection failed: ${error.message}`)
                    : 'Unknown error';
                const result = { passed: false, message: errMsg, latencyMs };
                logHealthCheckDetail(label, modelName, url, requestBody, result, errMsg);
                return result;
            }
        }
        // 1. Chat Completion test
        const chatResult = await testChatCompletion(url, modelName, headers);
        console.log(`[Test] Chat Completion: ${chatResult.passed ? 'PASS' : 'FAIL'} (${chatResult.latencyMs}ms) ${chatResult.message}`);
        // 2. Tool Call tests (A/B/C/D) - run even if chat fails (for diagnostic info)
        const [toolCallA, toolCallB, toolCallC, toolCallD] = await Promise.all([
            runToolCallTest('toolCallA', { temperature: 0, tool_choice: 'required' }),
            runToolCallTest('toolCallB', { temperature: 0, tool_choice: 'auto' }),
            runToolCallTest('toolCallC', { tool_choice: 'required' }),
            runToolCallTest('toolCallD', { tool_choice: 'auto' }),
        ]);
        console.log(`[Test] toolCallA: ${toolCallA.passed ? 'PASS' : 'FAIL'} (${toolCallA.latencyMs}ms)`);
        console.log(`[Test] toolCallB: ${toolCallB.passed ? 'PASS' : 'FAIL'} (${toolCallB.latencyMs}ms)`);
        console.log(`[Test] toolCallC: ${toolCallC.passed ? 'PASS' : 'FAIL'} (${toolCallC.latencyMs}ms)`);
        console.log(`[Test] toolCallD: ${toolCallD.passed ? 'PASS' : 'FAIL'} (${toolCallD.latencyMs}ms)`);
        const toolCallPassCount = [toolCallA, toolCallB, toolCallC, toolCallD].filter(r => r.passed).length;
        const allPassed = chatResult.passed && toolCallPassCount >= 2;
        const totalLatencyMs = Date.now() - totalStart;
        res.json({
            healthCheck: {
                healthy: allPassed,
                checks: {
                    chatCompletion: chatResult,
                    toolCallA,
                    toolCallB,
                    toolCallC,
                    toolCallD,
                },
                toolCallPassCount,
                allPassed,
                message: allPassed
                    ? 'All checks passed'
                    : chatResult.passed
                        ? `Tool call: ${toolCallPassCount}/4 passed (need 2+)`
                        : `Chat completion failed: ${chatResult.message}`,
                totalLatencyMs,
            },
        });
    }
    catch (error) {
        console.error('Model test error:', error);
        res.status(500).json({ error: 'Failed to test model' });
    }
});
/**
 * POST /admin/models/test-vl
 * Vision Language Model 테스트
 * Step 1 (visionDescribe): 테스트 이미지를 보내고 설명 요청
 * Step 2 (visionJudge): 설명이 이미지 내용을 정확히 묘사하는지 판정
 * Body: { endpointUrl, modelName, apiKey?, extraHeaders? }
 */
adminRoutes.post('/models/test-vl', async (req, res) => {
    try {
        const testSchema = z.object({
            endpointUrl: z.string().url(),
            modelName: z.string().min(1),
            apiKey: z.string().optional(),
            extraHeaders: z.record(z.string()).optional(),
        });
        const validation = testSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid request', details: validation.error.issues });
            return;
        }
        const { endpointUrl, modelName, apiKey, extraHeaders } = validation.data;
        const url = buildHealthCheckUrl(endpointUrl);
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }
        if (extraHeaders) {
            for (const [key, value] of Object.entries(extraHeaders)) {
                const lowerKey = key.toLowerCase();
                if (lowerKey !== 'content-type' && lowerKey !== 'authorization') {
                    headers[key] = value;
                }
            }
        }
        // 1x1 red pixel PNG base64
        const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
        // Step 1: visionDescribe - ask the model to describe the test image
        let visionDescribe;
        let description = '';
        const describeStart = Date.now();
        const describeBody = {
            model: modelName,
            messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Describe this image in detail.' },
                        { type: 'image_url', image_url: { url: `data:image/png;base64,${testImageBase64}` } },
                    ],
                }],
            temperature: 0,
        };
        try {
            const response = await fetchWithTimeout(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(describeBody),
            }, HEALTH_CHECK_TIMEOUT_MS);
            const latencyMs = Date.now() - describeStart;
            const responseText = await response.text();
            if (!response.ok) {
                visionDescribe = { passed: false, status: response.status, message: `Vision describe failed with status ${response.status}`, latencyMs };
                logHealthCheckDetail('Vision Describe', modelName, url, describeBody, visionDescribe, responseText);
            }
            else {
                let data;
                try {
                    data = JSON.parse(responseText);
                }
                catch {
                    visionDescribe = { passed: false, status: response.status, message: 'Response is not valid JSON', latencyMs };
                    logHealthCheckDetail('Vision Describe', modelName, url, describeBody, visionDescribe, responseText);
                }
                if (!visionDescribe) {
                    const content = data?.choices?.[0]?.message?.content;
                    if (content && typeof content === 'string' && content.length > 0) {
                        description = content;
                        visionDescribe = { passed: true, status: response.status, message: `OK: "${content.slice(0, 200)}"`, latencyMs };
                        logHealthCheckDetail('Vision Describe', modelName, url, describeBody, visionDescribe, responseText.length > 500 ? responseText.substring(0, 500) + '...' : responseText);
                    }
                    else {
                        visionDescribe = { passed: false, status: response.status, message: 'No content in response', latencyMs };
                        logHealthCheckDetail('Vision Describe', modelName, url, describeBody, visionDescribe, responseText);
                    }
                }
            }
        }
        catch (error) {
            const latencyMs = Date.now() - describeStart;
            const errMsg = error instanceof Error
                ? (error.name === 'AbortError' ? `Timed out after ${HEALTH_CHECK_TIMEOUT_MS / 1000}s` : `Connection failed: ${error.message}`)
                : 'Unknown error';
            visionDescribe = { passed: false, message: errMsg, latencyMs };
            logHealthCheckDetail('Vision Describe', modelName, url, describeBody, visionDescribe, errMsg);
        }
        // Step 2: visionJudge - ask if description accurately describes the image
        let visionJudge;
        if (!visionDescribe.passed || !description) {
            visionJudge = { passed: false, message: 'Skipped (vision describe failed)', latencyMs: 0 };
        }
        else {
            const judgeStart = Date.now();
            const judgeBody = {
                model: modelName,
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'image_url', image_url: { url: `data:image/png;base64,${testImageBase64}` } },
                            {
                                type: 'text',
                                text: `Here is a description of the image above: "${description}"\n\nDoes this description accurately describe the image content? Does it mention any visual element (color, shape, size, pixel, etc.)? Answer with "YES" or "NO" and briefly explain.`,
                            },
                        ],
                    },
                ],
                temperature: 0,
            };
            try {
                const response = await fetchWithTimeout(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(judgeBody),
                }, HEALTH_CHECK_TIMEOUT_MS);
                const latencyMs = Date.now() - judgeStart;
                const responseText = await response.text();
                if (!response.ok) {
                    visionJudge = { passed: false, status: response.status, message: `Vision judge failed with status ${response.status}`, latencyMs };
                    logHealthCheckDetail('Vision Judge', modelName, url, judgeBody, visionJudge, responseText);
                }
                else {
                    let data;
                    try {
                        data = JSON.parse(responseText);
                    }
                    catch {
                        visionJudge = { passed: false, status: response.status, message: 'Response is not valid JSON', latencyMs };
                        logHealthCheckDetail('Vision Judge', modelName, url, judgeBody, visionJudge, responseText);
                    }
                    if (!visionJudge) {
                        const content = data?.choices?.[0]?.message?.content || '';
                        // Check if the judge response mentions any visual element
                        const mentionsVisual = /yes|color|red|pixel|image|square|small|dot|point/i.test(content);
                        if (mentionsVisual) {
                            visionJudge = { passed: true, status: response.status, message: `OK: "${content.slice(0, 200)}"`, latencyMs };
                        }
                        else {
                            visionJudge = { passed: false, status: response.status, message: `Description did not mention visual elements: "${content.slice(0, 200)}"`, latencyMs };
                        }
                        logHealthCheckDetail('Vision Judge', modelName, url, judgeBody, visionJudge, responseText.length > 500 ? responseText.substring(0, 500) + '...' : responseText);
                    }
                }
            }
            catch (error) {
                const latencyMs = Date.now() - judgeStart;
                const errMsg = error instanceof Error
                    ? (error.name === 'AbortError' ? `Timed out after ${HEALTH_CHECK_TIMEOUT_MS / 1000}s` : `Connection failed: ${error.message}`)
                    : 'Unknown error';
                visionJudge = { passed: false, message: errMsg, latencyMs };
                logHealthCheckDetail('Vision Judge', modelName, url, judgeBody, visionJudge, errMsg);
            }
        }
        const passed = visionDescribe.passed && visionJudge.passed;
        console.log(`[Test-VL] Model "${modelName}" -> visionDescribe: ${visionDescribe.passed ? 'PASS' : 'FAIL'}, visionJudge: ${visionJudge.passed ? 'PASS' : 'FAIL'}, overall: ${passed ? 'PASS' : 'FAIL'}`);
        res.json({
            visionDescribe: visionDescribe,
            visionJudge: visionJudge,
            passed,
        });
    }
    catch (error) {
        console.error('Model test-vl error:', error);
        res.status(500).json({ error: 'Failed to test vision model' });
    }
});
/**
 * POST /admin/models/test-image
 * 이미지 생성 모델 테스트
 * Body: { endpointUrl, modelName, apiKey?, extraHeaders?, extraBody?, imageProvider? }
 */
adminRoutes.post('/models/test-image', async (req, res) => {
    try {
        const testSchema = z.object({
            endpointUrl: z.string().url(),
            modelName: z.string().min(1),
            apiKey: z.string().optional(),
            extraHeaders: z.record(z.string()).optional(),
            extraBody: z.any().optional(),
            imageProvider: z.string().optional(),
        });
        const validation = testSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid request', details: validation.error.issues });
            return;
        }
        const { endpointUrl, modelName, apiKey, extraHeaders: extraHdrs, extraBody, imageProvider } = validation.data;
        let imageGen;
        const startTime = Date.now();
        const provider = (imageProvider || 'OPENAI').toUpperCase();
        // provider별 분기: COMFYUI/GEMINI/PIXABAY/PEXELS는 generateImages() 어댑터 사용
        const useAdapter = ['COMFYUI', 'GEMINI', 'PIXABAY', 'PEXELS'].includes(provider);
        if (useAdapter) {
            try {
                const results = await generateImages(provider, {
                    endpointUrl,
                    apiKey: apiKey || null,
                    modelName,
                    extraHeaders: extraHdrs || null,
                    extraBody: extraBody || null,
                }, {
                    prompt: 'A simple red circle on white background',
                    n: 1,
                    size: '256x256',
                });
                const latencyMs = Date.now() - startTime;
                if (results.length > 0 && results[0].imageBuffer.length > 0) {
                    imageGen = { passed: true, status: 200, message: `OK: image generated successfully (${results[0].mimeType}, ${results[0].imageBuffer.length} bytes)`, latencyMs };
                }
                else {
                    imageGen = { passed: false, message: 'No image data returned', latencyMs };
                }
                console.log(`[HealthCheck] Image Generation ${imageGen.passed ? 'OK' : 'FAIL'} (${latencyMs}ms)`);
                console.log(`  Model: ${modelName}`);
                console.log(`  Provider: ${provider}`);
            }
            catch (error) {
                const latencyMs = Date.now() - startTime;
                const errMsg = error instanceof Error ? error.message : 'Unknown error';
                imageGen = { passed: false, message: errMsg, latencyMs };
                console.log(`[HealthCheck] Image Generation FAIL (${latencyMs}ms)`);
                console.log(`  Model: ${modelName}`);
                console.log(`  Provider: ${provider}`);
                console.log(`  Error: ${errMsg}`);
            }
        }
        else {
            // OpenAI-style image generation request
            const url = buildImagesGenerationsUrl(endpointUrl);
            const headers = { 'Content-Type': 'application/json' };
            if (apiKey) {
                headers['Authorization'] = `Bearer ${apiKey}`;
            }
            if (extraHdrs) {
                for (const [key, value] of Object.entries(extraHdrs)) {
                    const lowerKey = key.toLowerCase();
                    if (lowerKey !== 'content-type' && lowerKey !== 'authorization') {
                        headers[key] = value;
                    }
                }
            }
            const requestBody = {
                model: modelName,
                prompt: 'A simple red circle on white background',
                n: 1,
                size: '256x256',
                ...(extraBody && typeof extraBody === 'object' ? extraBody : {}),
            };
            try {
                const response = await fetchWithTimeout(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(requestBody),
                }, HEALTH_CHECK_TIMEOUT_MS);
                const latencyMs = Date.now() - startTime;
                const responseText = await response.text();
                if (!response.ok) {
                    imageGen = { passed: false, status: response.status, message: `Image generation failed with status ${response.status}`, latencyMs };
                    logHealthCheckDetail('Image Generation', modelName, url, requestBody, imageGen, responseText);
                }
                else {
                    let data;
                    try {
                        data = JSON.parse(responseText);
                    }
                    catch {
                        imageGen = { passed: false, status: response.status, message: 'Response is not valid JSON', latencyMs };
                        logHealthCheckDetail('Image Generation', modelName, url, requestBody, imageGen, responseText);
                    }
                    if (!imageGen) {
                        const imageData = data?.data?.[0];
                        if (imageData && (imageData.url || imageData.b64_json)) {
                            imageGen = { passed: true, status: response.status, message: `OK: image generated successfully`, latencyMs };
                        }
                        else {
                            imageGen = { passed: false, status: response.status, message: 'No image data in response (expected data[0].url or data[0].b64_json)', latencyMs };
                        }
                        logHealthCheckDetail('Image Generation', modelName, url, requestBody, imageGen, responseText.length > 500 ? responseText.substring(0, 500) + '...' : responseText);
                    }
                }
            }
            catch (error) {
                const latencyMs = Date.now() - startTime;
                const errMsg = error instanceof Error
                    ? (error.name === 'AbortError' ? `Timed out after ${HEALTH_CHECK_TIMEOUT_MS / 1000}s` : `Connection failed: ${error.message}`)
                    : 'Unknown error';
                imageGen = { passed: false, message: errMsg, latencyMs };
                logHealthCheckDetail('Image Generation', modelName, url, requestBody, imageGen, errMsg);
            }
        }
        console.log(`[Test-Image] Model "${modelName}" (provider: ${imageProvider || 'default'}) -> ${imageGen.passed ? 'PASS' : 'FAIL'} (${imageGen.latencyMs}ms)`);
        res.json({
            imageGen: imageGen,
            passed: imageGen.passed,
        });
    }
    catch (error) {
        console.error('Model test-image error:', error);
        res.status(500).json({ error: 'Failed to test image model' });
    }
});
/**
 * POST /admin/models/test-embedding
 * 임베딩 모델 테스트
 * Body: { endpointUrl, modelName, apiKey?, extraHeaders? }
 */
adminRoutes.post('/models/test-embedding', async (req, res) => {
    try {
        const testSchema = z.object({
            endpointUrl: z.string().url(),
            modelName: z.string().min(1),
            apiKey: z.string().optional(),
            extraHeaders: z.record(z.string()).optional(),
        });
        const validation = testSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid request', details: validation.error.issues });
            return;
        }
        const { endpointUrl, modelName, apiKey, extraHeaders: extraHdrs } = validation.data;
        const url = buildEmbeddingsUrl(endpointUrl);
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey)
            headers['Authorization'] = `Bearer ${apiKey}`;
        if (extraHdrs) {
            for (const [key, value] of Object.entries(extraHdrs)) {
                const lk = key.toLowerCase();
                if (lk !== 'content-type' && lk !== 'authorization')
                    headers[key] = value;
            }
        }
        const startTime = Date.now();
        const requestBody = { model: modelName, input: 'Hello world, this is a test embedding request.' };
        let embedding;
        try {
            const response = await fetchWithTimeout(url, {
                method: 'POST', headers, body: JSON.stringify(requestBody),
            }, HEALTH_CHECK_TIMEOUT_MS);
            const latencyMs = Date.now() - startTime;
            const responseText = await response.text();
            if (!response.ok) {
                embedding = { passed: false, status: response.status, message: `Embedding request failed (${response.status})`, latencyMs };
            }
            else {
                try {
                    const data = JSON.parse(responseText);
                    const vec = data?.data?.[0]?.embedding;
                    if (Array.isArray(vec) && vec.length > 0) {
                        embedding = { passed: true, status: response.status, message: `OK: ${vec.length}-dim embedding`, latencyMs, dimensions: vec.length };
                    }
                    else {
                        embedding = { passed: false, status: response.status, message: 'No embedding vector in response (expected data[0].embedding)', latencyMs };
                    }
                }
                catch {
                    embedding = { passed: false, status: response.status, message: 'Response is not valid JSON', latencyMs };
                }
            }
        }
        catch (err) {
            embedding = { passed: false, message: err.message || 'Connection failed', latencyMs: Date.now() - startTime };
        }
        console.log(`[Test-Embedding] Model "${modelName}" -> ${embedding.passed ? 'PASS' : 'FAIL'} (${embedding.latencyMs}ms)`);
        res.json({ embedding, passed: embedding.passed });
    }
    catch (error) {
        console.error('Model test-embedding error:', error);
        res.status(500).json({ error: 'Failed to test embedding model' });
    }
});
/**
 * POST /admin/models/test-rerank
 * 리랭킹 모델 테스트
 * Body: { endpointUrl, modelName, apiKey?, extraHeaders? }
 */
adminRoutes.post('/models/test-rerank', async (req, res) => {
    try {
        const testSchema = z.object({
            endpointUrl: z.string().url(),
            modelName: z.string().min(1),
            apiKey: z.string().optional(),
            extraHeaders: z.record(z.string()).optional(),
        });
        const validation = testSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid request', details: validation.error.issues });
            return;
        }
        const { endpointUrl, modelName, apiKey, extraHeaders: extraHdrs } = validation.data;
        const url = buildRerankUrl(endpointUrl);
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey)
            headers['Authorization'] = `Bearer ${apiKey}`;
        if (extraHdrs) {
            for (const [key, value] of Object.entries(extraHdrs)) {
                const lk = key.toLowerCase();
                if (lk !== 'content-type' && lk !== 'authorization')
                    headers[key] = value;
            }
        }
        const startTime = Date.now();
        const requestBody = {
            model: modelName,
            query: 'What is machine learning?',
            documents: [
                'Machine learning is a subset of artificial intelligence.',
                'The weather today is sunny and warm.',
                'Deep learning uses neural networks with many layers.',
            ],
        };
        let rerank;
        try {
            const response = await fetchWithTimeout(url, {
                method: 'POST', headers, body: JSON.stringify(requestBody),
            }, HEALTH_CHECK_TIMEOUT_MS);
            const latencyMs = Date.now() - startTime;
            const responseText = await response.text();
            if (!response.ok) {
                rerank = { passed: false, status: response.status, message: `Rerank request failed (${response.status})`, latencyMs };
            }
            else {
                try {
                    const data = JSON.parse(responseText);
                    // Jina/vLLM rerank format: { results: [{ index, relevance_score }] }
                    const results = data?.results || data?.data;
                    if (Array.isArray(results) && results.length > 0 && results[0].relevance_score !== undefined) {
                        rerank = { passed: true, status: response.status, message: `OK: ${results.length} results reranked`, latencyMs };
                    }
                    else {
                        rerank = { passed: false, status: response.status, message: 'No rerank results in response (expected results[].relevance_score)', latencyMs };
                    }
                }
                catch {
                    rerank = { passed: false, status: response.status, message: 'Response is not valid JSON', latencyMs };
                }
            }
        }
        catch (err) {
            rerank = { passed: false, message: err.message || 'Connection failed', latencyMs: Date.now() - startTime };
        }
        console.log(`[Test-Rerank] Model "${modelName}" -> ${rerank.passed ? 'PASS' : 'FAIL'} (${rerank.latencyMs}ms)`);
        res.json({ rerank, passed: rerank.passed });
    }
    catch (error) {
        console.error('Model test-rerank error:', error);
        res.status(500).json({ error: 'Failed to test rerank model' });
    }
});
/**
 * POST /admin/models/test-asr
 * ASR (음성 인식) 모델 테스트
 * Body: { endpointUrl, modelName, apiKey?, extraHeaders?, asrMethod? }
 * asrMethod: AUDIO_URL (vLLM chat/completions) | OPENAI_TRANSCRIBE (Whisper multipart)
 */
adminRoutes.post('/models/test-asr', async (req, res) => {
    try {
        const testSchema = z.object({
            endpointUrl: z.string().url(),
            modelName: z.string().min(1),
            apiKey: z.string().optional(),
            extraHeaders: z.record(z.string()).optional(),
            asrMethod: z.string().optional(),
        });
        const validation = testSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid request', details: validation.error.issues });
            return;
        }
        const { endpointUrl, modelName, apiKey, extraHeaders: extraHdrs, asrMethod } = validation.data;
        const method = asrMethod || 'AUDIO_URL';
        const headers = {};
        if (apiKey)
            headers['Authorization'] = `Bearer ${apiKey}`;
        if (extraHdrs) {
            for (const [key, value] of Object.entries(extraHdrs)) {
                const lk = key.toLowerCase();
                if (lk !== 'content-type' && lk !== 'authorization')
                    headers[key] = value;
            }
        }
        // 1초 무음 WAV 생성
        const wavBuffer = generateSilentWavBuffer(1);
        const startTime = Date.now();
        let asr;
        try {
            if (method === 'OPENAI_TRANSCRIBE') {
                // Whisper 호환: multipart/form-data → /audio/transcriptions
                const url = buildAudioTranscriptionsUrl(endpointUrl);
                const formData = new FormData();
                formData.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'test.wav');
                formData.append('model', modelName);
                formData.append('response_format', 'json');
                const response = await fetchWithTimeout(url, {
                    method: 'POST',
                    headers,
                    body: formData,
                }, 60000); // ASR 테스트 60초 타임아웃
                const latencyMs = Date.now() - startTime;
                const responseText = await response.text();
                if (!response.ok) {
                    asr = { passed: false, status: response.status, message: `ASR request failed (${response.status}): ${responseText.substring(0, 500)}`, latencyMs };
                }
                else {
                    try {
                        const data = JSON.parse(responseText);
                        if (data.text !== undefined) {
                            asr = { passed: true, status: response.status, message: `OK: Transcription received (${data.text.length} chars)`, latencyMs };
                        }
                        else {
                            asr = { passed: false, status: response.status, message: 'Response missing "text" field', latencyMs };
                        }
                    }
                    catch {
                        asr = { passed: false, status: response.status, message: 'Response is not valid JSON', latencyMs };
                    }
                }
            }
            else {
                // AUDIO_URL: base64 audio → /chat/completions (vLLM 방식)
                const url = buildChatCompletionsUrl(endpointUrl);
                const wavBase64 = wavBuffer.toString('base64');
                headers['Content-Type'] = 'application/json';
                const requestBody = {
                    model: modelName,
                    messages: [
                        {
                            role: 'user',
                            content: [
                                {
                                    type: 'input_audio',
                                    input_audio: { data: wavBase64, format: 'wav' },
                                },
                            ],
                        },
                    ],
                    max_tokens: 256,
                    temperature: 0.0,
                    stream: false,
                };
                const response = await fetchWithTimeout(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(requestBody),
                }, 60000);
                const latencyMs = Date.now() - startTime;
                const responseText = await response.text();
                if (!response.ok) {
                    asr = { passed: false, status: response.status, message: `ASR request failed (${response.status}): ${responseText.substring(0, 500)}`, latencyMs };
                }
                else {
                    try {
                        const data = JSON.parse(responseText);
                        const content = data?.choices?.[0]?.message?.content;
                        if (content !== undefined) {
                            asr = { passed: true, status: response.status, message: `OK: ASR response received (${String(content).length} chars)`, latencyMs };
                        }
                        else {
                            asr = { passed: false, status: response.status, message: 'Response missing choices[0].message.content', latencyMs };
                        }
                    }
                    catch {
                        asr = { passed: false, status: response.status, message: 'Response is not valid JSON', latencyMs };
                    }
                }
            }
        }
        catch (err) {
            asr = { passed: false, message: err.message || 'Connection failed', latencyMs: Date.now() - startTime };
        }
        console.log(`[Test-ASR] Model "${modelName}" method=${method} -> ${asr.passed ? 'PASS' : 'FAIL'} (${asr.latencyMs}ms)`);
        res.json({ asr, passed: asr.passed });
    }
    catch (error) {
        console.error('Model test-asr error:', error);
        res.status(500).json({ error: 'Failed to test ASR model' });
    }
});
// ==================== Users Management ====================
/**
 * GET /admin/users
 * Get all users with usage stats (excluding anonymous and users with 0 calls)
 * Query: ?serviceId= (optional), ?page=, ?limit=
 * - ADMIN: filtered by their dept
 */
adminRoutes.get('/users', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query['page']) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query['limit']) || 50));
        const skip = (page - 1) * limit;
        const serviceId = req.query['serviceId'];
        // Build where clause
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const whereClause = {
            loginid: { not: 'anonymous' },
            usageLogs: {
                some: getServiceFilter(serviceId),
            },
        };
        // Dept-scoped admins see only users from their business unit
        if (!req.isSuperAdmin && req.adminBusinessUnit) {
            whereClause['businessUnit'] = req.adminBusinessUnit;
        }
        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where: whereClause,
                skip,
                take: limit,
                orderBy: { lastActive: 'desc' },
                include: {
                    _count: {
                        select: { usageLogs: serviceId ? { where: { serviceId } } : true },
                    },
                },
            }),
            prisma.user.count({
                where: whereClause,
            }),
        ]);
        res.json({
            users,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    }
    catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: 'Failed to get users' });
    }
});
/**
 * GET /admin/users/:id
 * Get user details with usage history
 * Query: ?serviceId= (optional)
 */
adminRoutes.get('/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const serviceId = req.query['serviceId'];
        const user = await prisma.user.findUnique({
            where: { id },
            include: {
                usageLogs: {
                    where: getServiceFilter(serviceId),
                    orderBy: { timestamp: 'desc' },
                    take: 100,
                    include: {
                        model: {
                            select: { name: true, displayName: true },
                        },
                        service: {
                            select: { id: true, name: true, displayName: true },
                        },
                    },
                },
            },
        });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        // Dept-scoped admins can only view users from their BU
        if (!req.isSuperAdmin && req.adminBusinessUnit) {
            if (user.businessUnit !== req.adminBusinessUnit) {
                res.status(403).json({ error: 'No access to this user' });
                return;
            }
        }
        res.json({ user });
    }
    catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: 'Failed to get user' });
    }
});
/**
 * GET /admin/users/:id/admin-status
 * 사용자의 admin 상태 조회
 */
adminRoutes.get('/users/:id/admin-status', async (req, res) => {
    try {
        const { id } = req.params;
        const user = await prisma.user.findUnique({
            where: { id },
            select: { loginid: true, username: true },
        });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        // 환경변수 Super Admin 체크
        const isEnvSuperAdmin = isSuperAdminByEnv(user.loginid);
        if (isEnvSuperAdmin) {
            res.json({
                isAdmin: true,
                adminRole: 'SUPER_ADMIN',
                isSuperAdmin: true,
                canModify: false,
            });
            return;
        }
        // DB admin 체크
        const admin = await prisma.admin.findUnique({
            where: { loginid: user.loginid },
        });
        res.json({
            isAdmin: !!admin,
            adminRole: admin?.role || null,
            isSuperAdmin: false,
            canModify: true,
            deptname: admin?.deptname || null,
            businessUnit: admin?.businessUnit || null,
            designatedBy: admin?.designatedBy || null,
        });
    }
    catch (error) {
        console.error('Get user admin status error:', error);
        res.status(500).json({ error: 'Failed to get admin status' });
    }
});
/**
 * POST /admin/users/:id/promote
 * 사용자를 Admin으로 승격 (SUPER_ADMIN만)
 * Body: { role: 'ADMIN' }
 */
adminRoutes.post('/users/:id/promote', requireSuperAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { role } = req.body;
        if (!role || !['ADMIN', 'SUPER_ADMIN'].includes(role)) {
            res.status(400).json({ error: 'role must be ADMIN or SUPER_ADMIN' });
            return;
        }
        // Get user
        const user = await prisma.user.findUnique({
            where: { id },
            select: { loginid: true, username: true, deptname: true, businessUnit: true },
        });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        // 환경변수 Super Admin은 승격 불가
        if (isSuperAdminByEnv(user.loginid)) {
            res.status(400).json({ error: 'Environment super admins cannot be promoted' });
            return;
        }
        // Upsert admin record with dept info and designatedBy
        const admin = await prisma.admin.upsert({
            where: { loginid: user.loginid },
            update: {
                role,
                deptname: user.deptname || '',
                businessUnit: user.businessUnit || extractBusinessUnit(user.deptname || ''),
                designatedBy: req.user.loginid,
            },
            create: {
                loginid: user.loginid,
                role,
                deptname: user.deptname || '',
                businessUnit: user.businessUnit || extractBusinessUnit(user.deptname || ''),
                designatedBy: req.user.loginid,
            },
        });
        recordAudit(req, 'PROMOTE_USER', user.loginid, 'User', { username: user.username, role }).catch(() => { });
        res.json({
            success: true,
            admin,
            message: `${user.username} promoted to ${role}`,
        });
    }
    catch (error) {
        console.error('Promote user error:', error);
        res.status(500).json({ error: 'Failed to promote user' });
    }
});
/**
 * DELETE /admin/users/:id/demote
 * Admin 권한 해제 (SUPER_ADMIN만)
 */
adminRoutes.delete('/users/:id/demote', requireSuperAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        // Get user
        const user = await prisma.user.findUnique({
            where: { id },
            select: { loginid: true, username: true },
        });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        // 환경변수 Super Admin은 해제 불가
        if (isSuperAdminByEnv(user.loginid)) {
            res.status(400).json({ error: 'Cannot demote environment super admins' });
            return;
        }
        const admin = await prisma.admin.findUnique({
            where: { loginid: user.loginid },
        });
        if (!admin) {
            res.status(400).json({ error: 'User is not an admin' });
            return;
        }
        // Remove entire admin record
        await prisma.admin.delete({
            where: { loginid: user.loginid },
        });
        recordAudit(req, 'DEMOTE_USER', user.loginid, 'User', { username: user.username, previousRole: admin.role }).catch(() => { });
        res.json({
            success: true,
            message: `${user.username} demoted from admin`,
        });
    }
    catch (error) {
        console.error('Demote user error:', error);
        res.status(500).json({ error: 'Failed to demote user' });
    }
});
// ==================== Unified Users (SUPER_ADMIN) ====================
/**
 * GET /admin/unified-users
 * 사용자 관리 (SYSTEM ADMIN 이상)
 * - SUPER_ADMIN: 전체 사용자
 * - ADMIN: 본인 팀(dept) 사용자만
 * Query: ?page=, ?limit=, ?search=, ?serviceId=, ?businessUnit=, ?role=
 */
adminRoutes.get('/unified-users', async (req, res) => {
    try {
        const page = parseInt(req.query['page']) || 1;
        const limit = Math.min(100, parseInt(req.query['limit']) || 50);
        const skip = (page - 1) * limit;
        const search = req.query['search'];
        const serviceId = req.query['serviceId'];
        const businessUnit = req.query['businessUnit'];
        const role = req.query['role'];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const whereClause = {
            loginid: { not: 'anonymous' },
        };
        // SYSTEM ADMIN: 본인 팀 사용자만 보이게 제한
        if (req.adminRole !== 'SUPER_ADMIN') {
            const adminDept = req.adminDept || req.user?.deptname || '';
            if (adminDept) {
                whereClause.deptname = adminDept;
            }
        }
        if (search) {
            whereClause.OR = [
                { loginid: { contains: search, mode: 'insensitive' } },
                { username: { contains: search, mode: 'insensitive' } },
                { deptname: { contains: search, mode: 'insensitive' } },
            ];
        }
        if (businessUnit) {
            whereClause.businessUnit = businessUnit;
        }
        if (serviceId) {
            whereClause.userServices = { some: { serviceId } };
        }
        // Role filter: need to check admin table
        let adminLoginIds;
        if (role === 'SUPER_ADMIN') {
            const developers = (process.env['DEVELOPERS'] || '').split(',').map(s => s.trim()).filter(Boolean);
            const dbSuperAdmins = await prisma.admin.findMany({
                where: { role: 'SUPER_ADMIN' },
                select: { loginid: true },
            });
            adminLoginIds = [...developers, ...dbSuperAdmins.map(a => a.loginid)];
            whereClause.loginid = { in: adminLoginIds, not: 'anonymous' };
        }
        else if (role === 'ADMIN') {
            const dbAdmins = await prisma.admin.findMany({
                where: { role: 'ADMIN' },
                select: { loginid: true },
            });
            adminLoginIds = dbAdmins.map(a => a.loginid);
            whereClause.loginid = { in: adminLoginIds, not: 'anonymous' };
        }
        else if (role === 'USER') {
            const allAdmins = await prisma.admin.findMany({ select: { loginid: true } });
            const developers = (process.env['DEVELOPERS'] || '').split(',').map(s => s.trim()).filter(Boolean);
            const adminIds = new Set([...allAdmins.map(a => a.loginid), ...developers]);
            whereClause.loginid = { notIn: [...adminIds], not: 'anonymous' };
        }
        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where: whereClause,
                skip,
                take: limit,
                orderBy: { lastActive: 'desc' },
                include: {
                    userServices: {
                        include: {
                            service: { select: { id: true, name: true, displayName: true } },
                        },
                    },
                    _count: { select: { usageLogs: true } },
                },
            }),
            prisma.user.count({ where: whereClause }),
        ]);
        // Admin lookup
        const allAdmins = await prisma.admin.findMany({ select: { loginid: true, role: true } });
        const adminMap = new Map(allAdmins.map(a => [a.loginid, a.role]));
        const developers = (process.env['DEVELOPERS'] || '').split(',').map(s => s.trim()).filter(Boolean);
        const mappedUsers = users.map(u => {
            let globalRole = 'USER';
            if (developers.includes(u.loginid)) {
                globalRole = 'SUPER_ADMIN';
            }
            else if (adminMap.has(u.loginid)) {
                globalRole = adminMap.get(u.loginid);
            }
            return {
                id: u.id,
                loginid: u.loginid,
                username: u.username,
                deptname: u.deptname,
                businessUnit: u.businessUnit,
                knoxVerified: u.knoxVerified,
                globalRole,
                firstSeen: u.firstSeen,
                lastActive: u.lastActive,
                totalRequests: u._count.usageLogs,
                serviceStats: u.userServices.map(us => ({
                    serviceId: us.service.id,
                    serviceName: us.service.displayName,
                    firstSeen: us.firstSeen,
                    lastActive: us.lastActive,
                    requestCount: us.requestCount,
                })),
            };
        });
        // Filter options
        const [services, businessUnits] = await Promise.all([
            prisma.service.findMany({
                where: { enabled: true },
                select: { id: true, name: true, displayName: true },
                orderBy: { displayName: 'asc' },
            }),
            prisma.user.findMany({
                where: { businessUnit: { not: null }, loginid: { not: 'anonymous' } },
                select: { businessUnit: true },
                distinct: ['businessUnit'],
            }),
        ]);
        res.json({
            users: mappedUsers,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
            filterOptions: {
                services,
                businessUnits: businessUnits.map(b => b.businessUnit).filter(Boolean),
                deptnames: [],
                roles: ['SUPER_ADMIN', 'ADMIN', 'USER'],
            },
        });
    }
    catch (error) {
        console.error('Get unified users error:', error);
        res.status(500).json({ error: 'Failed to get unified users' });
    }
});
/**
 * PUT /admin/unified-users/:id/permissions
 * 사용자 권한 변경
 * - SUPER_ADMIN: 모든 역할 변경 가능 (ADMIN, SUPER_ADMIN, USER)
 * - ADMIN: ADMIN 역할만 지정/해제 가능 (본인 팀 사용자만)
 * Body: { globalRole?: 'ADMIN' | 'SUPER_ADMIN' }
 */
adminRoutes.put('/unified-users/:id/permissions', async (req, res) => {
    try {
        const { id } = req.params;
        const { globalRole } = req.body;
        const user = await prisma.user.findUnique({
            where: { id },
            select: { loginid: true, username: true, deptname: true, businessUnit: true },
        });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        if (isSuperAdminByEnv(user.loginid)) {
            res.status(400).json({ error: 'Cannot modify environment super admin' });
            return;
        }
        // SYSTEM ADMIN 제한: 본인 팀만 + ADMIN 역할만
        if (req.adminRole !== 'SUPER_ADMIN') {
            const adminDept = req.adminDept || req.user?.deptname || '';
            if (user.deptname !== adminDept) {
                res.status(403).json({ error: 'Can only modify users in your department' });
                return;
            }
            if (globalRole === 'SUPER_ADMIN') {
                res.status(403).json({ error: 'Only Super Admin can assign Super Admin role' });
                return;
            }
        }
        if (globalRole === 'ADMIN' || globalRole === 'SUPER_ADMIN') {
            await prisma.admin.upsert({
                where: { loginid: user.loginid },
                update: {
                    role: globalRole,
                    deptname: user.deptname || '',
                    businessUnit: user.businessUnit || extractBusinessUnit(user.deptname || ''),
                    designatedBy: req.user.loginid,
                },
                create: {
                    loginid: user.loginid,
                    role: globalRole,
                    deptname: user.deptname || '',
                    businessUnit: user.businessUnit || extractBusinessUnit(user.deptname || ''),
                    designatedBy: req.user.loginid,
                },
            });
            recordAudit(req, `SET_ROLE_${globalRole}`, user.loginid, 'User', { username: user.username, role: globalRole }).catch(() => { });
        }
        else {
            // globalRole undefined → demote to user
            await prisma.admin.deleteMany({ where: { loginid: user.loginid } });
            recordAudit(req, 'DEMOTE_TO_USER', user.loginid, 'User', { username: user.username }).catch(() => { });
        }
        res.json({ success: true, message: `${user.username} permissions updated` });
    }
    catch (error) {
        console.error('Update unified user permissions error:', error);
        res.status(500).json({ error: 'Failed to update permissions' });
    }
});
// ==================== Rate Limit Management ====================
/**
 * GET /admin/users/:id/rate-limit?serviceId=
 * 사용자의 서비스별 rate limit 조회
 */
adminRoutes.get('/users/:id/rate-limit', async (req, res) => {
    try {
        const { id } = req.params;
        const serviceId = req.query['serviceId'];
        if (!serviceId) {
            res.status(400).json({ error: 'serviceId is required' });
            return;
        }
        // Dept-scoped admin check
        if (!req.isSuperAdmin && req.adminBusinessUnit) {
            const user = await prisma.user.findUnique({ where: { id }, select: { businessUnit: true } });
            if (user && user.businessUnit !== req.adminBusinessUnit) {
                res.status(403).json({ error: 'No access to this user' });
                return;
            }
        }
        const rateLimit = await prisma.userRateLimit.findUnique({
            where: { userId_serviceId: { userId: id, serviceId } },
        });
        res.json({ rateLimit: rateLimit || null });
    }
    catch (error) {
        console.error('Get rate limit error:', error);
        res.status(500).json({ error: 'Failed to get rate limit' });
    }
});
/**
 * GET /admin/rate-limits?serviceId=
 * 서비스의 전체 rate limit 목록 조회
 */
adminRoutes.get('/rate-limits', async (req, res) => {
    try {
        const serviceId = req.query['serviceId'];
        if (!serviceId) {
            res.status(400).json({ error: 'serviceId is required' });
            return;
        }
        const rateLimits = await prisma.userRateLimit.findMany({
            where: { serviceId },
            include: {
                user: { select: { id: true, loginid: true, username: true, deptname: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ rateLimits });
    }
    catch (error) {
        console.error('Get rate limits error:', error);
        res.status(500).json({ error: 'Failed to get rate limits' });
    }
});
/**
 * PUT /admin/users/:id/rate-limit
 * 사용자의 서비스별 rate limit 설정/수정
 * Body: { serviceId, maxTokens, window: 'FIVE_HOURS' | 'DAY', enabled? }
 */
adminRoutes.put('/users/:id/rate-limit', async (req, res) => {
    try {
        const { id } = req.params;
        const { serviceId, maxTokens, window: windowType, enabled } = req.body;
        if (!serviceId || maxTokens === undefined || maxTokens === null || !windowType) {
            res.status(400).json({ error: 'serviceId, maxTokens, and window are required' });
            return;
        }
        if (!['FIVE_HOURS', 'DAY'].includes(windowType)) {
            res.status(400).json({ error: 'window must be FIVE_HOURS or DAY' });
            return;
        }
        if (typeof maxTokens !== 'number' || maxTokens < 1) {
            res.status(400).json({ error: 'maxTokens must be at least 1' });
            return;
        }
        // Verify user exists
        const user = await prisma.user.findUnique({ where: { id } });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        // Dept-scoped admin check
        if (!req.isSuperAdmin && req.adminBusinessUnit) {
            if (user.businessUnit !== req.adminBusinessUnit) {
                res.status(403).json({ error: 'No access to this user' });
                return;
            }
        }
        const rateLimit = await prisma.userRateLimit.upsert({
            where: { userId_serviceId: { userId: id, serviceId } },
            update: {
                maxTokens,
                window: windowType,
                enabled: enabled !== undefined ? enabled : true,
                createdBy: req.user.loginid,
            },
            create: {
                userId: id,
                serviceId,
                maxTokens,
                window: windowType,
                enabled: enabled !== undefined ? enabled : true,
                createdBy: req.user.loginid,
            },
        });
        res.json({ rateLimit, message: 'Rate limit updated' });
    }
    catch (error) {
        console.error('Set rate limit error:', error);
        res.status(500).json({ error: 'Failed to set rate limit' });
    }
});
/**
 * DELETE /admin/users/:id/rate-limit?serviceId=
 * 사용자의 서비스별 rate limit 삭제 (무제한으로 복원)
 */
adminRoutes.delete('/users/:id/rate-limit', async (req, res) => {
    try {
        const { id } = req.params;
        const serviceId = req.query['serviceId'] || req.body?.serviceId;
        if (!serviceId) {
            res.status(400).json({ error: 'serviceId is required' });
            return;
        }
        // Dept-scoped admin check
        const user = await prisma.user.findUnique({ where: { id } });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        if (!req.isSuperAdmin && req.adminBusinessUnit) {
            if (user.businessUnit !== req.adminBusinessUnit) {
                res.status(403).json({ error: 'No access to this user' });
                return;
            }
        }
        const existing = await prisma.userRateLimit.findUnique({
            where: { userId_serviceId: { userId: id, serviceId } },
        });
        if (!existing) {
            res.status(404).json({ error: 'Rate limit not found' });
            return;
        }
        await prisma.userRateLimit.delete({
            where: { userId_serviceId: { userId: id, serviceId } },
        });
        res.json({ success: true, message: 'Rate limit removed (unlimited)' });
    }
    catch (error) {
        console.error('Delete rate limit error:', error);
        res.status(500).json({ error: 'Failed to delete rate limit' });
    }
});
// ==================== Statistics (서비스별 필터링 지원) ====================
/**
 * GET /admin/stats/overview
 * Get dashboard overview statistics
 * Query: ?serviceId= (optional)
 * - ADMIN: filtered by their dept
 */
adminRoutes.get('/stats/overview', async (req, res) => {
    try {
        const serviceId = req.query['serviceId'];
        const serviceFilter = getServiceFilter(serviceId);
        // Dept-scoped filter for non-super admins
        const deptFilter = (!req.isSuperAdmin && req.adminBusinessUnit)
            ? { user: { businessUnit: req.adminBusinessUnit } }
            : {};
        const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
        const [activeUsers, todayUsage, totalUsers, totalModels] = await Promise.all([
            serviceId
                ? prisma.usageLog.groupBy({
                    by: ['userId'],
                    where: {
                        serviceId,
                        timestamp: { gte: thirtyMinutesAgo },
                        user: { loginid: { not: 'anonymous' }, ...((!req.isSuperAdmin && req.adminBusinessUnit) ? { businessUnit: req.adminBusinessUnit } : {}) },
                    },
                }).then((r) => r.length)
                : getActiveUserCount(redis),
            getTodayUsage(redis),
            prisma.user.count({
                where: {
                    isActive: true,
                    loginid: { not: 'anonymous' },
                    usageLogs: { some: serviceFilter },
                    ...((!req.isSuperAdmin && req.adminBusinessUnit) ? { businessUnit: req.adminBusinessUnit } : {}),
                },
            }),
            prisma.model.count({
                where: { enabled: true, endpointUrl: { not: 'external://auto-created' } },
            }),
        ]);
        // 서비스별 today's usage (DB에서 계산)
        let serviceTodayUsage = todayUsage;
        if (serviceId) {
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const todayStats = await prisma.usageLog.aggregate({
                where: {
                    serviceId,
                    timestamp: { gte: todayStart },
                    ...deptFilter,
                },
                _sum: {
                    inputTokens: true,
                    outputTokens: true,
                    totalTokens: true,
                    requestCount: true,
                },
            });
            serviceTodayUsage = {
                requests: todayStats._sum?.requestCount || 0,
                inputTokens: todayStats._sum.inputTokens || 0,
                outputTokens: todayStats._sum.outputTokens || 0,
            };
        }
        res.json({
            activeUsers,
            todayUsage: serviceTodayUsage,
            totalUsers,
            totalModels,
            serviceId: serviceId || null,
        });
    }
    catch (error) {
        console.error('Get overview stats error:', error);
        res.status(500).json({ error: 'Failed to get statistics' });
    }
});
/**
 * GET /admin/stats/daily
 * Get daily usage for charts (UsageLog 직접 SQL 집계)
 * Query: ?serviceId= (optional), ?days=
 */
adminRoutes.get('/stats/daily', async (req, res) => {
    try {
        const days = parseInt(req.query['days']) || 30;
        const serviceId = req.query['serviceId'];
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        startDate.setHours(0, 0, 0, 0);
        // UsageLog를 날짜별로 SQL 집계
        let whereClause = `WHERE ul.timestamp >= $1`;
        const params = [startDate];
        let paramIdx = 2;
        if (serviceId) {
            whereClause += ` AND ul.service_id = $${paramIdx}`;
            params.push(serviceId);
            paramIdx++;
        }
        if (!req.isSuperAdmin && req.adminBusinessUnit) {
            whereClause += ` AND u.business_unit = $${paramIdx}`;
            params.push(req.adminBusinessUnit);
            paramIdx++;
        }
        const dailyStats = await prisma.$queryRawUnsafe(`
      SELECT
        DATE(ul.timestamp) as date,
        COALESCE(SUM(ul."inputTokens"), 0) as total_input,
        COALESCE(SUM(ul."outputTokens"), 0) as total_output,
        COALESCE(SUM(request_count), 0) as req_count
      FROM usage_logs ul
      LEFT JOIN users u ON ul.user_id = u.id
      ${whereClause}
      GROUP BY DATE(ul.timestamp)
      ORDER BY date ASC
    `, ...params);
        const result = dailyStats.map(r => ({
            date: typeof r.date === 'string' ? r.date : new Date(r.date).toISOString().split('T')[0],
            _sum: {
                totalInputTokens: Number(r.total_input),
                totalOutputTokens: Number(r.total_output),
                requestCount: Number(r.req_count),
            },
        }));
        res.json({ dailyStats: result });
    }
    catch (error) {
        console.error('Get daily stats error:', error);
        res.status(500).json({ error: 'Failed to get daily statistics' });
    }
});
/**
 * GET /admin/stats/by-user
 * Get usage grouped by user (excluding anonymous)
 * Query: ?serviceId= (optional), ?days=
 */
adminRoutes.get('/stats/by-user', async (req, res) => {
    try {
        const days = parseInt(req.query['days']) || 30;
        const serviceId = req.query['serviceId'];
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const userStats = await prisma.usageLog.groupBy({
            by: ['userId'],
            where: {
                timestamp: { gte: startDate },
                user: {
                    loginid: { not: 'anonymous' },
                    ...((!req.isSuperAdmin && req.adminBusinessUnit) ? { businessUnit: req.adminBusinessUnit } : {}),
                },
                ...getServiceFilter(serviceId),
            },
            _sum: {
                inputTokens: true,
                outputTokens: true,
                totalTokens: true,
            },
            _count: true,
            orderBy: {
                _sum: {
                    totalTokens: 'desc',
                },
            },
            take: 20,
        });
        // Get user details
        const userIds = userStats.map((s) => s.userId).filter((id) => id !== null);
        const users = await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, loginid: true, username: true, deptname: true },
        });
        const userMap = new Map(users.map((u) => [u.id, u]));
        const statsWithUsers = userStats.map((s) => ({
            ...s,
            user: s.userId ? userMap.get(s.userId) : null,
        }));
        res.json({ userStats: statsWithUsers });
    }
    catch (error) {
        console.error('Get user stats error:', error);
        res.status(500).json({ error: 'Failed to get user statistics' });
    }
});
/**
 * GET /admin/stats/by-model
 * Get usage grouped by model
 * Query: ?serviceId= (optional), ?days=
 */
adminRoutes.get('/stats/by-model', async (req, res) => {
    try {
        const days = parseInt(req.query['days']) || 30;
        const serviceId = req.query['serviceId'];
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const modelStats = await prisma.usageLog.groupBy({
            by: ['modelId'],
            where: {
                timestamp: { gte: startDate },
                ...getServiceFilter(serviceId),
                ...((!req.isSuperAdmin && req.adminBusinessUnit) ? { user: { businessUnit: req.adminBusinessUnit } } : {}),
            },
            _sum: {
                inputTokens: true,
                outputTokens: true,
                totalTokens: true,
            },
            _count: true,
            orderBy: {
                _sum: {
                    totalTokens: 'desc',
                },
            },
        });
        // Get model details
        const modelIds = modelStats.map((s) => s.modelId);
        const models = await prisma.model.findMany({
            where: { id: { in: modelIds } },
            select: { id: true, name: true, displayName: true },
        });
        const modelMap = new Map(models.map((m) => [m.id, m]));
        const statsWithModels = modelStats.map((s) => ({
            ...s,
            model: modelMap.get(s.modelId),
        }));
        res.json({ modelStats: statsWithModels });
    }
    catch (error) {
        console.error('Get model stats error:', error);
        res.status(500).json({ error: 'Failed to get model statistics' });
    }
});
/**
 * GET /admin/stats/by-dept
 * Get usage grouped by department (UsageLog 직접 SQL 집계)
 * Query: ?serviceId= (optional), ?days=
 */
adminRoutes.get('/stats/by-dept', async (req, res) => {
    try {
        const days = parseInt(req.query['days']) || 30;
        const serviceId = req.query['serviceId'];
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        let whereClause = `WHERE ul.timestamp >= $1`;
        const params = [startDate];
        let paramIdx = 2;
        if (serviceId) {
            whereClause += ` AND ul.service_id = $${paramIdx}`;
            params.push(serviceId);
            paramIdx++;
        }
        if (!req.isSuperAdmin && req.adminBusinessUnit) {
            whereClause += ` AND u.business_unit = $${paramIdx}`;
            params.push(req.adminBusinessUnit);
            paramIdx++;
        }
        const deptStats = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE(u.deptname, 'Unknown') as deptname,
        COALESCE(SUM(ul."inputTokens"), 0) as total_input,
        COALESCE(SUM(ul."outputTokens"), 0) as total_output,
        COALESCE(SUM(request_count), 0) as req_count
      FROM usage_logs ul
      LEFT JOIN users u ON ul.user_id = u.id
      ${whereClause}
      GROUP BY u.deptname
      ORDER BY total_input DESC
    `, ...params);
        const result = deptStats.map(r => ({
            deptname: r.deptname,
            _sum: {
                totalInputTokens: Number(r.total_input),
                totalOutputTokens: Number(r.total_output),
                requestCount: Number(r.req_count),
            },
        }));
        res.json({ deptStats: result });
    }
    catch (error) {
        console.error('Get dept stats error:', error);
        res.status(500).json({ error: 'Failed to get department statistics' });
    }
});
/**
 * GET /admin/stats/daily-active-users
 * Get daily active user count for charts
 * Query: ?serviceId= (optional), ?days= (14-365)
 */
adminRoutes.get('/stats/daily-active-users', async (req, res) => {
    try {
        const days = Math.min(365, Math.max(14, parseInt(req.query['days']) || 30));
        const serviceId = req.query['serviceId'];
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        startDate.setHours(0, 0, 0, 0);
        // Get distinct users per day from usage logs (excluding anonymous)
        let dailyUsers;
        if (serviceId) {
            dailyUsers = await prisma.$queryRaw `
        SELECT DATE(ul.timestamp) as date, COUNT(DISTINCT ul.user_id) as user_count
        FROM usage_logs ul
        INNER JOIN users u ON ul.user_id = u.id
        WHERE ul.timestamp >= ${startDate}
          AND u.loginid != 'anonymous'
          AND ul.service_id::text = ${serviceId}
        GROUP BY DATE(ul.timestamp)
        ORDER BY date ASC
      `;
        }
        else {
            dailyUsers = await prisma.$queryRaw `
        SELECT DATE(ul.timestamp) as date, COUNT(DISTINCT ul.user_id) as user_count
        FROM usage_logs ul
        INNER JOIN users u ON ul.user_id = u.id
        WHERE ul.timestamp >= ${startDate}
          AND u.loginid != 'anonymous'
        GROUP BY DATE(ul.timestamp)
        ORDER BY date ASC
      `;
        }
        const chartData = dailyUsers.map((item) => ({
            date: formatDateToString(item.date),
            userCount: Number(item.user_count),
        }));
        // Get total unique users in period
        let totalUsers;
        if (serviceId) {
            totalUsers = await prisma.$queryRaw `
        SELECT COUNT(DISTINCT ul.user_id) as count
        FROM usage_logs ul
        INNER JOIN users u ON ul.user_id = u.id
        WHERE ul.timestamp >= ${startDate}
          AND u.loginid != 'anonymous'
          AND ul.service_id::text = ${serviceId}
      `;
        }
        else {
            totalUsers = await prisma.$queryRaw `
        SELECT COUNT(DISTINCT ul.user_id) as count
        FROM usage_logs ul
        INNER JOIN users u ON ul.user_id = u.id
        WHERE ul.timestamp >= ${startDate}
          AND u.loginid != 'anonymous'
      `;
        }
        res.json({
            chartData,
            totalUniqueUsers: Number(totalUsers[0]?.count || 0),
        });
    }
    catch (error) {
        console.error('Get daily active users error:', error);
        res.status(500).json({ error: 'Failed to get daily active users' });
    }
});
/**
 * GET /admin/stats/cumulative-users
 * Get cumulative unique user count by date
 * Query: ?serviceId= (optional), ?days= (14-365)
 */
adminRoutes.get('/stats/cumulative-users', async (req, res) => {
    try {
        const days = Math.min(365, Math.max(14, parseInt(req.query['days']) || 30));
        const serviceId = req.query['serviceId'];
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        startDate.setHours(0, 0, 0, 0);
        // Get the first usage date for each user
        let userFirstUsage;
        let existingUsers;
        if (serviceId) {
            userFirstUsage = await prisma.$queryRaw `
        SELECT DATE(first_usage) as first_date, COUNT(*) as new_users
        FROM (
          SELECT ul.user_id, MIN(ul.timestamp) as first_usage
          FROM usage_logs ul
          INNER JOIN users u ON ul.user_id = u.id
          WHERE u.loginid != 'anonymous'
            AND ul.service_id::text = ${serviceId}
          GROUP BY ul.user_id
        ) as user_first
        WHERE first_usage >= ${startDate}
        GROUP BY DATE(first_usage)
        ORDER BY first_date ASC
      `;
            existingUsers = await prisma.$queryRaw `
        SELECT COUNT(DISTINCT ul.user_id) as count
        FROM usage_logs ul
        INNER JOIN users u ON ul.user_id = u.id
        WHERE ul.timestamp < ${startDate}
          AND u.loginid != 'anonymous'
          AND ul.service_id::text = ${serviceId}
      `;
        }
        else {
            userFirstUsage = await prisma.$queryRaw `
        SELECT DATE(first_usage) as first_date, COUNT(*) as new_users
        FROM (
          SELECT ul.user_id, MIN(ul.timestamp) as first_usage
          FROM usage_logs ul
          INNER JOIN users u ON ul.user_id = u.id
          WHERE u.loginid != 'anonymous'
          GROUP BY ul.user_id
        ) as user_first
        WHERE first_usage >= ${startDate}
        GROUP BY DATE(first_usage)
        ORDER BY first_date ASC
      `;
            existingUsers = await prisma.$queryRaw `
        SELECT COUNT(DISTINCT ul.user_id) as count
        FROM usage_logs ul
        INNER JOIN users u ON ul.user_id = u.id
        WHERE ul.timestamp < ${startDate}
          AND u.loginid != 'anonymous'
      `;
        }
        let cumulativeCount = Number(existingUsers[0]?.count || 0);
        const newUsersMap = new Map(userFirstUsage.map((item) => [
            formatDateToString(item.first_date),
            Number(item.new_users),
        ]));
        const chartData = [];
        const endDate = new Date();
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const dateStr = toLocalDateString(d);
            const newUsers = newUsersMap.get(dateStr) || 0;
            cumulativeCount += newUsers;
            chartData.push({
                date: dateStr,
                cumulativeUsers: cumulativeCount,
                newUsers,
            });
        }
        res.json({
            chartData,
            totalUsers: cumulativeCount,
        });
    }
    catch (error) {
        console.error('Get cumulative users error:', error);
        res.status(500).json({ error: 'Failed to get cumulative users' });
    }
});
/**
 * GET /admin/stats/model-daily-trend
 * Get daily usage trend per model (for line chart)
 * Query: ?serviceId= (optional), ?days= (14-365)
 */
adminRoutes.get('/stats/model-daily-trend', async (req, res) => {
    try {
        const days = Math.min(365, Math.max(14, parseInt(req.query['days']) || 30));
        const serviceId = req.query['serviceId'];
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        startDate.setHours(0, 0, 0, 0);
        // Get models that were actually USED
        let modelIds;
        if (serviceId) {
            const usedModels = await prisma.$queryRaw `
        SELECT DISTINCT model_id
        FROM usage_logs
        WHERE timestamp >= ${startDate}
          AND service_id::text = ${serviceId}
      `;
            modelIds = usedModels.map((m) => m.model_id);
        }
        else {
            const usedModels = await prisma.$queryRaw `
        SELECT DISTINCT model_id
        FROM usage_logs
        WHERE timestamp >= ${startDate}
      `;
            modelIds = usedModels.map((m) => m.model_id);
        }
        // Get model details for the used models
        const models = await prisma.model.findMany({
            where: { id: { in: modelIds } },
            select: { id: true, name: true, displayName: true },
        });
        // Get daily stats grouped by model and date
        let dailyStats;
        if (serviceId) {
            dailyStats = await prisma.$queryRaw `
        SELECT DATE(timestamp) as date, model_id, SUM("totalTokens") as total_tokens
        FROM usage_logs
        WHERE timestamp >= ${startDate}
          AND service_id::text = ${serviceId}
        GROUP BY DATE(timestamp), model_id
        ORDER BY date ASC
      `;
        }
        else {
            dailyStats = await prisma.$queryRaw `
        SELECT DATE(timestamp) as date, model_id, SUM("totalTokens") as total_tokens
        FROM usage_logs
        WHERE timestamp >= ${startDate}
        GROUP BY DATE(timestamp), model_id
        ORDER BY date ASC
      `;
        }
        // Process into date-keyed structure
        const dateMap = new Map();
        const existingModelIds = models.map((m) => m.id);
        const endDate1 = new Date();
        for (let d = new Date(startDate); d <= endDate1; d.setDate(d.getDate() + 1)) {
            const dateStr = toLocalDateString(d);
            const initialData = {};
            for (const modelId of existingModelIds) {
                initialData[modelId] = 0;
            }
            dateMap.set(dateStr, initialData);
        }
        for (const stat of dailyStats) {
            const dateStr = formatDateToString(stat.date);
            const existing = dateMap.get(dateStr);
            if (existing) {
                existing[stat.model_id] = Number(stat.total_tokens);
            }
        }
        const chartData = Array.from(dateMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, modelUsage]) => ({
            date,
            ...modelUsage,
        }));
        res.json({
            models: models.map((m) => ({ id: m.id, name: m.name, displayName: m.displayName })),
            chartData,
        });
    }
    catch (error) {
        console.error('Get model daily trend error:', error);
        res.status(500).json({ error: 'Failed to get model daily trend' });
    }
});
/**
 * GET /admin/stats/model-user-trend
 * Get daily usage trend per user for a specific model
 * Query: modelId (required), ?serviceId=, ?days= (14-365), ?topN= (10-100)
 */
adminRoutes.get('/stats/model-user-trend', async (req, res) => {
    try {
        const modelId = req.query['modelId'];
        if (!modelId) {
            res.status(400).json({ error: 'modelId is required' });
            return;
        }
        const days = Math.min(365, Math.max(14, parseInt(req.query['days']) || 30));
        const topN = Math.min(100, Math.max(10, parseInt(req.query['topN']) || 10));
        const serviceId = req.query['serviceId'];
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        startDate.setHours(0, 0, 0, 0);
        // Get top N users by total usage for this model
        const topUsers = await prisma.usageLog.groupBy({
            by: ['userId'],
            where: {
                modelId,
                timestamp: { gte: startDate },
                user: {
                    loginid: { not: 'anonymous' },
                },
                ...getServiceFilter(serviceId),
            },
            _sum: {
                totalTokens: true,
            },
            orderBy: {
                _sum: {
                    totalTokens: 'desc',
                },
            },
            take: topN,
        });
        const topUserIds = topUsers.map((u) => u.userId).filter((id) => id !== null);
        // Get user details
        const users = await prisma.user.findMany({
            where: { id: { in: topUserIds } },
            select: { id: true, loginid: true, username: true, deptname: true },
        });
        // Get daily stats for these users
        let dailyStats;
        if (serviceId) {
            dailyStats = await prisma.$queryRaw `
        SELECT DATE(timestamp) as date, user_id, SUM("totalTokens") as total_tokens
        FROM usage_logs
        WHERE model_id::text = ${modelId}
          AND user_id::text = ANY(${topUserIds})
          AND timestamp >= ${startDate}
          AND service_id::text = ${serviceId}
        GROUP BY DATE(timestamp), user_id
        ORDER BY date ASC
      `;
        }
        else {
            dailyStats = await prisma.$queryRaw `
        SELECT DATE(timestamp) as date, user_id, SUM("totalTokens") as total_tokens
        FROM usage_logs
        WHERE model_id::text = ${modelId}
          AND user_id::text = ANY(${topUserIds})
          AND timestamp >= ${startDate}
        GROUP BY DATE(timestamp), user_id
        ORDER BY date ASC
      `;
        }
        // Process into date-keyed structure
        const dateMap = new Map();
        const endDate2 = new Date();
        for (let d = new Date(startDate); d <= endDate2; d.setDate(d.getDate() + 1)) {
            const dateStr = toLocalDateString(d);
            const initialData = {};
            for (const userId of topUserIds) {
                if (userId)
                    initialData[userId] = 0;
            }
            dateMap.set(dateStr, initialData);
        }
        for (const stat of dailyStats) {
            const dateStr = formatDateToString(stat.date);
            const existing = dateMap.get(dateStr);
            if (existing) {
                existing[stat.user_id] = Number(stat.total_tokens);
            }
        }
        const chartData = Array.from(dateMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, userUsage]) => ({
            date,
            ...userUsage,
        }));
        const usersWithTotal = users.map((u) => {
            const total = topUsers.find((t) => t.userId === u.id)?._sum.totalTokens || 0;
            return { ...u, totalTokens: total };
        }).sort((a, b) => (b.totalTokens || 0) - (a.totalTokens || 0));
        res.json({
            users: usersWithTotal,
            chartData,
        });
    }
    catch (error) {
        console.error('Get model user trend error:', error);
        res.status(500).json({ error: 'Failed to get model user trend' });
    }
});
// ==================== LLM Latency Statistics ====================
/**
 * GET /admin/stats/latency
 * LLM 응답 지연시간 통계 (서비스+모델별)
 * - 10분/30분/1시간/일평균
 */
adminRoutes.get('/stats/latency', async (req, res) => {
    try {
        const now = new Date();
        const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
        const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        // 서비스+모델별 latency 집계 쿼리
        const latencyStats = await prisma.$queryRaw `
      SELECT
        s.id as service_id,
        s."displayName" as service_name,
        m.id as model_id,
        m."displayName" as model_name,
        AVG(CASE WHEN ul.timestamp >= ${tenMinutesAgo} THEN ul.latency_ms END) as avg_10m,
        AVG(CASE WHEN ul.timestamp >= ${thirtyMinutesAgo} THEN ul.latency_ms END) as avg_30m,
        AVG(CASE WHEN ul.timestamp >= ${oneHourAgo} THEN ul.latency_ms END) as avg_1h,
        AVG(CASE WHEN ul.timestamp >= ${oneDayAgo} THEN ul.latency_ms END) as avg_24h,
        COUNT(CASE WHEN ul.timestamp >= ${tenMinutesAgo} AND ul.latency_ms IS NOT NULL THEN 1 END) as count_10m,
        COUNT(CASE WHEN ul.timestamp >= ${thirtyMinutesAgo} AND ul.latency_ms IS NOT NULL THEN 1 END) as count_30m,
        COUNT(CASE WHEN ul.timestamp >= ${oneHourAgo} AND ul.latency_ms IS NOT NULL THEN 1 END) as count_1h,
        COUNT(CASE WHEN ul.timestamp >= ${oneDayAgo} AND ul.latency_ms IS NOT NULL THEN 1 END) as count_24h
      FROM usage_logs ul
      INNER JOIN services s ON ul.service_id = s.id
      INNER JOIN models m ON ul.model_id = m.id
      WHERE ul.latency_ms IS NOT NULL
        AND ul.timestamp >= ${oneDayAgo}
      GROUP BY s.id, s."displayName", m.id, m."displayName"
      ORDER BY s."displayName", m."displayName"
    `;
        // 결과 포맷팅
        const stats = latencyStats.map(row => ({
            serviceId: row.service_id,
            serviceName: row.service_name,
            modelId: row.model_id,
            modelName: row.model_name,
            avg10m: row.avg_10m ? Math.round(row.avg_10m) : null,
            avg30m: row.avg_30m ? Math.round(row.avg_30m) : null,
            avg1h: row.avg_1h ? Math.round(row.avg_1h) : null,
            avg24h: row.avg_24h ? Math.round(row.avg_24h) : null,
            count10m: Number(row.count_10m),
            count30m: Number(row.count_30m),
            count1h: Number(row.count_1h),
            count24h: Number(row.count_24h),
        }));
        res.json({ stats, timestamp: now.toISOString() });
    }
    catch (error) {
        console.error('Get latency stats error:', error);
        res.status(500).json({ error: 'Failed to get latency statistics' });
    }
});
/**
 * GET /admin/stats/latency/history
 * LLM 응답 지연시간 시계열 데이터 (차트용)
 * Query: ?hours=24 (기본 24시간), ?interval=10 (분 단위, 기본 10분)
 */
adminRoutes.get('/stats/latency/history', async (req, res) => {
    try {
        const hours = Math.min(72, Math.max(1, parseInt(req.query['hours']) || 24));
        const interval = Math.min(60, Math.max(5, parseInt(req.query['interval']) || 10));
        const now = new Date();
        const startTime = new Date();
        startTime.setHours(startTime.getHours() - hours);
        // Generate all time buckets for the range
        const allBuckets = [];
        const bucketStart = new Date(startTime);
        bucketStart.setMinutes(Math.floor(bucketStart.getMinutes() / interval) * interval, 0, 0);
        while (bucketStart <= now) {
            allBuckets.push(new Date(bucketStart));
            bucketStart.setMinutes(bucketStart.getMinutes() + interval);
        }
        // interval 분 단위로 집계
        const historyData = await prisma.$queryRaw `
      SELECT
        date_trunc('hour', ul.timestamp) +
          (EXTRACT(minute FROM ul.timestamp)::int / ${interval}) * interval '${interval} minutes' as time_bucket,
        s.id as service_id,
        s."displayName" as service_name,
        m.id as model_id,
        m."displayName" as model_name,
        AVG(ul.latency_ms) as avg_latency,
        COALESCE(SUM(request_count), 0) as request_count
      FROM usage_logs ul
      INNER JOIN services s ON ul.service_id = s.id
      INNER JOIN models m ON ul.model_id = m.id
      WHERE ul.latency_ms IS NOT NULL
        AND ul.timestamp >= ${startTime}
      GROUP BY time_bucket, s.id, s."displayName", m.id, m."displayName"
      ORDER BY time_bucket ASC, s."displayName", m."displayName"
    `;
        // Get unique service/model combinations that have any data in the period
        const uniqueKeys = new Set();
        const dataMap = new Map();
        for (const row of historyData) {
            const key = `${row.service_name} / ${row.model_name}`;
            uniqueKeys.add(key);
            if (!dataMap.has(key)) {
                dataMap.set(key, new Map());
            }
            dataMap.get(key).set(row.time_bucket.toISOString(), {
                avgLatency: Math.round(row.avg_latency),
                count: Number(row.request_count),
            });
        }
        // Build complete history with 0 for missing time buckets
        const groupedData = {};
        for (const key of uniqueKeys) {
            const keyDataMap = dataMap.get(key);
            groupedData[key] = allBuckets.map(bucket => {
                const bucketTime = bucket.toISOString();
                const data = keyDataMap.get(bucketTime);
                return {
                    time: bucketTime,
                    avgLatency: data?.avgLatency ?? 0,
                    count: data?.count ?? 0,
                };
            });
        }
        res.json({
            history: groupedData,
            startTime: startTime.toISOString(),
            endTime: now.toISOString(),
            intervalMinutes: interval,
        });
    }
    catch (error) {
        console.error('Get latency history error:', error);
        res.status(500).json({ error: 'Failed to get latency history' });
    }
});
/**
 * GET /admin/stats/latency/healthcheck
 * 헬스체크 기반 응답 지연 이력 (10분 간격 프로빙 결과)
 * Query: ?hours=24
 */
adminRoutes.get('/stats/latency/healthcheck', async (req, res) => {
    try {
        const hours = Math.min(72, Math.max(1, parseInt(req.query['hours']) || 24));
        const startTime = new Date();
        startTime.setHours(startTime.getHours() - hours);
        const checks = await prisma.healthCheckLog.findMany({
            where: { checkedAt: { gte: startTime } },
            orderBy: { checkedAt: 'asc' },
            select: {
                modelName: true,
                latencyMs: true,
                success: true,
                statusCode: true,
                errorMessage: true,
                checkedAt: true,
            },
        });
        // 모델별로 그룹핑
        const grouped = {};
        for (const c of checks) {
            if (!grouped[c.modelName])
                grouped[c.modelName] = [];
            grouped[c.modelName].push({
                time: c.checkedAt.toISOString(),
                latency: c.latencyMs,
                success: c.success,
                error: c.errorMessage || undefined,
            });
        }
        res.json({ history: grouped, startTime: startTime.toISOString() });
    }
    catch (error) {
        console.error('Get healthcheck history error:', error);
        res.status(500).json({ error: 'Failed to get healthcheck history' });
    }
});
// ==================== Global Statistics (전체 서비스 통합) ====================
/**
 * GET /admin/stats/global/overview
 * 전체 서비스 통합 통계 (Main Dashboard용)
 */
adminRoutes.get('/stats/global/overview', async (req, res) => {
    try {
        // Get all services with stats
        const services = await prisma.service.findMany({
            where: { enabled: true },
            select: {
                id: true,
                name: true,
                displayName: true,
                _count: {
                    select: {
                        usageLogs: true,
                    },
                },
            },
        });
        // Get per-service statistics
        const serviceStats = await Promise.all(services.map(async (service) => {
            const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
            const [totalUsers, todayRequests, todayActiveUsers, avgDailyUsers, avgDailyUsersExcluding, totalTokens, totalRequests] = await Promise.all([
                // Total unique users for this service
                prisma.usageLog.groupBy({
                    by: ['userId'],
                    where: {
                        serviceId: service.id,
                        user: { loginid: { not: 'anonymous' } },
                    },
                }).then((r) => r.length),
                // Today's requests
                prisma.usageLog.aggregate({
                    where: {
                        serviceId: service.id,
                        timestamp: { gte: todayStart },
                    },
                    _sum: { requestCount: true },
                }).then((r) => r._sum.requestCount || 0),
                // Today's active users (distinct)
                prisma.$queryRaw `
            SELECT COUNT(DISTINCT ul.user_id) as count
            FROM usage_logs ul
            INNER JOIN users u ON ul.user_id = u.id
            WHERE ul.service_id::text = ${service.id}
              AND ul.timestamp >= ${todayStart}
              AND u.loginid != 'anonymous'
          `.then((r) => Number(r[0]?.count || 0)),
                // Average daily active users (last 30 days, excluding anonymous)
                prisma.$queryRaw `
            SELECT COALESCE(AVG(user_count), 0)::float as avg_users
            FROM (
              SELECT DATE(ul.timestamp), COUNT(DISTINCT ul.user_id) as user_count
              FROM usage_logs ul
              INNER JOIN users u ON ul.user_id = u.id
              WHERE ul.service_id::text = ${service.id}
                AND ul.timestamp >= NOW() - INTERVAL '30 days'
                AND u.loginid != 'anonymous'
              GROUP BY DATE(ul.timestamp)
            ) daily_counts
          `.then((r) => Math.round(r[0]?.avg_users || 0)),
                // Average daily active users EXCLUDING weekends and holidays
                prisma.$queryRaw `
            SELECT COALESCE(AVG(user_count), 0)::float as avg_users
            FROM (
              SELECT DATE(ul.timestamp) as log_date, COUNT(DISTINCT ul.user_id) as user_count
              FROM usage_logs ul
              INNER JOIN users u ON ul.user_id = u.id
              WHERE ul.service_id::text = ${service.id}
                AND ul.timestamp >= NOW() - INTERVAL '30 days'
                AND u.loginid != 'anonymous'
                AND EXTRACT(DOW FROM ul.timestamp) NOT IN (0, 6)
                AND NOT EXISTS (
                  SELECT 1 FROM holidays h
                  WHERE h.date = DATE(ul.timestamp)
                )
              GROUP BY DATE(ul.timestamp)
            ) daily_counts
          `.then((r) => Math.round(r[0]?.avg_users || 0)),
                // Total tokens
                prisma.usageLog.aggregate({
                    where: { serviceId: service.id },
                    _sum: { totalTokens: true },
                }).then((r) => r._sum.totalTokens || 0),
                // Total requests (cumulative)
                prisma.usageLog.aggregate({
                    where: { serviceId: service.id },
                    _sum: { requestCount: true },
                }).then((r) => r._sum.requestCount || 0),
            ]);
            return {
                serviceId: service.id,
                serviceName: service.name,
                serviceDisplayName: service.displayName,
                totalUsers,
                todayRequests,
                todayActiveUsers,
                avgDailyActiveUsers: avgDailyUsers,
                avgDailyActiveUsersExcluding: avgDailyUsersExcluding,
                totalTokens,
                totalRequests,
            };
        }));
        // Overall totals - deduplicate users across services
        const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
        const [uniqueUsersResult, todayActiveResult, avgDailyActiveResult, avgDailyActiveExcludingResult] = await Promise.all([
            prisma.$queryRaw `
        SELECT COUNT(DISTINCT user_id) as count
        FROM usage_logs ul
        INNER JOIN users u ON ul.user_id = u.id
        WHERE u.loginid != 'anonymous'
      `,
            prisma.$queryRaw `
        SELECT COUNT(DISTINCT ul.user_id) as count
        FROM usage_logs ul
        INNER JOIN users u ON ul.user_id = u.id
        WHERE u.loginid != 'anonymous'
          AND ul.timestamp >= ${todayStart}
      `,
            prisma.$queryRaw `
        SELECT COALESCE(AVG(user_count), 0)::float as avg_users
        FROM (
          SELECT DATE(ul.timestamp), COUNT(DISTINCT ul.user_id) as user_count
          FROM usage_logs ul
          INNER JOIN users u ON ul.user_id = u.id
          WHERE u.loginid != 'anonymous'
            AND ul.timestamp >= NOW() - INTERVAL '30 days'
          GROUP BY DATE(ul.timestamp)
        ) daily_counts
      `,
            prisma.$queryRaw `
        SELECT COALESCE(AVG(user_count), 0)::float as avg_users
        FROM (
          SELECT DATE(ul.timestamp) as log_date, COUNT(DISTINCT ul.user_id) as user_count
          FROM usage_logs ul
          INNER JOIN users u ON ul.user_id = u.id
          WHERE u.loginid != 'anonymous'
            AND ul.timestamp >= NOW() - INTERVAL '30 days'
            AND EXTRACT(DOW FROM ul.timestamp) NOT IN (0, 6)
            AND NOT EXISTS (
              SELECT 1 FROM holidays h
              WHERE h.date = DATE(ul.timestamp)
            )
          GROUP BY DATE(ul.timestamp)
        ) daily_counts
      `,
        ]);
        const uniqueTotalUsers = Number(uniqueUsersResult[0]?.count || 0);
        const todayActive = Number(todayActiveResult[0]?.count || 0);
        const avgDailyActive = Math.round(avgDailyActiveResult[0]?.avg_users || 0);
        const avgDailyActiveExcluding = Math.round(avgDailyActiveExcludingResult[0]?.avg_users || 0);
        const totals = {
            totalServices: services.length,
            totalUsers: uniqueTotalUsers,
            todayActiveUsers: todayActive,
            avgDailyActiveUsers: avgDailyActive,
            avgDailyActiveUsersExcluding: avgDailyActiveExcluding,
            totalRequests: serviceStats.reduce((sum, s) => sum + Number(s.totalRequests), 0),
            totalTokens: serviceStats.reduce((sum, s) => sum + Number(s.totalTokens), 0),
        };
        res.json({
            services: serviceStats,
            totals,
        });
    }
    catch (error) {
        console.error('Get global overview error:', error);
        res.status(500).json({ error: 'Failed to get global overview' });
    }
});
/**
 * GET /admin/stats/global/by-service
 * 서비스별 누적 사용량 (시계열)
 * Query: ?days= (14-365)
 */
adminRoutes.get('/stats/global/by-service', async (req, res) => {
    try {
        const days = Math.min(365, Math.max(14, parseInt(req.query['days']) || 30));
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        startDate.setHours(0, 0, 0, 0);
        // Get all services
        const services = await prisma.service.findMany({
            where: { enabled: true },
            select: { id: true, name: true, displayName: true },
        });
        // Get daily stats per service
        const dailyStats = await prisma.$queryRaw `
      SELECT DATE(timestamp) as date, service_id, SUM("totalTokens") as total_tokens, COALESCE(SUM(request_count), 0) as req_count
      FROM usage_logs
      WHERE timestamp >= ${startDate}
        AND service_id IS NOT NULL
      GROUP BY DATE(timestamp), service_id
      ORDER BY date ASC
    `;
        // Process into chart data
        const dateMap = new Map();
        const serviceIds = services.map((s) => s.id);
        const endDate3 = new Date();
        for (let d = new Date(startDate); d <= endDate3; d.setDate(d.getDate() + 1)) {
            const dateStr = toLocalDateString(d);
            const initialData = {};
            for (const serviceId of serviceIds) {
                initialData[serviceId] = 0;
            }
            dateMap.set(dateStr, initialData);
        }
        for (const stat of dailyStats) {
            const dateStr = formatDateToString(stat.date);
            const existing = dateMap.get(dateStr);
            if (existing && stat.service_id) {
                existing[stat.service_id] = Number(stat.total_tokens);
            }
        }
        const chartData = Array.from(dateMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, serviceUsage]) => ({
            date,
            ...serviceUsage,
        }));
        // dailyData: 프론트엔드 ServiceDailyData[] 형태로도 변환
        const serviceMap = new Map(services.map(s => [s.id, s]));
        const dailyData = [];
        for (const stat of dailyStats) {
            const dateStr = formatDateToString(stat.date);
            const svc = serviceMap.get(stat.service_id);
            if (svc) {
                dailyData.push({
                    date: dateStr,
                    serviceId: svc.id,
                    serviceName: svc.displayName || svc.name,
                    requests: Number(stat.req_count),
                    totalTokens: Number(stat.total_tokens),
                });
            }
        }
        res.json({
            services: services.map((s) => ({ id: s.id, name: s.name, displayName: s.displayName })),
            chartData,
            dailyData,
        });
    }
    catch (error) {
        console.error('Get global by-service stats error:', error);
        res.status(500).json({ error: 'Failed to get service statistics' });
    }
});
/**
 * GET /admin/stats/weekly-business-dau
 * 서비스별 DAU (주말/휴일 제외)
 * Query: ?days= (14-365, default 90), ?granularity= ('daily' | 'weekly', default 'weekly')
 */
adminRoutes.get('/stats/weekly-business-dau', async (req, res) => {
    try {
        const days = Math.min(365, Math.max(14, parseInt(req.query['days']) || 90));
        const granularity = req.query['granularity'] === 'daily' ? 'daily' : 'weekly';
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        startDate.setHours(0, 0, 0, 0);
        // Get all enabled services (include type for BACKGROUND estimation)
        const services = await prisma.service.findMany({
            where: { enabled: true },
            select: { id: true, name: true, displayName: true, type: true },
        });
        const serviceIds = services.map((s) => s.id);
        const standardServiceIds = services.filter(s => s.type === 'STANDARD').map(s => s.id);
        const backgroundServiceIds = services.filter(s => s.type === 'BACKGROUND').map(s => s.id);
        // STANDARD baseline: 1인당 하루 평균 호출 수 (해당 기간 영업일 기준)
        const [baselineDailyRes, baselineDauRes] = await Promise.all([
            prisma.$queryRaw `
        WITH daily_calls AS (
          SELECT DATE(timestamp) as d, COUNT(*) as cnt
          FROM usage_logs
          WHERE timestamp >= ${startDate}
            AND service_id::text = ANY(${standardServiceIds})
            AND EXTRACT(DOW FROM timestamp) NOT IN (0, 6)
            AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = DATE(timestamp))
          GROUP BY DATE(timestamp)
        )
        SELECT COALESCE(AVG(cnt), 0)::float as avg_daily_calls, COUNT(*) as business_days FROM daily_calls
      `,
            prisma.$queryRaw `
        WITH daily_dau AS (
          SELECT DATE(ul.timestamp) as d, COUNT(DISTINCT ul.user_id) as dau
          FROM usage_logs ul INNER JOIN users u ON ul.user_id = u.id
          WHERE ul.timestamp >= ${startDate}
            AND ul.service_id::text = ANY(${standardServiceIds})
            AND u.loginid != 'anonymous'
            AND EXTRACT(DOW FROM ul.timestamp) NOT IN (0, 6)
            AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = DATE(ul.timestamp))
          GROUP BY DATE(ul.timestamp)
        )
        SELECT COALESCE(AVG(dau), 0)::float as avg_daily_dau FROM daily_dau
      `,
        ]);
        const avgDailyCalls = baselineDailyRes[0]?.avg_daily_calls || 0;
        const avgDailyDau = baselineDauRes[0]?.avg_daily_dau || 0;
        const callsPerPersonPerDay = avgDailyDau > 0 ? avgDailyCalls / avgDailyDau : 0;
        const businessDaysUsed = Number(baselineDailyRes[0]?.business_days || 0);
        if (granularity === 'daily') {
            // Daily DAU per service (business days only) — STANDARD
            const dailyStats = await prisma.$queryRaw `
        SELECT
          ul.service_id::text as service_id,
          DATE(ul.timestamp) as log_date,
          COUNT(DISTINCT ul.user_id) as user_count
        FROM usage_logs ul
        INNER JOIN users u ON ul.user_id = u.id
        WHERE ul.timestamp >= ${startDate}
          AND u.loginid != 'anonymous'
          AND EXTRACT(DOW FROM ul.timestamp) NOT IN (0, 6)
          AND NOT EXISTS (
            SELECT 1 FROM holidays h
            WHERE h.date = DATE(ul.timestamp)
          )
        GROUP BY ul.service_id, DATE(ul.timestamp)
        ORDER BY log_date ASC, service_id
      `;
            // BACKGROUND services: daily total API calls (영업일)
            const bgDailyStats = backgroundServiceIds.length > 0 ? await prisma.$queryRaw `
        SELECT
          service_id::text as service_id,
          DATE(timestamp) as log_date,
          COALESCE(SUM(request_count), 0) as call_count
        FROM usage_logs
        WHERE timestamp >= ${startDate}
          AND service_id::text = ANY(${backgroundServiceIds})
          AND EXTRACT(DOW FROM timestamp) NOT IN (0, 6)
          AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = DATE(timestamp))
        GROUP BY service_id, DATE(timestamp)
        ORDER BY log_date ASC
      ` : [];
            // Process into chart data format
            const dateMap = new Map();
            // Collect all dates from STANDARD
            for (const stat of dailyStats) {
                const dateStr = formatDateToString(stat.log_date);
                if (!dateMap.has(dateStr)) {
                    const initialData = {};
                    for (const serviceId of serviceIds) {
                        initialData[serviceId] = 0;
                    }
                    dateMap.set(dateStr, initialData);
                }
            }
            // Also collect dates from BACKGROUND
            for (const stat of bgDailyStats) {
                const dateStr = formatDateToString(stat.log_date);
                if (!dateMap.has(dateStr)) {
                    const initialData = {};
                    for (const serviceId of serviceIds) {
                        initialData[serviceId] = 0;
                    }
                    dateMap.set(dateStr, initialData);
                }
            }
            // Fill STANDARD DAU (실측)
            for (const stat of dailyStats) {
                const dateStr = formatDateToString(stat.log_date);
                const existing = dateMap.get(dateStr);
                if (existing && serviceIds.includes(stat.service_id)) {
                    existing[stat.service_id] = Number(stat.user_count);
                }
            }
            // Fill BACKGROUND estimated DAU
            const bgDailyDetailMap = new Map(); // "serviceId|date" → dailyCalls
            if (callsPerPersonPerDay > 0) {
                for (const stat of bgDailyStats) {
                    const dateStr = formatDateToString(stat.log_date);
                    const existing = dateMap.get(dateStr);
                    const dailyCalls = Number(stat.call_count);
                    if (existing) {
                        existing[stat.service_id] = Math.round(dailyCalls / callsPerPersonPerDay);
                    }
                    bgDailyDetailMap.set(`${stat.service_id}|${dateStr}`, dailyCalls);
                }
            }
            const chartData = Array.from(dateMap.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([date, serviceUsage]) => ({
                week: date,
                ...serviceUsage,
            }));
            res.json({
                services: services.map((s) => ({ id: s.id, name: s.name, displayName: s.displayName, type: s.type })),
                chartData,
                granularity,
                estimationMeta: {
                    callsPerPersonPerDay: Math.round(callsPerPersonPerDay * 10) / 10,
                    standardAvgDailyDAU: Math.round(avgDailyDau),
                    standardAvgDailyCalls: Math.round(avgDailyCalls),
                    businessDays: businessDaysUsed,
                },
            });
        }
        else {
            // Weekly average DAU — STANDARD
            const weeklyStats = await prisma.$queryRaw `
        WITH business_day_users AS (
          SELECT
            ul.service_id::text as service_id,
            DATE(ul.timestamp) as log_date,
            DATE_TRUNC('week', ul.timestamp)::date as week_start,
            COUNT(DISTINCT ul.user_id) as user_count
          FROM usage_logs ul
          INNER JOIN users u ON ul.user_id = u.id
          WHERE ul.timestamp >= ${startDate}
            AND u.loginid != 'anonymous'
            AND EXTRACT(DOW FROM ul.timestamp) NOT IN (0, 6)
            AND NOT EXISTS (
              SELECT 1 FROM holidays h
              WHERE h.date = DATE(ul.timestamp)
            )
          GROUP BY ul.service_id, DATE(ul.timestamp), DATE_TRUNC('week', ul.timestamp)
        )
        SELECT
          service_id,
          week_start,
          COALESCE(AVG(user_count), 0)::float as avg_daily_users,
          COUNT(DISTINCT log_date) as business_days
        FROM business_day_users
        GROUP BY service_id, week_start
        ORDER BY week_start ASC, service_id
      `;
            // BACKGROUND services: weekly average daily calls (영업일)
            const bgWeeklyStats = backgroundServiceIds.length > 0 ? await prisma.$queryRaw `
        WITH daily_calls AS (
          SELECT
            service_id::text as service_id,
            DATE_TRUNC('week', timestamp)::date as week_start,
            DATE(timestamp) as d,
            COUNT(*) as cnt
          FROM usage_logs
          WHERE timestamp >= ${startDate}
            AND service_id::text = ANY(${backgroundServiceIds})
            AND EXTRACT(DOW FROM timestamp) NOT IN (0, 6)
            AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = DATE(timestamp))
          GROUP BY service_id, DATE_TRUNC('week', timestamp), DATE(timestamp)
        )
        SELECT service_id, week_start, COALESCE(AVG(cnt), 0)::float as avg_daily_calls
        FROM daily_calls GROUP BY service_id, week_start
        ORDER BY week_start ASC
      ` : [];
            // Process into chart data format
            const weekMap = new Map();
            for (const stat of weeklyStats) {
                const weekStr = formatDateToString(stat.week_start);
                if (!weekMap.has(weekStr)) {
                    const initialData = {};
                    for (const serviceId of serviceIds) {
                        initialData[serviceId] = 0;
                    }
                    weekMap.set(weekStr, initialData);
                }
            }
            for (const stat of bgWeeklyStats) {
                const weekStr = formatDateToString(stat.week_start);
                if (!weekMap.has(weekStr)) {
                    const initialData = {};
                    for (const serviceId of serviceIds) {
                        initialData[serviceId] = 0;
                    }
                    weekMap.set(weekStr, initialData);
                }
            }
            // Fill STANDARD (실측)
            for (const stat of weeklyStats) {
                const weekStr = formatDateToString(stat.week_start);
                const existing = weekMap.get(weekStr);
                if (existing && serviceIds.includes(stat.service_id)) {
                    existing[stat.service_id] = Math.round(stat.avg_daily_users);
                }
            }
            // Fill BACKGROUND (추정)
            if (callsPerPersonPerDay > 0) {
                for (const stat of bgWeeklyStats) {
                    const weekStr = formatDateToString(stat.week_start);
                    const existing = weekMap.get(weekStr);
                    if (existing) {
                        existing[stat.service_id] = Math.round(stat.avg_daily_calls / callsPerPersonPerDay);
                    }
                }
            }
            const chartData = Array.from(weekMap.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([week, serviceUsage]) => ({
                week,
                ...serviceUsage,
            }));
            res.json({
                services: services.map((s) => ({ id: s.id, name: s.name, displayName: s.displayName, type: s.type })),
                chartData,
                granularity,
                estimationMeta: {
                    callsPerPersonPerDay: Math.round(callsPerPersonPerDay * 10) / 10,
                    standardAvgDailyDAU: Math.round(avgDailyDau),
                    standardAvgDailyCalls: Math.round(avgDailyCalls),
                    businessDays: businessDaysUsed,
                },
            });
        }
    }
    catch (error) {
        console.error('Get weekly business DAU error:', error);
        res.status(500).json({ error: 'Failed to get weekly business DAU' });
    }
});
/**
 * GET /admin/stats/global/by-dept
 * 사업부별 통합 통계 (Main Dashboard용)
 * Query: ?days= (30), ?serviceId= (optional)
 */
adminRoutes.get('/stats/global/by-dept', async (req, res) => {
    try {
        const days = parseInt(req.query['days']) || 30;
        const serviceId = req.query['serviceId'];
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        startDate.setHours(0, 0, 0, 0);
        // Get business unit statistics
        let buUsers;
        let buDailyAvg;
        let buModelTokens;
        // 1. 사업부별 누적 사용자 (중복 제거)
        if (serviceId) {
            buUsers = await prisma.$queryRaw `
        SELECT u.business_unit, COUNT(DISTINCT ul.user_id) as user_count
        FROM usage_logs ul
        INNER JOIN users u ON ul.user_id = u.id
        WHERE u.loginid != 'anonymous'
          AND u.business_unit IS NOT NULL
          AND u.business_unit != ''
          AND ul.service_id::text = ${serviceId}
        GROUP BY u.business_unit
        ORDER BY user_count DESC
      `;
        }
        else {
            buUsers = await prisma.$queryRaw `
        SELECT u.business_unit, COUNT(DISTINCT ul.user_id) as user_count
        FROM usage_logs ul
        INNER JOIN users u ON ul.user_id = u.id
        WHERE u.loginid != 'anonymous'
          AND u.business_unit IS NOT NULL
          AND u.business_unit != ''
        GROUP BY u.business_unit
        ORDER BY user_count DESC
      `;
        }
        // 2. 사업부별 평균 일별 활성 사용자
        if (serviceId) {
            buDailyAvg = await prisma.$queryRaw `
        SELECT business_unit, COALESCE(AVG(daily_count), 0)::float as avg_daily_users
        FROM (
          SELECT u.business_unit, DATE(ul.timestamp), COUNT(DISTINCT ul.user_id) as daily_count
          FROM usage_logs ul
          INNER JOIN users u ON ul.user_id = u.id
          WHERE u.loginid != 'anonymous'
            AND u.business_unit IS NOT NULL
            AND u.business_unit != ''
            AND ul.timestamp >= ${startDate}
            AND ul.service_id::text = ${serviceId}
          GROUP BY u.business_unit, DATE(ul.timestamp)
        ) daily_stats
        GROUP BY business_unit
      `;
        }
        else {
            buDailyAvg = await prisma.$queryRaw `
        SELECT business_unit, COALESCE(AVG(daily_count), 0)::float as avg_daily_users
        FROM (
          SELECT u.business_unit, DATE(ul.timestamp), COUNT(DISTINCT ul.user_id) as daily_count
          FROM usage_logs ul
          INNER JOIN users u ON ul.user_id = u.id
          WHERE u.loginid != 'anonymous'
            AND u.business_unit IS NOT NULL
            AND u.business_unit != ''
            AND ul.timestamp >= ${startDate}
          GROUP BY u.business_unit, DATE(ul.timestamp)
        ) daily_stats
        GROUP BY business_unit
      `;
        }
        // 3. 사업부별 모델별 토큰 사용량
        if (serviceId) {
            buModelTokens = await prisma.$queryRaw `
        SELECT u.business_unit, m.name as model_name, SUM(ul."totalTokens") as total_tokens
        FROM usage_logs ul
        INNER JOIN users u ON ul.user_id = u.id
        INNER JOIN models m ON ul.model_id = m.id
        WHERE u.loginid != 'anonymous'
          AND u.business_unit IS NOT NULL
          AND u.business_unit != ''
          AND ul.service_id::text = ${serviceId}
        GROUP BY u.business_unit, m.name
        ORDER BY u.business_unit, total_tokens DESC
      `;
        }
        else {
            buModelTokens = await prisma.$queryRaw `
        SELECT u.business_unit, m.name as model_name, SUM(ul."totalTokens") as total_tokens
        FROM usage_logs ul
        INNER JOIN users u ON ul.user_id = u.id
        INNER JOIN models m ON ul.model_id = m.id
        WHERE u.loginid != 'anonymous'
          AND u.business_unit IS NOT NULL
          AND u.business_unit != ''
        GROUP BY u.business_unit, m.name
        ORDER BY u.business_unit, total_tokens DESC
      `;
        }
        // Combine into single response
        const buUserMap = new Map(buUsers.map((d) => [d.business_unit, Number(d.user_count)]));
        const buAvgMap = new Map(buDailyAvg.map((d) => [d.business_unit, Math.round(d.avg_daily_users || 0)]));
        // Group model tokens by business unit
        const buTokensMap = new Map();
        for (const row of buModelTokens) {
            if (!buTokensMap.has(row.business_unit)) {
                buTokensMap.set(row.business_unit, {});
            }
            buTokensMap.get(row.business_unit)[row.model_name] = Number(row.total_tokens);
        }
        // Build final result
        const allBUs = [...new Set([...buUserMap.keys(), ...buAvgMap.keys(), ...buTokensMap.keys()])];
        const deptStats = allBUs
            .map((businessUnit) => {
            const tokensObj = buTokensMap.get(businessUnit) || {};
            const tokensByModel = Object.entries(tokensObj)
                .map(([modelName, tokens]) => ({ modelName, tokens }))
                .sort((a, b) => b.tokens - a.tokens);
            return {
                deptname: businessUnit,
                cumulativeUsers: buUserMap.get(businessUnit) || 0,
                avgDailyActiveUsers: buAvgMap.get(businessUnit) || 0,
                tokensByModel,
                totalTokens: tokensByModel.reduce((sum, t) => sum + t.tokens, 0),
            };
        })
            .sort((a, b) => b.totalTokens - a.totalTokens);
        res.json({
            deptStats,
            totalDepts: deptStats.length,
            periodDays: days,
            serviceId: serviceId || null,
        });
    }
    catch (error) {
        console.error('Get global by-dept stats error:', error);
        res.status(500).json({ error: 'Failed to get department statistics' });
    }
});
/**
 * GET /admin/stats/global/by-dept-daily
 * 사업부별 일별 토큰 사용량 (시계열 - Line Chart용)
 * Query: ?days= (30), ?serviceId= (optional), ?topN= (5)
 */
adminRoutes.get('/stats/global/by-dept-daily', async (req, res) => {
    try {
        const days = parseInt(req.query['days']) || 30;
        const serviceId = req.query['serviceId'];
        const topN = Math.min(10, Math.max(3, parseInt(req.query['topN']) || 5));
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        startDate.setHours(0, 0, 0, 0);
        // 1. Get top N business units by total tokens
        let topBUs;
        if (serviceId) {
            topBUs = await prisma.$queryRaw `
        SELECT u.business_unit, SUM(ul."totalTokens") as total_tokens
        FROM usage_logs ul
        INNER JOIN users u ON ul.user_id = u.id
        WHERE u.loginid != 'anonymous'
          AND u.business_unit IS NOT NULL
          AND u.business_unit != ''
          AND ul.timestamp >= ${startDate}
          AND ul.service_id::text = ${serviceId}
        GROUP BY u.business_unit
        ORDER BY total_tokens DESC
        LIMIT ${topN}
      `;
        }
        else {
            topBUs = await prisma.$queryRaw `
        SELECT u.business_unit, SUM(ul."totalTokens") as total_tokens
        FROM usage_logs ul
        INNER JOIN users u ON ul.user_id = u.id
        WHERE u.loginid != 'anonymous'
          AND u.business_unit IS NOT NULL
          AND u.business_unit != ''
          AND ul.timestamp >= ${startDate}
        GROUP BY u.business_unit
        ORDER BY total_tokens DESC
        LIMIT ${topN}
      `;
        }
        const topBUNames = topBUs.map(b => b.business_unit);
        // 2. Get daily stats for top business units
        let dailyStats;
        if (serviceId) {
            dailyStats = await prisma.$queryRaw `
        SELECT DATE(ul.timestamp) as date, u.business_unit, SUM(ul."totalTokens") as total_tokens
        FROM usage_logs ul
        INNER JOIN users u ON ul.user_id = u.id
        WHERE u.loginid != 'anonymous'
          AND u.business_unit = ANY(${topBUNames})
          AND ul.timestamp >= ${startDate}
          AND ul.service_id::text = ${serviceId}
        GROUP BY DATE(ul.timestamp), u.business_unit
        ORDER BY date ASC
      `;
        }
        else {
            dailyStats = await prisma.$queryRaw `
        SELECT DATE(ul.timestamp) as date, u.business_unit, SUM(ul."totalTokens") as total_tokens
        FROM usage_logs ul
        INNER JOIN users u ON ul.user_id = u.id
        WHERE u.loginid != 'anonymous'
          AND u.business_unit = ANY(${topBUNames})
          AND ul.timestamp >= ${startDate}
        GROUP BY DATE(ul.timestamp), u.business_unit
        ORDER BY date ASC
      `;
        }
        // 3. Build response with CUMULATIVE data
        const dailyMap = new Map();
        const endDate4 = new Date();
        for (let d = new Date(startDate); d <= endDate4; d.setDate(d.getDate() + 1)) {
            const dateStr = toLocalDateString(d);
            const initialData = {};
            for (const bu of topBUNames) {
                initialData[bu] = 0;
            }
            dailyMap.set(dateStr, initialData);
        }
        for (const stat of dailyStats) {
            const dateStr = formatDateToString(stat.date);
            const existing = dailyMap.get(dateStr);
            if (existing) {
                existing[stat.business_unit] = Number(stat.total_tokens);
            }
        }
        // Convert to cumulative
        const sortedDates = Array.from(dailyMap.keys()).sort();
        const cumulativeSum = {};
        for (const bu of topBUNames) {
            cumulativeSum[bu] = 0;
        }
        const chartData = sortedDates.map((date) => {
            const dailyData = dailyMap.get(date);
            const result = { date };
            for (const bu of topBUNames) {
                cumulativeSum[bu] += dailyData[bu] || 0;
                result[bu] = cumulativeSum[bu];
            }
            return result;
        });
        res.json({
            businessUnits: topBUNames,
            chartData,
            periodDays: days,
            serviceId: serviceId || null,
        });
    }
    catch (error) {
        console.error('Get dept daily stats error:', error);
        res.status(500).json({ error: 'Failed to get department daily statistics' });
    }
});
/**
 * GET /admin/stats/global/by-dept-users-daily
 * 사업부별 일별 사용자 수 (누적/활성 - Line Chart용)
 * Query: ?days= (30), ?topN= (5)
 */
adminRoutes.get('/stats/global/by-dept-users-daily', async (req, res) => {
    try {
        const days = parseInt(req.query['days']) || 30;
        const topN = Math.min(10, Math.max(3, parseInt(req.query['topN']) || 5));
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        startDate.setHours(0, 0, 0, 0);
        // 1. Get top N business units by total users
        const topBUs = await prisma.$queryRaw `
      SELECT u.business_unit, COUNT(DISTINCT ul.user_id) as user_count
      FROM usage_logs ul
      INNER JOIN users u ON ul.user_id = u.id
      WHERE u.loginid != 'anonymous'
        AND u.business_unit IS NOT NULL
        AND u.business_unit != ''
        AND ul.timestamp >= ${startDate}
      GROUP BY u.business_unit
      ORDER BY user_count DESC
      LIMIT ${topN}
    `;
        const topBUNames = topBUs.map(b => b.business_unit);
        // 2. Get daily active users for top business units
        const dailyStats = await prisma.$queryRaw `
      SELECT DATE(ul.timestamp) as date, u.business_unit, COUNT(DISTINCT ul.user_id) as active_users
      FROM usage_logs ul
      INNER JOIN users u ON ul.user_id = u.id
      WHERE u.loginid != 'anonymous'
        AND u.business_unit = ANY(${topBUNames})
        AND ul.timestamp >= ${startDate}
      GROUP BY DATE(ul.timestamp), u.business_unit
      ORDER BY date ASC
    `;
        // 3. Build response with cumulative users
        const cumulativeUsers = new Map();
        for (const bu of topBUNames) {
            cumulativeUsers.set(bu, new Set());
        }
        // Get all user_ids per day per BU for cumulative calculation
        const usersByDayBU = await prisma.$queryRaw `
      SELECT DISTINCT DATE(ul.timestamp) as date, u.business_unit, ul.user_id::text
      FROM usage_logs ul
      INNER JOIN users u ON ul.user_id = u.id
      WHERE u.loginid != 'anonymous'
        AND u.business_unit = ANY(${topBUNames})
        AND ul.timestamp >= ${startDate}
      ORDER BY date ASC
    `;
        // Group users by date and BU
        const usersByDateBU = new Map();
        for (const row of usersByDayBU) {
            const dateStr = formatDateToString(row.date);
            if (!usersByDateBU.has(dateStr)) {
                usersByDateBU.set(dateStr, new Map());
            }
            const buMap = usersByDateBU.get(dateStr);
            if (!buMap.has(row.business_unit)) {
                buMap.set(row.business_unit, []);
            }
            buMap.get(row.business_unit).push(row.user_id);
        }
        // Build chart data with proper cumulative calculation
        const chartData = [];
        const endDate5 = new Date();
        for (let d = new Date(startDate); d <= endDate5; d.setDate(d.getDate() + 1)) {
            const dateStr = toLocalDateString(d);
            const dayData = usersByDateBU.get(dateStr);
            // Add users from this day to cumulative sets
            if (dayData) {
                for (const [bu, userIds] of dayData.entries()) {
                    const buSet = cumulativeUsers.get(bu);
                    if (buSet) {
                        for (const userId of userIds) {
                            buSet.add(userId);
                        }
                    }
                }
            }
            // Create data point with current cumulative values
            const item = { date: dateStr };
            for (const bu of topBUNames) {
                item[`${bu}_cumulative`] = cumulativeUsers.get(bu)?.size || 0;
                item[`${bu}_active`] = 0;
            }
            chartData.push(item);
        }
        // Fill in active users
        for (const stat of dailyStats) {
            const dateStr = formatDateToString(stat.date);
            const dataPoint = chartData.find(d => d.date === dateStr);
            if (dataPoint) {
                dataPoint[`${stat.business_unit}_active`] = Number(stat.active_users);
            }
        }
        res.json({
            businessUnits: topBUNames,
            chartData,
            periodDays: days,
        });
    }
    catch (error) {
        console.error('Get dept users daily stats error:', error);
        res.status(500).json({ error: 'Failed to get department users daily statistics' });
    }
});
/**
 * GET /admin/stats/global/by-dept-service-requests-daily
 * 사업부+서비스별 일별 API 요청수 (Line Chart용)
 * Query: ?days= (30), ?topN= (5)
 */
adminRoutes.get('/stats/global/by-dept-service-requests-daily', async (req, res) => {
    try {
        const days = parseInt(req.query['days']) || 30;
        const topN = Math.min(10, Math.max(3, parseInt(req.query['topN']) || 5));
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        startDate.setHours(0, 0, 0, 0);
        // 1. Get top N dept+service combinations by request count
        const topCombos = await prisma.$queryRaw `
      SELECT u.business_unit, s.name as service_name, COALESCE(SUM(request_count), 0) as request_count
      FROM usage_logs ul
      INNER JOIN users u ON ul.user_id = u.id
      INNER JOIN services s ON ul.service_id = s.id
      WHERE u.loginid != 'anonymous'
        AND u.business_unit IS NOT NULL
        AND u.business_unit != ''
        AND ul.timestamp >= ${startDate}
      GROUP BY u.business_unit, s.name
      ORDER BY request_count DESC
      LIMIT ${topN}
    `;
        const comboNames = topCombos.map(c => `${c.business_unit}/${c.service_name}`);
        const topBUs = [...new Set(topCombos.map(c => c.business_unit))];
        const topServices = [...new Set(topCombos.map(c => c.service_name))];
        // 2. Get daily requests for top business units and services
        const dailyStats = await prisma.$queryRaw `
      SELECT DATE(ul.timestamp) as date, u.business_unit, s.name as service_name, COALESCE(SUM(request_count), 0) as requests
      FROM usage_logs ul
      INNER JOIN users u ON ul.user_id = u.id
      INNER JOIN services s ON ul.service_id = s.id
      WHERE u.loginid != 'anonymous'
        AND ul.timestamp >= ${startDate}
        AND u.business_unit = ANY(${topBUs})
        AND s.name = ANY(${topServices})
      GROUP BY DATE(ul.timestamp), u.business_unit, s.name
      ORDER BY date ASC
    `;
        // 3. Build response with CUMULATIVE data
        const dailyMap = new Map();
        const endDate6 = new Date();
        for (let d = new Date(startDate); d <= endDate6; d.setDate(d.getDate() + 1)) {
            const dateStr = toLocalDateString(d);
            const initialData = {};
            for (const combo of comboNames) {
                initialData[combo] = 0;
            }
            dailyMap.set(dateStr, initialData);
        }
        for (const stat of dailyStats) {
            const dateStr = formatDateToString(stat.date);
            const comboKey = `${stat.business_unit}/${stat.service_name}`;
            const existing = dailyMap.get(dateStr);
            if (existing && comboNames.includes(comboKey)) {
                existing[comboKey] = Number(stat.requests);
            }
        }
        // Convert to cumulative
        const sortedDates = Array.from(dailyMap.keys()).sort();
        const cumulativeSum = {};
        for (const combo of comboNames) {
            cumulativeSum[combo] = 0;
        }
        const chartData = sortedDates.map((date) => {
            const dailyData = dailyMap.get(date);
            const result = { date };
            for (const combo of comboNames) {
                cumulativeSum[combo] += dailyData[combo] || 0;
                result[combo] = cumulativeSum[combo];
            }
            return result;
        });
        res.json({
            combinations: comboNames,
            chartData,
            periodDays: days,
        });
    }
    catch (error) {
        console.error('Get dept-service requests daily stats error:', error);
        res.status(500).json({ error: 'Failed to get department-service requests daily statistics' });
    }
});
// ==================== Enhanced Global Stats Endpoints ====================
/**
 * GET /admin/stats/global/cumulative-users-by-service
 * 서비스별 누적 사용자 수 (시계열)
 * Query: ?days= (default 30)
 * 각 날짜별로 해당 날짜까지의 서비스별 고유 사용자 수를 반환
 */
adminRoutes.get('/stats/global/cumulative-users-by-service', async (req, res) => {
    try {
        const days = Math.min(365, Math.max(1, parseInt(req.query['days']) || 30));
        // KST 기준 오늘 날짜
        const now = new Date();
        const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
        const todayStr = kstNow.toISOString().split('T')[0];
        const startDate = new Date(now);
        startDate.setDate(startDate.getDate() - days);
        startDate.setHours(0, 0, 0, 0);
        // Get all enabled services
        const services = await prisma.service.findMany({
            where: { enabled: true },
            select: { id: true, name: true, displayName: true },
        });
        const serviceIdToDisplay = new Map(services.map(s => [s.id, s.displayName]));
        // For each date in range, get cumulative distinct users per service up to that date
        // Use a single efficient query: for each (service_id, date), get the first-seen date of each user
        // Then compute cumulative counts from that
        const firstSeenPerService = await prisma.$queryRaw `
      SELECT
        service_id::text as service_id,
        DATE(timestamp) as first_date,
        COUNT(*) as user_count
      FROM (
        SELECT service_id, user_id, MIN(timestamp) as timestamp
        FROM usage_logs
        WHERE service_id IS NOT NULL
          AND user_id IS NOT NULL
        GROUP BY service_id, user_id
      ) first_seen
      WHERE DATE(timestamp) <= ${todayStr}::date
      GROUP BY service_id, first_date
      ORDER BY first_date ASC
    `;
        // Build date range
        const dateRange = [];
        const endDate = new Date(now);
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            dateRange.push(toLocalDateString(d));
        }
        // Organize first-seen counts: serviceId -> date -> newUserCount
        const newUsersMap = new Map();
        for (const row of firstSeenPerService) {
            const sid = row.service_id;
            const dateStr = formatDateToString(row.first_date);
            if (!newUsersMap.has(sid)) {
                newUsersMap.set(sid, new Map());
            }
            newUsersMap.get(sid).set(dateStr, Number(row.user_count));
        }
        // Build cumulative data
        const cumulativeCounts = new Map();
        for (const s of services) {
            cumulativeCounts.set(s.id, 0);
        }
        // We need cumulative counts from the beginning of time, not just startDate
        // First, compute the cumulative base before startDate
        for (const s of services) {
            const dateMap = newUsersMap.get(s.id);
            if (!dateMap)
                continue;
            for (const [dateStr, count] of dateMap) {
                if (dateStr < dateRange[0]) {
                    cumulativeCounts.set(s.id, (cumulativeCounts.get(s.id) || 0) + count);
                }
            }
        }
        // Now iterate through the date range and build the chart data
        const data = dateRange.map(date => {
            const row = { date };
            for (const s of services) {
                const newUsers = newUsersMap.get(s.id)?.get(date) || 0;
                cumulativeCounts.set(s.id, (cumulativeCounts.get(s.id) || 0) + newUsers);
                row[s.displayName] = cumulativeCounts.get(s.id) || 0;
            }
            return row;
        });
        res.json({
            data,
            services: services.map(s => ({ id: s.id, name: s.name, displayName: s.displayName })),
        });
    }
    catch (error) {
        console.error('Get cumulative users by service error:', error);
        res.status(500).json({ error: 'Failed to get cumulative users by service' });
    }
});
/**
 * GET /admin/stats/global/cumulative-tokens-by-service
 * 서비스별 누적 토큰 사용량 (시계열)
 * Query: ?days= (default 30)
 * 각 날짜별로 해당 날짜까지의 서비스별 총 토큰 수를 반환
 */
adminRoutes.get('/stats/global/cumulative-tokens-by-service', async (req, res) => {
    try {
        const days = Math.min(365, Math.max(1, parseInt(req.query['days']) || 30));
        const now = new Date();
        const startDate = new Date(now);
        startDate.setDate(startDate.getDate() - days);
        startDate.setHours(0, 0, 0, 0);
        // Get all enabled services
        const services = await prisma.service.findMany({
            where: { enabled: true },
            select: { id: true, name: true, displayName: true },
        });
        // Get daily token sums per service from usage_logs
        const dailyTokens = await prisma.$queryRaw `
      SELECT
        DATE(timestamp) as date,
        service_id::text as service_id,
        SUM("inputTokens" + "outputTokens") as total_tokens
      FROM usage_logs
      WHERE service_id IS NOT NULL
      GROUP BY DATE(timestamp), service_id
      ORDER BY DATE(timestamp) ASC
    `;
        // Build date range
        const dateRange = [];
        const endDate = new Date(now);
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            dateRange.push(toLocalDateString(d));
        }
        // Organize daily tokens: serviceId -> date -> tokens
        const dailyMap = new Map();
        for (const row of dailyTokens) {
            const sid = row.service_id;
            const dateStr = formatDateToString(row.date);
            if (!dailyMap.has(sid)) {
                dailyMap.set(sid, new Map());
            }
            dailyMap.get(sid).set(dateStr, Number(row.total_tokens));
        }
        // Compute cumulative base before startDate
        const cumulativeCounts = new Map();
        for (const s of services) {
            cumulativeCounts.set(s.id, 0);
            const dateMap = dailyMap.get(s.id);
            if (!dateMap)
                continue;
            for (const [dateStr, tokens] of dateMap) {
                if (dateStr < dateRange[0]) {
                    cumulativeCounts.set(s.id, (cumulativeCounts.get(s.id) || 0) + tokens);
                }
            }
        }
        // Build cumulative chart data
        const data = dateRange.map(date => {
            const row = { date };
            for (const s of services) {
                const dayTokens = dailyMap.get(s.id)?.get(date) || 0;
                cumulativeCounts.set(s.id, (cumulativeCounts.get(s.id) || 0) + dayTokens);
                row[s.displayName] = cumulativeCounts.get(s.id) || 0;
            }
            return row;
        });
        res.json({
            data,
            services: services.map(s => ({ id: s.id, name: s.name, displayName: s.displayName })),
        });
    }
    catch (error) {
        console.error('Get cumulative tokens by service error:', error);
        res.status(500).json({ error: 'Failed to get cumulative tokens by service' });
    }
});
/**
 * GET /admin/stats/global/dau-by-service
 * 서비스별 일별 활성 사용자 (DAU)
 * Query: ?days= (default 30)
 * 각 날짜별로 서비스별 고유 사용자 수를 반환
 */
adminRoutes.get('/stats/global/dau-by-service', async (req, res) => {
    try {
        const days = Math.min(365, Math.max(1, parseInt(req.query['days']) || 30));
        const now = new Date();
        const startDate = new Date(now);
        startDate.setDate(startDate.getDate() - days);
        startDate.setHours(0, 0, 0, 0);
        // Get all enabled services (include type for BACKGROUND estimation)
        const services = await prisma.service.findMany({
            where: { enabled: true },
            select: { id: true, name: true, displayName: true, type: true },
        });
        const standardServiceIds = services.filter(s => s.type === 'STANDARD').map(s => s.id);
        const backgroundServiceIds = services.filter(s => s.type === 'BACKGROUND').map(s => s.id);
        // STANDARD DAU: Count distinct userIds per (date, service)
        const dauStats = await prisma.$queryRaw `
      SELECT
        DATE(timestamp) as date,
        service_id::text as service_id,
        COUNT(DISTINCT user_id) as dau
      FROM usage_logs
      WHERE service_id IS NOT NULL
        AND user_id IS NOT NULL
        AND timestamp >= ${startDate}
      GROUP BY DATE(timestamp), service_id
      ORDER BY DATE(timestamp) ASC
    `;
        // STANDARD baseline: 1인당 하루 평균 호출 수 (영업일 기준)
        const [baselineDailyRes, baselineDauRes] = await Promise.all([
            prisma.$queryRaw `
        WITH daily_calls AS (
          SELECT DATE(timestamp) as d, SUM(request_count) as cnt
          FROM usage_logs
          WHERE service_id::text = ANY(${standardServiceIds})
            AND timestamp >= ${startDate}
            AND EXTRACT(DOW FROM DATE(timestamp)) NOT IN (0, 6)
            AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = DATE(usage_logs.timestamp))
          GROUP BY DATE(timestamp)
        )
        SELECT COALESCE(AVG(cnt), 0)::float as avg_daily_calls, COUNT(*) as business_days FROM daily_calls
      `,
            prisma.$queryRaw `
        WITH daily_dau AS (
          SELECT DATE(timestamp) as d, COUNT(DISTINCT user_id) as dau
          FROM usage_logs
          WHERE service_id::text = ANY(${standardServiceIds})
            AND user_id IS NOT NULL
            AND timestamp >= ${startDate}
            AND EXTRACT(DOW FROM DATE(timestamp)) NOT IN (0, 6)
            AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = DATE(usage_logs.timestamp))
          GROUP BY DATE(timestamp)
        )
        SELECT COALESCE(AVG(dau), 0)::float as avg_daily_dau FROM daily_dau
      `,
        ]);
        const avgDailyCalls = baselineDailyRes[0]?.avg_daily_calls || 0;
        const avgDailyDau = baselineDauRes[0]?.avg_daily_dau || 0;
        const callsPerPersonPerDay = avgDailyDau > 0 ? avgDailyCalls / avgDailyDau : 0;
        // BACKGROUND services: daily total calls (all days)
        const bgDailyStats = backgroundServiceIds.length > 0 ? await prisma.$queryRaw `
      SELECT DATE(timestamp) as date, service_id::text as service_id, SUM(request_count) as total_calls
      FROM usage_logs
      WHERE service_id::text = ANY(${backgroundServiceIds})
        AND timestamp >= ${startDate}
      GROUP BY DATE(timestamp), service_id
      ORDER BY DATE(timestamp) ASC
    ` : [];
        // Build date range
        const dateRange = [];
        const endDate = new Date(now);
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            dateRange.push(toLocalDateString(d));
        }
        // Build lookup: "serviceId|date" -> dau
        const dauMap = new Map();
        for (const row of dauStats) {
            const dateStr = formatDateToString(row.date);
            dauMap.set(`${row.service_id}|${dateStr}`, Number(row.dau));
        }
        // Build BG lookup: "serviceId|date" -> daily calls
        const bgCallsMap = new Map();
        if (callsPerPersonPerDay > 0) {
            for (const row of bgDailyStats) {
                const dateStr = formatDateToString(row.date);
                const totalCalls = Number(row.total_calls);
                dauMap.set(`${row.service_id}|${dateStr}`, Math.round(totalCalls / callsPerPersonPerDay));
                bgCallsMap.set(`${row.service_id}|${dateStr}`, totalCalls);
            }
        }
        // Build chart data (uses displayName as keys)
        const data = dateRange.map(date => {
            const row = { date };
            for (const s of services) {
                row[s.displayName] = dauMap.get(`${s.id}|${date}`) || 0;
            }
            return row;
        });
        // displayName → type lookup for frontend
        const serviceTypeMap = {};
        for (const s of services) {
            serviceTypeMap[s.displayName] = s.type;
        }
        res.json({
            data,
            services: services.map(s => ({ id: s.id, name: s.name, displayName: s.displayName, type: s.type })),
            serviceTypeMap,
            estimationMeta: {
                callsPerPersonPerDay: Math.round(callsPerPersonPerDay * 10) / 10,
                standardAvgDailyDAU: Math.round(avgDailyDau),
                standardAvgDailyCalls: Math.round(avgDailyCalls),
                businessDays: Number(baselineDailyRes[0]?.business_days || 0),
            },
        });
    }
    catch (error) {
        console.error('Get DAU by service error:', error);
        res.status(500).json({ error: 'Failed to get DAU by service' });
    }
});
/**
 * GET /admin/stats/global/dept-usage-by-service
 * 서비스별 부서 사용량 (Bar Chart용)
 * Query: ?days= (default 30), ?topN= (default 10)
 * 서비스-부서별 토큰 사용량 및 요청 수를 반환
 */
adminRoutes.get('/stats/global/dept-usage-by-service', async (req, res) => {
    try {
        const days = Math.min(365, Math.max(1, parseInt(req.query['days']) || 30));
        const topN = Math.min(50, Math.max(1, parseInt(req.query['topN']) || 10));
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        startDate.setHours(0, 0, 0, 0);
        // Single query: group by serviceId + deptname, sum tokens and requests
        const deptUsage = await prisma.$queryRaw `
      SELECT
        d.service_id::text as service_id,
        s."displayName" as service_display_name,
        d.deptname,
        SUM(d."inputTokens" + d."outputTokens") as total_tokens,
        SUM(d.request_count) as request_count
      FROM usage_logs d
      INNER JOIN services s ON d.service_id = s.id
      WHERE d.service_id IS NOT NULL
        AND d.deptname IS NOT NULL
        AND d.deptname != ''
        AND d.timestamp >= ${startDate}
      GROUP BY d.service_id, s."displayName", d.deptname
      ORDER BY total_tokens DESC
      LIMIT ${topN}
    `;
        const data = deptUsage.map(row => ({
            serviceName: row.service_display_name,
            deptname: row.deptname,
            totalTokens: Number(row.total_tokens),
            requestCount: Number(row.request_count),
        }));
        res.json({ data });
    }
    catch (error) {
        console.error('Get dept usage by service error:', error);
        res.status(500).json({ error: 'Failed to get department usage by service' });
    }
});
/**
 * GET /admin/stats/global/service-daily-requests
 * 서비스별 일별 요청 수 (시계열)
 * Query: ?days= (default 30)
 * 각 날짜별로 서비스별 요청 수를 반환
 */
adminRoutes.get('/stats/global/service-daily-requests', async (req, res) => {
    try {
        const days = Math.min(365, Math.max(1, parseInt(req.query['days']) || 30));
        const now = new Date();
        const startDate = new Date(now);
        startDate.setDate(startDate.getDate() - days);
        startDate.setHours(0, 0, 0, 0);
        // Get all enabled services
        const services = await prisma.service.findMany({
            where: { enabled: true },
            select: { id: true, name: true, displayName: true },
        });
        // Sum request_count per (date, service) from usage_logs
        const requestStats = await prisma.$queryRaw `
      SELECT
        DATE(timestamp) as date,
        service_id::text as service_id,
        SUM(request_count) as request_count
      FROM usage_logs
      WHERE service_id IS NOT NULL
        AND timestamp >= ${startDate}
      GROUP BY DATE(timestamp), service_id
      ORDER BY DATE(timestamp) ASC
    `;
        // Build date range
        const dateRange = [];
        const endDate = new Date(now);
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            dateRange.push(toLocalDateString(d));
        }
        // Build lookup: "serviceId|date" -> requestCount
        const requestMap = new Map();
        for (const row of requestStats) {
            const dateStr = formatDateToString(row.date);
            requestMap.set(`${row.service_id}|${dateStr}`, Number(row.request_count));
        }
        // Build chart data
        const data = dateRange.map(date => {
            const row = { date };
            for (const s of services) {
                row[s.displayName] = requestMap.get(`${s.id}|${date}`) || 0;
            }
            return row;
        });
        res.json({
            data,
            services: services.map(s => ({ id: s.id, name: s.name, displayName: s.displayName })),
        });
    }
    catch (error) {
        console.error('Get service daily requests error:', error);
        res.status(500).json({ error: 'Failed to get service daily requests' });
    }
});
// ==================== Business Units ====================
/**
 * GET /admin/business-units
 * Get distinct business units from users table
 */
adminRoutes.get('/business-units', async (_req, res) => {
    try {
        const units = await prisma.user.findMany({
            where: {
                businessUnit: { not: null },
                NOT: { businessUnit: '' },
            },
            select: { businessUnit: true },
            distinct: ['businessUnit'],
            orderBy: { businessUnit: 'asc' },
        });
        res.json({ businessUnits: units.map((u) => u.businessUnit).filter(Boolean) });
    }
    catch (error) {
        console.error('Get business units error:', error);
        res.status(500).json({ error: 'Failed to get business units' });
    }
});
// ==================== Scope Endpoints ====================
/**
 * GET /admin/scope/business-units
 * Get distinct business units for visibility scope selection
 */
adminRoutes.get('/scope/business-units', async (_req, res) => {
    try {
        const users = await prisma.user.findMany({
            select: { businessUnit: true },
            distinct: ['businessUnit'],
            where: {
                AND: [
                    { businessUnit: { not: null } },
                    { businessUnit: { not: '' } },
                ],
            },
            orderBy: { businessUnit: 'asc' },
        });
        const businessUnits = users.map(u => u.businessUnit).filter(Boolean);
        res.json({ businessUnits });
    }
    catch (error) {
        console.error('Failed to get business units:', error);
        res.status(500).json({ error: 'Failed to get business units' });
    }
});
/**
 * GET /admin/scope/departments
 * Get distinct departments for visibility scope selection
 */
adminRoutes.get('/scope/departments', async (_req, res) => {
    try {
        const users = await prisma.user.findMany({
            select: { deptname: true },
            distinct: ['deptname'],
            where: {
                deptname: { not: '' },
            },
            orderBy: { deptname: 'asc' },
        });
        const departments = users.map(u => u.deptname).filter(Boolean);
        res.json({ departments });
    }
    catch (error) {
        console.error('Failed to get departments:', error);
        res.status(500).json({ error: 'Failed to get departments' });
    }
});
// ==================== User Deletion (Record Purge) ====================
/**
 * DELETE /admin/users/:id
 * 사용자 기록 말소 (SUPER_ADMIN only)
 * cascade로 UsageLog, UserService, UserRateLimit 모두 삭제
 */
adminRoutes.delete('/users/:id', async (req, res) => {
    try {
        if (!req.isSuperAdmin) {
            res.status(403).json({ error: '슈퍼관리자만 사용자를 삭제할 수 있습니다.' });
            return;
        }
        const { id } = req.params;
        const user = await prisma.user.findUnique({ where: { id } });
        if (!user) {
            res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
            return;
        }
        // 슈퍼관리자 본인은 삭제 불가
        if (user.loginid === req.user.loginid) {
            res.status(400).json({ error: '자기 자신은 삭제할 수 없습니다.' });
            return;
        }
        // Admin 레코드도 삭제 (존재하면)
        await prisma.admin.deleteMany({ where: { loginid: user.loginid } });
        // User 삭제 (cascade: UsageLog, UserService, UserRateLimit)
        await prisma.user.delete({ where: { id } });
        console.log(`[User Delete] ${req.user.loginid} deleted user ${user.loginid} (${user.username})`);
        res.json({
            success: true,
            message: `사용자 ${user.username} (${user.loginid})의 모든 기록이 삭제되었습니다.`,
            deletedUser: { id: user.id, loginid: user.loginid, username: user.username },
        });
    }
    catch (error) {
        console.error('User deletion error:', error);
        res.status(500).json({ error: '사용자 삭제에 실패했습니다.' });
    }
});
// ==================== Service Rate Limit (공통) ====================
/**
 * GET /admin/service-rate-limit?serviceId=
 * 서비스의 공통 rate limit 조회
 */
adminRoutes.get('/service-rate-limit', async (req, res) => {
    try {
        const serviceId = req.query['serviceId'];
        if (!serviceId) {
            res.status(400).json({ error: 'serviceId is required' });
            return;
        }
        const rateLimit = await prisma.serviceRateLimit.findUnique({
            where: { serviceId },
        });
        res.json({ rateLimit: rateLimit || null });
    }
    catch (error) {
        console.error('Get service rate limit error:', error);
        res.status(500).json({ error: 'Failed to get service rate limit' });
    }
});
/**
 * PUT /admin/service-rate-limit
 * 서비스의 공통 rate limit 설정/수정
 * Body: { serviceId, maxTokens, window: 'FIVE_HOURS' | 'DAY', enabled? }
 * 이 제한은 개별 UserRateLimit이 없는 모든 사용자에게 적용됨
 */
adminRoutes.put('/service-rate-limit', async (req, res) => {
    try {
        const { serviceId, maxTokens, window: windowType, enabled } = req.body;
        if (!serviceId || maxTokens === undefined || maxTokens === null || !windowType) {
            res.status(400).json({ error: 'serviceId, maxTokens, and window are required' });
            return;
        }
        if (!['FIVE_HOURS', 'DAY'].includes(windowType)) {
            res.status(400).json({ error: 'window must be FIVE_HOURS or DAY' });
            return;
        }
        if (typeof maxTokens !== 'number' || maxTokens < 1) {
            res.status(400).json({ error: 'maxTokens must be at least 1' });
            return;
        }
        const rateLimit = await prisma.serviceRateLimit.upsert({
            where: { serviceId },
            update: {
                maxTokens,
                window: windowType,
                enabled: enabled !== undefined ? enabled : true,
                createdBy: req.user.loginid,
            },
            create: {
                serviceId,
                maxTokens,
                window: windowType,
                enabled: enabled !== undefined ? enabled : true,
                createdBy: req.user.loginid,
            },
        });
        res.json({ rateLimit, message: 'Service rate limit updated' });
    }
    catch (error) {
        console.error('Set service rate limit error:', error);
        res.status(500).json({ error: 'Failed to set service rate limit' });
    }
});
/**
 * DELETE /admin/service-rate-limit?serviceId=
 * 서비스의 공통 rate limit 삭제 (무제한으로 복원)
 */
adminRoutes.delete('/service-rate-limit', async (req, res) => {
    try {
        const serviceId = req.query['serviceId'] || req.body?.serviceId;
        if (!serviceId) {
            res.status(400).json({ error: 'serviceId is required' });
            return;
        }
        const existing = await prisma.serviceRateLimit.findUnique({ where: { serviceId } });
        if (!existing) {
            res.status(404).json({ error: 'Service rate limit not found' });
            return;
        }
        await prisma.serviceRateLimit.delete({ where: { serviceId } });
        res.json({ success: true, message: 'Service rate limit removed (unlimited)' });
    }
    catch (error) {
        console.error('Delete service rate limit error:', error);
        res.status(500).json({ error: 'Failed to delete service rate limit' });
    }
});
/**
 * GET /admin/stats/global/mau-by-service
 * 서비스별 월간 MAU (BACKGROUND 서비스는 추정 MAU)
 * Query: ?months= (1-12, default 6)
 */
adminRoutes.get('/stats/global/mau-by-service', async (req, res) => {
    try {
        const months = Math.min(12, Math.max(1, parseInt(req.query['months']) || 6));
        // Calculate start date
        const now = new Date();
        const startDate = new Date(now.getFullYear(), now.getMonth() - months, 1);
        startDate.setHours(0, 0, 0, 0);
        // Get all enabled services with type
        const services = await prisma.service.findMany({
            where: { enabled: true },
            select: { id: true, name: true, displayName: true, type: true },
        });
        const standardServiceIds = services.filter(s => s.type === 'STANDARD').map(s => s.id);
        const backgroundServiceIds = services.filter(s => s.type === 'BACKGROUND').map(s => s.id);
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        // 1. STANDARD services: real MAU per month
        const standardMau = await prisma.$queryRaw `
      SELECT
        ul.service_id::text as service_id,
        TO_CHAR(ul.timestamp, 'YYYY-MM') as month,
        COUNT(DISTINCT ul.user_id) as mau
      FROM usage_logs ul
      INNER JOIN users u ON ul.user_id = u.id
      WHERE ul.timestamp >= ${startDate}
        AND u.loginid != 'anonymous'
        AND ul.service_id::text = ANY(${standardServiceIds})
      GROUP BY ul.service_id, TO_CHAR(ul.timestamp, 'YYYY-MM')
      ORDER BY month ASC
    `;
        // 2. 월별 STANDARD baseline (해당 월 데이터 사용 → 과거 월 고정, 이번 달 실시간)
        const perMonthBaseline = await prisma.$queryRaw `
      WITH monthly_totals AS (
        SELECT
          TO_CHAR(ul.timestamp, 'YYYY-MM') as month,
          COUNT(*) as total_calls,
          COUNT(DISTINCT ul.user_id) as mau
        FROM usage_logs ul
        INNER JOIN users u ON ul.user_id = u.id
        WHERE ul.timestamp >= ${startDate}
          AND ul.service_id::text = ANY(${standardServiceIds})
          AND u.loginid != 'anonymous'
        GROUP BY TO_CHAR(ul.timestamp, 'YYYY-MM')
      ),
      daily_stats AS (
        SELECT
          TO_CHAR(ul.timestamp, 'YYYY-MM') as month,
          DATE(ul.timestamp) as d,
          COUNT(*) as calls,
          COUNT(DISTINCT ul.user_id) as dau
        FROM usage_logs ul
        INNER JOIN users u ON ul.user_id = u.id
        WHERE ul.timestamp >= ${startDate}
          AND ul.service_id::text = ANY(${standardServiceIds})
          AND u.loginid != 'anonymous'
          AND EXTRACT(DOW FROM ul.timestamp) NOT IN (0, 6)
          AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = DATE(ul.timestamp))
        GROUP BY TO_CHAR(ul.timestamp, 'YYYY-MM'), DATE(ul.timestamp)
      ),
      daily_agg AS (
        SELECT month, AVG(calls)::float as avg_daily_calls, AVG(dau)::float as avg_daily_dau, COUNT(*) as business_days
        FROM daily_stats GROUP BY month
      )
      SELECT mt.month, mt.total_calls, mt.mau, COALESCE(da.avg_daily_calls, 0) as avg_daily_calls,
        COALESCE(da.avg_daily_dau, 0) as avg_daily_dau, COALESCE(da.business_days, 0) as business_days
      FROM monthly_totals mt LEFT JOIN daily_agg da ON mt.month = da.month
      ORDER BY mt.month
    `;
        // 월별 baseline lookup: callsPerPersonPerMonth
        const baselineMap = new Map();
        for (const row of perMonthBaseline) {
            const mau = Number(row.mau);
            const totalCalls = Number(row.total_calls);
            const avgDailyDau = row.avg_daily_dau || 0;
            const avgDailyCalls = row.avg_daily_calls || 0;
            baselineMap.set(row.month, {
                callsPerPersonPerDay: avgDailyDau > 0 ? Math.round((avgDailyCalls / avgDailyDau) * 10) / 10 : 0,
                callsPerPersonPerMonth: mau > 0 ? Math.round((totalCalls / mau) * 10) / 10 : 0,
                standardMAU: mau,
                standardTotalCalls: totalCalls,
                avgDailyDAU: Math.round(avgDailyDau),
                businessDays: Number(row.business_days),
                isFixed: row.month !== currentMonth,
            });
        }
        // 3. BACKGROUND services: 월별 API 호출 수
        const backgroundMonthlyCallsByMonth = await prisma.$queryRaw `
      SELECT
        service_id::text as service_id,
        TO_CHAR(timestamp, 'YYYY-MM') as month,
        COUNT(*) as total_calls
      FROM usage_logs
      WHERE timestamp >= ${startDate}
        AND service_id::text = ANY(${backgroundServiceIds})
      GROUP BY service_id, TO_CHAR(timestamp, 'YYYY-MM')
      ORDER BY month ASC
    `;
        // BG 호출 수 lookup: "serviceId|month" → totalCalls
        const bgCallsMap = new Map();
        for (const row of backgroundMonthlyCallsByMonth) {
            bgCallsMap.set(`${row.service_id}|${row.month}`, Number(row.total_calls));
        }
        // Build month list
        const monthList = [];
        for (let d = new Date(startDate); d <= now; d.setMonth(d.getMonth() + 1)) {
            monthList.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        }
        // Build MAU lookup
        const mauMap = new Map();
        for (const row of standardMau) {
            mauMap.set(`${row.service_id}|${row.month}`, Number(row.mau));
        }
        // Background: 월별 baseline 적용하여 추정 MAU 계산
        for (const row of backgroundMonthlyCallsByMonth) {
            const baseline = baselineMap.get(row.month);
            const cpp = baseline?.callsPerPersonPerMonth || 0;
            const estMau = cpp > 0 ? Math.round(Number(row.total_calls) / cpp) : 0;
            mauMap.set(`${row.service_id}|${row.month}`, estMau);
        }
        // Build monthlyData
        const monthlyData = monthList.map(month => {
            const row = { month };
            for (const s of services) {
                row[s.id] = mauMap.get(`${s.id}|${month}`) || 0;
            }
            return row;
        });
        // Build per-month baseline for frontend tooltip
        const monthlyBaseline = {};
        for (const [month, bl] of baselineMap) {
            monthlyBaseline[month] = bl;
        }
        // Build per-BG-service per-month detail
        const bgMonthlyDetail = {};
        for (const [key, totalCalls] of bgCallsMap) {
            const month = key.split('|')[1];
            const baseline = baselineMap.get(month);
            const cpp = baseline?.callsPerPersonPerMonth || 0;
            bgMonthlyDetail[key] = {
                totalCalls,
                estimatedMAU: cpp > 0 ? Math.round(totalCalls / cpp) : 0,
            };
        }
        res.json({
            services: services.map(s => ({ id: s.id, name: s.name, displayName: s.displayName, type: s.type })),
            monthlyData,
            estimationMeta: {
                monthlyBaseline,
                backgroundMonthlyDetail: bgMonthlyDetail,
            },
        });
    }
    catch (error) {
        console.error('Get MAU by service error:', error);
        res.status(500).json({ error: 'Failed to get MAU by service' });
    }
});
/**
 * GET /admin/stats/global/estimated-dau-mau
 * BACKGROUND 서비스 추정 DAU/MAU 상세
 * 이번 달 1일~현재 STANDARD 서비스의 1인당 평균 API Call을 산출하고,
 * 이를 기반으로 BACKGROUND 서비스의 DAU/MAU를 추정 (실시간)
 */
adminRoutes.get('/stats/global/estimated-dau-mau', async (_req, res) => {
    try {
        const services = await prisma.service.findMany({
            where: { enabled: true },
            select: { id: true, name: true, displayName: true, type: true },
        });
        const standardServiceIds = services.filter(s => s.type === 'STANDARD').map(s => s.id);
        const backgroundServices = services.filter(s => s.type === 'BACKGROUND');
        // 이번 달 1일부터 현재까지를 baseline으로 사용 (실시간)
        const thisMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        thisMonthStart.setHours(0, 0, 0, 0);
        // STANDARD baseline: 이번 달 데이터
        const [dailyCallsRes, dailyDauRes, monthlyRes] = await Promise.all([
            prisma.$queryRaw `
        WITH daily_calls AS (
          SELECT DATE(timestamp) as log_date, COUNT(*) as call_count
          FROM usage_logs
          WHERE timestamp >= ${thisMonthStart}
            AND service_id::text = ANY(${standardServiceIds})
            AND EXTRACT(DOW FROM timestamp) NOT IN (0, 6)
            AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = DATE(timestamp))
          GROUP BY DATE(timestamp)
        )
        SELECT COALESCE(AVG(call_count), 0)::float as avg_daily_calls, COUNT(*) as business_days
        FROM daily_calls
      `,
            prisma.$queryRaw `
        WITH daily_dau AS (
          SELECT DATE(ul.timestamp) as log_date, COUNT(DISTINCT ul.user_id) as dau
          FROM usage_logs ul
          INNER JOIN users u ON ul.user_id = u.id
          WHERE ul.timestamp >= ${thisMonthStart}
            AND ul.service_id::text = ANY(${standardServiceIds})
            AND u.loginid != 'anonymous'
            AND EXTRACT(DOW FROM ul.timestamp) NOT IN (0, 6)
            AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = DATE(ul.timestamp))
          GROUP BY DATE(ul.timestamp)
        )
        SELECT COALESCE(AVG(dau), 0)::float as avg_daily_dau FROM daily_dau
      `,
            prisma.$queryRaw `
        SELECT COUNT(*) as total_calls, COUNT(DISTINCT ul.user_id) as monthly_mau
        FROM usage_logs ul
        INNER JOIN users u ON ul.user_id = u.id
        WHERE ul.timestamp >= ${thisMonthStart}
          AND ul.service_id::text = ANY(${standardServiceIds})
          AND u.loginid != 'anonymous'
      `,
        ]);
        const avgDailyCalls = dailyCallsRes[0]?.avg_daily_calls || 0;
        const businessDays = Number(dailyCallsRes[0]?.business_days || 0);
        const avgDailyDau = dailyDauRes[0]?.avg_daily_dau || 0;
        const avgCallsPerPersonPerDay = avgDailyDau > 0 ? avgDailyCalls / avgDailyDau : 0;
        const totalMonthlyCalls = Number(monthlyRes[0]?.total_calls || 0);
        const monthlyMau = Number(monthlyRes[0]?.monthly_mau || 0);
        const avgCallsPerPersonPerMonth = monthlyMau > 0 ? totalMonthlyCalls / monthlyMau : 0;
        // BACKGROUND services: daily + total calls
        const bgResults = await Promise.all(backgroundServices.map(async (svc) => {
            const [dailyRes, totalRes] = await Promise.all([
                prisma.$queryRaw `
            WITH daily AS (
              SELECT DATE(timestamp) as d, COUNT(*) as cnt
              FROM usage_logs
              WHERE timestamp >= ${thisMonthStart}
                AND service_id::text = ${svc.id}
                AND EXTRACT(DOW FROM timestamp) NOT IN (0, 6)
                AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = DATE(timestamp))
              GROUP BY DATE(timestamp)
            )
            SELECT COALESCE(AVG(cnt), 0)::float as avg_daily_calls FROM daily
          `,
                prisma.$queryRaw `
            SELECT COUNT(*) as total_calls
            FROM usage_logs
            WHERE timestamp >= ${thisMonthStart}
              AND service_id::text = ${svc.id}
          `,
            ]);
            const avgDaily = dailyRes[0]?.avg_daily_calls || 0;
            const totalCalls = Number(totalRes[0]?.total_calls || 0);
            return {
                serviceId: svc.id,
                serviceName: svc.name,
                serviceDisplayName: svc.displayName,
                avgDailyApiCalls: Math.round(avgDaily),
                estimatedDAU: avgCallsPerPersonPerDay > 0 ? Math.round(avgDaily / avgCallsPerPersonPerDay) : 0,
                totalMonthlyApiCalls: totalCalls,
                estimatedMAU: avgCallsPerPersonPerMonth > 0 ? Math.round(totalCalls / avgCallsPerPersonPerMonth) : 0,
                isEstimated: true,
            };
        }));
        res.json({
            standardBaseline: {
                avgDailyApiCalls: Math.round(avgDailyCalls),
                avgDailyDAU: Math.round(avgDailyDau),
                avgCallsPerPersonPerDay: Math.round(avgCallsPerPersonPerDay * 10) / 10,
                totalMonthlyApiCalls: totalMonthlyCalls,
                monthlyMAU: monthlyMau,
                avgCallsPerPersonPerMonth: Math.round(avgCallsPerPersonPerMonth * 10) / 10,
                businessDaysUsed: businessDays,
            },
            backgroundEstimates: bgResults,
        });
    }
    catch (error) {
        console.error('Get estimated DAU/MAU error:', error);
        res.status(500).json({ error: 'Failed to get estimated DAU/MAU' });
    }
});
// ==================== Knox 임직원 인증 관리 ====================
/**
 * GET /admin/knox/search?loginid=
 * Knox ID로 임직원 검색 (관리자 사전 등록용)
 */
adminRoutes.get('/knox/search', requireSuperAdmin, async (req, res) => {
    try {
        const loginid = (req.query['loginid'] || '').trim();
        if (!loginid) {
            res.status(400).json({ error: 'loginid 파라미터가 필요합니다.' });
            return;
        }
        const employee = await lookupEmployee(loginid);
        if (!employee) {
            res.status(404).json({ error: `임직원 정보를 찾을 수 없습니다: ${loginid}` });
            return;
        }
        // DB에 이미 등록되어 있는지 확인
        const existingUser = await prisma.user.findUnique({ where: { loginid } });
        const existingAdmin = await prisma.admin.findUnique({ where: { loginid } });
        res.json({
            employee: {
                loginid: employee.userId,
                fullName: employee.fullName,
                enFullName: employee.enFullName,
                departmentName: employee.departmentName,
                enDepartmentName: employee.enDepartmentName,
                companyName: employee.companyName,
                titleName: employee.titleName,
                gradeName: employee.gradeName,
                emailAddress: employee.emailAddress,
                employeeStatus: employee.employeeStatus === 'B' ? '재직' : '휴직',
            },
            existingUser: existingUser ? {
                id: existingUser.id,
                loginid: existingUser.loginid,
                username: existingUser.username,
                deptname: existingUser.deptname,
                knoxVerified: existingUser.knoxVerified,
            } : null,
            existingAdmin: existingAdmin ? {
                role: existingAdmin.role,
                designatedBy: existingAdmin.designatedBy,
            } : null,
        });
    }
    catch (error) {
        console.error('Knox search error:', error);
        res.status(500).json({ error: '임직원 검색에 실패했습니다.' });
    }
});
/**
 * POST /admin/knox/register
 * Knox 확인 후 관리자 사전 등록
 * Body: { loginid: string, role?: 'ADMIN' | 'SUPER_ADMIN' }
 */
adminRoutes.post('/knox/register', requireSuperAdmin, async (req, res) => {
    try {
        const { loginid, role } = req.body;
        if (!loginid) {
            res.status(400).json({ error: 'loginid가 필요합니다.' });
            return;
        }
        const adminRole = role || 'ADMIN';
        if (!['ADMIN', 'SUPER_ADMIN'].includes(adminRole)) {
            res.status(400).json({ error: 'role은 ADMIN 또는 SUPER_ADMIN이어야 합니다.' });
            return;
        }
        const ipAddress = req.ip || req.headers['x-forwarded-for'] || undefined;
        // Knox API로 인증 + 사용자 생성
        const result = await verifyAndRegisterUser(loginid, '', 'ADMIN_REGISTER', '/admin/knox/register', ipAddress);
        if (!result.success || !result.user) {
            res.status(400).json({ error: result.error || '임직원 인증에 실패했습니다.' });
            return;
        }
        // Admin 레코드 생성/업데이트
        const admin = await prisma.admin.upsert({
            where: { loginid },
            update: {
                role: adminRole,
                deptname: result.user.deptname,
                businessUnit: extractBusinessUnit(result.user.deptname),
                designatedBy: req.user.loginid,
            },
            create: {
                loginid,
                role: adminRole,
                deptname: result.user.deptname,
                businessUnit: extractBusinessUnit(result.user.deptname),
                designatedBy: req.user.loginid,
            },
        });
        recordAudit(req, 'KNOX_REGISTER_ADMIN', loginid, 'User', {
            username: result.user.username,
            role: adminRole,
            knoxFullName: result.employee?.fullName,
            knoxDept: result.employee?.departmentName,
        }).catch(() => { });
        res.json({
            success: true,
            message: `${result.user.username} (${loginid})을 ${adminRole}로 등록했습니다.`,
            user: result.user,
            admin: { role: admin.role, designatedBy: admin.designatedBy },
        });
    }
    catch (error) {
        console.error('Knox register error:', error);
        res.status(500).json({ error: '관리자 등록에 실패했습니다.' });
    }
});
/**
 * POST /admin/knox/reset-verification/:id
 * 사용자 Knox 인증 초기화 (부서 변경 시 재인증 필요)
 */
adminRoutes.post('/knox/reset-verification/:id', requireSuperAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const user = await prisma.user.findUnique({ where: { id } });
        if (!user) {
            res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
            return;
        }
        await prisma.user.update({
            where: { id },
            data: { knoxVerified: false },
        });
        recordAudit(req, 'RESET_KNOX_VERIFICATION', user.loginid, 'User', { username: user.username }).catch(() => { });
        res.json({
            success: true,
            message: `${user.username} (${user.loginid})의 Knox 인증이 초기화되었습니다. 다음 접근 시 재인증됩니다.`,
        });
    }
    catch (error) {
        console.error('Reset Knox verification error:', error);
        res.status(500).json({ error: 'Knox 인증 초기화에 실패했습니다.' });
    }
});
// ==================== Knox 인증 기록 ====================
/**
 * GET /admin/knox-verifications
 * Knox 인증 기록 조회 (SUPER_ADMIN only)
 * Query: ?page=, ?limit=, ?search=, ?success=, ?method=, ?startDate=, ?endDate=
 */
adminRoutes.get('/knox-verifications', requireSuperAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query['page']) || 1;
        const limit = Math.min(100, parseInt(req.query['limit']) || 50);
        const skip = (page - 1) * limit;
        const search = req.query['search'];
        const success = req.query['success'];
        const method = req.query['method'];
        const startDate = req.query['startDate'];
        const endDate = req.query['endDate'];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const where = {};
        if (search) {
            where.OR = [
                { loginid: { contains: search, mode: 'insensitive' } },
                { username: { contains: search, mode: 'insensitive' } },
                { knoxDeptName: { contains: search, mode: 'insensitive' } },
                { claimedDeptName: { contains: search, mode: 'insensitive' } },
            ];
        }
        if (success === 'true')
            where.success = true;
        else if (success === 'false')
            where.success = false;
        if (method)
            where.method = method;
        if (startDate || endDate) {
            where.timestamp = {};
            if (startDate)
                where.timestamp.gte = new Date(startDate);
            if (endDate)
                where.timestamp.lte = new Date(endDate + 'T23:59:59.999+09:00');
        }
        const [records, total] = await Promise.all([
            prisma.knoxVerification.findMany({
                where,
                skip,
                take: limit,
                orderBy: { timestamp: 'desc' },
            }),
            prisma.knoxVerification.count({ where }),
        ]);
        // 통계 (필터 적용)
        const stats = await prisma.knoxVerification.groupBy({
            by: ['success'],
            where,
            _count: true,
        });
        const successCount = stats.find(s => s.success)?._count || 0;
        const failCount = stats.find(s => !s.success)?._count || 0;
        res.json({
            records,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
            stats: {
                total: successCount + failCount,
                success: successCount,
                fail: failCount,
            },
        });
    }
    catch (error) {
        console.error('Get Knox verifications error:', error);
        res.status(500).json({ error: 'Knox 인증 기록 조회에 실패했습니다.' });
    }
});
//# sourceMappingURL=admin.routes.js.map