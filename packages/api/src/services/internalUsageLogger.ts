/**
 * 내부 LLM 사용량 로거
 *
 * 레지스트리 자체가 호출하는 LLM(AI 추정, GPU 예측, 챗봇, 에러 분석, 로고 생성)의
 * 사용량을 "agent-registry" 서비스 하위에 UsageLog + RequestLog로 기록.
 *
 * deptname: S/W혁신팀(S.LSI) 고정
 */

import { prisma } from '../index.js';

const SERVICE_NAME = 'agent-registry';
const DEPT_NAME = 'S/W혁신팀(S.LSI)';

let cachedServiceId: string | null = null;

/**
 * agent-registry 서비스 ID를 캐시하여 반환
 */
async function getServiceId(): Promise<string | null> {
  if (cachedServiceId) return cachedServiceId;
  try {
    const service = await prisma.service.findUnique({
      where: { name: SERVICE_NAME },
      select: { id: true },
    });
    if (service) {
      cachedServiceId = service.id;
      return cachedServiceId;
    }
  } catch (err) {
    console.error('[InternalUsage] Failed to lookup agent-registry service:', err);
  }
  return null;
}

/**
 * 서비스 ID 캐시 초기화 (테스트용 또는 재시작 시)
 */
export function resetServiceIdCache(): void {
  cachedServiceId = null;
}

export interface InternalUsageParams {
  modelId: string;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs?: number;
  /** 호출 경로 (e.g., '/internal/ai-estimation', '/internal/gpu-prediction') */
  path: string;
  /** 성공 여부 */
  statusCode?: number;
  /** 에러 메시지 (실패 시) */
  errorMessage?: string;
  /** 스트리밍 여부 */
  stream?: boolean;
}

/**
 * 레지스트리 내부 LLM 호출을 UsageLog + RequestLog에 기록
 */
export async function logInternalLlmUsage(params: InternalUsageParams): Promise<void> {
  try {
    const serviceId = await getServiceId();
    if (!serviceId) {
      // 서비스가 아직 시드되지 않았으면 조용히 스킵
      return;
    }

    const {
      modelId, modelName,
      inputTokens, outputTokens,
      latencyMs, path,
      statusCode = 200,
      errorMessage,
      stream = false,
    } = params;

    const totalTokens = inputTokens + outputTokens;

    // UsageLog 기록 (성공 시에만)
    if (statusCode < 400 && totalTokens > 0) {
      await prisma.usageLog.create({
        data: {
          userId: null,
          modelId,
          inputTokens,
          outputTokens,
          totalTokens,
          serviceId,
          deptname: DEPT_NAME,
          latencyMs,
        },
      });
    }

    // RequestLog 기록 (성공/실패 모두)
    await prisma.requestLog.create({
      data: {
        serviceId,
        userId: null,
        deptname: DEPT_NAME,
        modelName,
        resolvedModel: modelName,
        method: 'POST',
        path,
        statusCode,
        inputTokens: inputTokens ?? null,
        outputTokens: outputTokens ?? null,
        latencyMs: latencyMs ?? null,
        errorMessage: errorMessage ? errorMessage.substring(0, 2000) : null,
        userAgent: 'agent-registry-internal',
        stream,
      },
    });

    if (totalTokens > 0) {
      console.log(`[InternalUsage] model=${modelName}, path=${path}, tokens=${totalTokens}, latency=${latencyMs || 'N/A'}ms`);
    }
  } catch (err) {
    // 로깅 실패가 메인 로직을 방해하면 안 됨
    console.error('[InternalUsage] Failed to log:', err);
  }
}
