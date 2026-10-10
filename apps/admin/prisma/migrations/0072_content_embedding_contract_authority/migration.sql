-- Establish the durable Content Embedding Contract authority for current
-- serving. The registry is immutable; only the singleton pointer changes when
-- serving moves to a new approved contract. Query-embedding cache rows are
-- pinned to the active contract id so equal-dimension tuples cannot share
-- cache state across provider/model/transform boundaries.

CREATE TABLE "content_embedding_contract" (
  "id" varchar(191) NOT NULL,
  "query_provider" varchar(64) NOT NULL,
  "query_model" varchar(191) NOT NULL,
  "query_native_dimensions" integer NOT NULL,
  "query_dimensions" integer NOT NULL,
  "query_transform_version" varchar(191),
  "storage_provider" varchar(64) NOT NULL,
  "storage_model" varchar(191) NOT NULL,
  "storage_native_dimensions" integer NOT NULL,
  "storage_dimensions" integer NOT NULL,
  "storage_transform_version" varchar(191),
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_embedding_contract_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "content_embedding_contract_query_native_dimensions_check"
    CHECK ("query_native_dimensions" > 0),
  CONSTRAINT "content_embedding_contract_query_dimensions_check"
    CHECK ("query_dimensions" > 0),
  CONSTRAINT "content_embedding_contract_storage_native_dimensions_check"
    CHECK ("storage_native_dimensions" > 0),
  CONSTRAINT "content_embedding_contract_storage_dimensions_check"
    CHECK ("storage_dimensions" > 0)
);

CREATE TABLE "content_embedding_contract_pointer" (
  "id" varchar(64) NOT NULL,
  "active_contract_id" varchar(191) NOT NULL,
  "updated_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_embedding_contract_pointer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "content_embedding_contract_pointer_singleton_check"
    CHECK ("id" = 'content-embedding-contract-pointer'),
  CONSTRAINT "content_embedding_contract_pointer_active_contract_fkey"
    FOREIGN KEY ("active_contract_id")
    REFERENCES "content_embedding_contract"("id")
    ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION "prevent_content_embedding_contract_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'content embedding contracts are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "content_embedding_contract_immutable"
  BEFORE UPDATE OR DELETE ON "content_embedding_contract"
  FOR EACH ROW
  EXECUTE FUNCTION "prevent_content_embedding_contract_mutation"();

CREATE OR REPLACE FUNCTION "prevent_content_embedding_contract_pointer_delete"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'content embedding contract pointer cannot be deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "content_embedding_contract_pointer_delete_forbidden"
  BEFORE DELETE ON "content_embedding_contract_pointer"
  FOR EACH ROW
  EXECUTE FUNCTION "prevent_content_embedding_contract_pointer_delete"();

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
  'semantic-transcript-pgvector-v1',
  'openrouter',
  'qwen/qwen3-embedding-8b',
  1536,
  1536,
  NULL,
  'jesus-film-ai-gateway',
  'embeddings',
  1536,
  1536,
  NULL
);

INSERT INTO "content_embedding_contract_pointer" (
  "id",
  "active_contract_id"
) VALUES (
  'content-embedding-contract-pointer',
  'semantic-transcript-pgvector-v1'
);

ALTER TABLE "query_embedding_cache"
  ADD COLUMN "contract_id" varchar(191);

UPDATE "query_embedding_cache"
SET "contract_id" = 'semantic-transcript-pgvector-v1'
WHERE "contract_id" IS NULL;

ALTER TABLE "query_embedding_cache"
  ALTER COLUMN "contract_id" SET NOT NULL;

ALTER TABLE "query_embedding_cache"
  ADD CONSTRAINT "query_embedding_cache_contract_id_fkey"
  FOREIGN KEY ("contract_id")
  REFERENCES "content_embedding_contract"("id")
  ON DELETE RESTRICT;

DROP INDEX IF EXISTS "query_embedding_cache_key";

CREATE UNIQUE INDEX "query_embedding_cache_key"
  ON "query_embedding_cache"(
    "contract_id",
    "provider",
    "model",
    "dimensions",
    "query_hash"
  );

CREATE INDEX "query_embedding_cache_contract_expiry_idx"
  ON "query_embedding_cache"("contract_id", "expires_at");

COMMENT ON TABLE "content_embedding_contract" IS
  'Immutable exact query/stored vector compatibility registry for current content embedding serving.';
COMMENT ON TABLE "content_embedding_contract_pointer" IS
  'Singleton mutable pointer to the active content embedding contract.';
