---
title: "Give RAG corpus writes explicit Prisma transaction deadlines"
date: "2026-09-10"
module: "apps/rag"
problem_type: "database_issue"
component: "PostgresCorpusWriteStore"
tags: ["rag", "prisma", "postgres", "transactions", "timeout"]
---

## Problem

After the postgres.js-to-Prisma port, corpus ingestion inherited Prisma's
interactive transaction defaults: two seconds to acquire a transaction and
five seconds for its execution. Production reports included both acquisition
failures and closed-transaction errors, including at concurrency two.
The production cause is not proven by those messages alone, but both failure
mechanisms reproduce against real PostgreSQL with the unmodified writer.

## Correction

`apps/rag/src/adapters/postgres/index.ts` supplies `maxWait: 10_000` and
`timeout: 30_000` specifically to `PostgresCorpusWriteStore.replaceDocument`.
Document replacement, chunk deletion/insertion, embedding insertion, and the
staging update remain one atomic transaction. Embedding-provider calls remain
outside it. Connection-pool sizing and other transaction paths are unchanged.

A transaction's acquisition deadline and execution deadline are separate from
Prisma's ordinary connection-pool timeout. An explicit deadline on acquisition,
provisioning, or language maintenance does not configure corpus ingestion.
Check the actual transaction call rather than relying on nearby settings.

## Regression evidence

The existing `apps/rag/tests/adapters.integration.test.ts` suite uses real
connections and row locks, synthetic vectors, and no production delay hooks:

- Hold the sole connection in a test client for three seconds. The old writer
  fails to start a transaction; the corrected writer commits afterward.
- Lock the staging row for six seconds. The old writer reports an expired
  5,000 ms transaction; the corrected writer commits corpus and staging state.
- Hold that lock for 32 seconds, blocking the final staging update after the
  corpus changes. The corrected writer rejects with `P2028`; complete snapshots
  prove the old document, chunks, vectors, and staging state survive unchanged.
  The raw document remains pending for a later invocation.

These tests run in the existing `rag-postgres-integration` CI job through
`pnpm --filter @forge/rag db:verify`. Local verification used an isolated,
empty PostgreSQL 18 database with the repository migrations. All 26 database
integration tests and 867 unit tests passed, along with typecheck, lint, and
dependency-boundary checks. Two environment-gated tests were skipped by the
unit command; the reader-role test passed in the database suite.

This proves the configured deadlines and rollback behavior locally. A bounded
production ingest after the change lands is still needed to establish whether
these budgets resolve the reported workload failures.

## Related work

- [Corpus transaction ticket](../../roadmap/rag/feat-479-rag-corpus-transaction-timeouts.md)
- [Earlier provisioning deadline correction](../../roadmap/rag/feat-461-rag-readonly-provision-timeout.md)
