ALTER TABLE "watch_search_candidate_generation"
  ADD COLUMN IF NOT EXISTS "content_embedding_contract_id" varchar(128),
  ADD COLUMN IF NOT EXISTS "transcript_chunking_version" varchar(128);

ALTER TABLE "watch_search_candidate_qualification"
  ADD COLUMN IF NOT EXISTS "content_embedding_contract_id" varchar(128),
  ADD COLUMN IF NOT EXISTS "transcript_chunking_version" varchar(128);

ALTER TABLE "watch_search_candidate_lease"
  ADD COLUMN IF NOT EXISTS "content_embedding_contract_id" varchar(128),
  ADD COLUMN IF NOT EXISTS "transcript_chunking_version" varchar(128);

DO $$
DECLARE
  active_contract_id text;
  active_chunking_versions text[];
  needs_compatibility_backfill boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM "watch_search_candidate_generation"
    WHERE "content_embedding_contract_id" IS NULL
       OR "transcript_chunking_version" IS NULL
    UNION ALL
    SELECT 1
    FROM "watch_search_candidate_qualification"
    WHERE "content_embedding_contract_id" IS NULL
       OR "transcript_chunking_version" IS NULL
    UNION ALL
    SELECT 1
    FROM "watch_search_candidate_lease"
    WHERE "content_embedding_contract_id" IS NULL
       OR "transcript_chunking_version" IS NULL
  )
  INTO needs_compatibility_backfill;

  -- Fresh databases have no legacy candidate rows to backfill, so they do not
  -- need a current transcript compatibility tuple during migration deploy.
  IF NOT needs_compatibility_backfill THEN
    RETURN;
  END IF;

  SELECT pointer.active_contract_id
  INTO active_contract_id
  FROM content_embedding_contract_pointer pointer
  WHERE pointer.id = 'content-embedding-contract-pointer';

  IF active_contract_id IS NULL OR length(btrim(active_contract_id)) = 0 THEN
    RAISE EXCEPTION
      'watch search candidate compatibility backfill requires one active content embedding contract';
  END IF;

  SELECT COALESCE(array_agg(version ORDER BY version), ARRAY[]::text[])
  INTO active_chunking_versions
  FROM (
    SELECT DISTINCT vt.chunking_version AS version
    FROM video_transcript vt
    JOIN video_transcript_chunk vtc
      ON vtc.transcript_id = vt.id
    JOIN content_embedding_contract_pointer pointer
      ON pointer.id = 'content-embedding-contract-pointer'
    JOIN content_embedding_contract contract
      ON contract.id = pointer.active_contract_id
    WHERE vtc.embedding IS NOT NULL
      AND vt.embedding_provider = contract.storage_provider
      AND vt.model = contract.storage_model
      AND vt.dimensions = contract.storage_dimensions
      AND vt.embedding_native_dimensions = contract.storage_native_dimensions
      AND vt.embedding_transform_version IS NOT DISTINCT FROM contract.storage_transform_version
      AND vtc.model = contract.storage_model
      AND vtc.dimensions = contract.storage_dimensions
  ) versions;

  IF array_length(active_chunking_versions, 1) IS DISTINCT FROM 1
     OR active_chunking_versions[1] IS NULL
     OR length(btrim(active_chunking_versions[1])) = 0 THEN
    RAISE EXCEPTION
      'watch search candidate compatibility backfill requires one exact current transcript chunking version';
  END IF;

  UPDATE "watch_search_candidate_generation"
  SET
    "content_embedding_contract_id" = active_contract_id,
    "transcript_chunking_version" = active_chunking_versions[1]
  WHERE "content_embedding_contract_id" IS NULL
     OR "transcript_chunking_version" IS NULL;

  UPDATE "watch_search_candidate_qualification"
  SET
    "content_embedding_contract_id" = active_contract_id,
    "transcript_chunking_version" = active_chunking_versions[1]
  WHERE "content_embedding_contract_id" IS NULL
     OR "transcript_chunking_version" IS NULL;

  UPDATE "watch_search_candidate_lease"
  SET
    "content_embedding_contract_id" = active_contract_id,
    "transcript_chunking_version" = active_chunking_versions[1]
  WHERE "content_embedding_contract_id" IS NULL
     OR "transcript_chunking_version" IS NULL;
END
$$;

ALTER TABLE "watch_search_candidate_generation"
  ALTER COLUMN "content_embedding_contract_id" SET NOT NULL,
  ALTER COLUMN "transcript_chunking_version" SET NOT NULL;

ALTER TABLE "watch_search_candidate_qualification"
  ALTER COLUMN "content_embedding_contract_id" SET NOT NULL,
  ALTER COLUMN "transcript_chunking_version" SET NOT NULL;

ALTER TABLE "watch_search_candidate_lease"
  ALTER COLUMN "content_embedding_contract_id" SET NOT NULL,
  ALTER COLUMN "transcript_chunking_version" SET NOT NULL;

ALTER TABLE "watch_search_candidate_generation"
  ADD CONSTRAINT "watch_search_candidate_generation_exact_compatibility_check"
    CHECK (
      length(btrim("content_embedding_contract_id")) > 0
      AND length(btrim("transcript_chunking_version")) > 0
    );

ALTER TABLE "watch_search_candidate_qualification"
  ADD CONSTRAINT "watch_search_candidate_qualification_exact_compatibility_check"
    CHECK (
      length(btrim("content_embedding_contract_id")) > 0
      AND length(btrim("transcript_chunking_version")) > 0
    );

ALTER TABLE "watch_search_candidate_lease"
  ADD CONSTRAINT "watch_search_candidate_lease_exact_compatibility_check"
    CHECK (
      length(btrim("content_embedding_contract_id")) > 0
      AND length(btrim("transcript_chunking_version")) > 0
    );

CREATE INDEX "watch_search_candidate_generation_transcript_compatibility_idx"
  ON "watch_search_candidate_generation"(
    "transcript_collection",
    "content_embedding_contract_id",
    "transcript_chunking_version"
  );

CREATE INDEX "watch_search_candidate_lease_transcript_compatibility_expires_at_idx"
  ON "watch_search_candidate_lease"(
    "transcript_collection",
    "content_embedding_contract_id",
    "transcript_chunking_version",
    "expires_at"
  );

CREATE OR REPLACE FUNCTION "reject_watch_search_candidate_identity_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW."id",
    NEW."application_revision",
    NEW."source_epoch",
    NEW."source_digests",
    NEW."catalog_collection",
    NEW."availability_collection",
    NEW."lexical_collection",
    NEW."transcript_collection",
    NEW."content_embedding_contract_id",
    NEW."transcript_chunking_version",
    NEW."transcript_projection_revision",
    NEW."catalog_fields",
    NEW."availability_fields",
    NEW."lexical_fields",
    NEW."transcript_fields",
    NEW."owned_collections",
    NEW."shared_collections"
  ) IS DISTINCT FROM ROW(
    OLD."id",
    OLD."application_revision",
    OLD."source_epoch",
    OLD."source_digests",
    OLD."catalog_collection",
    OLD."availability_collection",
    OLD."lexical_collection",
    OLD."transcript_collection",
    OLD."content_embedding_contract_id",
    OLD."transcript_chunking_version",
    OLD."transcript_projection_revision",
    OLD."catalog_fields",
    OLD."availability_fields",
    OLD."lexical_fields",
    OLD."transcript_fields",
    OLD."owned_collections",
    OLD."shared_collections"
  ) THEN
    RAISE EXCEPTION 'watch search candidate identity is immutable';
  END IF;

  IF NEW."state" <> OLD."state" THEN
    IF NOT (
      (OLD."state" = 'building' AND NEW."state" IN ('ready', 'invalidated', 'retiring'))
      OR (OLD."state" = 'ready' AND NEW."state" = 'invalidated')
      OR (OLD."state" = 'invalidated' AND NEW."state" = 'retiring')
      OR (OLD."state" = 'retiring' AND NEW."state" = 'retired')
    ) THEN
      RAISE EXCEPTION 'illegal watch search candidate lifecycle transition: % -> %',
        OLD."state", NEW."state";
    END IF;
    IF NEW."version" <> OLD."version" + 1 THEN
      RAISE EXCEPTION 'watch search candidate lifecycle must increment version';
    END IF;
  END IF;

  IF NEW."state" = 'ready' AND NEW."validated_at" IS NULL THEN
    RAISE EXCEPTION 'ready watch search candidate must be fully validated';
  END IF;
  IF NEW."state" = 'invalidated' AND (
    NEW."invalidated_at" IS NULL
    OR NEW."invalidation_reason" IS NULL
    OR length(btrim(NEW."invalidation_reason")) = 0
  ) THEN
    RAISE EXCEPTION 'invalidated watch search candidate requires a reason';
  END IF;
  IF NEW."state" = 'retired' AND (
    NEW."retired_at" IS NULL
    OR jsonb_typeof(NEW."deletion_progress"->'deletedCollections') IS DISTINCT FROM 'array'
    OR NOT ((NEW."deletion_progress"->'deletedCollections') @> NEW."owned_collections")
    OR NOT (NEW."owned_collections" @> (NEW."deletion_progress"->'deletedCollections'))
  ) THEN
    RAISE EXCEPTION 'retired watch search candidate requires complete deletion progress';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "watch_search_candidate_generation_identity_guard"
ON "watch_search_candidate_generation";

CREATE TRIGGER "watch_search_candidate_generation_identity_guard"
BEFORE UPDATE ON "watch_search_candidate_generation"
FOR EACH ROW
EXECUTE FUNCTION "reject_watch_search_candidate_identity_update"();
