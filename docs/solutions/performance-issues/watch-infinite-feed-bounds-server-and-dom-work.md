---
title: "Bound Watch infinite feeds at both the server and DOM layers"
date: "2026-08-21"
last_updated: "2026-08-26"
category: "performance-issues"
module: "apps/web Watch homepage and apps/admin collection feed"
problem_type: "performance_issue"
component: "frontend_stimulus"
symptoms:
  - "Every loaded collection carousel remained mounted, so DOM nodes, media previews, listeners, and heap grew with scroll depth"
  - "Generic nested collection hydration could perform work proportional to every child relation instead of the displayed cards"
  - "Identical collection batches expired from the shared server cache after 60 seconds, while oversized child-slug exclusions could make draft requests fail before Admin was called"
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
- Treating every featured child Video slug as a parent-collection exclusion
  inflated the request URL without changing which parent collections were
  eligible.
- A one-minute shared cache still sent stable, identical batches back through
  Web and Admin throughout normal viewing traffic.
- Adding an index from static inspection alone would have increased migration
  and write-amplification risk without reducing the measured query time.

## Solution

Treat the feed as four bounded layers:

1. **Retained data:** Keep compact collection DTOs so upward scrolling can
   reconstruct an earlier carousel without refetching it.
2. **Mounted interaction:** Keep stable measured wrappers, but unmount distant
   carousel children into exact-height placeholders. Use viewport overscan,
   focus pinning, and saved carousel snap indexes so restoration is early,
   accessible, and geometrically stable.
3. **Page production:** Return a card-ready Admin projection with strict page
   and card limits in one bounded SQL transaction.
4. **Shared delivery cache:** Key normalized page batches only by content
   inputs, use separate live and preview cache namespaces, and retain live
   batches for 24 hours in the Railway-backed Next Data Cache. Keep browser
   responses `no-store`; optionally cache only successful live JSON responses
   at Cloudflare for six hours with a 24-hour stale-while-revalidate window.
   Purge both the Next tags and the Cloudflare cache tag when relevant Watch
   content is revalidated. Admit only server-issued HMAC-bound variants to the
   long-lived origin cache, and require exact canonical query serialization
   before emitting edge headers so a public caller cannot manufacture
   high-cardinality Redis or Cloudflare objects.

The Watch implementation starts windowing after nine retained sections and
keeps at most ten observer-managed carousel subtrees mounted, plus any row that
contains focus. Mobile requests two parents with up to eight cards each;
desktop requests three parents with up to twelve. These values are validated at
both the browser route and Admin boundary.

The dynamic feed remains an editor-authored `MediaCollectionBlock` in the
Experience block sequence. Web may locate that block to derive bounded
exclusions and initial cache signatures, but it renders `normalized.blocks` in
their authored order. The editor hint can recommend placing the feed last;
runtime code must not extract and reappend it, because doing so silently
overrides the Experience's ordering contract.

Only parent collection slugs and child or explicitly configured Video IDs
belong in the initial exclusion identity. Child Video IDs remain useful for
excluding cards, but child Video slugs must not be serialized as parent
collection slugs. That keeps otherwise identical viewers on the same bounded
cache key and avoids URL-size failures in draft previews.

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
keep pagination deterministic even when exclusions remove a full page. The
shared cache identity contains locale, language, cursor, normalized exclusions,
and the device page profile—never cookies, authentication, IP address, or a
viewer identifier—so identical users reuse one batch. The server signs that
identity for the initial mobile and desktop requests and returns the next
cursor signature in a response header. Invalid, unsigned, reordered, or
alternately encoded requests can use the bounded fallback but cannot create
long-lived shared variants. A separate preview scope prevents draft traffic
from warming the longer-lived live namespace.

Keeping browser caching disabled avoids stale per-device state and makes the
browser always consult the shared delivery layer. The optional Cloudflare layer
is enabled only when cache-tag purge credentials are present, so long-lived edge
objects never exist without a publication-time invalidation path.

Snapshot-backed `EXPLAIN ANALYZE` keeps schema changes evidence-driven. If an
existing access path already satisfies the bounded query, omitting a new index
is both faster to ship and safer for production writes.

## Prevention

- For any infinite or very long feed, set separate budgets for retained data,
  mounted interactive DOM, request payload, database statements, and shared
  cache lifetime.
- Test that distant rows actually unmount; visual hiding is not a performance
  assertion.
- Preserve measured height and focused content before unmounting.
- Test reverse scroll and horizontal state restoration, not only downward load.
- Run production-like `EXPLAIN ANALYZE` before creating an index, and remove the
  migration when PostgreSQL does not use it.
- Build shared cache keys only from normalized content inputs. Separate draft
  and live namespaces, and test publication-time invalidation before extending
  retention.
- Treat dynamic feed placement as authored Experience data. Test its order
  against neighboring blocks instead of moving it to satisfy a layout hint.
- A public cache endpoint needs an admission proof as well as input bounds.
  Bind every long-lived variant to a server-issued signature and require an
  exact canonical URL before CDN admission; a maximum URL length alone still
  permits high-cardinality cache amplification.
- If an edge cache is optional, emit cacheable edge headers only when its purge
  path is fully configured; keep errors and preview responses out of that cache.
- Measure initial SSR/hydration separately from long-session growth; a lazy feed
  can have a healthy first paint and still leak work with scroll depth.

## Related Issues

- `docs/solutions/mobile/android-lazy-section-viewport-gating-oom-fix.md`
- `docs/solutions/performance-issues/watch-transcript-eager-interactive-dom.md`
- `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`
- `docs/solutions/integration-issues/public-watch-server-actions-require-post-aware-edge-routing.md`
