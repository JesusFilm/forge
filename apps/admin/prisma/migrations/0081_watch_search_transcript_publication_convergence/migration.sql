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
CREATE OR REPLACE FUNCTION enqueue_watch_search_transcript_lifecycle_cleanup()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  latest_event record;
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
  FROM watch_search_current_transcript_publication_event
  WHERE transcript_id = OLD.id
  ORDER BY source_generation DESC, created_at DESC
  LIMIT 1;

  -- A transcript that has never emitted publication evidence cannot own a
  -- Typesense document through this pipeline, so there is no cleanup to queue.
  IF NOT FOUND THEN
    RETURN OLD;
  END IF;

  SELECT COALESCE(
    array_agg(DISTINCT document_id ORDER BY document_id),
    ARRAY[]::text[]
  )
  INTO cleanup_document_ids
  FROM watch_search_current_transcript_publication_event event
  CROSS JOIN LATERAL unnest(
    event.current_document_ids || event.stale_document_ids
  ) AS document_id
  WHERE event.transcript_id = OLD.id;

  lifecycle_generation := GREATEST(
    OLD.source_generation,
    latest_event.source_generation
  ) + 1;
  lifecycle_contract_id := COALESCE(
    (
      SELECT content_embedding_contract_id
      FROM watch_search_current_transcript_projection
      WHERE id = 'current'
    ),
    latest_event.content_embedding_contract_id
  );
  lifecycle_chunking_version := COALESCE(
    (
      SELECT transcript_chunking_version
      FROM watch_search_current_transcript_projection
      WHERE id = 'current'
    ),
    latest_event.transcript_chunking_version
  );

  INSERT INTO watch_search_current_transcript_publication_event (
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
BEFORE DELETE ON "video_transcript"
FOR EACH ROW
EXECUTE FUNCTION enqueue_watch_search_transcript_lifecycle_cleanup();
