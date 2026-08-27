---
id: "feat-427"
title: "Port RAG database adapters and retrieval tooling"
owner: "jaco"
priority: "P0"
status: "complete"
start_date: "2026-09-05"
duration: 4
depends_on: ["feat-426"]
blocks: ["feat-428"]
tags: ["rag", "postgres", "retrieval"]
---

## Problem

The pure cores need real Postgres and embedding/query adapters while retaining dependency inversion. Historical scope: [jfrag #160](https://github.com/JesusFilm/jesusfilm-rag/issues/160).

## Entry Points — Read These First

1. jfrag `src/adapters/postgres`, retrieval scripts, and integration tests.
2. `apps/rag/.dependency-cruiser.cjs`.

## Grep These

- `<=>`
- `tsvector`
- `PostgresStore`
- `retrieve-production`

## What To Build

Port database/embedding adapters and read-only retrieval CLI tooling behind existing ports.

## Constraints

- Keep production credentials out of tests and logs.
- Adapters must not become dependencies of core lanes.

## Verification

- Adapter integration tests pass against local pgvector Postgres.
- Retrieval fixtures reconcile ranking and citation behavior with jfrag.

## Resolution

Forge now owns Prisma-backed corpus, raw-document, fetch-state, vector-search,
and full-text adapters plus a read-only local query CLI. Deterministic pgvector
fixtures cover transactional replacement, resume semantics, language
preservation, model compatibility, vector width, source/language filters,
citations, and selective HNSW scans. The OpenRouter-compatible embedder also
preserves gateway truncation and hosted-provider failover behavior.

Historical scope: [jfrag #160](https://github.com/JesusFilm/jesusfilm-rag/issues/160).
