CREATE TABLE IF NOT EXISTS "query_embedding_cache" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "dimensions" INTEGER NOT NULL,
  "query_hash" TEXT NOT NULL,
  "embedding" JSONB NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "query_embedding_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "query_embedding_cache_key"
  ON "query_embedding_cache"("provider", "model", "dimensions", "query_hash");

CREATE INDEX IF NOT EXISTS "query_embedding_cache_expires_at_idx"
  ON "query_embedding_cache"("expires_at");

CREATE INDEX IF NOT EXISTS "query_embedding_cache_last_used_at_idx"
  ON "query_embedding_cache"("last_used_at");
