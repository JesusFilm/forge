---
id: "feat-497"
title: "Expand production recommendation pools beyond the initial languages"
owner: "nisal"
priority: "P2"
status: "not-started"
start_date: "2026-09-14"
duration: 3
depends_on:
  - "feat-487"
blocks: []
tags:
  - "recommendations"
  - "i18n"
  - "admin"
---

## Problem

The source-free API and Web row are live with 51 validated locale/audio contexts.
The owner explicitly accepted partial coverage. A broader production audit of
2,081 contexts that passed the local snapshot lost its public PostgreSQL
connection after more than 600 queries; it produced no completed report.
Continue coverage work without disabling available contexts or reopening launch.

## Entry Points — Read These First

1. `docs/operations/user-recommendations-activation-2026-09-14.md` and its JSON
   evidence — exact activated contexts, generation, observations and limits.
2. `apps/admin/scripts/import-recommendation-pools.ts` — audit/import/promote/rollback.
3. `apps/admin/src/services/recommendations/curated-pools.service.ts` and
   `curated-pools.catalog.ts` — immutable versions and current eligibility.
4. `docs/recommendations/curation/2026-09-10/all-context-web-default-coverage.csv`
   and `pg-catalog-summary.json` — local projections and unfiltered catalog map.

## Grep These

`CuratedPoolsService`, `CURATED_POOL_POINTER_ID`, `exact_audio_unavailable`,
`localePublished`, `watchPlayable`, `canonical_duplicate`.

## What To Build

- Audit remaining actual Web locale/audio mappings in bounded, resumable batches.
  Record completed reports by source digest and context; do not treat progress
  counters as completed validation. Avoid repeatedly transferring identical
  embeddings, with parity checks against the normal audit implementation.
- Import a new immutable generation that includes every currently active context
  plus additional passing contexts. Promote through the existing service with
  the expected current version and fresh production eligibility checks.
- Classify failures separately: display translation, exact audio, playback,
  restrictions, artwork, canonical duplicates and reserve depth. Reuse the
  reviewed editorial choices; do not infer absent videoVariants from absent text.

## Constraints

No 100% coverage launch gate, new model API spend, monthly worker, silent language
fallback, weakened history rules or direct application deployment. Six plus zero
exclusions was the initial activation check; thirty starters provides a larger
reserve, but overlapping interest pools do not add distinct inventory.

## Verification

All source IDs resolve. Every newly activated context passes the existing
validator and is retained in the immutable report. Recheck stored starter IDs at
promotion, prove currently active contexts remain present, and smoke representative
languages through the live API. Runtime failures remain `feat-496`; a successful
catalog audit alone does not prove delivery latency or full playback of every dub.
