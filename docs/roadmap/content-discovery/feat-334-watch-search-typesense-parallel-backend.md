---
id: "feat-334"
title: "Watch Search Typesense parallel backend"
owner: "codex"
priority: "P0"
status: "in-progress"
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

1. Add a small Typesense HTTP client and versioned catalog/transcript collection
   schemas using collection aliases for atomic full rebuilds.
2. Add an Admin indexer that exports the viewer-safe catalog projection plus
   the broad native transcript-vector corpus. Store explicit transcript
   visibility so public Watch Search can filter without discarding semantic
   evidence needed by other authorized consumers.
3. Add a Typesense Watch Search service that performs lexical and semantic
   retrieval in parallel, hydrates results only from the precomputed catalog,
   and returns the existing `WatchSearchResponse` contract.
4. Add an optional `mode: DEFAULT | MODERN` input to `watchSearch`; omitted or
   `DEFAULT` keeps the current backend and `MODERN` selects Typesense.
5. Add local setup and benchmark commands that restore the latest full
   `video-search` snapshot, run Typesense, build both indexes, and compare
   latency/result overlap over representative multilingual queries.

## Constraints

- Keep transcript embeddings in semantic retrieval; do not reduce the backend
  to metadata-only search.
- Never expose raw vectors through GraphQL or benchmark output.
- Apply the same public publication, deletion, and `noIndex` gates as current
  Watch Search through catalog eligibility and the transcript
  `publiclyVisible` filter.
- Do not provision production infrastructure from this code branch. After the
  normal PR merge, the shadow Typesense Railway service is named exactly
  `@forge/admin/search` and receives no user traffic until rollout gates pass.
- Keep Typesense optional so Admin starts normally when it is not configured.
- Regenerate Admin schema and `packages/admin-graphql` outputs for the new field.

## Verification

- Restore and index the latest `video-search` snapshot locally without Docker.
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

The 2026-08-04 production audit found 280,107 accepted native vectors and 1,175
viewer-visible catalog documents. The broad-corpus rebuild and benchmark on the
isolated `@forge/admin/search` shadow service remain rollout gates. `DEFAULT`
must remain unchanged until that run, production-shaped load evidence,
synchronization evidence, and the documented sub-200 ms full-round-trip gate
all pass.
