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
- Keep desktop backdrop blur disabled and raise the header scrim opacity so the LIBRARY label remains legible over moving video.
- Make footer links, CTA pills, and compact carousel slide selectors at least 44px tall/wide with adequate spacing.
- Preserve layout, navigation behavior, and localized content.

## Verification

- Add component assertions for label scrim, header backdrop, and minimum touch target classes.
- Run focused category rail, footer, media collection, Watch section, carousel, and floating header tests, Web typecheck, lint, and formatting.
- Verify the change does not add page-loading work or impact media/network behavior.

## Completion Evidence

- Added a contrast scrim to all Watch category tile labels and increased the header gradient alpha while preserving the no-desktop-blur performance behavior.
- Footer navigation/contact controls, section and collection CTAs, and compact timeline selectors now meet 44px target sizing. Compact selectors use a 54px progress ring with a 3.5px outer margin; the mobile hero action row wraps below `sm` when needed.
- Original PR verification: focused category rail, footer, FloatingSearchProvider, Watch Home, and MediaCollection tests: 313 passed. Web typecheck, targeted ESLint, Prettier, and `git diff --check` passed.
- Original PR review record: Claude Code US Team review completed with layout concerns resolved; final review found no blockers. Independent review of the October 17 repair remains owned by the parent QA loop.
- The original CSS changes preserve runtime initialization and desktop backdrop blur remains disabled. This source inspection is not a measured page-load performance result.
- 2026-10-15 follow-up (QA N62a): the footer cookie settings trigger now shows the pointer cursor; its three-case test covers the cursor, 44px target, and settings event with return-focus target.
- 2026-10-17 isolated repair: rebased the exact published head `5da88b679` onto main `848ce82f8`. All 13 scoped source/test files match the merge of current main and the original PR; only the generated roadmap index conflicted. Six focused suites passed (391 tests), as did Web typecheck, targeted ESLint with zero warnings, UI-locale drift, Prettier, and `git diff --check`. No new rendering or initialization logic was authored, and no new browser/page-load measurement is claimed.
- 2026-10-17 N66 proposal verification: white on hero `brand-red` #ef3340 is 4.025:1 at rest and hover. Tailwind 4.2.4 stone-500 native names are 4.368:1 on black and 3.639:1 on the 10%-white hover surface. Inventory row numbers are 3.866:1 at rest and 3.392:1 on hover, accounting for the 3.5%-white group over stone-950 and the additional 5.5%-white row hover. These normal-sized labels miss the 4.5:1 AA threshold. N66 colors and hover treatment remain pending human design approval; this PR applies none of those proposals.
