/**
 * Pre-migration: gpu_power_usages.date → timestamp 컬럼 변환
 *
 * Prisma db push 전에 실행하여 기존 date(Date) 컬럼을
 * timestamp(DateTime/timestamptz)로 변환. 멱등성 보장.
 *
 * 실행: node scripts/pre-migrate-gpu-power.mjs
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // gpu_power_usages 테이블에 date 컬럼이 존재하는지 확인
  const cols = await prisma.$queryRawUnsafe(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'gpu_power_usages'
      AND column_name IN ('date', 'timestamp')
  `);

  const hasDate = cols.some(c => c.column_name === 'date');
  const hasTimestamp = cols.some(c => c.column_name === 'timestamp');

  if (!hasDate) {
    console.log('✅ gpu_power_usages: date 컬럼 없음 — 마이그레이션 불필요');
    return;
  }

  if (hasTimestamp) {
    console.log('✅ gpu_power_usages: timestamp 컬럼 이미 존재 — 마이그레이션 불필요');
    return;
  }

  console.log('🔄 gpu_power_usages: date → timestamp 컬럼 변환 시작');

  // date(Date) → timestamp(timestamptz) 변환
  // Date 값은 자정(00:00:00)으로 캐스팅됨
  await prisma.$executeRawUnsafe(`
    ALTER TABLE gpu_power_usages
      ALTER COLUMN date TYPE timestamptz USING date::timestamptz
  `);

  // 컬럼명 변경: date → timestamp
  await prisma.$executeRawUnsafe(`
    ALTER TABLE gpu_power_usages
      RENAME COLUMN date TO "timestamp"
  `);

  // 기존 인덱스 삭제 후 재생성 (인덱스명이 다를 수 있으므로 안전하게 처리)
  await prisma.$executeRawUnsafe(`
    DROP INDEX IF EXISTS gpu_power_usages_date_idx
  `);
  await prisma.$executeRawUnsafe(`
    DROP INDEX IF EXISTS gpu_power_usages_date_key
  `);

  console.log('✅ gpu_power_usages: date → timestamp 변환 완료 (기존 데이터 보존)');
}

main()
  .catch(e => {
    console.error('❌ pre-migrate-gpu-power 실패:', e.message);
    // 실패해도 프로세스를 멈추지 않음 — prisma db push에서 처리
  })
  .finally(() => prisma.$disconnect());
