---
title: "Watch parent container width drift across route families"
date: "2026-07-15"
category: ui-bugs
module: apps/web
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "At a 2200px viewport, the Watch language index used a 1792px frame while Watch home used the canonical 1920px frame"
  - "Language inventory and history stopped at narrower route-local caps, while series sections could exceed the canonical frame"
  - "Navigating among Watch route families caused visible horizontal edge shifts on wide displays"
root_cause: logic_error
resolution_type: code_fix
severity: medium
related_components:
  - "apps/web/src/lib/content-width.ts"
  - "apps/web/src/components/watch/WatchLanguageIndexBrowser.tsx"
  - "apps/web/src/components/watch-language-inventory/LanguageInventoryPage.tsx"
  - "apps/web/src/app/[locale]/[htmlLang]/history/page.tsx"
  - "apps/web/src/components/watch/SeriesPageClient.tsx"
  - "apps/web/src/components/watch/SeriesEpisodesGrid.tsx"
  - "apps/web/src/components/watch/SeriesHero.tsx"
tags:
  - "watch-page"
  - "responsive-layout"
  - "container-width"
  - "ultrawide"
  - "tailwind"
  - "shared-token"
---

# Watch parent container width drift across route families

## Problem

Public Watch routes did not enforce one parent-frame contract. At a 2200px
viewport, production `/watch/languages` measured 1792px wide while Watch home
measured 1920px. Language inventory and history also used narrower local caps,
while series metadata, episodes, and a static-hero overlay had no canonical
maximum.

The correct contract already existed in
`apps/web/src/lib/content-width.ts`: `WATCH_PAGE_CONTENT_CLASSES` composes the
centered `max-w-[1920px]` frame with the canonical Watch rail
(`px-5 md:px-16 xl:px-24`). The bug was consumer drift across both the maximum
width and the inner content edge.

## What Didn't Work

- Changing the shared maximum would not fix wrappers that bypassed it.
- Fixing only `/watch/languages` would leave inventory, history, and series
  sections visibly inconsistent.
- Applying only `CONTENT_WIDTH_ALIGN_CLASSES` fixed ultrawide maximums but did
  not fix desktop geometry. At 1280px, Languages still started at 32px while
  home and single-video content started at 96px.
- Replacing every descendant `max-w-*` class would damage intentional reading
  widths and full-bleed media. Parent alignment and inner component geometry
  are separate concerns.
- Class-token coverage alone cannot prove computed geometry. Compare the
  reference and migrated routes at representative desktop and ultrawide
  viewports with `getBoundingClientRect()`.

## Solution

Apply `WATCH_PAGE_CONTENT_CLASSES` to every content-bearing primary Watch
parent or section that should share the home and single-video content edge:

```tsx
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"

export function WatchSection() {
  return <section className={`${WATCH_PAGE_CONTENT_CLASSES} ...`}>...</section>
}
```

The migration covers the language index root, all language-inventory frames,
the history content wrapper, series metadata, and the episode section. The
static-hero overlay anchor keeps the padding-free alignment helper because its
absolutely positioned child owns the shared left rail. Both the fallback and
the visible series-page overlay use the canonical mobile, desktop, and
ultrawide left offsets. Local typography limits and the static hero's
full-bleed media wrapper remain unchanged.

Focused tests enforce the exact contract rather than accepting any arbitrary
maximum-width class:

- `apps/web/src/lib/__tests__/content-width.test.ts` requires the shared helper
  to contain exactly `max-w-[1920px]`.
- `apps/web/src/components/watch/WatchLanguageIndexBrowser.test.tsx` checks the
  language-index root.
- `apps/web/src/app/[locale]/[htmlLang]/videos/[languageSlug]/page.test.tsx`
  enumerates eight independently rendered inventory frames and requires the
  exact shared maximum on each one.
- History, series metadata, episodes, and the static-hero overlay have matching
  exact-token assertions in their component or route tests.

The implementation is tracked in
[PR #1585](https://github.com/JesusFilm/forge/pull/1585).

## Why This Works

All audited content-bearing primary frames now obtain centering, full width,
the maximum width, and the responsive inner rail from one helper. A route
cannot silently choose a narrower cap or a different content edge.

Keeping the frame contract separate from descendant geometry preserves useful
exceptions: prose can remain narrow for readability, cards and carousels keep
their own sizing, and media designed to bleed to the viewport stays uncapped.
Only the content-alignment anchor receives the shared frame.

## Prevention

- Use `WATCH_PAGE_CONTENT_CLASSES` for new content-bearing public Watch parents
  and sections that should align with home and single-video content. Reserve
  `CONTENT_WIDTH_ALIGN_CLASSES` for deliberately padding-free media or overlay
  anchors whose descendants own the Watch rail.
- Keep intentional descendant limits and full-bleed media explicit. The shared
  frame belongs at the content boundary, not on every nested node.
- When changing or auditing the shared frame, grep Watch routes for inline
  `max-w-*` classes and inspect uncapped primary wrappers as well as imports of
  the helper.
- Test every independently rendered frame. Extract all `max-w-*` tokens and
  compare them with exactly `["max-w-[1920px]"]`; negative assertions for
  replaced caps such as `max-w-7xl` or `max-w-5xl` make drift easier to spot.
- Keep carousel bleed in the shared Watch contract so its negative margins and
  re-applied padding stay paired with the responsive rail.
- When browser access is available, measure representative mobile, desktop,
  and ultrawide routes with `getBoundingClientRect()` instead of relying only on
  screenshots.
- Continue the frontend performance gate. This fix changes static class
  composition only and adds no request, dependency, effect, listener,
  hydration boundary, or client-side initialization.

## Related Issues

- [Grep for inline tier copies before bumping shared layout-token tuples](../conventions/grep-inline-tier-copies-before-bumping-shared-layout-tokens-2026-05-05.md)
  documents the broader open-coded-token drift pattern.
- [Embla carousel bleed-alignment port pattern](../design-patterns/embla-carousel-bleed-alignment-port-pattern-20260508.md)
  explains how the canonical frame coexists with intentional carousel bleed.
- [Measurement-driven layout iteration via Chrome MCP](../developer-experience/measurement-driven-layout-iteration-chrome-mcp-20260505.md)
  provides the numerical geometry-verification workflow.
- [Frontend changes require page-load performance verification](../conventions/frontend-change-page-load-performance-verification.md)
  defines the required risk-matched performance evidence.
- [Roadmap ticket feat-263](../../roadmap/platform/feat-263-watch-container-width-consistency.md)
  records the implementation scope and verification contract.
