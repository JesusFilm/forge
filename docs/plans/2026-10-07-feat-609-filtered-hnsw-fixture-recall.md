---
title: Filtered HNSW fixture recall diagnosis
type: bug
status: in-progress
date: 2026-10-07
---

# Filtered HNSW fixture recall diagnosis

## Scope

Reproduce the intermittent six-card recommendation failure in an owned PostgreSQL 18/pgvector fixture using the complete native test file. Capture the original ANN result, then the same statement's `EXPLAIN ANALYZE` rerun, scan settings, exact eligible count, and elapsed time on the same built index. Compare a bounded scan-memory variation only after a natural failure establishes the baseline; a diagnostic rerun may differ from the first result.

## Decision gate

Change the fixture or delivery retrieval only when the failed plan supports a specific cause and the correction preserves indexed execution, exact eligibility, six distinct cards, and the 1.5-second retrieval budget. A passing retry or a speculative parameter increase is insufficient. If no failure reproduces within a bounded run, retain the evidence and leave the ticket open without a retrieval correction. A failure-only diagnostic may land separately so the next natural failure provides the missing evidence.

## Verification

Use the existing PostgreSQL 18.6/pgvector image with an owner-specific temporary data directory. Run the complete `delivery-retriever.db.test.ts` suite, then focused same-index diagnostics if it fails. Confirm actual HNSW index use with `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`. For any fix, run repeated native tests, Admin typecheck, scoped lint and format, and required PR CI.

October 7 bounded result: six fresh-schema complete-file runs passed (15 tests plus one expected opt-in skip each), as did three targeted-only runs. The exact 19-file recommendation migration/service CI batch passed 121 tests on the same database; the complete delivery file then passed again without resetting that database. No ANN failure occurred, so no stop cause or runtime correction is established. Publish only the failure diagnostic, keep feat-609 in progress, and use its next natural failure receipt to decide the correction.

## Boundaries

No production probe or operation, workflow or migration change, retention runtime change, test weakening, unbounded exact fallback, or deadline expansion. Keep experiments isolated from the parent's databases.
