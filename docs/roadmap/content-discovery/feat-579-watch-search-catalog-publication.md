---
id: "feat-579"
title: "Publish Core catalog changes into the serving Watch search index"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-09-30"
duration: 5
depends_on: []
blocks:
  - "feat-578"
  - "feat-581"
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

## Production publication evidence

PR #2493 merged as `a0fc474b31e14d9ea6229c8a8a909ae3d036e097`. Production
startup automatically requested version `1` and published the READY generation
`core-catalog-6eac2756e41ad0517ca9b31b1cf9c68f`. Search and Web acknowledgments
both reached `1` by `2026-09-29T22:35:24Z`, with no retries or error. Public
search, autocomplete, and Watch UI returned Breaking Point and all four episodes.

An executed localized-metadata backfill queued version `2`; both deliveries
completed by `22:36:50Z`. The content digest avoided rebuilding identical
collections. Route/SEO manifests were regenerated and Web cache invalidations
acknowledged. Qualified SERVING and EVALUATION pointers remained unchanged.

The first full build and delivery took about 4 minutes 23 seconds; the unchanged
backfill delivery took about 46 seconds. The 30-second worker poll is only one
part of that latency. Forge's daily Core pull remains 07:00 UTC. Full importer
verification is recorded in the automatic publication plan. It succeeded with
1,134 updates and zero errors, then automatically queued version `3`. Search
acknowledged it at `23:04:19Z` and Web by `23:04:40Z`, with no publication error
or retry. The final public search probe still returned all five Breaking Point
records with `degraded: false`.
