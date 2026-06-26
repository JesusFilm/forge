---
id: "feat-211"
title: "Watch video relation loader performance"
owner: "vlad"
priority: "P1"
status: "in-progress"
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
