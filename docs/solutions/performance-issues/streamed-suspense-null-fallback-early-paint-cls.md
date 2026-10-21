---
title: "Null Suspense fallbacks let later inline content paint early, then shift, while React streams"
date: "2026-10-21"
category: "performance-issues"
module: "apps/web Watch page"
problem_type: "performance_issue"
component: "frontend_rendering"
severity: "medium"
applies_when:
  - "A list of sibling Suspense boundaries uses fallback={null} and is followed by small blocks or page sections"
  - "Field CLS names an element that sits just below an above-the-fold block and moves off screen without scrolling"
  - "A layout-shift reproduces only in some throttled runs"
tags: [cls, suspense, streaming, ssr, react, layout-shift, scroll-anchoring]
related_components: [apps/web]
---

# Null Suspense fallbacks let later inline content paint early, then shift, while React streams

## Problem

Mobile Watch views sometimes scored CLS ≈ 0.34: the recommendation slot and
transcript painted directly under the player, then moved off screen about
300 ms later without any scroll (feat-776). It reproduced in roughly 1 run in
3 to 1 in 12, depending on the session.

## Root cause

React's streaming server renderer does not only stream boundaries that
suspend. A completed Suspense boundary whose HTML is large is written as a
separate hidden segment (`<div hidden id="S:n">`) and swapped in by the inline
`$RC`/`$RV` script; small boundaries stay inline in their parent segment.
Reveals are batched: the first batch waits for a frame, later ones are held
until 300 ms after the previous reveal (a batch queued between 2.0 and 2.3 s
after navigation start is held until 2.3 s instead; read from the inline
script React emits, React DOM in Next.js 16.3.8). So a page can paint with some segments revealed
and later ones still pending.

On Watch, every body block had its own boundary with `fallback={null}`. The
hero, carousel, `WatchBody` and Bible Quotes were large enough to be streamed
as segments; the recommendation slot was small and stayed inline, and the
transcript and footer rendered after the body zone. When the hero landed in an
earlier batch than the carousel and `WatchBody`, the null fallbacks reserved no
space, so the slot and transcript painted right under the hero. The next batch
pushed them away. The timing race is why it only happened in some runs.

## Fix

Give each streamed body block a fallback that reserves one viewport height,
rendered only from the server snapshot of `useSyncExternalStore` so a fallback
first rendered on the client keeps the old empty behaviour:

```tsx
function BodyBlockStreamingFallback() {
  const streaming = useSyncExternalStore(
    subscribeNever,
    () => false,
    () => true,
  )
  if (!streaming) return null
  return <div aria-hidden="true" className="min-h-screen" />
}
```

Later content starts below the fold until it reaches its final position.
Rejected: removing the boundaries or batching the hero with the body (delays
LCP in exactly the runs that hit the race); sizing each fallback to its block
(body heights depend on content and language).

## How to find it

- Wrap `window.$RV` (and optionally `$RC`) in an init script to log each reveal
  batch's segment ids, and record element tops every animation frame. A
  shifting run shows two batches, for example `[S:0,S:1]` then `[S:2,S:3,S:4]`.
- Force the worst case by revealing every segment as soon as `$RC` queues it;
  the race then reproduces in every run.
- Freeze the state by serving the real HTML cut just before the first pending
  segment (`<div hidden id="S:2"`). This works in Firefox too.

## Related trap: a full-size absolute layer disables scroll anchoring

A decorative `absolute inset-0` layer that is the first child of a tall
container is picked as the scroll anchor. It never moves when content above
the reader changes height, so native scroll anchoring does nothing, and when
anything adjusts the scroll the whole painted layer counts as a layout shift.
Minimal repro: CLS 0 without the layer, 1.0 with it, 0 again with
`overflow-anchor: none` on the layer. Watch's `watch-body-texture` has this
shape; see the #2845 review.
