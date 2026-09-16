---
id: "feat-515"
title: "Isolate cold Watch paint variability around deferred preview activation"
owner: "nisal"
priority: "P2"
status: "in-progress"
start_date: "2026-09-16"
duration: 2
depends_on: []
blocks: []
tags: [web, watch, playback, performance, verification]
---

## Problem

The sound-off recommendation release's whole-page browser checks reported warm
LCP of 688/776ms and three fresh-browser LCP values of 900/1,108/1,304ms, but other
cold runs reported approximately 9.94–9.99s. Baseline had only one cold sample
(1,512ms); these samples do not establish a causal regression or a clean pass.
Cold maximum long tasks ranged from 119–229ms versus the baseline's 126ms.

In a diagnostic run the heading existed with visible computed styles at 1.98s,
but the paint timeline was still empty. Later LCP named that heading at 9.99s.
The existing desktop preview activation waits eight seconds after load and then
an idle callback; that policy is byte-for-byte unchanged from the baseline.
Do not equate a late LCP observation with a proven blank screen, attribute it to
viewing-mode collection, or discard it as a harness artifact without evidence.

## Entry Points

- `apps/web/src/components/watch/HeroPlayer.tsx`: `IDLE_PREVIEW_FALLBACK_DELAY_MS`,
  `scheduleConservativeActivation`, poster and media-frame reveal.
- `apps/web/src/components/watch/WatchHeroOverlay.tsx`: heading placement.
- `apps/web/src/lib/watch-font.ts`: local font with `display: "swap"`.
- `apps/web/src/components/recommendations/RecommendationPlaybackRecorder.tsx`:
  prove telemetry/profile initialization does not gate rendering or playback.
- `docs/validation/recommendation-quality-followup/page-performance-*.json` and
  `docs/operations/recommendation-quality-release-2026-09-16.md`.

## Work and Verification

Capture matched cold/warm runs against baseline and current artifacts with fixed
viewport, cache state, browser version and service revisions. Record first paint,
heading visibility, poster paint, first media frame, LCP element changes and long
animation-frame script attribution. Use time-stamped screenshots to distinguish
actual delayed rendering from delayed/missing performance entries. Include real
device or field evidence before treating headless observations as user percentiles.

Keep the recommendation collector's controlled component cost separate from full
page and third-party work. If a regression is reproduced, fix its causal path and
run Watch/hero/recorder tests plus full-page load checks. Preserve preview first,
sound-off learning, navigation, exact eligibility and existing deployment flow;
do not change the preview delay or disable telemetry just to improve a metric.

## Matched investigation — September 16

Built pre-release `0a1c58599` and current `469edc6f9` independently with the same
CI configuration. Local servers used the same production catalog read backend;
Redis and production mutation origins were not enabled. Six fresh-browser runs
alternated baseline/current/current/baseline/baseline/current. All displayed the
expected heading, a playing muted preview and Watch now.

Baseline LCP: 4,920 / 9,988 / 9,972ms. Current LCP: 4,788 / 324 / 9,988ms.
Initial SSR cache misses had roughly 4.5–4.7s TTFB in both builds. Baseline maximum
long tasks: 124 / 111 / 113ms; current: 127 / 126 / 125ms. The approximately
10-second late-paint behavior therefore demonstrably predates the sound-off
release. These small, mixed SSR-cache samples do not estimate a change in its
frequency or prove the eight-second preview delay causes the paint entry.

The new recommendation signal is no longer blocked on an unexplained _new_
late-paint behavior. This ticket remains in progress for the existing behavior's
cause, representative device/field impact and any justified correction. Do not
rewrite these observations as a field performance pass or dismiss the slow runs.
The initial local harness URL mistake produced a cached 404 and was corrected;
404 pages were excluded, the generated ISR responses were pruned, both servers
restarted, and only the six successful Watch journeys enter the artifact.

Evidence: `docs/validation/recommendation-quality-followup/page-performance-matched.json`.
