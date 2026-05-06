-- Manager backend migration contracts owned by apps/admin.

CREATE TABLE "manager_coverage_snapshot" (
  "id" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "total_videos" INTEGER NOT NULL DEFAULT 0,
  "videos_with_ai_metadata" INTEGER NOT NULL DEFAULT 0,
  "videos_with_human_metadata" INTEGER NOT NULL DEFAULT 0,
  "subtitles_human_total" INTEGER NOT NULL DEFAULT 0,
  "subtitles_ai_total" INTEGER NOT NULL DEFAULT 0,
  "audio_human_total" INTEGER NOT NULL DEFAULT 0,
  "audio_ai_total" INTEGER NOT NULL DEFAULT 0,
  "language_coverage" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "manager_coverage_snapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "manager_coverage_snapshot_date_key"
  ON "manager_coverage_snapshot"("date");

CREATE INDEX "manager_coverage_snapshot_date_idx"
  ON "manager_coverage_snapshot"("date");

CREATE TABLE "manager_enrichment_job" (
  "id" TEXT NOT NULL,
  "mux_asset_id" TEXT NOT NULL,
  "mux_playback_id" TEXT,
  "video_document_id" TEXT,
  "languages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "source_language_id" TEXT,
  "source_language_code" TEXT,
  "source_selection_reason" TEXT,
  "primary_requested_target_language_code" TEXT,
  "resolved_target_language_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "source_collection_title" TEXT,
  "source_media_title" TEXT,
  "requested_language_abbreviations" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "options" JSONB NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "current_step" TEXT,
  "retries" INTEGER NOT NULL DEFAULT 0,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "artifacts" JSONB NOT NULL DEFAULT '{}',
  "steps" JSONB NOT NULL DEFAULT '[]',
  "errors" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "manager_enrichment_job_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "manager_enrichment_job_status_created_at_idx"
  ON "manager_enrichment_job"("status", "created_at");

CREATE INDEX "manager_enrichment_job_video_document_id_idx"
  ON "manager_enrichment_job"("video_document_id");
