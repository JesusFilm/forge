---
id: "feat-664"
title: "Window off-screen authored Watch collection rails"
owner: "urim"
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
---

## Problem

The dynamic Watch collection feed already windows its rows, but authored static `MediaCollection` sections on `/watch` all render their cards after hydration. Production currently emits 9 static sections and 62 video cards; a 1280×800 browser reports 1,219 DOM elements. The listing audit reported 1,379 nodes and 45 ms style recalculation affecting 1,254 elements. Reduce the active DOM for distant authored rows while preserving SSR markup, scroll geometry, and keyboard/screen-reader access.

## Entry Points — Read These First

- `apps/web/src/components/sections/MediaCollection.tsx` — static authored section markup, card grids, carousel state.
- `apps/web/src/components/sections/MediaCollection.test.tsx` — component rendering and carousel behavior.
- `apps/web/src/components/home/WatchHomeExperiencePage.tsx` — home section rendering context.
- `apps/web/src/components/sections/index.tsx` — Admin block renderer and explicit windowing prop.
- `apps/web/src/lib/watch-section-styles.ts` — shared section spacing.
- `docs/solutions/conventions/frontend-change-page-load-performance-verification.md` — before/after measurements.

## What To Build

- Add opt-in windowing for authored static collection rows on the Watch home route; do not affect collection sections on video or preview routes.
- Preserve full SSR output and initial hydration. After hydration, observe each section and unmount only distant card content after measuring its rendered block size.
- Keep the outer section and accessible heading/summary in the DOM. Preserve measured row height while card content is absent, remount before the row approaches the viewport, and restore the active carousel snap.
- Never unmount a row containing focus. Make a collapsed shell focusable and named; focus must remount the cards. If `IntersectionObserver` or `ResizeObserver` is unavailable, leave content mounted.
- Cover off-screen collapse, scroll-approach remount, focus pinning, unsupported observer fallback, and carousel snap restoration in `MediaCollection.test.tsx`.

## Constraints

- Keep dynamic collection feed windowing unchanged.
- Keep `MediaCollection` default behavior unchanged outside Watch home.
- Do not hide or omit content from server-rendered HTML.
- Preserve card links, `aria` relationships, and the root section heading while collapsed.
- Use production rendering measurements and the same 1280×800 viewport for before/after comparison; do not claim DOM-size reduction from CSS `content-visibility` alone.

## Verification

- Run focused `MediaCollection.test.tsx` and the Watch home renderer tests.
- Run Web typecheck, targeted ESLint, Prettier, and `git diff --check`.
- Measure production and local implementation at 1280×800: DOM element count, mounted card count, document height/section geometry, layout/style timing or trace evidence, and ensure no CLS/scroll regression when distant sections mount.
- Review with Claude Code using the verified NZ Team profile.

## Completion Evidence

Implementation is in draft [PR #2675](https://github.com/JesusFilm/forge/pull/2675). The production baseline was captured at a 1280×800 viewport setting (browser CSS viewport 1402×877): 9 authored collection sections, 62 cards, and 1,219 DOM elements. A local before/after browser comparison could not be collected: the CI env points Admin GraphQL and the Watch route manifest to `localhost:1437`, where no service is running; the local `/watch` page consequently renders no authored collections. A deterministic fixture route also could not be exercised because the Watch proxy canonicalizes unknown slugs through the unavailable route manifest and returns 404. No DOM or rendering performance improvement is claimed until a valid same-data local comparison is available.

Focused verification: 80 component tests pass, including shell focus handoff, mobile horizontal scroll restoration, observer fallback, prop-off recovery, and authored home opt-in. Web typecheck, targeted ESLint, Prettier, and `git diff --check` pass. Draft PR remains partial pending browser measurement evidence.
