CREATE TABLE "admin_requests" (
  "id" TEXT NOT NULL,
  "loginid" TEXT NOT NULL,
  "username" TEXT NOT NULL DEFAULT '',
  "deptname" TEXT NOT NULL DEFAULT '',
  "business_unit" TEXT,
  "title_name" TEXT,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reviewed_by" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "review_note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_requests_loginid_idx" ON "admin_requests"("loginid");
CREATE INDEX "admin_requests_status_idx" ON "admin_requests"("status");
CREATE INDEX "admin_requests_created_at_idx" ON "admin_requests"("created_at");
