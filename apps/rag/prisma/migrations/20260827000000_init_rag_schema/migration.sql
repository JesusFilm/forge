CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "sources" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "domain" TEXT,
  "trust" TEXT,
  "ingestion_mode" TEXT,
  "languages" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "default_tags" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "default_category" TEXT,
  "rights" TEXT,
  "content_hash" TEXT,
  "indexed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "documents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "source_id" UUID NOT NULL,
  "canonical_url" TEXT NOT NULL,
  "url" TEXT,
  "title" TEXT,
  "language" TEXT,
  "category" TEXT,
  "content_hash" TEXT NOT NULL,
  "chunk_count" INTEGER NOT NULL DEFAULT 0,
  "first_seen" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "indexed_at" TIMESTAMPTZ,
  CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chunks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "document_id" UUID NOT NULL,
  "source_id" UUID NOT NULL,
  "ord" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "char_start" INTEGER NOT NULL,
  "char_end" INTEGER NOT NULL,
  "token_count" INTEGER NOT NULL,
  "tags" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "search_tsv" TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', "text")) STORED,
  CONSTRAINT "chunks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chunk_embeddings" (
  "chunk_id" UUID NOT NULL,
  "embedding" halfvec(1536) NOT NULL,
  "embedding_model" TEXT NOT NULL,
  "embedded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chunk_embeddings_pkey" PRIMARY KEY ("chunk_id")
);

CREATE TABLE "http_cache" (
  "url" TEXT NOT NULL,
  "etag" TEXT,
  "last_modified" TEXT,
  "body_hash" TEXT,
  "status_code" INTEGER,
  "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "http_cache_pkey" PRIMARY KEY ("url")
);

CREATE TABLE "robots_cache" (
  "robots_url" TEXT NOT NULL,
  "body" TEXT,
  "status_code" INTEGER,
  "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "robots_cache_pkey" PRIMARY KEY ("robots_url")
);

CREATE TABLE "raw_documents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "source_key" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "canonical_url" TEXT NOT NULL,
  "title" TEXT,
  "raw_content" TEXT NOT NULL,
  "status" INTEGER,
  "body_hash" TEXT,
  "etag" TEXT,
  "last_modified" TEXT,
  "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "not_modified" BOOLEAN NOT NULL DEFAULT false,
  "ingested_at" TIMESTAMPTZ,
  CONSTRAINT "raw_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sources_key_uq" ON "sources"("key");
CREATE INDEX "documents_source_idx" ON "documents"("source_id");
CREATE UNIQUE INDEX "documents_source_canonical_url_uq" ON "documents"("source_id", "canonical_url");
CREATE INDEX "chunks_source_idx" ON "chunks"("source_id");
CREATE INDEX "chunks_document_idx" ON "chunks"("document_id");
CREATE INDEX "chunks_tags_gin" ON "chunks" USING GIN ("tags");
CREATE INDEX "chunks_search_tsv_gin" ON "chunks" USING GIN ("search_tsv");
CREATE INDEX "chunk_embeddings_hnsw" ON "chunk_embeddings" USING hnsw ("embedding" halfvec_cosine_ops);
CREATE INDEX "chunk_embeddings_model_idx" ON "chunk_embeddings"("embedding_model");
CREATE INDEX "raw_documents_source_key_idx" ON "raw_documents"("source_key");
CREATE INDEX "raw_documents_ingested_at_idx" ON "raw_documents"("ingested_at");

ALTER TABLE "documents" ADD CONSTRAINT "documents_source_id_fkey"
  FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_source_id_fkey"
  FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "chunk_embeddings" ADD CONSTRAINT "chunk_embeddings_chunk_id_fkey"
  FOREIGN KEY ("chunk_id") REFERENCES "chunks"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
