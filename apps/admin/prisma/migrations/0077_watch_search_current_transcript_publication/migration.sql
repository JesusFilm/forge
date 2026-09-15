ALTER TABLE "video_transcript"
ADD COLUMN "source_generation" bigint NOT NULL DEFAULT 0;

CREATE TYPE "WatchSearchCurrentTranscriptPublicationStatus" AS ENUM (
  'pending',
  'claimed',
  'completed'
);

CREATE TABLE "watch_search_current_transcript_projection" (
  "id" varchar(64) NOT NULL,
  "transcript_collection" varchar(255),
  "content_embedding_contract_id" varchar(128),
  "transcript_chunking_version" varchar(128),
  "projection_revision" bigint NOT NULL DEFAULT 0,
  "version" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "watch_search_current_transcript_projection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "watch_search_current_transcript_publication_event" (
  "id" text NOT NULL,
  "transcript_id" text NOT NULL,
  "video_id" text NOT NULL,
  "video_edition_id" text NOT NULL,
  "language" text NOT NULL,
  "content_embedding_contract_id" varchar(128) NOT NULL,
  "transcript_chunking_version" varchar(128) NOT NULL,
  "source_generation" bigint NOT NULL,
  "source_content_hash" text,
  "current_document_ids" text[] NOT NULL,
  "stale_document_ids" text[] NOT NULL,
  "status" "WatchSearchCurrentTranscriptPublicationStatus" NOT NULL DEFAULT 'pending',
  "lease_generation" integer NOT NULL DEFAULT 0,
  "lease_token_hash" varchar(128),
  "lease_expires_at" timestamptz,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamptz,
  "last_error_code" varchar(128),
  "completed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "watch_search_current_transcript_publication_event_pkey"
    PRIMARY KEY ("id"),
  CONSTRAINT "watch_search_current_transcript_publication_event_transcript_id_fkey"
    FOREIGN KEY ("transcript_id")
    REFERENCES "video_transcript"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE UNIQUE INDEX
  "watch_search_current_transcript_publication_event_transcript_id_source_generation_key"
ON "watch_search_current_transcript_publication_event"(
  "transcript_id",
  "source_generation"
);

CREATE INDEX
  "watch_search_current_transcript_publication_event_status_next_attempt_created_idx"
ON "watch_search_current_transcript_publication_event"(
  "status",
  "next_attempt_at",
  "created_at"
);

CREATE INDEX
  "watch_search_current_transcript_publication_event_transcript_status_created_idx"
ON "watch_search_current_transcript_publication_event"(
  "transcript_id",
  "status",
  "created_at"
);
