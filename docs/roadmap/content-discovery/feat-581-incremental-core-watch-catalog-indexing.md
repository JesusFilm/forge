---
id: "feat-581"
title: "Index Core Watch catalog changes incrementally"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-09-30"
duration: 5
depends_on:
  - "feat-579"
blocks: []
tags:
  - "admin"
  - "search"
  - "typesense"
  - "core-sync"
---

## Problem

The automatic Core publisher rebuilds three whole catalog collections and
retains duplicate snapshots for ordinary content changes. A single changed
video should require only its own documents and affected ancestors.

## Entry Points — Read These First

1. `apps/admin/src/services/watch-catalog-publication-worker.ts`: coalesced
   search and Web delivery.
2. `apps/admin/src/services/typesense-watch-search-indexer.ts`: catalog,
   availability, and lexical projections.
3. `apps/admin/src/services/watch-catalog-publication.ts`: serving selection.
4. `apps/admin/prisma/schema.prisma`: durable publication ownership.

## Grep These

`watchCatalogPublication`, `buildCatalogDocuments`,
`resolvePublishedWatchCatalog`, `video_relation`, `synced_at`.

## What To Build

Capture changed video IDs durably, including parent containers affected by
relations and child playback. Bootstrap one separately owned live catalog and
apply bounded per-video upserts and removals. Re-read current source state on
every retry and acknowledge only after all writes verify. Preserve immutable
qualified Candidate generations and the existing Web delivery path.

## Constraints

No Core webhook, new infrastructure, embedding generation, ranking changes,
or generic CDC service. Never move SERVING or EVALUATION during Core sync.

## Verification

Focused tests cover no-op imports, one-video updates, localized/availability
removals, parent propagation, partial-write retries, concurrent requests, and
Web delivery. Run Admin format, lint, and type checks.

Implementation verification: 235 scoped Admin tests and six real PostgreSQL
delivery tests passed after integrating current main. All 121 migrations applied
to a fresh disposable PostgreSQL 16 database, and rollback-only trigger assertions
passed. A real Typesense 30.2 smoke verified no-op writes, scoped title updates,
and removal after a partial write; see the [durable retry learning](../../solutions/architecture-patterns/incremental-watch-catalog-durable-intent-ledger.md).
Publication has not been deployed.
