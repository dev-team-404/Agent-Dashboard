/**
 * GPU AI Coaching Service
 *
 * 서버별 1시간마다 LLM 분석 — 5분 간격 순차 호출
 * - 이론값/보정값 검증
 * - FP8/FP16/INT 최적화 제안
 * - 모델 배치 최적화 제안
 * - 서비스 품질 이슈 감지
 */

import { prisma } from '../index.js';
import { getAllLatestMetrics, lookupGpuSpec, estimateModelParams, calcTheoreticalMaxTps, detectPrecision } from './gpuMonitor.service.js';
import { logInternalLlmUsage } from './internalUsageLogger.js';

const COACHING_INTERVAL_MS = 60 * 60 * 1000; // 1시간
const DELAY_BETWEEN_SERVERS_MS = 5 * 60 * 1000; // 5분 간격
const LLM_TIMEOUT_MS = 120_000;

let interval: ReturnType<typeof setInterval> | null = null;

// ── LLM 호출 ──
async function callLlm(prompt: string): Promise<string> {
  // GPU 코칭 전용 LLM → 없으면 시스템 LLM fallback
  const gpuLlm = await prisma.systemSetting.findUnique({ where: { key: 'GPU_CAPACITY_LLM_MODEL_ID' } });
  const sysLlm = await prisma.systemSetting.findUnique({ where: { key: 'SYSTEM_LLM_MODEL_ID' } });
  const modelId = gpuLlm?.value || sysLlm?.value;
  if (!modelId) return '';

  const model = await prisma.model.findUnique({ where: { id: modelId } });
  if (!model) return '';

  let url = model.endpointUrl.trim();
  if (!url.endsWith('/chat/completions')) url = `${url.replace(/\/$/, '')}/chat/completions`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (model.apiKey) headers['Authorization'] = `Bearer ${model.apiKey}`;
  if (model.extraHeaders && typeof model.extraHeaders === 'object') {
    for (const [k, v] of Object.entries(model.extraHeaders as Record<string, string>)) {
      if (!['content-type', 'authorization'].includes(k.toLowerCase())) headers[k] = v;
    }
  }

  const body = {
    ...(model.extraBody && typeof model.extraBody === 'object' ? model.extraBody : {}),
    model: model.name,
    messages: [
      { role: 'system', content: '당신은 GPU 인프라 최적화 전문가입니다. 간결하고 실행 가능한 한국어 조언을 제공하세요. JSON으로만 응답하세요.' },
      { role: 'user', content: prompt },
    ],
    max_tokens: 2048, temperature: 0.2, stream: false,
  };

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
  const startMs = Date.now();
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
    clearTimeout(tid);
    if (!res.ok) return '';
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const content = data.choices?.[0]?.message?.content || '';
    // 사용량 로깅
    logInternalLlmUsage({
      modelId, modelName: model.name,
      inputTokens: data.usage?.prompt_tokens || Math.round(prompt.length / 4),
      outputTokens: data.usage?.completion_tokens || Math.round(content.length / 4),
      latencyMs: Date.now() - startMs,
      path: '/internal/gpu-coaching', statusCode: 200,
    }).catch(() => {});
    return content;
  } catch { clearTimeout(tid); return ''; }
}

// ── 단일 서버 코칭 ──
async function coachServer(serverId: string): Promise<void> {
  const server = await prisma.gpuServer.findUnique({ where: { id: serverId } });
  if (!server || !server.enabled) return;

  const metrics = getAllLatestMetrics().find(m => m.serverId === serverId);
  if (!metrics || metrics.error) return;

  const gpuCount = metrics.gpus.length;
  const spec = gpuCount > 0 ? lookupGpuSpec(metrics.gpus[0].name) : null;
  if (!spec) return;

  const endpoints = metrics.llmEndpoints.filter(ep => ep.type !== 'unknown');
  if (endpoints.length === 0) return;

  // 서버 정보 수집
  const llmInfo = endpoints.map(ep => {
    const name = ep.modelNames?.[0] || ep.containerName || 'unknown';
    const params = estimateModelParams(name);
    const precision = ep.precision || 'fp16';
    const theoretical = params ? calcTheoreticalMaxTps(spec!, gpuCount, params, precision) : null;
    const tps = (ep.promptThroughputTps || 0) + (ep.genThroughputTps || 0);
    return {
      name, params: params ? `${params}B` : '?', precision,
      theoreticalMax: theoretical ? Math.round(theoretical) : null,
      currentTps: Math.round(tps * 10) / 10,
      kvCache: ep.kvCacheUsagePct,
      running: ep.runningRequests, waiting: ep.waitingRequests,
      ttft: ep.ttftMs ? Math.round(ep.ttftMs) : null,
      preemption: ep.preemptionCount,
      cacheHit: ep.prefixCacheHitRate ? (ep.prefixCacheHitRate * 100).toFixed(1) + '%' : null,
    };
  });

  const prompt = `서버 "${server.name}" (${spec.label} x${gpuCount}) AI 코칭 요청

## 현재 LLM 인스턴스
${llmInfo.map((l, i) => `${i + 1}. ${l.name} (${l.params}, ${l.precision})
   이론max: ${l.theoreticalMax || '?'} tok/s | 현재: ${l.currentTps} tok/s
   KV Cache: ${l.kvCache != null ? l.kvCache.toFixed(1) + '%' : '-'} | TTFT: ${l.ttft || '-'}ms
   실행: ${l.running || 0} | 대기: ${l.waiting || 0} | Preemption: ${l.preemption || 0}
   Cache Hit: ${l.cacheHit || '-'}`).join('\n')}

## GPU 상태
- GPU: ${spec.label} x${gpuCount} (FP16: ${spec.fp16Tflops}T, FP8: ${spec.fp8Tflops}T)
- CPU: ${metrics.cpuLoadAvg || '-'}/${metrics.cpuCores || '-'}cores
- RAM: ${metrics.memoryUsedMb ? Math.round(metrics.memoryUsedMb / 1024) : '-'}/${metrics.memoryTotalMb ? Math.round(metrics.memoryTotalMb / 1024) : '-'}GB

## 분석 요청 (JSON으로 응답)
1. 이론값 검증: 각 모델의 파라미터 매핑이 맞는지, 이론max가 합리적인지
2. 정밀도 최적화: FP8로 바꾸면 성능이 개선되는 모델이 있는지
3. 배치 최적화: GPU 배분이 효율적인지, 재배치가 필요한지
4. 서비스 품질: TTFT, Preemption, 대기큐에 문제 있는지
5. 종합 권고: 즉시 조치 필요한 것 1-2개

{"paramCheck": "...", "precisionAdvice": "...", "batchAdvice": "...", "qualityIssues": "...", "topRecommendations": ["...", "..."]}`;

  const raw = await callLlm(prompt);
  if (!raw) return;

  // DB에 코칭 결과 저장 (기존 SystemSetting 활용)
  const coachingKey = `GPU_COACHING_${serverId}`;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw };
    await prisma.systemSetting.upsert({
      where: { key: coachingKey },
      update: { value: JSON.stringify({ ...parsed, timestamp: new Date().toISOString(), serverName: server.name }), updatedBy: 'ai-coaching' },
      create: { key: coachingKey, value: JSON.stringify({ ...parsed, timestamp: new Date().toISOString(), serverName: server.name }), updatedBy: 'ai-coaching' },
    });
    console.log(`[GPU Coaching] ${server.name}: ${parsed.topRecommendations?.[0] || 'done'}`);
  } catch (err) {
    console.error(`[GPU Coaching] ${server.name} parse error:`, err);
  }
}

// ── 전체 서버 순차 코칭 (5분 간격) ──
async function runCoachingRound() {
  const servers = await prisma.gpuServer.findMany({ where: { enabled: true }, orderBy: { createdAt: 'asc' } });
  console.log(`[GPU Coaching] Starting round for ${servers.length} server(s)`);

  for (let i = 0; i < servers.length; i++) {
    try {
      await coachServer(servers[i].id);
    } catch (err) {
      console.error(`[GPU Coaching] Error for ${servers[i].name}:`, err);
    }
    // 마지막 서버가 아니면 5분 대기
    if (i < servers.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_SERVERS_MS));
    }
  }
  console.log('[GPU Coaching] Round complete');
}

// ── 크론 (1시간마다) ──
export function startGpuCoachingCron() {
  // 첫 실행은 서버 시작 10분 후 (데이터 수집 후)
  setTimeout(() => {
    runCoachingRound().catch(err => console.error('[GPU Coaching] Initial run failed:', err));
  }, 10 * 60 * 1000);

  interval = setInterval(() => {
    runCoachingRound().catch(err => console.error('[GPU Coaching] Cron failed:', err));
  }, COACHING_INTERVAL_MS);

  console.log('[GPU Coaching] Cron started (1h interval, 5min between servers, first run in 10min)');
}

/** 수동 실행 (특정 서버 또는 전체) */
export async function runGpuCoaching(serverId?: string) {
  if (serverId) {
    await coachServer(serverId);
  } else {
    await runCoachingRound();
  }
}

/** 특정 서버의 최신 코칭 결과 조회 */
export async function getCoachingResult(serverId: string) {
  const key = `GPU_COACHING_${serverId}`;
  const setting = await prisma.systemSetting.findUnique({ where: { key } });
  if (!setting) return null;
  try { return JSON.parse(setting.value); } catch { return null; }
}
