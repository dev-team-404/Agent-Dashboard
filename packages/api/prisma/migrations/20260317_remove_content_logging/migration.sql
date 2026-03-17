-- Remove request/response body columns from request_logs (no longer collecting LLM content)
ALTER TABLE "request_logs" DROP COLUMN IF EXISTS "request_body";
ALTER TABLE "request_logs" DROP COLUMN IF EXISTS "response_body";

-- Remove content logging fields from services
ALTER TABLE "services" DROP COLUMN IF EXISTS "content_logging_enabled";
ALTER TABLE "services" DROP COLUMN IF EXISTS "content_logging_consent_at";
ALTER TABLE "services" DROP COLUMN IF EXISTS "content_logging_consent_by";
