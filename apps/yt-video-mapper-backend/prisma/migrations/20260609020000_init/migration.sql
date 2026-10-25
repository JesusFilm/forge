-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "catalog_run_status" AS ENUM ('running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "media_source_type" AS ENUM ('download', 'hls', 'dash', 'none');

-- CreateEnum
CREATE TYPE "signature_type" AS ENUM ('visual_frame', 'audio_fingerprint', 'text_segment');

-- CreateEnum
CREATE TYPE "match_job_status" AS ENUM ('queued', 'running', 'complete', 'failed');

-- CreateEnum
CREATE TYPE "match_strength" AS ENUM ('high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "evidence_signal" AS ENUM ('visual', 'audio', 'text', 'duration', 'fusion');

-- CreateTable
CREATE TABLE "mapper_catalog_video" (
    "id" TEXT NOT NULL,
    "core_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "title_locale" TEXT,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mapper_catalog_video_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mapper_catalog_variant" (
    "id" TEXT NOT NULL,
    "core_id" TEXT NOT NULL,
    "video_variant_id" TEXT NOT NULL,
    "admin_video_id" TEXT,
    "admin_dub_id" TEXT,
    "edition_core_id" TEXT,
    "language_id" TEXT,
    "language_slug" TEXT,
    "locale" TEXT,
    "duration_seconds" INTEGER,
    "length_in_milliseconds" BIGINT,
    "hls_url" TEXT,
    "dash_url" TEXT,
    "download_url" TEXT,
    "download_quality" TEXT,
    "download_width" INTEGER,
    "download_height" INTEGER,
    "download_renditions" JSONB,
    "media_source_type" "media_source_type" NOT NULL DEFAULT 'none',
    "media_source_url" TEXT,
    "indexable" BOOLEAN NOT NULL DEFAULT false,
    "non_indexable_reason" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mapper_catalog_variant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mapper_catalog_sync_run" (
    "id" TEXT NOT NULL,
    "status" "catalog_run_status" NOT NULL DEFAULT 'running',
    "cursor" TEXT,
    "videos_seen" INTEGER NOT NULL DEFAULT 0,
    "variants_seen" INTEGER NOT NULL DEFAULT 0,
    "variants_indexable" INTEGER NOT NULL DEFAULT 0,
    "failure_summary" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mapper_catalog_sync_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mapper_index_run" (
    "id" TEXT NOT NULL,
    "status" "catalog_run_status" NOT NULL DEFAULT 'running',
    "algorithm_version" TEXT NOT NULL,
    "cursor_variant_id" TEXT,
    "variants_attempted" INTEGER NOT NULL DEFAULT 0,
    "variants_indexed" INTEGER NOT NULL DEFAULT 0,
    "variants_failed" INTEGER NOT NULL DEFAULT 0,
    "failure_summary" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mapper_index_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mapper_media_signature" (
    "id" TEXT NOT NULL,
    "core_id" TEXT NOT NULL,
    "video_variant_id" TEXT NOT NULL,
    "signature_type" "signature_type" NOT NULL,
    "algorithm_version" TEXT NOT NULL,
    "offset_milliseconds" INTEGER NOT NULL DEFAULT 0,
    "duration_milliseconds" INTEGER,
    "signature" JSONB NOT NULL,
    "source_media_url" TEXT,
    "source_media_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mapper_media_signature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mapper_match_job" (
    "id" TEXT NOT NULL,
    "status" "match_job_status" NOT NULL DEFAULT 'queued',
    "upload_storage_key" TEXT,
    "upload_content_type" TEXT,
    "upload_byte_length" BIGINT,
    "input_duration_milliseconds" INTEGER,
    "result_limit" INTEGER NOT NULL DEFAULT 3,
    "safe_error_code" TEXT,
    "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "retention_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mapper_match_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mapper_match_candidate" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "core_id" TEXT NOT NULL,
    "video_variant_id" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "match_strength" "match_strength" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mapper_match_candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mapper_match_evidence" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "candidate_id" TEXT,
    "signal" "evidence_signal" NOT NULL,
    "score" DOUBLE PRECISION,
    "details" JSONB,
    "internal" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mapper_match_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mapper_catalog_video_core_id_key" ON "mapper_catalog_video"("core_id");

-- CreateIndex
CREATE INDEX "mapper_catalog_video_included_idx" ON "mapper_catalog_video"("included");

-- CreateIndex
CREATE UNIQUE INDEX "mapper_catalog_variant_video_variant_id_key" ON "mapper_catalog_variant"("video_variant_id");

-- CreateIndex
CREATE INDEX "mapper_catalog_variant_core_id_idx" ON "mapper_catalog_variant"("core_id");

-- CreateIndex
CREATE INDEX "mapper_catalog_variant_indexable_idx" ON "mapper_catalog_variant"("indexable");

-- CreateIndex
CREATE INDEX "mapper_catalog_variant_media_source_type_idx" ON "mapper_catalog_variant"("media_source_type");

-- CreateIndex
CREATE INDEX "mapper_catalog_variant_deleted_at_idx" ON "mapper_catalog_variant"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "mapper_catalog_variant_core_id_video_variant_id_key" ON "mapper_catalog_variant"("core_id", "video_variant_id");

-- CreateIndex
CREATE INDEX "mapper_catalog_sync_run_status_started_at_idx" ON "mapper_catalog_sync_run"("status", "started_at");

-- CreateIndex
CREATE INDEX "mapper_index_run_status_started_at_idx" ON "mapper_index_run"("status", "started_at");

-- CreateIndex
CREATE INDEX "mapper_index_run_cursor_variant_id_idx" ON "mapper_index_run"("cursor_variant_id");

-- CreateIndex
CREATE INDEX "mapper_media_signature_core_id_signature_type_idx" ON "mapper_media_signature"("core_id", "signature_type");

-- CreateIndex
CREATE UNIQUE INDEX "mapper_media_signature_video_variant_id_signature_type_algo_key" ON "mapper_media_signature"("video_variant_id", "signature_type", "algorithm_version", "offset_milliseconds");

-- CreateIndex
CREATE INDEX "mapper_match_job_status_created_at_idx" ON "mapper_match_job"("status", "created_at");

-- CreateIndex
CREATE INDEX "mapper_match_job_retention_expires_at_idx" ON "mapper_match_job"("retention_expires_at");

-- CreateIndex
CREATE INDEX "mapper_match_candidate_core_id_idx" ON "mapper_match_candidate"("core_id");

-- CreateIndex
CREATE UNIQUE INDEX "mapper_match_candidate_job_id_rank_key" ON "mapper_match_candidate"("job_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "mapper_match_candidate_job_id_video_variant_id_key" ON "mapper_match_candidate"("job_id", "video_variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "mapper_match_candidate_id_job_id_key" ON "mapper_match_candidate"("id", "job_id");

-- CreateIndex
CREATE INDEX "mapper_match_evidence_job_id_signal_idx" ON "mapper_match_evidence"("job_id", "signal");

-- CreateIndex
CREATE INDEX "mapper_match_evidence_candidate_id_idx" ON "mapper_match_evidence"("candidate_id");

-- AddForeignKey
ALTER TABLE "mapper_catalog_variant" ADD CONSTRAINT "mapper_catalog_variant_core_id_fkey" FOREIGN KEY ("core_id") REFERENCES "mapper_catalog_video"("core_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mapper_media_signature" ADD CONSTRAINT "mapper_media_signature_core_id_fkey" FOREIGN KEY ("core_id") REFERENCES "mapper_catalog_video"("core_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mapper_media_signature" ADD CONSTRAINT "mapper_media_signature_core_id_video_variant_id_fkey" FOREIGN KEY ("core_id", "video_variant_id") REFERENCES "mapper_catalog_variant"("core_id", "video_variant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mapper_match_candidate" ADD CONSTRAINT "mapper_match_candidate_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "mapper_match_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mapper_match_candidate" ADD CONSTRAINT "mapper_match_candidate_core_id_fkey" FOREIGN KEY ("core_id") REFERENCES "mapper_catalog_video"("core_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mapper_match_candidate" ADD CONSTRAINT "mapper_match_candidate_core_id_video_variant_id_fkey" FOREIGN KEY ("core_id", "video_variant_id") REFERENCES "mapper_catalog_variant"("core_id", "video_variant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mapper_match_evidence" ADD CONSTRAINT "mapper_match_evidence_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "mapper_match_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mapper_match_evidence" ADD CONSTRAINT "mapper_match_evidence_candidate_id_job_id_fkey" FOREIGN KEY ("candidate_id", "job_id") REFERENCES "mapper_match_candidate"("id", "job_id") ON DELETE CASCADE ON UPDATE CASCADE;
