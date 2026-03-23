/**
 * LLM Health Check Service
 *
 * 10분마다 등록된 모든 활성 LLM 엔드포인트에 경량 요청을 보내 응답시간 기록.
 * 실제 사용 트래픽과 무관한 독립적 모니터링.
 */

import { prisma } from '../index.js';

const HEALTH_CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10분
const HEALTH_CHECK_TIMEOUT_MS = 30000; // 30초
const ASR_HEALTH_CHECK_TIMEOUT_MS = 60000; // ASR은 60초

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

// 모델 타입별 테스트 요청 생성 (ASR은 별도 처리)
function buildTestRequest(type: string, modelName: string): { url: string; body: Record<string, unknown> } | null {
  switch (type) {
    case 'CHAT':
      return {
        url: '/chat/completions',
        body: {
          model: modelName,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
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
      // 최소 크기 이미지 1장 생성으로 엔드포인트 확인
      return {
        url: '/images/generations',
        body: {
          model: modelName,
          prompt: 'health check: white square',
          n: 1,
          size: '256x256',
        },
      };
    case 'ASR':
      // ASR은 checkAsrModel()에서 별도 처리
      return null;
    default:
      return {
        url: '/chat/completions',
        body: {
          model: modelName,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false,
        },
      };
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
}): Promise<void> {
  const method = model.asrMethod || 'AUDIO_URL';
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
  let url: string;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ASR_HEALTH_CHECK_TIMEOUT_MS);
    let response: Response;

    if (method === 'OPENAI_TRANSCRIBE') {
      // Whisper 호환: multipart → /audio/transcriptions
      url = buildEndpointUrl(model.endpointUrl, '/audio/transcriptions');
      const formData = new FormData();
      formData.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'healthcheck.wav');
      formData.append('model', model.name);
      formData.append('response_format', 'json');
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
      errorMessage = text.substring(0, 500);
    }
  } catch (err) {
    url = model.endpointUrl;
    errorMessage = err instanceof Error ? err.message : 'Unknown error';
    if (errorMessage.includes('abort')) {
      errorMessage = `Timeout after ${ASR_HEALTH_CHECK_TIMEOUT_MS}ms`;
    }
  }

  const latencyMs = Date.now() - startTime;

  try {
    await prisma.healthCheckLog.create({
      data: {
        modelId: model.id,
        modelName: model.displayName || model.name,
        endpointUrl: url!,
        latencyMs: success ? latencyMs : null,
        statusCode,
        success,
        errorMessage,
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
}): Promise<void> {
  // ASR은 별도 처리
  if (model.type === 'ASR') {
    return checkAsrModel(model);
  }

  const testReq = buildTestRequest(model.type, model.name);
  if (!testReq) return; // IMAGE 등 스킵

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
      errorMessage = text.substring(0, 500);
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : 'Unknown error';
    if (errorMessage.includes('abort')) {
      errorMessage = `Timeout after ${HEALTH_CHECK_TIMEOUT_MS}ms`;
    }
  }

  const latencyMs = Date.now() - startTime;

  try {
    await prisma.healthCheckLog.create({
      data: {
        modelId: model.id,
        modelName: model.displayName || model.name,
        endpointUrl: url,
        latencyMs: success ? latencyMs : null,
        statusCode,
        success,
        errorMessage,
      },
    });
  } catch (err) {
    console.error(`[HealthCheck] Failed to save log for ${model.name}:`, err);
  }
}

async function runHealthChecks(): Promise<void> {
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
      },
    });

    console.log(`[HealthCheck] Checking ${models.length} models...`);

    // 동시 실행 (너무 많으면 5개씩 배치)
    const BATCH_SIZE = 5;
    for (let i = 0; i < models.length; i += BATCH_SIZE) {
      const batch = models.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(batch.map(m => checkSingleModel(m)));
    }

    console.log(`[HealthCheck] Done.`);
  } catch (err) {
    console.error('[HealthCheck] Failed:', err);
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
  // 시작 시 1분 후 첫 실행 (서버 부팅 직후 부하 방지)
  setTimeout(() => {
    runHealthChecks();
    cleanupOldHealthChecks();
  }, 60 * 1000);

  // 이후 10분마다 반복
  healthCheckInterval = setInterval(() => {
    runHealthChecks();
    cleanupOldHealthChecks();
  }, HEALTH_CHECK_INTERVAL_MS);

  console.log('[HealthCheck] Cron started (every 10 minutes)');
}

export function stopHealthCheckCron(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}
