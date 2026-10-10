---
id: "feat-664"
title: "Window off-screen authored Watch collection rails"
owner: "urim"
priority: "P2"
status: "complete"
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

### October 9 follow-through

Current production `/watch` at an actual 1280×800 CSS viewport still renders 9 authored sections and 62 cards (1,220 total DOM elements), including distant rows beginning at y=1,296 through y=6,083. This validates retained off-screen DOM, not the historical 45–54 ms style cost. CSS `content-visibility` alone would not remove those nodes.

The NZ Team Claude Code review found that rounding the measured card-region height up to whole pixels grew collapsed shells by up to one pixel per row. Preserve the fractional height instead. The new regression test fails with the old rounding (`424.4px` expected, `425px` received) and passes after the fix. Focused component/home verification now passes 81 tests; Web typecheck, targeted ESLint, Prettier and diff checks pass. The roadmap index formatting failure is fixed.

A temporary Vite harness now mounts the actual component and real Tailwind styles with identical fixture data for both windowing modes, bypassing the unavailable Admin service and Next route canonicalizer. This is component evidence only: image/link/translation/env adapters are stubbed and it does not exercise Watch SSR/hydration or full-page loading. T3 preview evaluation works, but snapshots fail and a separate control IntersectionObserver, ResizeObserver and requestAnimationFrame never deliver callbacks; both modes consequently retain their initial DOM in that browser. Do not interpret that stalled lifecycle as an application defect or claim full-page performance clearance. Keep the PR draft until a functioning browser can compare the actual Watch route with the same data, including load work, row mount/unmount geometry and layout shifts.

### Full Watch runtime acceptance

The Admin runtime blocker was overcome using an existing authenticated read-only consumer. Two isolated production Next builds served the actual Watch homepage with the same authored data: the control disables only the static-row opt-in, while the enabled build uses PR head `0e1d75abd`. Node 24.19.0 and Chromium 152.0.7977.82, actual 1280×800/DPR 1 (mobile 390×844), separate local caches, no shared Redis, and no production mutations or deploys. Temporary source/config overrides and private credential files were removed.

Settled DOM falls from 1,224 to 641 elements, with mounted cards falling from 62 to 4 and eight distant rows collapsed. Full keyboard traversal reaches all nine rows with identical card order; focused rows stay mounted until blur. Desktop document height remains 7,601 pixels through full down/up scrolling; mobile height stays 8,196 pixels. No visible shell remains collapsed. Desktop scroll-window CLS is 0.00457 in the control and 0.00458 with windowing; mobile scroll CLS is zero. A mobile grid's 268-pixel horizontal scroll position survives an actual collapse/remount.

Eight alternating local load samples show median FCP 226→222 ms, card React hydration 433→411.5 ms, and load 260.5→264 ms. Script transfer bytes are unchanged (848,776→848,775). Four diagnostic pairs at 4× CPU show median hydration 1,554→1,488 ms. No material initial render/load regression appears in these local samples, but no page-load speedup or statistical equivalence is claimed: six-second long-task totals have medians 144→169.5 ms, and latest LCP candidate medians 842→916 ms amid existing hero/media variability. These local results do not reproduce Railway/Cloudflare or establish the historical 45–54 ms style cost.

Sanitized metrics and screenshots are retained at `/tmp/watch-fge-230-runtime-evidence/`; the full runtime report is `/tmp/watch-fge-230-runtime-report.md`. The real-route evidence supersedes the earlier fixture and unavailable-browser blocker. Implementation and performance acceptance are complete; GitHub review and merge remain separate.
