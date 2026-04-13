-- Admin app initial migration.
-- Enables pgvector and creates Core sync infrastructure tables.
-- See Unit 2 of docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.
--
-- Railway note: `CREATE EXTENSION vector` requires the DB role to have the
-- privilege. Pre-deploy runbook must verify `pg_extension` contains `vector`
-- before applying this migration. If it does not, execute `CREATE EXTENSION
-- vector` manually as the Railway DB owner and then mark 0001 as applied.

-- pgvector extension (deterministic raw SQL; not relying on Prisma preview)
CREATE EXTENSION IF NOT EXISTS "vector";

-- sync_state — per-phase watermark for Core API sync
CREATE TABLE "sync_state" (
    "phase"          TEXT        PRIMARY KEY,
    "last_synced_at" TIMESTAMPTZ NOT NULL,
    "stats"          JSONB       NOT NULL DEFAULT '{}',
    "updated_at"     TIMESTAMPTZ NOT NULL
);

-- sync_locks — DB-backed cross-instance lock
CREATE TABLE "sync_locks" (
    "key"          TEXT        PRIMARY KEY,
    "held_by"      TEXT,
    "acquired_at"  TIMESTAMPTZ,
    "updated_at"   TIMESTAMPTZ NOT NULL
);
