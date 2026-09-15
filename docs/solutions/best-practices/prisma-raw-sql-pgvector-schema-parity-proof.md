---
title: Prisma and raw SQL schema parity proof for pgvector databases
date: 2026-08-27
category: best-practices
module: apps/rag
problem_type: best_practice
component: database
severity: medium
applies_when:
  - Porting an existing PostgreSQL schema whose relational structure must remain compatible
  - Prisma manages ordinary relations while raw SQL owns halfvec, generated tsvector columns, or specialized indexes
  - A migration needs executable proof against a real PostgreSQL and pgvector instance
  - Schema drift checks must tolerate only a small documented set of Prisma representation gaps
resolution_type: migration
related_components:
  - testing_framework
  - infrastructure
  - tooling
tags:
  - prisma
  - postgresql
  - pgvector
  - halfvec
  - tsvector
  - schema-drift
  - migrations
  - integration-testing
---

# Prisma and raw SQL schema parity proof for pgvector databases

## Context

Forge RAG needed to port the relational contract of the legacy `jfrag` database without copying its corpus data. Prisma can model the portable structure—table and column mappings, UUIDs, JSON defaults, timestamps, uniqueness, relations, and cascade behavior—but cannot fully represent pgvector `halfvec` or PostgreSQL stored generated `tsvector` expressions. Those fields therefore remain explicit `Unsupported` placeholders in the Prisma schema (`apps/rag/prisma/schema.prisma:70`, `apps/rag/prisma/schema.prisma:80`).

Earlier infrastructure preparation showed why database provisioning alone was not completion: the repository still needed the schema, native PostgreSQL objects, executable drift detection, and real migration proof. It also established that the schema slice must remain separate from the later HTTP runtime slice; a temporary start command or premature healthcheck would conceal missing runtime behavior rather than prove database correctness. (session history)

The implementation is in [PR #2064](https://github.com/JesusFilm/forge/pull/2064). CI proof is complete, and this documentation session also reran the local migration, drift, and integration commands successfully (session evidence). Production Railway provisioning and validation remain operator-owned until the PR is merged and deployed.

## Guidance

Treat the checked-in migration as authoritative for database-native objects that Prisma cannot express. Enable `vector` before creating `halfvec(1536)`, create the stored generated `search_tsv`, and declare JSON GIN, full-text GIN, and half-vector HNSW indexes in raw SQL (`apps/rag/prisma/migrations/20260827000000_init_rag_schema/migration.sql:1`, `apps/rag/prisma/migrations/20260827000000_init_rag_schema/migration.sql:37`, `apps/rag/prisma/migrations/20260827000000_init_rag_schema/migration.sql:52`, `apps/rag/prisma/migrations/20260827000000_init_rag_schema/migration.sql:97`). Keep static contract tests for these details beside the corresponding Prisma placeholders so neither representation can silently lose part of the contract (`apps/rag/tests/schema.test.mjs:40`).

Do not require a literally empty Prisma diff when intentional raw-SQL objects exceed Prisma's representation. Run `prisma migrate diff` against the migrated database, allow only the exact reviewed differences, and fail both when a new difference appears and when an expected difference disappears. The second failure forces maintainers to remove stale exceptions if Prisma support or the schema changes (`apps/rag/scripts/check-schema-drift.ts:4`, `apps/rag/scripts/check-schema-drift.ts:43`, `apps/rag/scripts/check-schema-drift.ts:57`).

Prove migrations against a real PostgreSQL server with pgvector, not only by parsing schema text. The local service uses PostgreSQL 18 with pgvector and a readiness check (`apps/rag/docker-compose.yml:1`, `apps/rag/docker-compose.yml:14`). CI applies the migration to a fresh database, applies it again to prove idempotence, checks migration status and drift, and runs the live database integration suite (`.github/workflows/ci.yml:180`, `.github/workflows/ci.yml:211`, `.github/workflows/ci.yml:222`).

The integration suite should exercise semantic invariants: extension and migration-ledger presence, every expected table, a real 1,536-dimensional half-vector insert, generated full-text search, required indexes, cascade deletion, and zero rows after cleanup (`apps/rag/tests/database.integration.test.ts:20`, `apps/rag/tests/database.integration.test.ts:55`, `apps/rag/tests/database.integration.test.ts:90`, `apps/rag/tests/database.integration.test.ts:113`). Include cache and staging tables in zero-row verification, not only corpus tables (`apps/rag/tests/database.integration.test.ts:124`).

For Railway, run `prisma migrate deploy` as a pre-deploy command and keep configuration narrow and declarative (`apps/rag/railway.toml:5`, `apps/rag/railway.toml:8`). Do not add a platform healthcheck until the application exposes the promised route. Production confirmation must use the normal PR-to-main deployment flow and the metadata-only procedure in `apps/rag/docs/ops/postgres-and-schema.md`; never deploy a local worktree directly.

## Why This Matters

This split avoids two opposite failures. Reducing the database to what Prisma can represent would discard retrieval-critical PostgreSQL behavior. Keeping everything only in raw SQL would weaken typed relational ownership and make ordinary schema evolution harder. The migration supplies exact PostgreSQL semantics, Prisma supplies the application-facing relational model, and drift plus live integration checks bind both views into one enforceable contract.

It also keeps schema safety separate from data movement. The procedure migrates and verifies an empty destination without copying corpus rows. Before corpus copy, rollback may recreate only the new empty RAG database; the legacy `jfrag` database remains untouched (`apps/rag/docs/ops/postgres-and-schema.md:1`, `apps/rag/docs/ops/postgres-and-schema.md:66`).

## When to Apply

- When adopting Prisma over an existing PostgreSQL schema that depends on native types, generated columns, extension-provided operators, or specialized indexes Prisma cannot faithfully model.
- When exact compatibility matters and the destination must begin empty.
- When migrations run automatically during deployment and a disposable real database can be exercised in CI.
- When intentional representation gaps are few enough to review explicitly rather than suppress broadly.

Local success is not production proof. Railway still needs evidence of the selected config file, successful pre-deploy migration, expected extension/tables/types/indexes, and zero application rows (`apps/rag/docs/ops/postgres-and-schema.md:29`, `apps/rag/docs/ops/postgres-and-schema.md:39`).

## Examples

The representation split is:

```prisma
searchTsv Unsupported("tsvector")? @map("search_tsv")
embedding Unsupported("halfvec(1536)")
```

paired with authoritative migration SQL:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
"search_tsv" TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', "text")) STORED;
"embedding" halfvec(1536) NOT NULL;
CREATE INDEX "chunks_search_tsv_gin" ON "chunks" USING GIN ("search_tsv");
CREATE INDEX "chunk_embeddings_hnsw" ON "chunk_embeddings" USING hnsw ("embedding" halfvec_cosine_ops);
```

The package exposes separate commands for migration deployment, migration status, static schema-contract checks, real drift checks, and live database verification (`apps/rag/package.json:7`). Keeping these commands separate makes each layer's evidence explicit.

## Related

- [Prisma Unsupported placeholders for raw-SQL generated columns](../database-issues/prisma-unsupported-placeholder-for-raw-sql-generated-columns-20260429.md)
- [PostgreSQL generated-column drift](../database-issues/postgres-generated-column-drift-add-column-if-not-exists-20260429.md)
- [Prisma raw-SQL invariant assertions](prisma-raw-sql-invariant-assertions-20260423.md)
- [Railway dashboard overrides and railway.toml](../deployment/railway-dashboard-override-shadows-railway-toml-20260429.md)
- [JesusFilm/jesusfilm-rag#158](https://github.com/JesusFilm/jesusfilm-rag/issues/158)
- [JesusFilm/jesusfilm-rag#130](https://github.com/JesusFilm/jesusfilm-rag/issues/130)
