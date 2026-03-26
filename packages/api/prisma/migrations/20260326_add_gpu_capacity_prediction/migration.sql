CREATE TABLE "gpu_capacity_predictions" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "target_user_count" INTEGER NOT NULL,
    "current_dau" DOUBLE PRECISION NOT NULL,
    "current_users" INTEGER NOT NULL,
    "avg_tokens_per_user_per_day" DOUBLE PRECISION NOT NULL,
    "avg_requests_per_user_per_day" DOUBLE PRECISION NOT NULL,
    "peak_concurrent_requests" DOUBLE PRECISION NOT NULL,
    "avg_latency_ms" DOUBLE PRECISION,
    "current_gpu_inventory" JSONB NOT NULL,
    "current_total_vram_gb" DOUBLE PRECISION NOT NULL,
    "current_avg_gpu_util" DOUBLE PRECISION,
    "current_avg_kv_cache" DOUBLE PRECISION,
    "predicted_total_vram_gb" DOUBLE PRECISION NOT NULL,
    "predicted_gpu_count" JSONB NOT NULL,
    "predicted_b300_units" INTEGER NOT NULL,
    "gap_vram_gb" DOUBLE PRECISION NOT NULL,
    "scaling_factor" DOUBLE PRECISION NOT NULL,
    "safety_margin" DOUBLE PRECISION NOT NULL,
    "ai_analysis" TEXT NOT NULL,
    "ai_confidence" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "calculation_details" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gpu_capacity_predictions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "gpu_capacity_predictions_date_key" ON "gpu_capacity_predictions"("date");
CREATE INDEX "gpu_capacity_predictions_date_idx" ON "gpu_capacity_predictions"("date");
