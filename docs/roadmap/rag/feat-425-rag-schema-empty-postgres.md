---
id: "feat-425"
title: "Port the RAG schema and provision empty Postgres"
owner: "jaco"
priority: "P0"
status: "complete"
start_date: "2026-08-29"
duration: 3
depends_on: ["feat-424"]
blocks: ["feat-426"]
tags: ["rag", "postgres", "migration"]
---

## Problem

Forge RAG needs a schema-compatible empty database before code or corpus can move. Historical scope: [jfrag #158](https://github.com/JesusFilm/jesusfilm-rag/issues/158).

## Resolution

**Shipped:** 2026-08-27 via [PR #2064](https://github.com/JesusFilm/forge/pull/2064), with production evidence and service-name corrections recorded in [PR #2069](https://github.com/JesusFilm/forge/pull/2069).

**What landed.** Forge RAG owns a seven-table Prisma schema, PostgreSQL-native raw SQL for pgvector, generated full-text search, GIN and HNSW indexes, real drift detection, PostgreSQL 18 local and CI integration proof, and Railway config-as-code at `/apps/rag/railway.toml`.

**Production verification.** The initial migration completed against `forge/production/@forge/rag-postgres`. Migration status and drift were clean. PostgreSQL reported vector `0.8.6`, an active `20260827000000_init_rag_schema` migration, seven application tables, `halfvec(1536)`, the expected HNSW and GIN indexes, successful read access, and zero rows in every application table. No corpus data or legacy `jfrag` resource was touched.

**Sequencing decision.** The initial schema was applied by an explicit operator migration from merged `main`. Railway already reads the correct config file and pre-deploy command, but automatic pre-deploy execution belongs to feat-428 because Railpack requires a runnable service before it reaches that phase. Feat-428 must verify the configured migration on its first valid deployment; it must not recreate or replace this database.

**Unblocked.** `feat-426`.

## Entry Points — Read These First

1. `JesusFilm/jesusfilm-rag/src/db/schema.ts`, `JesusFilm/jesusfilm-rag/migrations/`, and `JesusFilm/jesusfilm-rag/scripts/check-migrations.ts` — source Drizzle schema, migration history, and drift checker at the pinned migration commit.
2. `JesusFilm/jesusfilm-rag/railway.toml`, `JesusFilm/jesusfilm-rag/Dockerfile`, and `JesusFilm/jesusfilm-rag/docker-compose.yml` — deployed and local database/runtime configuration to translate into Forge-owned equivalents.
3. `apps/rag/AGENTS.md` — database separation and production rules.

## Grep These

- `halfvec(1536)`
- `embedding_model`
- `migration`
- `pgvector`

## What To Build

Port schema and migrations, add drift checks, and document an explicit-target procedure to provision and verify an empty Railway Postgres service.

## Constraints

- Do not copy corpus rows or re-embed content.
- Provisioning is an operator action; no direct local production deploy.

## Verification

- Fresh local Postgres migrates from zero and schema drift is clean.
- Empty production verification records extensions, tables, indexes, and vector dimensions without row content.
