-- CreateTable
CREATE TABLE "gpu_servers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "ssh_port" INTEGER NOT NULL DEFAULT 22,
    "ssh_username" TEXT NOT NULL,
    "ssh_password" TEXT NOT NULL,
    "description" TEXT,
    "is_local" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "poll_interval_sec" INTEGER NOT NULL DEFAULT 60,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gpu_servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gpu_metric_snapshots" (
    "id" TEXT NOT NULL,
    "server_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gpu_metrics" JSONB NOT NULL,
    "cpu_load_avg" DOUBLE PRECISION,
    "cpu_cores" INTEGER,
    "memory_total_mb" DOUBLE PRECISION,
    "memory_used_mb" DOUBLE PRECISION,
    "hostname" TEXT,
    "gpu_processes" JSONB,

    CONSTRAINT "gpu_metric_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gpu_servers_name_key" ON "gpu_servers"("name");

-- CreateIndex
CREATE INDEX "gpu_metric_snapshots_server_id_timestamp_idx" ON "gpu_metric_snapshots"("server_id", "timestamp");

-- CreateIndex
CREATE INDEX "gpu_metric_snapshots_timestamp_idx" ON "gpu_metric_snapshots"("timestamp");

-- AddForeignKey
ALTER TABLE "gpu_metric_snapshots" ADD CONSTRAINT "gpu_metric_snapshots_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "gpu_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
