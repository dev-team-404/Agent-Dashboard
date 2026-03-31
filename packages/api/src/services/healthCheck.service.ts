/**
 * LLM Health Check Service
 *
 * 10분마다 등록된 모든 활성 LLM 엔드포인트에 요청을 보내 응답시간 기록.
 * 실제 사용 트래픽과 무관한 독립적 모니터링.
 */

import { prisma, redis } from '../index.js';

const HEALTH_CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10분
const HC_LOCK_KEY = 'healthcheck:running';
const HC_LOCK_TTL = 9 * 60; // 9분 (10분 주기보다 짧게, 다음 주기 전 자동 해제)
const HEALTH_CHECK_TIMEOUT_MS = 9.5 * 60 * 1000; // 9분 30초 (timeout 시 10분으로 기록)
const ASR_HEALTH_CHECK_TIMEOUT_MS = 9.5 * 60 * 1000; // ASR도 동일
const TIMEOUT_RECORD_MS = 10 * 60 * 1000; // timeout 시 기록할 latency (10분)

// 1초 무음 WAV 생성 (16kHz mono 16-bit PCM) — ASR 헬스체크용
function generateSilentWavBuffer(): Buffer {
  const sampleRate = 16000;
  const numSamples = sampleRate; // 1초
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);           // PCM
  buffer.writeUInt16LE(1, 22);           // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);           // block align
  buffer.writeUInt16LE(16, 34);          // bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  // 나머지는 0 (무음)
  return buffer;
}

const MAX_RETRIES = 2; // fetch 실패 시 최대 재시도 횟수

// 모델 타입별 테스트 요청 생성 (ASR·IMAGE는 별도 처리)
function buildTestRequest(type: string, modelName: string): { url: string; body: Record<string, unknown>; method?: string } | null {
  switch (type) {
    case 'CHAT':
      return {
        url: '/chat/completions',
        body: {
          model: modelName,
          messages: [{ role: 'user', content: '양자역학의 핵심 원리와 실생활 응용 사례를 자세히 설명해줘.' }],
          // max_tokens 제한 없음 — 모델 기본값 사용
          stream: false,
        },
      };
    case 'EMBEDDING':
      return {
        url: '/embeddings',
        body: { model: modelName, input: 'health check' },
      };
    case 'RERANKING':
      return {
        url: '/rerank',
        body: { model: modelName, query: 'test', documents: ['doc'], top_n: 1 },
      };
    case 'IMAGE':
    case 'ASR':
      // IMAGE·ASR은 별도 처리 (checkComfyUI / checkAsrModel)
      return null;
    default:
      return {
        url: '/chat/completions',
        body: {
          model: modelName,
          messages: [{ role: 'user', content: '양자역학의 핵심 원리와 실생활 응용 사례를 자세히 설명해줘.' }],
          // max_tokens 제한 없음 — 모델 기본값 사용
          stream: false,
        },
      };
  }
}

// ComfyUI 헬스체크: GET /system_stats 로 서버 상태 확인
async function checkComfyUI(model: {
  id: string;
  name: string;
  displayName: string;
  endpointUrl: string;
  apiKey: string | null;
  extraHeaders: unknown;
}, checkedAt: Date): Promise<void> {
  const baseUrl = model.endpointUrl.replace(/\/+$/, '');
  const url = `${baseUrl}/system_stats`;
  const headers: Record<string, string> = {};
  if (model.apiKey) headers['Authorization'] = `Bearer ${model.apiKey}`;
  if (model.extraHeaders && typeof model.extraHeaders === 'object') {
    for (const [k, v] of Object.entries(model.extraHeaders as Record<string, string>)) {
      headers[k] = v;
    }
  }

  const startTime = Date.now();
  let statusCode: number | null = null;
  let success = false;
  let errorMessage: string | null = null;
  let isTimeout = false;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

      const response = await fetch(url, { method: 'GET', headers, signal: controller.signal });
      clearTimeout(timeoutId);

      statusCode = response.status;
      success = response.ok;
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        errorMessage = `HTTP ${response.status}: ${text.substring(0, 500)}`;
      } else {
        errorMessage = null;
      }
      break; // 성공 또는 HTTP 에러 → 재시도 불필요
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      if (msg.includes('abort')) {
        success = true;
        errorMessage = null;
        isTimeout = true;
        break;
      }
      errorMessage = msg;
      if (attempt < MAX_RETRIES) {
        console.log(`[HealthCheck] ComfyUI ${model.name} fetch failed, retry ${attempt + 1}/${MAX_RETRIES}`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  const latencyMs = isTimeout ? TIMEOUT_RECORD_MS : Date.now() - startTime;

  try {
    await prisma.healthCheckLog.create({
      data: {
        modelId: model.id,
        modelName: model.displayName || model.name,
        endpointUrl: url,
        latencyMs,
        statusCode,
        success,
        errorMessage,
        checkedAt,
      },
    });
  } catch (err) {
    console.error(`[HealthCheck] Failed to save ComfyUI log for ${model.name}:`, err);
  }
}

function buildEndpointUrl(baseUrl: string, path: string): string {
  let url = baseUrl.trim();
  // 이미 full path인 경우
  if (url.endsWith(path)) return url;
  if (url.endsWith('/')) url = url.slice(0, -1);
  // 기존 API 경로 제거 (사용자가 full path를 입력한 경우 대비)
  url = url.replace(/\/(chat\/completions|embeddings|rerank|images\/generations|audio\/transcriptions)$/, '');
  // /v1 으로 끝나면 path만 추가
  if (url.endsWith('/v1')) return `${url}${path}`;
  // 그 외 path 추가
  return `${url}${path}`;
}

// ASR 모델 헬스체크 (무음 WAV로 테스트)
async function checkAsrModel(model: {
  id: string;
  name: string;
  displayName: string;
  endpointUrl: string;
  apiKey: string | null;
  extraHeaders: unknown;
  asrMethod: string | null;
}, checkedAt: Date): Promise<void> {
  // whisper 모델은 항상 OPENAI_TRANSCRIBE (AUDIO_URL은 /chat/completions → 404)
  const isWhisper = /whisper/i.test(model.name) || /whisper/i.test(model.displayName || '');
  const method = isWhisper ? 'OPENAI_TRANSCRIBE' : (model.asrMethod || 'AUDIO_URL');
  console.log(`[HealthCheck] ASR method resolve: name="${model.name}" display="${model.displayName}" stored=${model.asrMethod} → ${method}`);
  const headers: Record<string, string> = {};
  if (model.apiKey) headers['Authorization'] = `Bearer ${model.apiKey}`;
  if (model.extraHeaders && typeof model.extraHeaders === 'object') {
    for (const [k, v] of Object.entries(model.extraHeaders as Record<string, string>)) {
      const lower = k.toLowerCase();
      if (lower !== 'content-type' && lower !== 'authorization') headers[k] = v;
    }
  }

  const wavBuffer = generateSilentWavBuffer();
  const startTime = Date.now();
  let statusCode: number | null = null;
  let success = false;
  let errorMessage: string | null = null;
  let isTimeout = false;
  let url: string;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ASR_HEALTH_CHECK_TIMEOUT_MS);
    let response: Response;

    if (method === 'OPENAI_TRANSCRIBE') {
      // Whisper 호환: multipart → /audio/transcriptions
      url = buildEndpointUrl(model.endpointUrl, '/audio/transcriptions');
      const formData = new FormData();
      // File API 사용 (Node.js Blob보다 안정적 — Content-Disposition filename 보장)
      formData.append('file', new File([new Uint8Array(wavBuffer.buffer, wavBuffer.byteOffset, wavBuffer.byteLength)], 'healthcheck.wav', { type: 'audio/wav' }));
      formData.append('model', model.name);
      formData.append('response_format', 'json');
      console.log(`[HealthCheck] ASR OPENAI_TRANSCRIBE → ${url} model=${model.name}`);
      response = await fetch(url, { method: 'POST', headers, body: formData, signal: controller.signal });
    } else {
      // AUDIO_URL: base64 → /chat/completions
      url = buildEndpointUrl(model.endpointUrl, '/chat/completions');
      headers['Content-Type'] = 'application/json';
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: model.name,
          messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: wavBuffer.toString('base64'), format: 'wav' } }] }],
          max_tokens: 64,
          stream: false,
        }),
        signal: controller.signal,
      });
    }
    clearTimeout(timeoutId);

    statusCode = response.status;
    success = response.ok;
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      errorMessage = `HTTP ${response.status}: ${text.substring(0, 500)}`;
      console.warn(`[HealthCheck] ASR ${model.name} method=${method} url=${url} FAIL: ${errorMessage}`);
    } else {
      console.log(`[HealthCheck] ASR ${model.name} method=${method} url=${url} OK (${Date.now() - startTime}ms)`);
    }
  } catch (err) {
    url = model.endpointUrl;
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (msg.includes('abort')) {
      // Timeout — 장애가 아님, 10분으로 기록
      success = true;
      errorMessage = null;
      isTimeout = true;
    } else {
      errorMessage = msg;
      console.warn(`[HealthCheck] ASR ${model.name} method=${method} url=${url} ERROR: ${msg}`);
    }
  }

  const latencyMs = isTimeout ? TIMEOUT_RECORD_MS : Date.now() - startTime;

  try {
    await prisma.healthCheckLog.create({
      data: {
        modelId: model.id,
        modelName: model.displayName || model.name,
        endpointUrl: url!,
        latencyMs,
        statusCode,
        success,
        errorMessage,
        checkedAt,
      },
    });
  } catch (err) {
    console.error(`[HealthCheck] Failed to save ASR log for ${model.name}:`, err);
  }
}

async function checkSingleModel(model: {
  id: string;
  name: string;
  displayName: string;
  endpointUrl: string;
  apiKey: string | null;
  extraHeaders: unknown;
  type: string;
  asrMethod: string | null;
  imageProvider: string | null;
}, checkedAt: Date): Promise<void> {
  // ASR은 별도 처리
  if (model.type === 'ASR') {
    return checkAsrModel(model, checkedAt);
  }

  // IMAGE: ComfyUI만 헬스체크, 나머지 스킵
  if (model.type === 'IMAGE') {
    if ((model.imageProvider || '').toUpperCase() === 'COMFYUI') {
      return checkComfyUI(model, checkedAt);
    }
    return; // OPENAI, GEMINI, PIXABAY, PEXELS 등 스킵
  }

  const testReq = buildTestRequest(model.type, model.name);
  if (!testReq) return;

  const url = buildEndpointUrl(model.endpointUrl, testReq.url);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (model.apiKey) headers['Authorization'] = `Bearer ${model.apiKey}`;
  if (model.extraHeaders && typeof model.extraHeaders === 'object') {
    for (const [k, v] of Object.entries(model.extraHeaders as Record<string, string>)) {
      const lower = k.toLowerCase();
      if (lower !== 'content-type' && lower !== 'authorization') {
        headers[k] = v;
      }
    }
  }

  const startTime = Date.now();
  let statusCode: number | null = null;
  let success = false;
  let errorMessage: string | null = null;
  let isTimeout = false;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(testReq.body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      statusCode = response.status;
      success = response.ok;
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        errorMessage = `HTTP ${response.status}: ${text.substring(0, 500)}`;
      } else {
        errorMessage = null;
      }
      break; // 성공 또는 HTTP 에러 → 재시도 불필요
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      if (msg.includes('abort')) {
        // Timeout — 장애가 아님, 10분으로 기록
        success = true;
        errorMessage = null;
        isTimeout = true;
        break;
      }
      errorMessage = msg;
      if (attempt < MAX_RETRIES) {
        console.log(`[HealthCheck] ${model.name} fetch failed, retry ${attempt + 1}/${MAX_RETRIES}`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  const latencyMs = isTimeout ? TIMEOUT_RECORD_MS : Date.now() - startTime;

  try {
    await prisma.healthCheckLog.create({
      data: {
        modelId: model.id,
        modelName: model.displayName || model.name,
        endpointUrl: url,
        latencyMs,
        statusCode,
        success,
        errorMessage,
        checkedAt,
      },
    });
  } catch (err) {
    console.error(`[HealthCheck] Failed to save log for ${model.name}:`, err);
  }
}

async function runHealthChecks(): Promise<void> {
  // Redis 분산 락: blue-green 양쪽 중 한쪽만 실행
  try {
    const acquired = await redis.set(HC_LOCK_KEY, process.pid.toString(), 'EX', HC_LOCK_TTL, 'NX');
    if (!acquired) {
      console.log('[HealthCheck] Skipped — another instance is running');
      return;
    }
  } catch (err) {
    console.error('[HealthCheck] Redis lock failed, proceeding anyway:', err);
  }

  try {
    const models = await prisma.model.findMany({
      where: { enabled: true, endpointUrl: { not: 'external://auto-created' } },
      select: {
        id: true,
        name: true,
        displayName: true,
        endpointUrl: true,
        apiKey: true,
        extraHeaders: true,
        type: true,
        asrMethod: true,
        imageProvider: true,
      },
    });

    console.log(`[HealthCheck] Checking ${models.length} models...`);

    // 배치 시작 시점을 checkedAt으로 통일 (응답 속도와 무관하게 같은 X축)
    const batchCheckedAt = new Date();

    // 전체 병렬 실행 (timeout 모델이 다른 모델을 블로킹하지 않도록)
    await Promise.allSettled(models.map(m => checkSingleModel(m, batchCheckedAt)));

    console.log(`[HealthCheck] Done.`);
  } catch (err) {
    console.error('[HealthCheck] Failed:', err);
  } finally {
    // 락 해제
    try { await redis.del(HC_LOCK_KEY); } catch { /* ignore */ }
  }
}

// 오래된 헬스체크 로그 정리 (7일 이상)
async function cleanupOldHealthChecks(): Promise<void> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const result = await prisma.healthCheckLog.deleteMany({
      where: { checkedAt: { lt: cutoff } },
    });
    if (result.count > 0) {
      console.log(`[HealthCheck] Cleaned up ${result.count} old records`);
    }
  } catch (err) {
    console.error('[HealthCheck] Cleanup failed:', err);
  }
}

let healthCheckInterval: ReturnType<typeof setInterval> | null = null;

export function startHealthCheckCron(): void {
  // 다음 정각 10분 단위(xx:00, xx:10, xx:20...)까지 대기 후 시작
  const now = Date.now();
  const msIntoSlot = now % HEALTH_CHECK_INTERVAL_MS;
  const delayToNextSlot = HEALTH_CHECK_INTERVAL_MS - msIntoSlot;

  console.log(`[HealthCheck] Next run in ${Math.round(delayToNextSlot / 1000)}s (aligned to :${String(new Date(now + delayToNextSlot).getMinutes()).padStart(2, '0')})`);

  setTimeout(() => {
    runHealthChecks();
    cleanupOldHealthChecks();

    // 이후 정확히 10분마다 반복
    healthCheckInterval = setInterval(() => {
      runHealthChecks();
      cleanupOldHealthChecks();
    }, HEALTH_CHECK_INTERVAL_MS);
  }, delayToNextSlot);

  console.log('[HealthCheck] Cron started (every 10 minutes)');
}

export function stopHealthCheckCron(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}
