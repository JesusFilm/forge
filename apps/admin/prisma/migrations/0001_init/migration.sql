-- Admin app initial migration — collapsed.
--
-- This is the single source-of-truth schema bootstrap. No prior migration
-- history exists in any deployed environment yet, so we collapsed the
-- iterative Phase 2 migrations (init, content models, HNSW index, Ping
-- spike, drop spike, variant→dub rename, embedding move to per-locale)
-- into one clean apply. Future schema changes append new migration files
-- as normal.
--
-- Operational note: `CREATE EXTENSION vector` requires the DB role to have
-- the privilege. Pre-deploy runbook step: assert
--   SELECT 1 FROM pg_extension WHERE extname='vector'
-- returns a row before applying. If it doesn't, run
--   CREATE EXTENSION vector
-- manually as the Railway DB owner and then mark this migration as applied.

-- =============================================================================
-- Extensions
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "vector";

-- =============================================================================
-- Enums
-- =============================================================================

CREATE TYPE "SourceTier"   AS ENUM ('core', 'manager');
CREATE TYPE "LocaleStatus" AS ENUM ('draft', 'published', 'archived');
CREATE TYPE "VideoLabel"   AS ENUM (
  'collection', 'episode', 'featureFilm', 'segment',
  'series', 'shortFilm', 'trailer', 'behindTheScenes'
);
CREATE TYPE "VideoSource"  AS ENUM ('internal', 'youTube', 'cloudflare', 'mux');

-- =============================================================================
-- Core sync infrastructure
-- =============================================================================

CREATE TABLE "sync_state" (
    "phase"          TEXT        PRIMARY KEY,
    "last_synced_at" TIMESTAMPTZ NOT NULL,
    "stats"          JSONB       NOT NULL DEFAULT '{}',
    "updated_at"     TIMESTAMPTZ NOT NULL
);

CREATE TABLE "sync_locks" (
    "key"          TEXT        PRIMARY KEY,
    "held_by"      TEXT,
    "acquired_at"  TIMESTAMPTZ,
    "updated_at"   TIMESTAMPTZ NOT NULL
);

-- =============================================================================
-- Reference data (Core-sourced; FK targets for Video et al.)
-- =============================================================================

CREATE TABLE "language" (
    "id"               TEXT         PRIMARY KEY,
    "core_id"          TEXT         NOT NULL UNIQUE,
    "source"           "SourceTier" NOT NULL DEFAULT 'core',
    "name"             JSONB        NOT NULL DEFAULT '{}',
    "bcp47"            TEXT,
    "iso3"             TEXT,
    "slug"             TEXT         UNIQUE,
    "synced_at"        TIMESTAMPTZ,
    "deleted_at"       TIMESTAMPTZ,
    "created_at"       TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMPTZ  NOT NULL
);
CREATE INDEX "language_deleted_at_idx" ON "language"("deleted_at");

CREATE TABLE "continent" (
    "id"               TEXT         PRIMARY KEY,
    "core_id"          TEXT         NOT NULL UNIQUE,
    "source"           "SourceTier" NOT NULL DEFAULT 'core',
    "name"             JSONB        NOT NULL DEFAULT '{}',
    "slug"             TEXT,
    "synced_at"        TIMESTAMPTZ,
    "deleted_at"       TIMESTAMPTZ,
    "created_at"       TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMPTZ  NOT NULL
);
CREATE INDEX "continent_deleted_at_idx" ON "continent"("deleted_at");

CREATE TABLE "country" (
    "id"                            TEXT         PRIMARY KEY,
    "core_id"                       TEXT         NOT NULL UNIQUE,
    "source"                        "SourceTier" NOT NULL DEFAULT 'core',
    "name"                          JSONB        NOT NULL DEFAULT '{}',
    "population"                    INTEGER,
    "latitude"                      DOUBLE PRECISION,
    "longitude"                     DOUBLE PRECISION,
    "flag_png_src"                  TEXT,
    "flag_webp_src"                 TEXT,
    "language_count"                INTEGER,
    "language_having_media_count"   INTEGER,
    "continent_id"                  TEXT,
    "synced_at"                     TIMESTAMPTZ,
    "deleted_at"                    TIMESTAMPTZ,
    "created_at"                    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                    TIMESTAMPTZ  NOT NULL,
    CONSTRAINT "country_continent_id_fkey"
        FOREIGN KEY ("continent_id") REFERENCES "continent"("id") ON DELETE SET NULL
);
CREATE INDEX "country_continent_id_idx" ON "country"("continent_id");
CREATE INDEX "country_deleted_at_idx"   ON "country"("deleted_at");

CREATE TABLE "country_language" (
    "id"          TEXT        PRIMARY KEY,
    "country_id"  TEXT        NOT NULL,
    "language_id" TEXT        NOT NULL,
    "speakers"    INTEGER,
    "suggested"   BOOLEAN     DEFAULT false,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "country_language_country_id_fkey"
        FOREIGN KEY ("country_id")  REFERENCES "country"("id")  ON DELETE CASCADE,
    CONSTRAINT "country_language_language_id_fkey"
        FOREIGN KEY ("language_id") REFERENCES "language"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "country_language_country_id_language_id_key"
    ON "country_language"("country_id", "language_id");
CREATE INDEX "country_language_language_id_idx" ON "country_language"("language_id");

CREATE TABLE "keyword" (
    "id"               TEXT         PRIMARY KEY,
    "core_id"          TEXT         NOT NULL UNIQUE,
    "source"           "SourceTier" NOT NULL DEFAULT 'core',
    "value"            TEXT         NOT NULL,
    "language_id"      TEXT,
    "synced_at"        TIMESTAMPTZ,
    "deleted_at"       TIMESTAMPTZ,
    "created_at"       TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMPTZ  NOT NULL,
    CONSTRAINT "keyword_language_id_fkey"
        FOREIGN KEY ("language_id") REFERENCES "language"("id") ON DELETE SET NULL
);
CREATE INDEX "keyword_language_id_idx" ON "keyword"("language_id");
CREATE INDEX "keyword_value_idx"       ON "keyword"("value");
CREATE INDEX "keyword_deleted_at_idx"  ON "keyword"("deleted_at");

CREATE TABLE "video_origin" (
    "id"               TEXT         PRIMARY KEY,
    "core_id"          TEXT         NOT NULL UNIQUE,
    "source"           "SourceTier" NOT NULL DEFAULT 'core',
    "name"             TEXT         NOT NULL,
    "synced_at"        TIMESTAMPTZ,
    "deleted_at"       TIMESTAMPTZ,
    "created_at"       TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMPTZ  NOT NULL
);
CREATE INDEX "video_origin_deleted_at_idx" ON "video_origin"("deleted_at");

CREATE TABLE "video_edition" (
    "id"               TEXT         PRIMARY KEY,
    "core_id"          TEXT         NOT NULL UNIQUE,
    "source"           "SourceTier" NOT NULL DEFAULT 'core',
    "name"             TEXT         NOT NULL,
    "synced_at"        TIMESTAMPTZ,
    "deleted_at"       TIMESTAMPTZ,
    "created_at"       TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMPTZ  NOT NULL
);
CREATE INDEX "video_edition_deleted_at_idx" ON "video_edition"("deleted_at");

CREATE TABLE "mux_video" (
    "id"               TEXT         PRIMARY KEY,
    "core_id"          TEXT         UNIQUE,
    "source"           "SourceTier" NOT NULL DEFAULT 'core',
    "asset_id"         TEXT,
    "playback_id"      TEXT,
    "upload_id"        TEXT,
    "duration"         INTEGER,
    "synced_at"        TIMESTAMPTZ,
    "created_at"       TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMPTZ  NOT NULL
);

CREATE TABLE "bible_book" (
    "id"               TEXT         PRIMARY KEY,
    "core_id"          TEXT         NOT NULL UNIQUE,
    "source"           "SourceTier" NOT NULL DEFAULT 'core',
    "name"             JSONB        NOT NULL DEFAULT '{}',
    "order"            INTEGER,
    "testament"        TEXT,
    "synced_at"        TIMESTAMPTZ,
    "deleted_at"       TIMESTAMPTZ,
    "created_at"       TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMPTZ  NOT NULL
);
CREATE INDEX "bible_book_deleted_at_idx" ON "bible_book"("deleted_at");

-- =============================================================================
-- Video and friends
-- =============================================================================

CREATE TABLE "video" (
    "id"                  TEXT         PRIMARY KEY,
    "core_id"             TEXT         NOT NULL UNIQUE,
    "source"              "SourceTier" NOT NULL DEFAULT 'core',
    "slug"                TEXT         NOT NULL UNIQUE,
    "label"               "VideoLabel",
    "video_source"        "VideoSource",
    "locked"              BOOLEAN      NOT NULL DEFAULT false,
    "no_index"            BOOLEAN      NOT NULL DEFAULT false,
    "ai_metadata"         BOOLEAN      NOT NULL DEFAULT false,
    "primary_language_id" TEXT,
    "origin_id"           TEXT,
    "synced_at"           TIMESTAMPTZ,
    "deleted_at"          TIMESTAMPTZ,
    "created_at"          TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMPTZ  NOT NULL,
    CONSTRAINT "video_primary_language_id_fkey"
        FOREIGN KEY ("primary_language_id") REFERENCES "language"("id") ON DELETE SET NULL,
    CONSTRAINT "video_origin_id_fkey"
        FOREIGN KEY ("origin_id") REFERENCES "video_origin"("id") ON DELETE SET NULL
);
CREATE INDEX "video_primary_language_id_idx" ON "video"("primary_language_id");
CREATE INDEX "video_origin_id_idx"           ON "video"("origin_id");
CREATE INDEX "video_deleted_at_idx"          ON "video"("deleted_at");

CREATE TABLE "video_locale" (
    "id"           TEXT          PRIMARY KEY,
    "video_id"     TEXT          NOT NULL,
    "locale"       TEXT          NOT NULL,
    "title"        TEXT,
    "description"  TEXT,
    "snippet"      TEXT,
    "image_alt"    TEXT,
    "status"       "LocaleStatus" NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMPTZ,
    "created_at"   TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMPTZ   NOT NULL,
    CONSTRAINT "video_locale_video_id_fkey"
        FOREIGN KEY ("video_id") REFERENCES "video"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "video_locale_video_id_locale_key" ON "video_locale"("video_id", "locale");
CREATE INDEX "video_locale_locale_idx" ON "video_locale"("locale");

CREATE TABLE "video_relation" (
    "id"         TEXT        PRIMARY KEY,
    "parent_id"  TEXT        NOT NULL,
    "child_id"   TEXT        NOT NULL,
    "order"      INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "video_relation_parent_id_fkey"
        FOREIGN KEY ("parent_id") REFERENCES "video"("id") ON DELETE CASCADE,
    CONSTRAINT "video_relation_child_id_fkey"
        FOREIGN KEY ("child_id")  REFERENCES "video"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "video_relation_parent_id_child_id_key"
    ON "video_relation"("parent_id", "child_id");
CREATE INDEX "video_relation_child_id_idx" ON "video_relation"("child_id");

CREATE TABLE "video_keyword" (
    "video_id"   TEXT NOT NULL,
    "keyword_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("video_id", "keyword_id"),
    CONSTRAINT "video_keyword_video_id_fkey"
        FOREIGN KEY ("video_id")   REFERENCES "video"("id")   ON DELETE CASCADE,
    CONSTRAINT "video_keyword_keyword_id_fkey"
        FOREIGN KEY ("keyword_id") REFERENCES "keyword"("id") ON DELETE CASCADE
);
CREATE INDEX "video_keyword_keyword_id_idx" ON "video_keyword"("keyword_id");

-- VideoDub — language-specific audio dub of an Edition, bundled with its
-- encoded playback. Core API calls this a "video-variant"; the admin app
-- uses "dub" because the varying axis is the audio language. Boundary
-- translation lives in the Core-sync transform layer.
CREATE TABLE "video_dub" (
    "id"                     TEXT         PRIMARY KEY,
    "core_id"                TEXT         NOT NULL UNIQUE,
    "source"                 "SourceTier" NOT NULL DEFAULT 'core',
    "slug"                   TEXT,
    "duration"               INTEGER,
    "length_in_milliseconds" BIGINT,
    "hls"                    TEXT,
    "dash"                   TEXT,
    "share"                  TEXT,
    "downloadable"           BOOLEAN      NOT NULL DEFAULT false,
    "published"              BOOLEAN      NOT NULL DEFAULT false,
    "version"                INTEGER,
    "brightcove_id"          TEXT,
    "ai_generated"           BOOLEAN      NOT NULL DEFAULT false,
    "video_id"               TEXT         NOT NULL,
    "language_id"            TEXT,
    "video_edition_id"       TEXT,
    "mux_video_id"           TEXT,
    "synced_at"              TIMESTAMPTZ,
    "deleted_at"             TIMESTAMPTZ,
    "created_at"             TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"             TIMESTAMPTZ  NOT NULL,
    CONSTRAINT "video_dub_video_id_fkey"
        FOREIGN KEY ("video_id")         REFERENCES "video"("id")         ON DELETE CASCADE,
    CONSTRAINT "video_dub_language_id_fkey"
        FOREIGN KEY ("language_id")      REFERENCES "language"("id")      ON DELETE SET NULL,
    CONSTRAINT "video_dub_video_edition_id_fkey"
        FOREIGN KEY ("video_edition_id") REFERENCES "video_edition"("id") ON DELETE SET NULL,
    CONSTRAINT "video_dub_mux_video_id_fkey"
        FOREIGN KEY ("mux_video_id")     REFERENCES "mux_video"("id")     ON DELETE SET NULL
);
CREATE INDEX "video_dub_video_id_idx"         ON "video_dub"("video_id");
CREATE INDEX "video_dub_language_id_idx"      ON "video_dub"("language_id");
CREATE INDEX "video_dub_video_edition_id_idx" ON "video_dub"("video_edition_id");
CREATE INDEX "video_dub_mux_video_id_idx"     ON "video_dub"("mux_video_id");
CREATE INDEX "video_dub_deleted_at_idx"       ON "video_dub"("deleted_at");

CREATE TABLE "video_dub_download" (
    "id"           TEXT        PRIMARY KEY,
    "video_dub_id" TEXT        NOT NULL,
    "quality"      TEXT,
    "url"          TEXT,
    "size"         BIGINT,
    "width"        INTEGER,
    "height"       INTEGER,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "video_dub_download_video_dub_id_fkey"
        FOREIGN KEY ("video_dub_id") REFERENCES "video_dub"("id") ON DELETE CASCADE
);
CREATE INDEX "video_dub_download_video_dub_id_idx"
    ON "video_dub_download"("video_dub_id");

-- VideoSubtitle attaches to VideoEdition because timecodes derive from the
-- edition's cut, not from the audio dub. One unified entity covers
-- subtitles, transcripts (source-language), and closed captions
-- (same-language-as-dub) — semantics derived at query time.
CREATE TABLE "video_subtitle" (
    "id"                TEXT         PRIMARY KEY,
    "core_id"           TEXT         UNIQUE,
    "source"            "SourceTier" NOT NULL DEFAULT 'core',
    "video_edition_id"  TEXT         NOT NULL,
    "language_id"       TEXT,
    "vtt_src"           TEXT,
    "srt_src"           TEXT,
    "ai_generated"      BOOLEAN      NOT NULL DEFAULT false,
    "synced_at"         TIMESTAMPTZ,
    "deleted_at"        TIMESTAMPTZ,
    "created_at"        TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMPTZ  NOT NULL,
    CONSTRAINT "video_subtitle_video_edition_id_fkey"
        FOREIGN KEY ("video_edition_id") REFERENCES "video_edition"("id") ON DELETE CASCADE
);
CREATE INDEX "video_subtitle_video_edition_id_idx" ON "video_subtitle"("video_edition_id");
CREATE INDEX "video_subtitle_language_id_idx"      ON "video_subtitle"("language_id");
CREATE INDEX "video_subtitle_deleted_at_idx"       ON "video_subtitle"("deleted_at");

CREATE TABLE "video_study_question" (
    "id"         TEXT         PRIMARY KEY,
    "core_id"    TEXT         UNIQUE,
    "source"     "SourceTier" NOT NULL DEFAULT 'core',
    "video_id"   TEXT         NOT NULL,
    "text"       JSONB        NOT NULL DEFAULT '{}',
    "order"      INTEGER,
    "synced_at"  TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ  NOT NULL,
    CONSTRAINT "video_study_question_video_id_fkey"
        FOREIGN KEY ("video_id") REFERENCES "video"("id") ON DELETE CASCADE
);
CREATE INDEX "video_study_question_video_id_idx" ON "video_study_question"("video_id");

CREATE TABLE "video_image" (
    "id"         TEXT         PRIMARY KEY,
    "core_id"    TEXT         UNIQUE,
    "source"     "SourceTier" NOT NULL DEFAULT 'core',
    "video_id"   TEXT         NOT NULL,
    "url"        TEXT,
    "width"      INTEGER,
    "height"     INTEGER,
    "blurhash"   TEXT,
    "kind"       TEXT,
    "synced_at"  TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ  NOT NULL,
    CONSTRAINT "video_image_video_id_fkey"
        FOREIGN KEY ("video_id") REFERENCES "video"("id") ON DELETE CASCADE
);
CREATE INDEX "video_image_video_id_idx" ON "video_image"("video_id");

CREATE TABLE "bible_citation" (
    "id"            TEXT         PRIMARY KEY,
    "core_id"       TEXT         UNIQUE,
    "source"        "SourceTier" NOT NULL DEFAULT 'core',
    "video_id"      TEXT         NOT NULL,
    "bible_book_id" TEXT         NOT NULL,
    "chapter_start" INTEGER,
    "chapter_end"   INTEGER,
    "verse_start"   INTEGER,
    "verse_end"     INTEGER,
    "synced_at"     TIMESTAMPTZ,
    "created_at"    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bible_citation_video_id_fkey"
        FOREIGN KEY ("video_id")      REFERENCES "video"("id")      ON DELETE CASCADE,
    CONSTRAINT "bible_citation_bible_book_id_fkey"
        FOREIGN KEY ("bible_book_id") REFERENCES "bible_book"("id") ON DELETE CASCADE
);
CREATE INDEX "bible_citation_video_id_idx"      ON "bible_citation"("video_id");
CREATE INDEX "bible_citation_bible_book_id_idx" ON "bible_citation"("bible_book_id");

-- =============================================================================
-- Experience and friends — embedding lives on per-locale rows, not canonical.
-- =============================================================================

CREATE TABLE "experience" (
    "id"           TEXT        PRIMARY KEY,
    "is_template"  BOOLEAN     NOT NULL DEFAULT false,
    "owner_id"     TEXT,
    "archived_at"  TIMESTAMPTZ,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMPTZ NOT NULL
);
CREATE INDEX "experience_archived_at_idx" ON "experience"("archived_at");
CREATE INDEX "experience_owner_id_idx"    ON "experience"("owner_id");

CREATE TABLE "experience_locale" (
    "id"               TEXT          PRIMARY KEY,
    "experience_id"    TEXT          NOT NULL,
    "locale"           TEXT          NOT NULL,
    "slug"             TEXT          NOT NULL,
    "is_homepage"      BOOLEAN       NOT NULL DEFAULT false,
    "path_segment"     TEXT,
    "title"            TEXT,
    "meta_description" TEXT,
    "og_title"         TEXT,
    "og_description"   TEXT,
    "og_image_url"     TEXT,
    "blocks"           JSONB         NOT NULL DEFAULT '[]',
    "embedding"        vector(1536),
    "status"           "LocaleStatus" NOT NULL DEFAULT 'draft',
    "published_at"     TIMESTAMPTZ,
    "created_at"       TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMPTZ   NOT NULL,
    CONSTRAINT "experience_locale_experience_id_fkey"
        FOREIGN KEY ("experience_id") REFERENCES "experience"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "experience_locale_experience_id_locale_key"
    ON "experience_locale"("experience_id", "locale");
CREATE INDEX "experience_locale_locale_idx" ON "experience_locale"("locale");
CREATE INDEX "experience_locale_status_idx" ON "experience_locale"("status");
-- Partial unique on (locale, slug) for published rows only — different locales
-- can collide on slug, and draft / archived rows can collide too.
CREATE UNIQUE INDEX "experience_locale_locale_slug_published_key"
    ON "experience_locale"("locale", "slug")
    WHERE "status" = 'published';

-- HNSW partial index — NULL embeddings excluded by design (NULL until the
-- experienceEmbedding workflow runs against this locale's text). Created
-- non-CONCURRENTLY here because the table is empty at first apply; future
-- re-creations after data exists should use CREATE INDEX CONCURRENTLY in a
-- dedicated `prisma:no_transaction` migration.
CREATE INDEX "experience_locale_embedding_hnsw"
    ON "experience_locale" USING hnsw ("embedding" vector_cosine_ops)
    WHERE "embedding" IS NOT NULL;
