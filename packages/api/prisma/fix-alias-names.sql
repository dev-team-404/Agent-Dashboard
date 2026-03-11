-- 기존 service_models에 alias_name이 비어있으면 model.displayName으로 채움
UPDATE "service_models" sm
SET "alias_name" = m."displayName"
FROM "models" m
WHERE sm."model_id" = m."id"
  AND (sm."alias_name" IS NULL OR sm."alias_name" = '');
