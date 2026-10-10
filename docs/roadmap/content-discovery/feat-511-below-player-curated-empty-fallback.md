---
id: "feat-511"
title: "Fill empty below-player recommendations from approved exact-context pools"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-09-16"
duration: 2
depends_on:
  - "feat-487"
blocks: []
tags: [admin, recommendations, watch, reliability]
---

## Problem

The September 16 live audit found 1,521 empty below-player requests out of
10,052: 922 had no candidates and 590 lacked a seed embedding. Existing approved
curated pools only back source-free delivery. Reuse this inventory when the
seeded row is empty, while retaining truthful source and shortfall evidence.

## Entry Points — Read These First

1. `apps/admin/src/services/recommendations/delivery.service.ts`,
   `delivery.types.ts`, `delivery.factory.ts` and `delivery-candidate-mapping.ts`.
2. `apps/admin/src/services/recommendations/curated-pools.service.ts` and
   `curated-pools.runtime.ts` — exact active-generation reads and live eligibility.
3. `apps/admin/src/services/recommendations/recent-context.service.ts` and
   `slate.ts` — current/recent media exclusion and identity deduplication.
4. `docs/reports/2026-09-16-recommendation-next-improvements/report.md`.

## Grep These

`seed_embedding_unavailable|no_candidates|PreparedCandidate|candidateGenerator|CURATED_POOL_POINTER_ID`

## What To Build

- When no eligible semantic/profile items remain, fill from approved starter
  inventory for the exact locale/audio context under the existing deadline.
- Recheck publication, playback, artwork and identity; exclude current and
  recently watched media, including aliases, before issuing capabilities.
- Record curated generation/pool/source provenance and the original empty reason.
  Keep healthy contextual recommendations even for cold profiles.
- Preserve the existing fail-open behavior when inventory is absent or slow.

## Constraints

No new curated publication, locale expansion, embedding generation, request-time
catalog scans, false similarity scores or For you flag changes. Coordinate with
the source-free task before touching its owned service/cache/admission files.

## Verification

Test missing seed embeddings, all-filtered candidates, exact audio mismatch,
recent/current aliases, deleted/unplayable items, exhausted budget and sparse
inventory. Reconcile ledger source with returned cards in real PostgreSQL and
confirm player load and retrieval deadlines. Run affected Admin/Web checks.

## Production verification — September 16

Implementation, focused regressions, sequential Compound Engineering review and
PR CI passed. The normal main deployment and exact production revision were
verified. See [release evidence](../../operations/recommendation-quality-release-2026-09-16.md)
for the bounded browser/database/HTTP result and remaining system-wide gates.
The 02:14–02:24 window recovered eight empty seeded requests with 48 curated cards. Live source, duplicate/current-video and item-count invariants passed. No inventory was published or locale coverage expanded.
