/**
 * Backfill script: 기존 서비스에 신규 필수 필드 기본값 채우기
 * - targetMM: BACKGROUND → 2.0, STANDARD → 1.0
 * - serviceCategory: BACKGROUND → ['백그라운드 업무 자동화'], STANDARD → ['코드 생성 및 리뷰']
 * - standardMD: BACKGROUND → 0.5, STANDARD → null
 *
 * 이미 값이 있는 서비스는 건너뜁니다.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // targetMM이 null이거나 serviceCategory가 비어있는 서비스만 업데이트
  const services = await prisma.service.findMany({
    where: {
      OR: [
        { targetMM: null },
        { serviceCategory: { isEmpty: true } },
      ],
    },
    select: { id: true, type: true, targetMM: true, serviceCategory: true },
  });

  if (services.length === 0) {
    console.log('[Backfill] All services already have required fields. Skipping.');
    return;
  }

  let updated = 0;
  for (const svc of services) {
    const isBG = svc.type === 'BACKGROUND';
    const data: Record<string, unknown> = {};
    if (svc.targetMM == null) {
      data.targetMM = isBG ? 2.0 : 1.0;
    }
    if (!svc.serviceCategory || svc.serviceCategory.length === 0) {
      data.serviceCategory = isBG ? ['백그라운드 업무 자동화'] : ['코드 생성 및 리뷰'];
    }
    if (svc.targetMM == null) {
      data.standardMD = isBG ? 0.5 : null;
    }
    await prisma.service.update({ where: { id: svc.id }, data });
    updated++;
  }

  console.log(`[Backfill] Updated ${updated} services with default field values.`);
}

main()
  .catch((e) => {
    console.error('[Backfill] Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
