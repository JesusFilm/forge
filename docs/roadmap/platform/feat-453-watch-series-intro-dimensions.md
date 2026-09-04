---
id: "feat-453"
title: "Align Watch series intro dimensions"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-09-04"
completed_date: "2026-09-04"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "ui"
---

## Problem

Static Watch series pages such as `/watch/impulses-for-the-way.html` use an
uncapped `aspect-video` hero. On wide displays that makes the intro taller than
the viewport, while muted single-video pages and the Watch homepage use a
bounded intro that leaves the next page content within reach.

## Entry Points — Read These First

1. `apps/web/src/components/watch/SeriesHero.tsx` — trailer and static series
   hero branches.
2. `apps/web/src/components/home/WatchHomeTvCarousel.tsx` — muted Watch home
   intro sizing.
3. `apps/web/src/lib/watch-home-hero-fit.ts` — shared fallback and measured
   Watch home hero sizing rules.
4. `apps/web/src/components/watch/__tests__/SeriesHero.test.tsx` — static and
   playable series hero coverage.

## Grep These

- `series-hero-static`
- `aspect-video`
- `h-[max(34svh`
- `WATCH_MUTED_INTRO_HEIGHT_CLASS`

## What To Build

1. Give static series heroes the same responsive muted-intro dimensions used
   by Watch home.
2. Keep the existing sticky positioning, artwork crop, darkening treatment,
   overlay anchor, and playable-trailer behavior.
3. Keep the sizing expression shared so series and home cannot drift.
4. Add focused regression coverage for the bounded static hero class.

## Constraints

- Do not change series content, routing, playback, downloads, sharing, or
  language selection.
- Do not add media requests, client effects, dependencies, or runtime layout
  measurement to the static series path.
- Preserve the existing mobile floor and desktop 16:9 cap.

## Verification

- `src/components/home/__tests__/WatchHomePage.test.tsx`,
  `src/components/watch/__tests__/SeriesHero.test.tsx`, and
  `src/lib/watch-home-hero-fit.test.ts` — 46 tests passed.
- `pnpm --filter @forge/web typecheck` — passed.
- `pnpm --filter @forge/web lint` — passed, including the generated UI locale
  check.
- Touched-file Prettier check and `git diff --check` — passed.
- Production-browser measurement confirmed the reported static series page
  used a 2,521×1,418px `aspect-video` intro in a 2,536×1,303px viewport. The
  shared desktop muted-intro rule caps that layout to 863px, while an
  aspect-limited 1,261×1,247px comparison measured the home and single-video
  intros at the same 709px height.
- Local browser smoke at `/watch/impulses-for-the-way.html` passed against the
  active branch on port 3011. At 2,536×1,247px the static series intro measured
  807px high, and the metadata plus first episode row were visible in the first
  viewport.
- Responsive Chromium captures passed at 390×844px, 320×700px, and
  1,920×1,080px. Mobile keeps the full title and action controls inside the
  hero; desktop retains its side-by-side overlay band.
- Breakpoint-edge geometry checks at 359/360px and 767/768px also passed: no
  horizontal overflow, all controls remained contained, and bottom clearance
  changed at the intended boundaries (8px, 20px, then 40px).
- Load-window browser checks reported zero layout-shift score and no console
  errors at every measured viewport. The poster retained `object-fit: cover`.
- Loading-performance review: the change only reuses an existing static class
  string. It adds no request, media asset, dependency, effect, measurement,
  hydration work, or serialized page data.

## Completion Notes

- Extracted the Watch home muted-intro fallback classes into
  `WATCH_MUTED_INTRO_HEIGHT_CLASS`.
- Applied that same contract to static series heroes and removed their
  unbounded `aspect-video` height.
- Playable series trailers still delegate to `HeroPlayer`; sticky positioning,
  image cropping, darkening, and overlay behavior are unchanged.
- Reflowed the series overlay on phones so action pills cannot squeeze the
  title, and added a narrow-phone icon-only Share treatment that preserves its
  accessible name.
- Increased the standard mobile inset below the hero actions to 20px while
  retaining the compact 8px inset below 360px to avoid header collisions.
- Constrained long localized download labels to the available mobile pill width
  while preserving the full translated accessible name.
