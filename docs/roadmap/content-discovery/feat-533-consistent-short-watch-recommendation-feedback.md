---
id: "feat-533"
title: "Consistent short-watch feedback across recommendation APIs"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-09-23"
duration: 3
depends_on: []
blocks: []
tags:
  - "admin"
  - "recommendations"
  - "playback"
  - "web"
---

## Problem

A 20-second watch followed by returning to and reloading the homepage left the
same recommendations visible. Homepage history requires qualified finalized
viewing, while below-player recent context already includes playback starts.
The user explicitly scoped consistent short-watch behavior across both APIs.
They also require viewing from any product entry point to affect recommendations
and user profiles, without requiring a recommendation-card click.

Implementation, repeated review and local release validation are complete.
Production verification follows the normal reviewed PR-to-main deployment.
This extends the delivered homepage work in feat-488 and below-player
recent-context work in feat-503. It has not been deployed.

## Entry Points

1. `docs/plans/2026-09-23-001-feat-shared-short-watch-recommendations-plan.md`
2. `apps/admin/src/services/recommendations/user-history.service.ts`
3. `apps/admin/src/services/recommendations/recent-context.service.ts`
4. `apps/admin/src/services/recommendations/user-delivery.service.ts`
5. `apps/admin/src/services/recommendations/delivery.service.ts`
6. `apps/admin/src/services/recommendations/slate.ts`
7. `apps/admin/src/services/recommendations/playback-outcome-consumer.ts`
8. `apps/admin/src/services/recommendations/profiles/profile-projection.service.ts`

## Grep These

`getUserWatchHistory`, `getRecommendationRecentContext`,
`composeUserRecommendations`, `composeRecommendationSlate`,
`recently_tried`, `recentPlaybackCtes`, `qualified_view`, `recentRefill`.
Also inspect `discoverySource`, `requestId`, and `request_id IS NULL` through
episode ingestion and profile evidence selection.

## What To Build

Define one backend short-watch policy and apply it to both source-free homepage
and seeded below-player recommendation delivery, including applicable fallback
paths. Use the same interpretation of equivalent authorized evidence while
retaining each surface's relevance context. Subsequent API requests should
reflect brief actual viewing even below the durable-interest qualification gate.

Require source-independent collection and consumption of playback feedback for
recommendation and profile updates. Search, browsing/editorial, direct, shared,
acquisition, and recommendation-origin viewing must follow equivalent evidence
and weighting rules. A recommendation request, selection, or impression is not
required; discovery source remains attribution. Verify and extend the existing
source-neutral playback pipeline rather than introducing a parallel collector.

Use three seconds of accepted visible playback and a 24-hour recently-tried
window. Prefer fresh eligible candidates across sources, with deterministic
recent refill for limited supply. Short-only evidence updates recent context;
lasting interests retain existing qualified-watch rules for every origin.

## Constraints

Keep behavior in the API/backend; no cosmetic frontend shuffle. Preserve exact
language, playable cards, canonical identity, current-video exclusion, bounded
query work, authorization and reset behavior. Consistency does not require
identical lists on differently seeded surfaces. Do not silently weaken existing
completion rules. Profile-first ordering remains within each freshness tier.

## Verification

Add shared-policy parity cases for both APIs and real-PostgreSQL evidence coverage.
Exercise 20-second viewing, pending finalization, invalid and expired evidence,
profile reset, repeated requests, fresh alternatives and bounded refill. Measure
source parity through actual recommendation-history and profile updates, including
episodes with no recommendation request or card selection. Measure
both delivery paths and verify homepage return/reload and below-player requests
against the actual returned ordering. Follow the scope draft's verification
entry points and the normal PR-to-main release process.

## Completion Evidence

- Shared 3-second / 24-hour SQL evidence policy feeds both API surfaces.
- All six playback origins affect recent context and qualified profile learning,
  including recommendation playback without attributed impressions.
- 7,324 Admin unit tests, 61 real-PostgreSQL tests and 119 Web tests passed.
- Admin typecheck, changed-file lint, production build and schema drift checks
  passed. Both readers retained indexed access with 10,000 unrelated episodes
  and bounded integrity work with eight sessions, 32 roots and 128 facts each.
- Two full Compound Engineering review rounds plus a focused final re-review
  left no unresolved findings; fallback, identity and deadline fixes are covered.
- Compound learning and related pattern/operations guidance refreshed in place.
- [Verification and release smoke checklist](../../validation/feat-533-short-watch-feedback.md).
  Browser reproduction and production end-to-end latency remain release checks;
  no production activation or deployment was performed.
