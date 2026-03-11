/**
 * 기존 service_models의 alias_name이 비어있으면 model.displayName으로 채움
 * db push 후 한번 실행
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    const result = await prisma.$executeRawUnsafe(`
      UPDATE "service_models" sm
      SET "alias_name" = m."displayName"
      FROM "models" m
      WHERE sm."model_id" = m."id"
        AND (sm."alias_name" IS NULL OR sm."alias_name" = '')
    `);
    console.log(`[fix-alias-names] Updated ${result} rows`);
  } catch (err: any) {
    console.log('[fix-alias-names] Skip:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
