-- Unit 4 — HNSW partial index on Experience.embedding.
--
-- This migration must run OUTSIDE a transaction because CREATE INDEX
-- CONCURRENTLY cannot run inside one. Prisma respects the `migration.sql`
-- file but applies the whole migration as a single transaction by default;
-- we set the executor to no-transaction via the migration directory naming
-- convention (Prisma 6.x reads `-- prisma:no_transaction` directive).
--
-- Why partial:
--   - Experience.embedding is NULL between Experience creation and the
--     experienceEmbedding workflow run. NULL rows are excluded by design;
--     `WHERE embedding IS NOT NULL` documents this and keeps planner stats
--     focused on rows that participate in similarity search.
--
-- Why HNSW:
--   - Better recall/latency than IVFFlat, no build-time data requirement,
--     incremental-insert friendly. Defaults `m=16, ef_construction=64` are
--     fine for v1 scale (low thousands of Experiences).
--   - Per-session tuning happens in service layer with `SET LOCAL
--     hnsw.ef_search = N` inside the search transaction.

-- prisma:no_transaction
CREATE INDEX CONCURRENTLY "experience_embedding_hnsw"
    ON "experience" USING hnsw ("embedding" vector_cosine_ops)
    WHERE "embedding" IS NOT NULL;
