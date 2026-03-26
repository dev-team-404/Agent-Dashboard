/**
 * Agent Registry 내부 서비스 시드
 *
 * 서버 시작 시 자동 실행:
 * 1. "agent-registry" BACKGROUND 서비스가 없으면 생성
 * 2. 활성화된 모든 LLM 모델을 ServiceModel로 등록 (중복 무시)
 *
 * 이 서비스는 레지스트리 자체가 사용하는 LLM 호출(AI 추정, GPU 예측, 챗봇, 에러 분석, 로고 생성)의
 * 사용량을 기록하기 위한 내부 백그라운드 서비스입니다.
 */

import { PrismaClient } from '@prisma/client';

const SERVICE_NAME = 'agent-registry';
const DISPLAY_NAME = '에이전트 레지스트리';
const DESCRIPTION = '레지스트리 플랫폼 내부 AI 기능(M/M 추정, GPU 예측, AI 도우미 챗봇, 에러 분석, 로고 생성)에서 사용하는 LLM 호출량을 추적하는 백그라운드 서비스';
const REGISTERED_BY = 'syngha.han';
const REGISTERED_BY_DEPT = 'S/W혁신팀(S.LSI)';

export async function seedAgentRegistryService(prisma: PrismaClient): Promise<void> {
  try {
    // 1. 서비스 생성 (이미 있으면 스킵)
    let service = await prisma.service.findUnique({ where: { name: SERVICE_NAME } });

    if (!service) {
      service = await prisma.service.create({
        data: {
          name: SERVICE_NAME,
          displayName: DISPLAY_NAME,
          description: DESCRIPTION,
          type: 'BACKGROUND',
          status: 'DEPLOYED',
          deployScope: 'ALL',
          enabled: true,
          registeredBy: REGISTERED_BY,
          registeredByDept: REGISTERED_BY_DEPT,
        },
      });
      console.log(`[Seed] "${DISPLAY_NAME}" 서비스 생성 완료 (id: ${service.id})`);
    } else {
      console.log(`[Seed] "${DISPLAY_NAME}" 서비스 이미 존재 — 스킵`);
    }

    // 2. 모든 활성 모델을 ServiceModel로 등록 (이미 있으면 스킵)
    const allModels = await prisma.model.findMany({
      where: { enabled: true },
      select: { id: true, name: true },
    });

    if (allModels.length === 0) {
      console.log(`[Seed] 등록할 모델 없음 — 스킵`);
      return;
    }

    let added = 0;
    for (const model of allModels) {
      const exists = await prisma.serviceModel.findFirst({
        where: {
          serviceId: service.id,
          modelId: model.id,
          aliasName: '',
        },
      });

      if (!exists) {
        await prisma.serviceModel.create({
          data: {
            serviceId: service.id,
            modelId: model.id,
            aliasName: '',
            weight: 1,
            enabled: true,
            addedBy: REGISTERED_BY,
          },
        });
        added++;
      }
    }

    if (added > 0) {
      console.log(`[Seed] "${DISPLAY_NAME}" 서비스에 모델 ${added}개 등록 (총 ${allModels.length}개 중)`);
    }
  } catch (error) {
    console.error('[Seed] agent-registry 서비스 시드 실패:', error);
  }
}
