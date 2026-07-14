---
id: feat-218
title: Raise internal Watch route snapshot GraphQL rate budget
status: complete
lane: platform
depends_on:
  - feat-217
blocks: []
---

## Problem

After routing Web to Admin over Railway private networking, production Web logs
still show bursts of `You are trying to access 'watchVideoRouteSnapshotBySlug'
too often`. The single-video page uses this resolver for metadata and route
rendering, and ISR/crawler bursts can exceed the generic Admin GraphQL query
limit.

## Scope

- Give `Query.watchVideoRouteSnapshotBySlug` a higher per-minute read budget.
- Keep the generic query and mutation rate limits unchanged for other fields.
- Verify the Envelop field matcher does not overlap the specific route snapshot
  field and the catch-all query rule.

## Verification

1. `pnpm --filter @forge/admin test -- rate-limit`
2. Production web/admin logs stop showing route-snapshot 429 bursts after
   deployment.
