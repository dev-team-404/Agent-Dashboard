-- GPU Power Usage: date(일별) → timestamp(시간별) 전환
-- 기존 데이터 TRUNCATE 후 스키마 변경

-- 1) 기존 데이터 삭제
TRUNCATE TABLE "gpu_power_usages";

-- 2) 기존 인덱스 삭제
DROP INDEX IF EXISTS "gpu_power_usages_date_key";
DROP INDEX IF EXISTS "gpu_power_usages_date_idx";

-- 3) 컬럼 타입 변경 (DATE → TIMESTAMP) + 이름 변경
ALTER TABLE "gpu_power_usages" RENAME COLUMN "date" TO "timestamp";
ALTER TABLE "gpu_power_usages" ALTER COLUMN "timestamp" TYPE TIMESTAMP(3) USING "timestamp"::timestamp(3);

-- 4) 새 인덱스 생성
CREATE UNIQUE INDEX "gpu_power_usages_timestamp_key" ON "gpu_power_usages"("timestamp");
CREATE INDEX "gpu_power_usages_timestamp_idx" ON "gpu_power_usages"("timestamp");
