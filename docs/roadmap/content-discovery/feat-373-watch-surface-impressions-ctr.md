---
id: "feat-373"
title: "Watch surface impressions and CTR"
owner: "nisal"
priority: "P0"
status: "in-progress"
start_date: ""
duration: 5
depends_on:
  - "feat-368"
blocks:
  - "feat-374"
  - "feat-375"
  - "feat-388"
  - "feat-449"
tags:
  - "admin"
  - "web"
  - "watch"
  - "recommendations"
  - "impressions"
  - "ctr"
---

## Problem

Clicks cannot be interpreted without eligible impressions across every Watch block that can lead to a video.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U6 contract.
2. `apps/web/src/components/`
3. `apps/admin/src/services/recommendations/`
4. `apps/admin/src/app/dashboard/recommendations/`

## Grep These

- `IntersectionObserver|trackVisibility`
- `MediaCollection|carousel|VideoCard`
- `surface|placement|impression`

## What To Build

- Create a finite registry of click-bearing Watch surfaces, blocks, presentations, placements, items, and policy versions.
- Reuse one exposure primitive across static lists, carousels, search, home, editorial blocks, and below-player recommendations.
- Record one eligible impression per exposure window plus rendered, selected, repeated, and capability-dependent visibility state.
- Migrate registered surfaces incrementally while Admin exposes missing instrumentation.

## Admin Evidence Gate

- Show served, rendered, eligible-impression, and selection counts with CTR by surface, block, presentation, and position.
- Show registry completeness, duplicate rate, visibility capability, and instrumentation gaps so partial migration cannot look complete.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Remaining evidence gate

The signed below-player and For You surfaces have request-owned served facts.
Origin-issued anonymous V2 evidence is deployed through PR #2450. Authorized
Admin observations include served and rendered positions for authored home,
search, series episodes and video chapters, with natural chapter impressions,
selections, visibility capability and replay counts. These rolling cohorts
include concurrent production traffic and do not establish complete coverage.
The active hero authority and mixed-policy display-bound repairs from PR #2452
are deployed after the test-only timing repair in PR #2453. The deployed Admin
policy filter exposes all 74 V2 chapter positions in the inspected cohort and
separately retains 77 legacy positions with unknown served counts. A real
browser verifies active-card authority, focus retention, matching V2 selection
and successful playback navigation. The final Admin hero cohort has 15 served,
15 rendered, two eligible impressions and one early selection, with no eligible
selection; these rolling counts include concurrent traffic.
The batch's release and evidence boundaries are recorded in
`docs/operations/recommendation-batch-acceptance-2026-09-29.md`.

The owner explicitly retained fallback home carousel, fallback home grid and
video editorial as unresolved coverage gaps for this batch. They currently
have no producing public route; missing rows are unknown coverage, not measured
zeros. This scope decision preserves their registry entries and does not
complete this ticket. For You also had no measured rows in the inspected
rolling window. The full coverage and ingestion-health gate remains open:
shared health still reports loss suspected. Comparative page-loading evidence
is retained with small-sample limits: home LCP rose 164 ms while its
FCP/load/TTFB fell, and headed paint entries remained unavailable. It is not
field regression clearance. Local browser and PostgreSQL fixtures cannot
establish deployed ingestion completeness. Unreceipted transient windows retain
V1 unknown-served facts rather than manufacturing a denominator.

The origin-issued v2 implementation is described in
`docs/plans/2026-09-29-feat-373-origin-served-manifests-plan.md`. Local browser
reconciliation is recorded in
`docs/validation/2026-09-29-feat-373-browser-local.md`. Served means persisted
origin issuance of a verified measurement manifest, with no claim that the
browser received it or that its cards were eligible. Unsupported source
projections and legacy v1 facts retain an unknown denominator. Registry
completion remains false pending deployed coverage and authorized Admin review.
Root/language home projections use proven public pathnames; generic authored
relative-navigation authority remains unknown and is tracked by feat-564.
The Admin exposure table has registry-entry and optional placement filters;
PR #2452 adds an optional policy filter before the unchanged 128-row bound.
Its anonymous report
uses an exact-partition window calculation after a production timeout was
reproduced locally, preserving cutoffs, policy isolation and the three-second
statement budget.

## Constraints

- Use portable intersection ratio, page visibility, and dwell. Treat occlusion as unknown when visibility tracking is unsupported.
- Selection before an eligible impression remains an observable anomaly; do not synthesize an impression.
- This ticket measures exposure and CTR but does not authorize CTR as the optimization objective.
- Declare purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback/fallback for every new recommendation record.
- Preserve player startup and Watch availability when recommendation telemetry or Admin is degraded.

## Verification

- Test below-fold, carousel movement, hidden tabs, repeated intersections, responsive changes, selection-before-impression, and navigation replay.
- Test capability detection for occlusion-aware visibility and unknown fallback.
- Run component-family tests and reconcile every registered surface in Admin.
- Run affected application checks: `pnpm --filter @forge/web test`, `pnpm --filter @forge/web lint`, and `pnpm --filter @forge/web typecheck`; `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.
