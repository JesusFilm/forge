-- Run after the expired enum value is committed, because Postgres does not
-- allow a new enum value to be referenced in the same transaction that adds it.
CREATE INDEX IF NOT EXISTS "mapper_match_job_expired_upload_cleanup_idx"
ON "mapper_match_job"("queued_at", "id")
WHERE "status" = 'expired'
  AND (
    "upload_storage_key" IS NOT NULL
    OR "upload_content_type" IS NOT NULL
    OR "upload_byte_length" IS NOT NULL
  );
