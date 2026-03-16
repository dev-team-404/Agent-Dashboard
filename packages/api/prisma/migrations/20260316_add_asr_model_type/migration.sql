-- AlterEnum: ModelType에 ASR 추가
ALTER TYPE "ModelType" ADD VALUE 'ASR';

-- AlterTable: models에 asr_method 컬럼 추가
ALTER TABLE "models" ADD COLUMN "asr_method" TEXT;
