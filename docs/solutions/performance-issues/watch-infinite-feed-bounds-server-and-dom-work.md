---
title: "Bound Watch infinite feeds at both the server and DOM layers"
date: "2026-08-21"
category: "performance-issues"
module: "apps/web Watch homepage and apps/admin collection feed"
problem_type: "performance_issue"
component: "frontend_stimulus"
symptoms:
  - "Every loaded collection carousel remained mounted, so DOM nodes, media previews, listeners, and heap grew with scroll depth"
  - "Generic nested collection hydration could perform work proportional to every child relation instead of the displayed cards"
  - "A speculative database index would have added rollout risk without improving the production-like query plan"
root_cause: "logic_error"
resolution_type: "code_fix"
severity: "high"
related_components:
  - "apps/web/src/components/sections/DynamicMediaCollection.tsx"
  - "apps/web/src/lib/dynamic-collection-feed.ts"
  - "apps/admin/src/services/video.service.ts"
tags:
  - "watch"
  - "infinite-scroll"
  - "dom-windowing"
  - "graphql"
  - "postgresql"
  - "query-bounding"
  - "intersection-observer"
  - "performance"
---

# Bound Watch infinite feeds at both the server and DOM layers

## Problem

An infinite collection feed has two independent growth axes. The browser can
retain every interactive carousel as the viewer scrolls, and the server can do
unbounded relation or per-card work for each page. Fixing only one axis leaves
the other free to grow.

CSS hiding is insufficient for the browser axis. Hidden carousels still retain
their DOM, React lifecycle, media resources, event listeners, and hydration
cost. Client windowing is also insufficient for the server axis because it does
not change the work required to produce the next page.

## Symptoms

- Long sessions accumulated interactive carousel subtrees and image/media work.
- Nested GraphQL fields could multiply database work with the number of cards.
- A new parent index looked plausible from the query shape but was not selected
  by PostgreSQL on the production-like snapshot.

## What Didn't Work

- `display: none` or CSS-only visibility did not release interactive subtrees.
- Keeping all card DOM and only pausing previews did not bound listeners or
  hydration work.
- Adding an index from static inspection alone would have increased migration
  and write-amplification risk without reducing the measured query time.

## Solution

Treat the feed as three bounded layers:

1. **Retained data:** Keep compact collection DTOs so upward scrolling can
   reconstruct an earlier carousel without refetching it.
2. **Mounted interaction:** Keep stable measured wrappers, but unmount distant
   carousel children into exact-height placeholders. Use viewport overscan,
   focus pinning, and saved carousel snap indexes so restoration is early,
   accessible, and geometrically stable.
3. **Page production:** Return a card-ready Admin projection with strict page
   and card limits in a fixed number of database statements. Cache normalized
   pages briefly on the server while leaving the browser response private and
   no-store.

The Watch implementation starts windowing after nine retained sections and
keeps at most ten observer-managed carousel subtrees mounted, plus any row that
contains focus. Mobile requests two parents with up to eight cards each;
desktop requests three parents with up to twelve. These values are validated at
both the browser route and Admin boundary.

For database changes, validate the real plan before adding an index:

```sql
EXPLAIN (ANALYZE, BUFFERS)
-- candidate parent cursor query

EXPLAIN (ANALYZE, BUFFERS)
-- bounded child relation query
```

On the production-like snapshot, the parent scan used the `video` primary key
and completed in 1.96 ms. Bounded child lookup used the existing
`video_relation_watch_children_order_idx` and completed in 0.11 ms. The proposed
new index was unused, so the feature shipped without a migration.

## Why This Works

Exact-height wrappers preserve vertical geometry while removing the expensive
interactive subtree. Retaining compact DTOs separates content history from DOM
lifetime, so reverse scrolling can restore content without another network
request. Focus pinning prevents accessibility regressions that a purely visual
viewport algorithm would introduce.

The flat Admin projection bounds server work before Web receives the data.
Strict profiles, response validation, cursor checks, and duplicate draining
keep pagination deterministic even when exclusions remove a full page. A short
server cache deduplicates identical requests without exposing shared browser or
edge caching.

Snapshot-backed `EXPLAIN ANALYZE` keeps schema changes evidence-driven. If an
existing access path already satisfies the bounded query, omitting a new index
is both faster to ship and safer for production writes.

## Prevention

- For any infinite or very long feed, set separate budgets for retained data,
  mounted interactive DOM, request payload, and database statements.
- Test that distant rows actually unmount; visual hiding is not a performance
  assertion.
- Preserve measured height and focused content before unmounting.
- Test reverse scroll and horizontal state restoration, not only downward load.
- Run production-like `EXPLAIN ANALYZE` before creating an index, and remove the
  migration when PostgreSQL does not use it.
- Measure initial SSR/hydration separately from long-session growth; a lazy feed
  can have a healthy first paint and still leak work with scroll depth.

## Related Issues

- `docs/solutions/mobile/android-lazy-section-viewport-gating-oom-fix.md`
- `docs/solutions/performance-issues/watch-transcript-eager-interactive-dom.md`
- `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`
- `docs/solutions/integration-issues/public-watch-server-actions-require-post-aware-edge-routing.md`
