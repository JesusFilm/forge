-- Register the audited Fireworks query-embedding contract without mutating the
-- historical OpenRouter contract. The stored transcript tuple is unchanged, so
-- existing Typesense and pgvector transcript vectors remain authoritative.

INSERT INTO "content_embedding_contract" (
  "id",
  "query_provider",
  "query_model",
  "query_native_dimensions",
  "query_dimensions",
  "query_transform_version",
  "storage_provider",
  "storage_model",
  "storage_native_dimensions",
  "storage_dimensions",
  "storage_transform_version"
) VALUES (
  'semantic-transcript-pgvector-v2',
  'fireworks',
  'fireworks/qwen3-embedding-8b',
  1536,
  1536,
  NULL,
  'jesus-film-ai-gateway',
  'embeddings',
  1536,
  1536,
  NULL
);

UPDATE "content_embedding_contract_pointer"
SET "active_contract_id" = 'semantic-transcript-pgvector-v2',
    "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = 'content-embedding-contract-pointer'
  AND "active_contract_id" = 'semantic-transcript-pgvector-v1';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "content_embedding_contract_pointer"
    WHERE "id" = 'content-embedding-contract-pointer'
      AND "active_contract_id" = 'semantic-transcript-pgvector-v2'
  ) THEN
    RAISE EXCEPTION 'Fireworks content embedding contract pointer rotation failed';
  END IF;
END
$$;
