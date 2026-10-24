-- Add structural hints for duration and media-shape signatures.
ALTER TYPE "signature_type" ADD VALUE 'structural_hint';

-- Support page-level checks for variants already indexed by an algorithm.
CREATE INDEX "mapper_media_signature_algorithm_variant_idx"
ON "mapper_media_signature"("algorithm_version", "core_id", "video_variant_id");
