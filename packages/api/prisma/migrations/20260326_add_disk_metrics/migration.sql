ALTER TABLE "gpu_metric_snapshots" ADD COLUMN "disk_total_gb" DOUBLE PRECISION;
ALTER TABLE "gpu_metric_snapshots" ADD COLUMN "disk_used_gb" DOUBLE PRECISION;
ALTER TABLE "gpu_metric_snapshots" ADD COLUMN "disk_free_gb" DOUBLE PRECISION;
