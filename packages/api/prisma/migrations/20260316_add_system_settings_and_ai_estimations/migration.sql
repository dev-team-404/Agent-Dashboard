-- SystemSetting
CREATE TABLE "system_settings" (
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by" TEXT,
  CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- AiEstimation
CREATE TABLE "ai_estimations" (
  "id" TEXT NOT NULL,
  "service_id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "estimated_mm" DOUBLE PRECISION NOT NULL,
  "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
  "reasoning" TEXT NOT NULL,
  "dau_used" DOUBLE PRECISION NOT NULL,
  "is_estimated_dau" BOOLEAN NOT NULL DEFAULT false,
  "total_calls" INTEGER NOT NULL DEFAULT 0,
  "model_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_estimations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_estimations_service_id_date_key" ON "ai_estimations"("service_id", "date");
CREATE INDEX "ai_estimations_service_id_idx" ON "ai_estimations"("service_id");
CREATE INDEX "ai_estimations_date_idx" ON "ai_estimations"("date");

ALTER TABLE "ai_estimations"
  ADD CONSTRAINT "ai_estimations_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
