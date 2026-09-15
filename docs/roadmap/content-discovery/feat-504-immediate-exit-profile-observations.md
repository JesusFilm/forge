---
id: "feat-504"
title: "Preserve immediate exits as uninterpreted profile observations"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-09-15"
duration: 4
depends_on:
  - "feat-370"
blocks: []
tags: [admin, web, recommendations, profiles, playback]
---

## Problem

Clicking a video and immediately leaving does not establish that the viewer liked
it. The owner explicitly says the meaning is unknown. Preserve that distinction
without guessing dislike, penalizing related topics, or learning a positive
durable interest from the click.

## Entry Points — Read These First

1. `docs/plans/2026-09-15-recommendation-quality-feedback-plan.md`.
2. `apps/web/src/components/recommendations/RecommendationPlaybackRecorder.tsx`.
3. `apps/admin/src/services/recommendations/outcome.service.ts`.
4. `apps/admin/src/services/recommendations/profiles/profile-projection.service.ts`.

## Grep These

`route_exit|pagehide|playback_attempt|qualified_view|session_selection|negativeEvidence`

## What To Build

- Capture brief departures as a separate observation with an explicit unknown
  preference interpretation, linked through the existing authorized episode/profile
  evidence chain. Distinguish before-start, after-start, failure and missingness.
- Choose and document a versioned diagnostic time window. Preserve elapsed and
  active playback separately; long buffering or a long pause is not an immediate
  departure just because active playback is short.
- Expose observation counts and provenance in authorized Admin playback evidence.
- Keep raw exits out of positive and negative durable-interest training. Do not
  relabel all unqualified viewing as dislike. Future weights require a separate
  evaluated interpretation decision.

## Constraints

Use the existing bounded episode retention and profile privacy-generation fences.
Never delay playback/navigation on evidence delivery. Hidden tabs and bfcache are
not deliberate exits. Browser cleanup alone cannot prove viewer intent.

## Verification

Cover rapid exit, before-start exit, long pause/buffer, completion, fatal error,
missing coverage, duplicate/late evidence, and profile reset. Demonstrate that the
observation does not create qualified positive or inferred negative interests.

## Implementation and verification

The versioned collector and Admin projection are implemented with a ten-second
diagnostic departure window and explicit unknown preference interpretation.
Expected start, error, seek, navigation and QoE counts make missing retained facts
visible; insufficient evidence cannot become a confident departure classification.
Ordinary playback events remain compatible with older Web/Admin deployments.

The authorized Admin detail and latest-20-episode sample expose the observations.
These are episode-linked diagnostic observations; they do not change durable
profile interests, existing click weights or qualified-view classification.

Verification: 54 focused Admin tests, 72 focused Web tests, seven real PostgreSQL
episode cases, independent review, browser lifecycle checks and before/after load
measurements. Full evidence and rollout checks are in
`docs/validation/feat-504-playback-observations/README.md`. Implementation is
complete locally; production rollout and the broader feat-370 instrumentation
remain separate work. Choosing a preference meaning or weight requires an
evaluated interpretation decision.
