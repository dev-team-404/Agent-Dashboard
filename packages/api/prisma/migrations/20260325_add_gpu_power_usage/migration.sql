-- CreateTable
CREATE TABLE "gpu_power_usages" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "power_avg_usage_ratio" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gpu_power_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gpu_power_usages_date_key" ON "gpu_power_usages"("date");

-- CreateIndex
CREATE INDEX "gpu_power_usages_date_idx" ON "gpu_power_usages"("date");
