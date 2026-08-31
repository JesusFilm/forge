-- Forward repair for databases restored from the pre-final feat-368 snapshot.
-- The snapshot created the trace audit with a raw actor_id, while the final
-- privacy contract stores only a keyed runtime digest. A migration cannot be
-- given the application HMAC key without turning that secret into durable
-- schema history, so legacy rows deliberately sacrifice actor continuity and
-- receive independent random pseudonyms before the raw identifier is removed.

ALTER TABLE "recommendation_trace_access_audit"
  ADD COLUMN IF NOT EXISTS "actor_digest" char(64);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'recommendation_trace_access_audit'
      AND column_name = 'actor_id'
  ) THEN
    UPDATE "recommendation_trace_access_audit"
    SET "actor_digest" = encode(
      sha256(convert_to(gen_random_uuid()::text, 'UTF8')),
      'hex'
    )
    WHERE "actor_digest" IS NULL;

    ALTER TABLE "recommendation_trace_access_audit"
      DROP COLUMN "actor_id";
  END IF;
END;
$$;

ALTER TABLE "recommendation_trace_access_audit"
  ALTER COLUMN "actor_digest" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'recommendation_trace_access_audit'::regclass
      AND conname = 'recommendation_trace_access_audit_actor_digest_check'
  ) THEN
    ALTER TABLE "recommendation_trace_access_audit"
      ADD CONSTRAINT "recommendation_trace_access_audit_actor_digest_check"
      CHECK ("actor_digest" ~ '^[a-f0-9]{64}$');
  END IF;
END;
$$;
