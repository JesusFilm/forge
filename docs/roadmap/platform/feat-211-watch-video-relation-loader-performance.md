---
id: "feat-211"
title: "Watch video relation loader performance"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-26"
duration: 1
depends_on:
  - "feat-203"
blocks: []
tags:
  - "platform"
  - "admin"
  - "web"
  - "watch-page"
  - "performance"
  - "graphql"
---

## Problem

Production probes of the Watch single-video GraphQL snapshot still show
server-side latency around 8-11 seconds after the selected-dub projection
reduced payload size. Datadog traces show the remaining hot path includes many
`Video.findUniqueOrThrow` spans while resolving `VideoRelation.parent` and
`VideoRelation.child` for parent/sibling traversal.

## What To Build

- Resolve `VideoRelation.parent` and `VideoRelation.child` through the existing
  request-scoped `videoById` DataLoader instead of Pothos relation resolvers.
- Preserve the existing Admin GraphQL schema shape.
- Re-run the production watch snapshot probe after deploy to compare against
  the 2026-06-26 baseline.

## Baseline

Controlled production probe on `2026-06-26`:

- `life-of-jesus-gospel-of-john`, selected-dub projection:
  median `10277.0ms`, mean `9985.2ms`, p95 `11204.4ms`, `174.5 KiB`.
- `jesus`, selected-dub projection:
  median `9155.9ms`, mean `9422.0ms`, p95 `11151.7ms`, `264.2 KiB`.

Datadog trace `6a3df257000000007b3a2f866cecc214` showed repeated
`Video.findUniqueOrThrow` spans of roughly `1.6s` each during the current
selected-dub `jesus` request.

## Verification

- Focused Admin GraphQL tests pass.
- `pnpm --filter @forge/admin schema:print` produces no SDL drift.
- Admin typecheck/lint pass for the touched scope.
- After deployment, re-run
  `pnpm --filter @forge/web probe:watch-video-snapshot --slug jesus --language-slug english --locale en --runs 3 --warmup 0`
  and inspect Datadog for reduced `Video.findUniqueOrThrow` fanout.

## Completion Notes

- Merged PR #1382 as `807ac371` and deployed Admin production deployment
  `b4c659a7-cd81-41aa-9ae4-a9a343f51fc9`.
- Healthcheck passed at `https://admin.jesusfilm.org/api/health`.
- Alternating legacy/current probe after deploy:
  - `jesus`, selected-dub projection: median `7729.1ms`, mean `8721.2ms`,
    p95 `11276.2ms`, `264.2 KiB`.
  - Baseline median was `9155.9ms`, so the alternating probe showed a
    `15.6%` selected-dub median improvement.
- Selected-only probe using the live web route-snapshot document:
  - Runs: `6806.4ms`, `6907.1ms`, `5497.6ms`, `5767.7ms`, `8902.4ms`.
  - Median: `6806.4ms`, a `25.7%` improvement from the `9155.9ms` baseline.
- The page is still too slow. Datadog retained selected-only traces around
  `6.9s-8.0s` plus a tail above `10s`; the next optimization should collapse
  more of the Watch route snapshot into an Admin-owned projection or reduce the
  sibling/localized-copy relation traversal itself.
