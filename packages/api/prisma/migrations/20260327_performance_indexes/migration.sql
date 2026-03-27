-- gpu_metric_snapshots 성능 인덱스
CREATE INDEX IF NOT EXISTS "gpu_metric_snapshots_server_timestamp_desc" ON "gpu_metric_snapshots"("server_id", "timestamp" DESC);

-- usage_logs 성능 인덱스 (예측 서비스용)
CREATE INDEX IF NOT EXISTS "usage_logs_timestamp_service" ON "usage_logs"("timestamp", "service_id");

-- request_logs 성능 인덱스
CREATE INDEX IF NOT EXISTS "request_logs_timestamp_status" ON "request_logs"("timestamp", "status_code");
