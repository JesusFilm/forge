---
id: "feat-631"
title: "Gate Watch home hero CTA and category rail prefetch on touch"
owner: "vlad"
priority: "P2"
status: "in-progress"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "performance"
linear_issue: "FGE-215"
---

## Problem

From the 2026-09-13 `/watch` listing audit, item W-025 (Linear FGE-215). At
390px on Slow 4G, about 20 speculative `?_rsc=` document prefetches fire in
the first seconds of the Watch home (`/watch/lumo.html` x7,
`/watch/jesus.html` x4, `/watch/english.html/videos` x5). The hero "Watch
Now" `<Link>` has no `prefetch` prop and re-targets on every hero advance, and
the 13 category-rail tiles plus the rail's "See all" link are also ungated.
Touch users on slow connections pay for pages they never asked for while the
intro video is still buffering.

`MediaCollection`'s card latch (`prefetchArmed`) already does the opposite:
prefetch stays off until a real intent signal.

## Entry Points — Read These First

1. `apps/web/src/components/home/useTouchGatedPrefetch.ts` — shared latch:
   off on first render, arms on focus or mouse `pointermove`, and arms right
   after mount when `(hover: hover) and (pointer: fine)` matches.
2. `apps/web/src/components/home/WatchHomeTvCarousel.tsx` — `PrimaryAction`
   (the hero "Watch Now" link).
3. `apps/web/src/components/home/WatchHomeCategoryRail.tsx` —
   `PrefetchGatedLink`, one latch per link (tiles and "See all").
4. `apps/web/src/components/sections/MediaCollection.tsx` — `VideoCard`
   `prefetchArmed`, the pattern this follows.
5. `docs/solutions/best-practices/next-link-props-unobservable-three-vacuous-test-traps.md`
   — why `prefetch` must be asserted through a mocked `next/link`.

## Grep These

- `useTouchGatedPrefetch`
- `PrefetchGatedLink`
- `HOVER_CAPABLE_POINTER_QUERY`
- `prefetchArmed`

## What To Build

```ts
export function useTouchGatedPrefetch(): {
  prefetch: false | undefined // false until armed; undefined = default strategy
  onFocus: () => void
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void
}
```

- Touch / coarse pointer: links ship `prefetch={false}`; focus (tap or Tab)
  arms only the focused link; touch `pointermove` never arms.
- Hover-capable desktop: arms after mount, keeping the previous eager posture
  of these bounded links.
- No `matchMedia`: treated as touch (fail closed).
- External category tiles stay plain `<a target="_blank">`.

## Constraints

- Do not change `MediaCollection`'s card latch; it stays intent-gated on every
  device because it is an unbounded feed.
- Do not use one rail-wide latch: a single tap must not prefetch all 13 tiles.
- Do not remove `next/link` from these surfaces; client-side navigation stays.

## Follow-up (not in this ticket)

- Once armed (desktop, or after focus on touch), the hero "Watch Now" href
  still carries `t=<whole seconds>` from `appendAutoplaySignal`, so it
  re-targets about once a second during playback and may schedule a new
  prefetch each time (Next's prefetch cache key includes the query string).
  Pre-existing desktop behaviour; confirm with a `next start` network trace
  before fixing (e.g. a stable href with `t` added at click time).

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/home`
- `apps/web/src/components/home/__tests__/WatchHomeCategoryRail.prefetch.test.tsx`
  and `WatchHomeTvCarousel.prefetch.test.tsx` pin touch-off, desktop-eager,
  focus-arms, touch-move-does-not-arm; each guard was falsified once.
- Prefetch is disabled in `next dev`, so any browser check of `?_rsc=`
  requests must run under `next build` + `next start` at a touch viewport.
