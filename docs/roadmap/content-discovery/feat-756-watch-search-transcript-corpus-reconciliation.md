---
id: "feat-756"
title: "Watch search transcript corpus bootstrap reconciliation"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-10-22"
duration: 1
depends_on:
  - "feat-465"
blocks: []
tags:
  - "admin"
  - "search"
  - "embeddings"
  - "typesense"
  - "reliability"
---

## Problem

Incremental transcript publication (feat-462, feat-465) only reconciles
transcripts whose outbox events run through the publication worker. The
broad transcript vector corpus Typesense already serves predates that
outbox and has no durable evidence that it still matches canonical
PostgreSQL. A blind full reimport would be safe but wasteful and would
needlessly interrupt a working collection; silently trusting the existing
corpus would let historical drift go unnoticed forever.

## Entry Points — Read These First

1. `apps/admin/src/services/typesense-watch-search-transcript-reconciliation.ts` — the dry-run-first watermark audit: canonical enumeration, Typesense export + exact reads, fingerprint comparison, exact-match ledger seeding, embedding-owned drift enqueueing, and orphan/ambiguous classification.
2. `apps/admin/src/services/typesense-watch-search-transcript-publication.ts` — the normal publication path this audit enqueues into (`watchSearchCurrentTranscriptPublicationEvent`); reused exports: `loadCurrentWatchSearchTranscriptProjection`, `mapWithConcurrency`, `normalizeTranscriptDocument`, `sha256`.
3. `apps/admin/src/services/typesense-client.ts` — `exportDocuments` (new): the full-id-universe export used alongside exact `getDocument` reads.
4. `apps/admin/src/scripts/watch-search-transcript-reconciliation.ts` — manual CLI entry point. Dry-run by default; `--execute` mutates the publication ledger only (never Typesense directly) and requires `WATCH_SEARCH_TRANSCRIPT_RECONCILIATION_ENABLED=true`.
5. `apps/admin/src/services/typesense-watch-search-transcript-reconciliation.test.ts` — mocked-fixture coverage of every classification branch.

## Grep These

- `auditWatchSearchTranscriptCorpus`
- `exactMatchTranscriptIds|embeddingDriftTranscriptIds|visibilityOnlyDriftTranscriptIds`
- `orphanLifecycleDocumentIds|ambiguousExtraDocumentIds`
- `changedDuringAuditTranscriptIds|backfillComplete`
- `WATCH_SEARCH_TRANSCRIPT_RECONCILIATION_ENABLED`
- `exportDocuments`

## What To Build

- Independently enumerate canonical PostgreSQL transcripts under the active
  Content Embedding Contract (bulk query, same shape as the single-transcript
  publication snapshot) and the active Typesense transcript collection (via
  `exportDocuments` for the full id universe, `getDocument` for exact
  vector-bearing reads).
- Per transcript, compare ordered document ids and two field digests:
  embedding-owned (`text`, `startSeconds`, `embedding`) and lifecycle-owned
  (`publiclyVisible`, `canonicalVideoId`).
- Exact match (same id set, both digests equal): seed any outstanding
  non-completed publication event straight to `COMPLETED` against the
  established projection revision. No Typesense import. Establish the
  projection row itself (once) if nothing had verified the collection before.
- Embedding-owned drift (missing ids, a changed digest, or a proven extra id
  owned by the same transcript): enqueue exactly one new
  `watchSearchCurrentTranscriptPublicationEvent` through the existing
  publication worker — but only when the transcript has no non-completed
  event already; an existing event (pending, claimed, or dead-lettered) means
  the transcript is already represented in the outbox.
- Extra Typesense ids not expected by any canonical transcript: resolve
  ownership via `video_transcript_chunk` first (still-live transcript →
  proven, folded into that transcript's repair event as `staleDocumentIds`);
  otherwise via publication-event history (deleted transcript → report-only
  `orphanLifecycleDocumentIds`, left for the separately scoped lifecycle
  publisher); otherwise `ambiguousExtraDocumentIds` (fail closed, never
  mutated).
- Compare-and-set: immediately before mutating a transcript, reload its
  `sourceGeneration`/`sourceContentHash`. A mismatch means a newer canonical
  write landed mid-audit — skip and report `changedDuringAuditTranscriptIds`;
  the normal outbox already represents that write.
- `backfillComplete` is true only when zero pending/claimed events remain and
  this run found zero embedding-owned drift.
- `dryRun` defaults to `true`. All counting/classification happens either way;
  every mutation (seed-complete, enqueue) is gated on `dryRun === false`.

## Constraints

- Never call a Typesense write method (`importDocuments`,
  `deleteDocumentsByFilter`, `updateDocumentsByFilter`) from this audit —
  `ReconciliationTypesense` only exposes `getAlias`, `getDocument`, and
  `exportDocuments` by type, so this is enforced structurally, not just by
  convention.
- Never dead-letter, re-claim, or otherwise touch an existing non-completed
  event's lease — only create a brand-new event when zero exist for a
  transcript, and only flip existing events to `COMPLETED` on a proven exact
  match.
- Never automatically repair lifecycle-only (visibility) drift or orphan
  lifecycle evidence — report only.
- Fail closed on any extra document id whose ownership cannot be proven.
- `WATCH_SEARCH_TRANSCRIPT_RECONCILIATION_ENABLED` defaults `false` and gates
  only the CLI's `--execute` path; dry-run reporting never requires it. No
  periodic scheduler is wired into `instrumentation.ts` in this change —
  least-privilege, environment-bound credentials for reconciliation
  (a distinct read-only Typesense export credential) are explicitly
  out of scope here and belong to the dedicated follow-up.
- Production activation, draining legacy writer processes, and provisioning
  a dedicated reconciliation credential are explicitly out of scope.

## Verification

- `pnpm --filter @forge/admin exec vitest run src/services/typesense-watch-search-transcript-reconciliation.test.ts src/services/typesense-client.test.ts src/scripts/watch-search-transcript-reconciliation.test.ts`
- `pnpm --filter @forge/admin typecheck`
- Manual dry-run against a real environment:
  `pnpm --filter @forge/admin watch-search:transcript-reconciliation -- --report-out=.tmp/reconciliation-dry-run.json`
- `pnpm --filter roadmap generate:readme` and `pnpm --filter roadmap lint` after roadmap metadata changes.
