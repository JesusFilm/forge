---
id: "feat-738"
title: "Restore Watch recommendation cards with bounded retention throughput"
owner: "nisal"
priority: "P0"
status: "in-progress"
start_date: "2026-10-19"
duration: 1
depends_on: ["feat-737"]
blocks: []
tags: [recommendations, retention, postgres, reliability, web]
---

## Problem

The public Watch video recommendation row (`watch-below-player-v1`) is mounted
but receives `retention_overdue`. The index repairs restored successful cleanup,
but the five-episode page leaves approximately 9,800 overdue standalone playback
episodes and delays visible recovery for hours.

## Entry Points — Read These First

- `apps/admin/src/services/recommendations/retention.service.ts`
- `apps/admin/src/services/recommendations/retention-standalone.db.test.ts`
- `apps/web/src/components/recommendations/WatchSemanticRecommendations.tsx`
- `docs/roadmap/platform/feat-554-recommendation-storage-rollout-verification.md`

## Grep These

- `RECOMMENDATION_RETENTION_STANDALONE_EPISODE_PAGE_SIZE`
- `standaloneEpisodePageSize`
- `watch-below-player-v1`

## What To Build

Measure a larger bounded standalone page against the loaded PostgreSQL fixture
with the current indexes. Increase throughput only if expired requests still
progress and full cleanup succeeds inside the existing deadline. Verify the
actual public Watch row after deployment and backlog clearance.

Raise the standalone cap from five to 25. After the original five admissions,
stop admitting additional episodes when at most three seconds remain. Continue
request and profile cleanup, and schedule continuation even when the selected
standalone page was partial. Keep each episode's existing atomic transaction.

## Constraints

- Keep the five-second deadline, per-episode atomicity, expiry, dependency locks,
  truthful failure ledger and full retention health gate.
- Do not disable controls, fabricate recommendation cards, or alter the homepage flag.
- Use normal PR-to-main deployment. Do not manually delete production records.
- Preserve the original dirty checkout.

## Verification

- Native PostgreSQL mixed-backlog test reaches request roots and clears playback
  records more quickly, preserving live records and accurate committed counts.
- Slow-tail failure and phase-admission tests remain valid.
- CI, normal deployment, live retention outcomes and browser-visible cards.

## Evidence

- Public JESUS and How to Know God Personally Watch requests return HTTP 200
  with `unavailable/retention_overdue`; the actual below-player loading slot
  disappears without cards. This is `watch-below-player-v1`.
- Before: the native loaded fixture deleted five episodes in 1,199 ms.
- After: the larger cap deleted 25 episodes in 2,551 ms. With the time reserve
  and concurrent local typechecking, it deleted 23 in 2,543 ms and still cleared
  all 12 request roots and 100 expired profile runs.
- Clock-controlled regression proves fast full/partial pages, reduced work on
  slow pages, continued request cleanup, and continuation before expiry is overdue.
- Production recovery verification remains pending deployment and backlog clearance.
