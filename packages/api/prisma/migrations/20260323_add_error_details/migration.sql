-- AlterTable: RequestLog에 error_details JSONB 컬럼 추가
-- 기존 데이터에 영향 없음 (nullable, 기본값 NULL)
ALTER TABLE "request_logs" ADD COLUMN "error_details" JSONB;
