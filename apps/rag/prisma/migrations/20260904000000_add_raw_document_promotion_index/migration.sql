CREATE INDEX CONCURRENTLY IF NOT EXISTS "raw_documents_promotion_latest_idx"
ON "raw_documents"("source_key", "canonical_url", "fetched_at" DESC, "id" DESC);
