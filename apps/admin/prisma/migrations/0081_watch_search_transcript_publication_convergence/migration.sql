ALTER TYPE "WatchSearchCurrentTranscriptPublicationStatus"
ADD VALUE IF NOT EXISTS 'dead_letter';

CREATE TYPE "WatchSearchTranscriptPublicationWorkKind" AS ENUM (
  'publication',
  'lifecycle'
);

ALTER TABLE "watch_search_current_transcript_publication_event"
DROP CONSTRAINT "watch_search_transcript_pub_transcript_id_fkey";

ALTER TABLE "watch_search_current_transcript_publication_event"
ADD COLUMN "work_kind" "WatchSearchTranscriptPublicationWorkKind"
  NOT NULL DEFAULT 'publication',
ADD COLUMN "completed_projection_revision" bigint,
ADD COLUMN "dead_lettered_at" timestamptz;

-- Publication events are a repair ledger, not children of the canonical
-- transcript. A BEFORE DELETE trigger appends exact lifecycle cleanup evidence
-- while the transcript and its historical publication ids are still visible.
CREATE OR REPLACE FUNCTION "public".enqueue_watch_search_transcript_lifecycle_cleanup()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  latest_event record;
  current_projection record;
  lifecycle_generation bigint;
  lifecycle_contract_id text;
  lifecycle_chunking_version text;
  cleanup_document_ids text[];
BEGIN
  SELECT
    content_embedding_contract_id,
    transcript_chunking_version,
    source_generation
  INTO latest_event
  FROM "public".watch_search_current_transcript_publication_event
  WHERE transcript_id = OLD.id
  ORDER BY source_generation DESC, created_at DESC
  LIMIT 1;

  SELECT
    content_embedding_contract_id,
    transcript_chunking_version
  INTO current_projection
  FROM "public".watch_search_current_transcript_projection
  WHERE id = 'watch-search-current-transcript-projection';

  SELECT COALESCE(
    array_agg(document_id ORDER BY document_id),
    ARRAY[]::text[]
  )
  INTO cleanup_document_ids
  FROM (
    -- Full transcript rebuilds publish canonical chunk ids without creating an
    -- incremental event. Read them before the parent cascade removes the only
    -- exact identity available for lifecycle cleanup.
    SELECT chunk.id AS document_id
    FROM "public".video_transcript_chunk chunk
    WHERE chunk.transcript_id = OLD.id

    UNION

    SELECT document_id
    FROM "public".watch_search_current_transcript_publication_event event
    CROSS JOIN LATERAL unnest(
      event.current_document_ids || event.stale_document_ids
    ) AS document_id
    WHERE event.transcript_id = OLD.id
  ) evidence;

  IF cardinality(cleanup_document_ids) = 0 THEN
    RETURN OLD;
  END IF;

  lifecycle_generation := GREATEST(
    OLD.source_generation,
    COALESCE(latest_event.source_generation, OLD.source_generation)
  ) + 1;
  lifecycle_contract_id := COALESCE(
    current_projection.content_embedding_contract_id,
    latest_event.content_embedding_contract_id,
    (
      SELECT active_contract_id
      FROM "public".content_embedding_contract_pointer
      WHERE id = 'content-embedding-contract-pointer'
    )
  );
  lifecycle_chunking_version := COALESCE(
    current_projection.transcript_chunking_version,
    latest_event.transcript_chunking_version,
    OLD.chunking_version
  );

  -- Legacy transcripts without a compatible projection cannot be safely
  -- assigned to the active Typesense collection. They were not eligible for a
  -- successful full rebuild; leave their canonical delete unblocked.
  IF lifecycle_contract_id IS NULL OR lifecycle_chunking_version IS NULL THEN
    RETURN OLD;
  END IF;

  INSERT INTO "public".watch_search_current_transcript_publication_event (
    id,
    transcript_id,
    video_id,
    video_edition_id,
    language,
    content_embedding_contract_id,
    transcript_chunking_version,
    source_generation,
    source_content_hash,
    current_document_ids,
    stale_document_ids,
    work_kind,
    status,
    created_at,
    updated_at
  ) VALUES (
    OLD.id || ':lifecycle:' || lifecycle_generation::text,
    OLD.id,
    OLD.video_id,
    OLD.video_edition_id,
    OLD.language,
    lifecycle_contract_id,
    lifecycle_chunking_version,
    lifecycle_generation,
    OLD.source_content_hash,
    ARRAY[]::text[],
    cleanup_document_ids,
    'lifecycle',
    'pending',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  );

  RETURN OLD;
END;
$$;

CREATE TRIGGER "video_transcript_enqueue_watch_search_lifecycle_cleanup"
BEFORE DELETE ON "public"."video_transcript"
FOR EACH ROW
EXECUTE FUNCTION "public".enqueue_watch_search_transcript_lifecycle_cleanup();
