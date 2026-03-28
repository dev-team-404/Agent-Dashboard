-- 서비스별 테스트 계정 (Knox 인증 우회)
CREATE TABLE IF NOT EXISTS "test_accounts" (
    "id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "loginid" TEXT NOT NULL,
    "username" TEXT NOT NULL DEFAULT '테스트 사용자',
    "deptname" TEXT NOT NULL DEFAULT '',
    "business_unit" TEXT,
    "department_code" TEXT,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_accounts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "test_accounts_loginid_idx" ON "test_accounts"("loginid");
CREATE INDEX IF NOT EXISTS "test_accounts_service_id_idx" ON "test_accounts"("service_id");
CREATE UNIQUE INDEX IF NOT EXISTS "test_accounts_service_id_loginid_key" ON "test_accounts"("service_id", "loginid");

-- FK: service 삭제 시 테스트 계정도 함께 삭제
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'test_accounts_service_id_fkey'
  ) THEN
    ALTER TABLE "test_accounts"
      ADD CONSTRAINT "test_accounts_service_id_fkey"
      FOREIGN KEY ("service_id") REFERENCES "services"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
