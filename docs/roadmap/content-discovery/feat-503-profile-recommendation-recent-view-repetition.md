---
id: "feat-503"
title: "Audit recent-view repetition in profile recommendations"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-09-15"
duration: 3
depends_on: []
blocks: []
tags:
  - "admin"
  - "recommendations"
  - "profiles"
  - "playback"
---

## Problem

The September 15 live profile audit found 4,843 / 15,465 below-player profile-contributed cards pointing to videos already represented by qualified viewing in the served profile projection. A diagnostic of the latest 200 personalized requests found 90 recent-repeat cards learned outside recommendation-origin playback, but only one carried a recent-history suppression record. The local recent-context reader only joins playback facts through recommendation requests, while profile learning accepts source-neutral playback.

This ticket owns verification and a bounded repair to recent-view context coverage. General slate diversity and ranking remain in `feat-393`; source-free For you policy and activation remain in `feat-488`. Qualified viewing is not completion, and some repeats are intentional refill or continuation.

## Entry Points — Read These First

1. `docs/reports/2026-09-15-profile-recommendations/report.md` — live findings, complete aggregates, and sample limitations.
2. `docs/reports/2026-09-15-profile-recommendations/repeat-sample.sql` — source-neutral versus recommendation-origin repeats and actual rejected-stage suppression evidence.
3. `apps/admin/src/services/recommendations/recent-context.service.ts` — `recent_requests`, `started_items`, authorization windows, and bounded sessions/roots/videos.
4. `apps/admin/src/services/recommendations/slate.ts` — recent-history preference versus hard current-video exclusion and allowed refill.
5. `apps/admin/src/services/recommendations/profiles/profile-projection.service.ts` — qualified source-neutral playback accepted into interests.
6. `apps/admin/src/services/recommendations/recent-context.db.test.ts` — real-PostgreSQL context test seam.

## Grep These

`recent_requests`, `started_items`, `recent_playback_start`, `discovery_source`, `request_id IS NULL`, `refill_after_suppression`, `terminal_completed`.

## What To Build

1. Confirm the deployed revision and exact recent-view policy; do not infer production behavior solely from this checkout.
2. Reproduce the source-neutral gap using an active authorized profile, a direct/search-origin episode with no recommendation request, a qualified finalized outcome, and a later profile-driven request for another video.
3. Include the relevant bounded source-neutral viewing evidence in recent context while retaining authorization start times, active privacy generations, expiry, and safe no-profile behavior.
4. Keep current-video exclusion hard. Preserve explicitly permitted partial-watch continuation and insufficient-fresh-candidate refill. A composed-stage movement reason alone is not proof of prior suppression.
5. Record remaining For you completion-window questions in `feat-488`: eight profile cards matched completion evidence in the initial live audit, four within seven days and none within 24 hours. Do not change a separate surface's completion policy implicitly.

## Constraints

No production data mutation or deployment during diagnosis. No raw profile identifiers, session digests, history membership, or vectors in reports or public contracts. Preserve bounded database work, exact playback language, six-card fill semantics, and the delivery deadline. Do not classify every repeated qualified view as a defect or equate qualification with completion.

## Verification

Add real-DB and focused behavior cases for direct/search/recommendation origin; partial versus completed viewing; expired/revoked links; privacy-generation changes; history-window and count boundaries; fresh supply versus refill; and current-video exclusion. Confirm suppressed recent videos lose priority when sufficient eligible fresh candidates exist. Measure bounded query latency against representative data, then run touched Admin tests, lint/typecheck, and normal PR checks. Recheck production repeat rates by discovery source after normal PR-to-main deployment.

## Identity and coordination

Renumbered from the local recommendation ticket feat-478 because main already uses that ID for analytics documentation. Work starts from main at `3cc4017af`, in `codex/recommendation-quality-feedback`. The active feat-496 task owns Web admission/runtime recovery.

## Implementation and verification

The recent-context reader now merges bounded source-neutral episode starts into
the existing authorized recent-history preference. Server receipt time preserves
accepted buffered and clock-skewed starts; attempts without a start are excluded.
Migration `0096_recommendation_recent_episode_index` adds the matching
session/created-time index using transaction-compatible DDL with bounded lock and
statement timeouts.

Six actual PostgreSQL cases cover authorization, privacy reset, expiry, origins,
clock differences and count bounds. The 439-case recommendation service unit run
and existing fresh-first/refill regressions pass. A 10,000-unrelated-episode fixture
used the new index and measured 1.94 ms median / 4.41 ms p95 over 25 calls.

Implementation is complete locally. Production repeat-rate and delivery-latency
verification remains a post-deployment check through the normal PR-to-main flow;
see `docs/operations/recommendation-quality-validation-2026-09-15.md`.
