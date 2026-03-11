-- Add alias_name column to service_models (v1/models에 표시될 가상 모델명)
ALTER TABLE "service_models" ADD COLUMN "alias_name" TEXT;

-- 기존 데이터: model의 displayName으로 alias_name 설정
UPDATE "service_models" sm
SET "alias_name" = m."displayName"
FROM "models" m
WHERE sm."model_id" = m."id";

-- alias_name NOT NULL 설정
ALTER TABLE "service_models" ALTER COLUMN "alias_name" SET NOT NULL;

-- 기존 unique constraint 삭제 (동일 모델이 다른 alias로 등록 가능하도록)
ALTER TABLE "service_models" DROP CONSTRAINT IF EXISTS "service_models_service_id_model_id_key";

-- 새 unique constraint: 같은 서비스 + 같은 alias + 같은 모델 조합은 중복 불가
CREATE UNIQUE INDEX "service_models_service_id_model_id_alias_name_key" ON "service_models"("service_id", "model_id", "alias_name");
