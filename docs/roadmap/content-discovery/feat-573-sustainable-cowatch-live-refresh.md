---
id: "feat-573"
title: "Sustain live co-watch with bounded graph refresh"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: ""
duration: 3
depends_on:
  - "feat-565"
blocks: []
tags: [admin, recommendations, cowatch, retention]
---

## Problem

The owner-approved direct release in feat-565 uses a current immutable graph with
at most 24-hour publication freshness and earlier dependency expiry. Its initial
operator supports explicit replacement. Sustained graph-backed serving needs a
bounded refresh process and verified capacity for retained overlapping generations.
Expiry currently serves the actual semantic/profile/viewing-mode incumbent; an
enabled pointer must not be reported as continuously executing co-watch.

## Entry Points — Read These First

1. `docs/plans/2026-09-30-001-feat-owner-approved-cowatch-live-plan.md`.
2. `apps/admin/src/services/recommendations/promotion/owner-authority.ts` and
   `owner-operator.ts` — exact immutable release, qualification, CAS and replay.
3. `apps/admin/src/services/recommendations/cowatch/projection.service.ts` and
   `source-window.ts` — complete finite population, single publisher and bounds.
4. `apps/admin/src/services/recommendations/retention.ts` and
   `retention-locks.ts` — retained graph dependencies, closure and lock order.
5. `docs/solutions/database-issues/recommendation-retention-cascade-lock-order-20260929.md`.

## Grep These

`owner-approved-no-study-v1|current-source-owner-live-v1|ownerInfluenceFloorGeneration|COWATCH_PUBLICATION_LOCK_ID|rawPopulationExpiresAt`

## What To Build

- Define the fixed finite source-window/cutoff policy and refresh trigger before
  execution; preserve 50,000 raw sources, 256 sources/session, 250,000 attempted
  pairs and the single serialized publisher. Refusals do not shrink the window.
- Budget actual retained graph overlap, source lineage, peak build memory/temp,
  WAL and incremental serving writes. Coordinate with the storage owner and
  credit reclamation only after observed loaded purge/filesystem evidence.
- Refresh within the exact approved manifest/configuration/population. Publish
  complete source data first, qualify it and atomically replace the pointer;
  uncertain acknowledgements reconcile the original operation identity.
- Preserve privacy and source invalidation, immutable first revocation,
  disable/reset/deletion, influence-floor fencing and issuance lock order.
  Identical republish cannot renew graph age or retained input expiry.
- Show last successful refresh, current graph deadline, refusal/fallback and
  stop state in the existing Admin operator. Keep rollback independent of refresh.

## Constraints

This is operational continuity, not a restored trial or causal-evidence gate.
Do not claim measured usefulness, broaden the supported cohort, raise bounds,
extend raw retention or create a second serving authority. No scheduler or
production refresh is created merely by filing this ticket.

## Verification

- Real bounded publication and atomic replacement at the admitted population.
- Retry/unknown acknowledgement, expiry, overlap, source/privacy invalidation,
  stop-during-refresh and retention races on an owned PostgreSQL fixture.
- Incremental physical heap/index/WAL, transient resources and retained overlap
  under the current storage envelope; no credit for scheduled-but-unobserved purge.
- Deployed refresh and actual served provenance across a graph replacement,
  with truthful incumbent fallback during a natural refresh failure or expiry.

Complete only when refresh sustains the approved live policy within its bounds.
