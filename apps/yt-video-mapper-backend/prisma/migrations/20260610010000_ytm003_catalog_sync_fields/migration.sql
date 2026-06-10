-- AlterTable
ALTER TABLE "mapper_catalog_variant"
ADD COLUMN "edition_name" TEXT,
ADD COLUMN "video_published" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "dub_published" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "video_no_index" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "video_deleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "dub_deleted" BOOLEAN NOT NULL DEFAULT false;

-- Preserve the old ambiguous published value as the dub publication snapshot
-- until the next Admin catalog sync refreshes both explicit fields.
UPDATE "mapper_catalog_variant"
SET "dub_published" = "published";

-- Drop single-column identity constraints so mapper-owned rows are keyed by
-- the Core-facing composite identity: core_id + video_variant_id.
DROP INDEX "mapper_catalog_variant_video_variant_id_key";
DROP INDEX "mapper_media_signature_video_variant_id_signature_type_algo_key";
DROP INDEX "mapper_match_candidate_job_id_video_variant_id_key";

-- CreateIndex
CREATE UNIQUE INDEX "mapper_media_signature_variant_signature_key"
ON "mapper_media_signature"("core_id", "video_variant_id", "signature_type", "algorithm_version", "offset_milliseconds");

-- CreateIndex
CREATE UNIQUE INDEX "mapper_match_candidate_job_variant_key"
ON "mapper_match_candidate"("job_id", "core_id", "video_variant_id");
