---
id: "feat-479"
title: "Bound RAG corpus transactions for production latency"
owner: "jaco"
priority: "P0"
status: "complete"
start_date: "2026-09-10"
duration: 1
depends_on: []
blocks: []
tags: ["rag", "postgres", "prisma", "ingestion"]
---

## Problem

Corpus ingestion inherits Prisma's two-second transaction acquisition deadline
and five-second execution deadline. Reported production failures persist at
concurrency two. The original postgres.js ingestion did not impose these Prisma
transaction deadlines; acquisition and other maintenance transaction settings
do not configure the corpus writer.

## Entry Points — Read These First

- `apps/rag/src/adapters/postgres/index.ts`: `PostgresCorpusWriteStore.replaceDocument`.
- `apps/rag/tests/adapters.integration.test.ts`: real PostgreSQL adapter coverage.
- `.github/workflows/ci.yml`: `rag-postgres-integration` runs `db:verify`.

## Grep These

`replaceDocument`, `maxWait`, `timeout`, `indexAttemptedModel`.

## What To Build

Set `maxWait: 10_000` and `timeout: 30_000` on the corpus replacement transaction.
Add real PostgreSQL regression tests for connection waits beyond two seconds,
writes beyond five seconds, and atomic rollback after the execution deadline.

## Constraints

Keep one atomic document/chunk/embedding/staging transaction. Leave connection
pool sizing, concurrency, retries, logging, acquisition, and other maintenance
paths unchanged. Tests use synthetic vectors and isolated local/CI PostgreSQL.

## Verification

- Demonstrate the acquisition and execution regression tests fail without the fix.
- Run `pnpm --filter @forge/rag db:verify` on an empty migrated test database.
- Run RAG unit tests, typecheck, lint, dependency boundaries, and touched-file formatting.
- Review the runtime diff independently of formatting and inspect PR scope.

## Resolution

The corpus writer now explicitly allows 10 seconds to acquire its transaction
and 30 seconds to execute it. Before the fix, the three-second connection wait
and six-second write tests reproduced the acquisition and expired-transaction
errors. With the fix, both pass and the 32-second lock test verifies atomic
rollback of document, chunks, embeddings, and staging state.

All 26 PostgreSQL integration tests and 867 unit tests pass; typecheck, lint,
and dependency checks pass. Production ingestion has not been retried by this
change. Durable evidence and limits are recorded in
[the solution note](../../solutions/database-issues/rag-corpus-transaction-deadlines.md).
