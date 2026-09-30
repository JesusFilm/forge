---
module: "Admin Core-to-Watch publication"
date: "2026-09-30"
problem_type: architecture_pattern
component: background_job
severity: high
applies_when:
  - "Maintaining a mutable search projection across nontransactional external writes"
  - "Replacing whole-catalog publication with per-video indexing"
tags:
  - core-sync
  - typesense
  - incremental-indexing
  - retries
  - deletion
---

# Incremental Watch catalog publication

Core imports and the localized-metadata/relation-order backfills already request
search and Web delivery. Rebuilding three complete Typesense collections for each
content refresh increased work and retained duplicate catalog memory. The live
publisher now compares bounded per-video projections and writes only changed
catalog, availability, and localized lexical documents.

## Source capture and removal discovery

`watch_catalog_dirty_video` records identities and revisions transactionally with
source changes. Triggers cover videos, locales, dubs, subtitles, images, editions,
relations, languages, and Mux records. Changes propagate to ancestors within the
same two-level depth used by container availability. Relation removals capture
both endpoints before the former relationship is lost.

Edition-wide subtitles can have a null `videoId`. Changes to their language
must resolve videos through the edition's dubs as well as direct subtitle
ownership. Otherwise a language slug, display name, or soft deletion can leave
stale subtitle availability indefinitely. The real database regression in
`apps/admin/src/services/core-watch-delivery.db.test.ts` covers this fan-out.

Core's public Watch query hides unpublished, restricted, and unavailable videos.
An `updatedAt` query therefore cannot report every disappearance. After a
successful incremental video phase, `sync-videos.ts` scans public eligible IDs
and validates the reported count before soft-deleting absent Core rows. Missing,
empty, duplicate, or count-inconsistent responses fail the phase without deleting
rows. This small ID scan does not rebuild the search catalog.

## Why a committed fingerprint is insufficient

Consider committed content A, an attempted external update to B, and a lost
response after Typesense accepted B. If the source reverts to A, comparing the
source only with committed fingerprint A incorrectly skips the repair. Likewise,
a newly written localized child can survive a subsequent source deletion if its
ID never reached the successful checkpoint.

`watch-catalog-live-index.ts` persists an `inFlight` intent and the union of
possibly written child IDs **before** external writes. A retry rereads current
source data, rewrites the desired documents, and removes both committed and
possibly written stale IDs. The successful transaction clears intent, stores
fingerprints/child IDs, and deletes only the exact observed queue revision.
A concurrent revision remains queued.

Bootstrap deliberately leaves the dirty queue untouched. PostgreSQL sequence
allocation order is not transaction commit order: deleting all revisions below
a pre-snapshot maximum can lose a transaction that commits after the snapshot.
The ordinary compare-and-ack pass safely drains matching rows without search
writes and replays changes that raced with bootstrap.

## Live ownership and consistency

Live `core-live-*` collections are separately owned mutable content projections.
The existing qualified Candidate remains the engine baseline and rollback;
SERVING/EVALUATION pointers, qualifications, and shared transcript vectors remain
unchanged. A first live catalog, a changed baseline/contract, or a missing lexical
tokenizer field triggers a fresh full catalog build. Record ownership before
creation so a crash cannot leave an untracked collection.

Readers can briefly see mixed per-video state across the three collections during
writes or recovery. This is eventual consistency. Private SERVING diagnostics
acquire the publication lock and reject an unfinished publication; successful
publication time participates in the comparison revision. Immutable EVALUATION
qualification keeps its existing lease rules.

Retired live copies drain for five minutes. Old automatic `core-catalog-*`
snapshots use the existing pointer/lease/ownership retirement guards. Cleanup
never owns transcript vectors. Curations resolve only their target videos and
remove pins when the target no longer has searchable documents.

## Verification and operation

Focused tests live in `watch-catalog-live-index.test.ts`,
`watch-catalog-publication-worker.test.ts`, `watch-catalog-publication.test.ts`,
and `core-sync/phases/sync-videos.core-auth.test.ts` under
`apps/admin/src/services/`. They cover no-op writes, scoped changes, partial-write
recovery, removals, bootstrap queue preservation, schema expansion, retirement,
and independent search/Web delivery.

A disposable PostgreSQL 16 and Typesense 30.2 smoke verified a real bootstrap,
zero Typesense writes for its unchanged dirty rows, exactly two document imports
for a title edit, a real lexical search hit for the new title, and cleanup after a
lost availability-write response followed by `noIndex`. An unrelated video
remained present throughout. These are small-fixture correctness measurements,
not production cost or capacity measurements.

Inspect `watch_catalog_publication` delivery counters, `live_updating`,
`live_curation_in_flight`, and retry state alongside dirty-row count and
`watch_catalog.incremental_published` / `watch_catalog.retry` logs. The daily Core
import remains 07:00 UTC; publication polls every 30 seconds. Route/SEO manifests
and Web caches keep separate retryable delivery. No new embedding generation is
part of this path. Measure steady production memory and daily work after normal
PR-to-main deployment before claiming billing savings.

Related: [original Core authorization and publication recovery](../integration-issues/core-watch-catalog-sync-publisher-field-and-search-freshness.md),
[operating guide](../../operations/typesense-watch-search-production-readiness.md),
[implementation ticket](../../roadmap/content-discovery/feat-581-incremental-core-watch-catalog-indexing.md).
