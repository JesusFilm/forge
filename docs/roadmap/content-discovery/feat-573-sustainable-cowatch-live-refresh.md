---
id: "feat-573"
title: "Sustain live co-watch with bounded graph refresh"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-10-01"
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

## Implementation and release tracking

The October 1 restoration implements an explicit default-off, 29-day owner grant
with a complete seven-day source window, seven-hour maturation, five-minute
checks and at least 12 hours between new attempts/publications. Exact grant,
lease, pointer and influence-floor checks fence publication and activation.
Unknown acknowledgements preserve the original attempt; capacity/eligibility
refusals retain honest fallback.

Entry points are `cowatch/refresh-policy.ts`, `refresh.service.ts`,
`refresh.job.ts`, `refresh-retention.ts`,
`apps/admin/src/workflows/recommendationCowatchRefresh.ts`, migration 0126 and
`apps/admin/src/app/api/recommendations/cowatch-refresh/route.ts`.
The operator and release procedure are documented in
`docs/operations/recommendation-cowatch-refresh-2026-10-01.md`.

Native lifecycle, integrity-reuse and serving metadata regressions passed locally.
The owner requested keeping the existing CI workflow unchanged for this release;
feat-591 tracks adding these PostgreSQL suites to CI separately.
PR #2529 is merged. Admin and worker normally autodeployed the code, then advanced
to `58cf00928a083156414618988f42c02545b4b1e6`. The supported CLI published a
complete seven-day graph; the owner UI activated G7 on October 1 02:57:35.266 UTC.
Measured graph allocation grew 57,769,984 bytes, informing the 96 MiB publication
reserve and full 29-day retained-overlap budget. Grant
`a593c39d-20c2-42fe-aefc-f6ce92776a4b` lasts through October 30 02:59:47.524 UTC;
first eligibility was scheduled for October 1 14:56:54.108 UTC. The scheduler
was running at the recorded October 1 check. Exact dated receipts and the budget
are in the operations record above; they do not certify the current state.

At that check automatic replacement was not yet due. The first
33 natural requests yielded no exact co-watch execution; one owner attempt
correctly fell back for sparse supported edges. This ticket remains in progress
for the separate refresh lifecycle/capacity verification. The requested 24-hour
follow-up will inspect replacement and record contribution or expected fallback
before switching to weekly reviews. Positive contribution is not a completion gate.

The restoration task recorded production admission, G7 activation and a refresh
grant in [PR #2530](https://github.com/JesusFilm/forge/pull/2530). Keep actual
refresh lifecycle/capacity verification separate from delivery health; this
ticket's in-progress status is not evidence of a delivery bug. The October 2
owner decision accepts sparse coverage and successful incumbent fallback and
permits proceeding without a positive co-watch-card gate. Apply
`docs/analytics-and-recommendation-policy.md#delivery-health-and-accepted-coverage`.

## October 2 bounded-lifecycle closeout

The first automatic attempt under the existing grant succeeded on October 1
14:57 UTC. It published a new bounded graph, committed a matching G8 release
and pointer, and recorded the delegated system audit. At 18:16:52 UTC, two
captured source eligibility decisions were superseded; the graph and release
were correctly invalidated/revoked with `eligibility_changed`. The grant remains
valid, the scheduler heartbeat is running and its last batch was idle while
the fixed 12-hour minimum publication interval applies. The next attempt is
eligible at October 2 02:57:19.104 UTC; its real result has not yet been
observed. Native PostgreSQL `cowatch/refresh.db.test.ts` covers revocation,
throttled fallback and a subsequent successful replacement with the original
revocation unchanged.

This is the approved bounded refresh lifecycle: invalid evidence withdraws
co-watch influence until a fresh qualified publication is permitted. It does
not promise continuous graph-backed service between checks. At the October 1
23:02 UTC read, database allocation was 22.625 GB against the grant's 44.5 GB
ceiling and graph relations allocated 274.5 MB against the 6.3 GB retained
graph ceiling. Successful first replacement and these observed allocations
support the current envelope; future attempts still apply admission and may
refuse. Ordinary recommendation delivery falls back when graph authority is
unavailable. The next natural attempt and actual co-watch contribution remain
subjects for the existing scheduled follow-up, not claims of this closeout.
