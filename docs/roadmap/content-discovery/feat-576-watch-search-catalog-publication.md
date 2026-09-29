---
id: "feat-576"
title: "Publish Core catalog changes into the serving Watch search index"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-09-30"
duration: 5
depends_on: []
blocks:
  - "feat-578"
tags:
  - "admin"
  - "search"
  - "typesense"
  - "core-sync"
---

## Problem

Breaking Point recovery exposed a second freshness boundary: successful Core
sync refreshes route/SEO manifests but does not publish catalog, lexical, or
availability changes into the serving Typesense projection. Production is
pinned to a Candidate snapshot built September 8. The readiness runbook still
describes the catalog outbox worker as future work. Transcript publication
alone does not fill this gap.

## Entry Points — Read These First

1. `docs/operations/typesense-watch-search-production-readiness.md`:
   Production Synchronization Strategy and ancestor availability requirements.
2. `apps/admin/src/services/core-sync/orchestrator.ts`: finishSyncRun.
3. `apps/admin/src/services/typesense-watch-search-indexer.ts`:
   buildTypesenseWatchCandidateProjectionSnapshot and visibility predicates.
4. `apps/admin/src/services/typesense-watch-search-candidate-generation.ts`:
   immutable generation identity, serving pointer, qualification, and leases.
5. `apps/admin/src/services/typesense-watch-search-transcript-publication.ts`:
   existing durable publication pattern; it is not catalog publication.

## Grep These

`WATCH_SEARCH_TYPESENSE_PROFILE`, `sourceDigests`, `containerLanguagesJson`,
`withTypesenseWatchSearchIndexLock`, `finishSyncRun`, `publiclyVisible`.

## What To Build

Design a supported publication boundary for ordinary content updates while
preserving Candidate qualification and schema/ranking compatibility. Add
durable change capture, bounded coalesced retries, verified JSONL imports,
removals, and periodic reconciliation for the actual serving projection.
Rebuild ancestor availability when child dubs, relations, or visibility change.
Expose publication lag and failed updates so an old index cannot appear fresh.
Verify the worker has the same Web revalidation destination and credential
configuration as Admin: the recovery CLI rebuilt manifests but skipped its
webhooks with `config_missing`, requiring an explicit replay from Admin.

## Constraints

Do not silently mutate immutable Candidate identities or fabricate fresh
qualification. Do not rebuild embeddings for metadata-only changes. Preserve
publication, deletion, noIndex, language, and platform visibility predicates.
Reuse production publication locks and keep indexing off request paths.

## Verification

An imported published video becomes searchable within the declared lag budget.
Unpublication and Watch restriction changes remove it. New playable child dubs
update parent-series availability. Recovery after a failed batch converges
without manual whole-index promotion or exposure of partially updated records.
