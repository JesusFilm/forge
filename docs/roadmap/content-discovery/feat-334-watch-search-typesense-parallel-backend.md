---
id: "feat-334"
title: "Watch Search Typesense parallel backend"
owner: "codex"
priority: "P0"
status: "complete"
start_date: "2026-08-03"
duration: 2
depends_on:
  - "feat-254"
blocks: []
tags:
  - "admin"
  - "search"
  - "typesense"
  - "multilingual"
  - "performance"
---

## Problem

Production Watch Search has a 24-hour p95 near four seconds and can spend
multiple seconds hydrating watchability after retrieval. We need a full-data,
locally runnable Typesense backend that preserves semantic transcript retrieval
and the current Watch Search response contract so relevance and latency can be
compared directly without changing the production path.

## Entry Points - Read These First

1. `apps/admin/src/services/watch-search.service.ts`
2. `apps/admin/src/services/search-watchability.ts`
3. `apps/admin/src/graphql/queries/watch-search.ts`
4. `apps/admin/src/scripts/video-db-backup.ts`
5. `apps/admin/src/services/hybrid-search-retrievers.ts`
6. `docs/brainstorms/2026-07-14-universal-multilingual-watch-search-requirements.md`

## Grep These

- `WatchSearchResponse|WatchSearchInput|searchVideos` in `apps/admin/src`
- `video_transcript_chunk|embedding` in `apps/admin/src/services`
- `playableDubWhere|targetSubtitlesForVideos` in `apps/admin/src/services`
- `video-search|restore:video-db:latest` in `apps/admin`

## What To Build

1. Add a small Typesense HTTP client and versioned catalog, localized lexical,
   per-language availability, and transcript collection schemas using aliases
   for reversible publication.
2. Add an Admin indexer that exports the viewer-safe catalog projection plus
   the broad native transcript-vector corpus. Store explicit transcript
   visibility so public Watch Search can filter without discarding semantic
   evidence needed by other authorized consumers.
3. Add a Typesense Watch Search service that sends localized title, localized
   metadata, and canonically grouped semantic-vector searches in one
   multi-search request, fuses them 70% lexical / 30% semantic in Admin,
   hydrates only the bounded catalog/availability projection, and returns the
   existing `WatchSearchResponse` contract. Lexical-only degradation remains
   available when query embedding misses its deadline.
4. Add an optional `mode: DEFAULT | MODERN` input to `watchSearch`; omitted or
   `DEFAULT` keeps the current backend and `MODERN` selects Typesense. Production
   Web explicitly selects MODERN and may request a bounded DEFAULT shadow;
   omitted-mode compatibility remains unchanged for every other caller.
5. Add local setup and benchmark commands that restore the latest full
   `video-search` snapshot, run Typesense, build all three indexes, and compare
   latency/result overlap over representative multilingual queries.

## Constraints

- Keep transcript embeddings in semantic retrieval; do not reduce the backend
  to metadata-only search.
- Never expose raw vectors through GraphQL or benchmark output.
- Apply the same public publication, deletion, and `noIndex` gates as current
  Watch Search through catalog eligibility and the transcript
  `publiclyVisible` filter.
- Do not mutate production infrastructure from a workstation. The Typesense
  Railway service is named exactly `@forge/admin/search`; application rollout
  continues through the normal reviewed PR-to-main process.
- Keep Typesense optional so Admin starts normally when it is not configured.
- Regenerate Admin schema and `packages/admin-graphql` outputs for the new field.

## Verification

- Keep production-sized indexing off developer machines; use small unit
  fixtures locally and the isolated `@forge/admin/search` service for the full
  corpus.
- `communion` in French returns `La communion des croyants` from Typesense.
- Generic semantic queries return transcript-backed results with semantic
  evidence even when metadata does not contain the query terms.
- Both modes on the GraphQL field return the same response shape and viewer-safe
  fields.
- A repeated multilingual benchmark reports p50/p95 and result overlap for both
  backends, with Typesense serving p95 under one second after query embedding is
  warm.
- Admin unit tests, typecheck, schema generation, and GraphQL client generation
  pass.

## Production Readiness Follow-up

The operation-specific APM analysis, `JESUS` ranking correction, synchronization
design, capacity estimate, HA topology, backup, monitoring, rollout, and
rollback requirements are recorded in
`docs/operations/typesense-watch-search-production-readiness.md`.

The production index contains 280,107 accepted native vectors and reuses that
generation during routine metadata releases. After stale generations were
retired, Typesense settled at approximately 4.69 GiB RSS on its 16 GiB service.
A correlated 100-request GraphQL MODERN probe measured 87.48 ms server p50,
193.69 ms server p95, and 526.43 ms full-round-trip p95 with zero degradation.
The guarded promotion keeps the GraphQL `DEFAULT` behavior intact, makes Web's
MODERN selection explicit, records DEFAULT as bounded post-response shadow
work, and retains `WATCH_SEARCH_PRIMARY_MODE=DEFAULT` as the independent
traffic rollback.
