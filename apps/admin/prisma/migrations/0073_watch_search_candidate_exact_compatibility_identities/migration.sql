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
BEGIN
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
