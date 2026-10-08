---
id: "feat-658"
title: "Restore Watch navigation contrast and touch target sizes"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - web
  - watch-page
  - accessibility
---

## Problem

Watch category tiles place white labels over unrestricted gradient backgrounds, the desktop header backdrop loses its blur and uses a low-opacity scrim over moving hero media, and multiple Watch controls are 36px or 20px tall.

## Entry Points

- `apps/web/src/components/home/WatchHomeCategoryRail.tsx`
- `apps/web/src/components/FloatingSearchProvider.tsx`
- `apps/web/src/components/home/WatchHomeFooter.tsx`
- `apps/web/src/components/home/WatchHomeTvCarousel.tsx`
- `apps/web/src/components/home/WatchHomeSection.tsx`
- `apps/web/src/components/sections/MediaCollection.tsx`

## Grep These

- `WATCH_HOME_CATEGORY_RAIL`
- `floating-header-backdrop`
- `watch-footer-navigation`
- `watch-home-current-progress`
- `data-testid="media-collection-cta"`
- `min-h-11`, `h-11 w-11`, `gap-2`

## Constraints

- Keep authored category gradients and existing navigation destinations; use an independent label scrim to protect contrast.
- Do not enable desktop backdrop blur over the moving hero media; meet contrast with the scrim alpha.
- Keep the compact progress ring outside the 44px control edge and size thumbnail sources to their rendered target.
- Preserve footer contact stacking while making its three actions 44px tall.
- Avoid runtime JavaScript, media requests, or routing changes; this is a CSS-only rendering adjustment.

## What To Build

- Add a dark text scrim on category tiles to preserve label contrast over authored gradients.
- Keep backdrop blur on desktop and raise the header scrim opacity so the LIBRARY label remains legible over moving video.
- Make footer links, CTA pills, and compact carousel slide selectors at least 44px tall/wide with adequate spacing.
- Preserve layout, navigation behavior, and localized content.

## Verification

- Add component assertions for label scrim, header backdrop, and minimum touch target classes.
- Run focused category rail, footer, media collection, Watch section, carousel, and floating header tests, Web typecheck, lint, and formatting.
- Verify the change does not add page-loading work or impact media/network behavior.

## Completion Evidence

- Added a contrast scrim to all Watch category tile labels and increased the header gradient alpha while preserving the no-desktop-blur performance behavior.
- Footer navigation/contact controls, section and collection CTAs, and compact timeline selectors now meet 44px target sizing. Compact selectors use a 54px progress ring with a 3.5px outer margin; the mobile hero action row wraps below `sm` when needed.
- Focused category rail, footer, FloatingSearchProvider, Watch Home, and MediaCollection tests: 313 passed. Web typecheck, targeted ESLint, Prettier, and `git diff --check` passed.
- Claude Code US Team review completed with layout concerns resolved; final review found no blockers.
- CSS-only visual changes add no JavaScript or network requests; desktop backdrop blur remains disabled to avoid added compositing work over moving hero video.
