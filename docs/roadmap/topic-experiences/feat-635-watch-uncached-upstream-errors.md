---
id: "feat-635"
title: "Keep transient Watch page failures out of shared cache"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
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
