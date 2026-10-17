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
- `apps/web/src/components/watch/WatchHeroOverlay.tsx`
- `apps/web/src/components/watch/WatchLanguageIndexBrowser.tsx`
- `apps/web/src/components/watch-language-inventory/LanguageInventoryPage.tsx` (`CompactVideoRow`)

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
- October 17 N66 design approval applies only to the shared hero primary action (`#d33a43` at rest and hover), native-language names (`#88817b`), and compact inventory ordinals (`#928a85`). Preserve same-fill hero hover, all backgrounds, typography, geometry, other accents, and global `brand-red`.

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
- 2026-10-17 N66 proposal baseline, before approval: white on hero `brand-red` #ef3340 is 4.025:1 at rest and hover. Tailwind 4.2.4 stone-500 native names are 4.368:1 on black and 3.639:1 on the 10%-white hover surface. Inventory row numbers are 3.866:1 at rest and 3.392:1 on hover, accounting for the 3.5%-white group over stone-950 and the additional 5.5%-white row hover. These normal-sized labels miss the 4.5:1 AA threshold. No proposal was applied before explicit design approval.
- 2026-10-17 N66 approval and implementation: the owner selected **H2 / N1 / R1, keep current hover**. The shared hero primary action now uses `#d33a43` at rest and hover (same-fill behavior), native-language names use `#88817b`, and `CompactVideoRow` ordinals use `#928a85`. No global tokens, other colors, hover backgrounds, sizes, markup, routing, or initialization changed. The existing shared hero treatment assertion was updated; no new color-mirroring tests were added.
- Approved contrast, verified independently from compiled CSS and browser-computed background layers: hero white text **4.713:1** at rest, hover, and focus; native names **5.473:1** at rest/focus and **4.559:1** on hover; ordinals **5.484:1** at rest/focus and **4.811:1** on hover. All exceed 4.5:1 for normal text. Focus adds no background change; hover retains the existing composited layers.
- Approved N66 validation: **462 tests across 11 focused suites passed**, including original navigation/cursor coverage and hero, language-index, inventory, thumbnail, and page-weight coverage. Web typecheck, targeted ESLint with zero warnings, UI-locale drift, Prettier, and `git diff --check` passed.
- Proportionate load-impact evidence: Tailwind 4.2.4 compiled the actual application stylesheet against the same 764 tracked Web/shared-player source files before and after. Only three color declarations were added; existing declarations and CSS URLs were unchanged. Minified CSS changed from 299,064 to 299,185 bytes (**+121 bytes**, **+27 gzip bytes**). The three components' emitted JavaScript byte counts were unchanged, and their sources/imports match after normalizing only the approved color strings. In a static browser fixture using production class strings and that CSS, all ten target rectangles/type measurements matched at 1280px and 390px; both variants requested one stylesheet and no scripts, fonts, or media.
- Performance limits: the CSS compilation and static surface fixture are **not a full-app trace or Next route bundle**. They do not measure application hydration, media startup, field LCP/CLS, or production transfer sizes. No cached Next build was used. Independent review, authoritative validation, and publication remain with the parent QA loop.

- Independent N66 review confirmed the approved style/cascade and contrast, and found one stale integration assertion in `HeroPlayer.test.tsx` still expecting the old red class. Only that existing assertion was updated. The complete affected HeroPlayer suite then passed **124 tests with one pre-existing todo**; the approved production colors were preserved. This supplements the 462 tests above.
