-- AddColumn: LLM 서빙 메트릭 (자동 탐지 결과)
ALTER TABLE "gpu_metric_snapshots" ADD COLUMN "llm_metrics" JSONB;
