---
id: "feat-699"
title: "Keep transient Watch lookup failures out of shared Data Cache"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks:
  - "feat-700"
tags:
  - "web"
  - "watch"
  - "caching"
  - "reliability"
---

## Goal

Do not cache upstream failures from Watch homepage or curated Experience resolution; retain successful page and JSON-safe missing-page caching.

## Entry points

- `apps/web/src/lib/content.ts`
- `apps/web/src/lib/content.test.ts`

## Constraints

- Catch failures outside `unstable_cache`, inside the request-scoped React cache wrapper.
- Preserve the shared cache for successful pages and intentional missing-page results.
- Preserve the original error message and shape for the caller.

## Verification

- Simulate an `unstable_cache` that caches successful results but does not cache thrown errors.
- Verify both homepage and curated Experience calls recover on a second request after a transient first failure.
- Run focused content tests, Web typecheck and lint.

## Tracking

- Linear: FGE-172

## Acceptance boundary and verified outcome

This ticket completes only the two content lookup helpers. Catching failures outside `unstable_cache` lets later requests retry; successful and intentional missing-content results retain their cache keys, tags and 60-second TTL. The 57 resolver tests, actual Next 16.3.8 production-mode Data Cache fixture and native local browser verify that boundary. Reverting the runtime to main fails exactly the two recovery tests.

Returned error JSX can still enter the separate HTML/ISR cache. `feat-700` records that plan-only follow-up; FGE-172 remains open. No renderer changes, blanket cache disable or production fault were introduced. Synthetic cached endpoint timing preserved healthy cache hits, but is not a full-page benchmark.

The original unpublished roadmap ID `feat-635` was replaced by `feat-699` after refreshing all open PR branches and main for publication, per the review receipt's fresh-allocation requirement. This does not claim a collision with main; main had no `feat-635` ticket.
