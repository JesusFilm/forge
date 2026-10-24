---
id: "feat-764"
title: "Fit the Watch header search label on phones and keep keyboard focus visible"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-10-20"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "ui"
  - "accessibility"
---

## Problem

Round-04 design + mobile audit, production, 2026-10-20 (headless Chromium
viewport emulation; native T3 preview for the focus checks):

- **Header search label clipped on phones.** The pill reads "Search vi…"
  on every Watch page at 320 px (86 of 113 px available) and "Sear…" on the
  home page, whose full wordmark leaves the label 50 px. At 390 px the home
  label is still 1 px short.
- **Feedback launcher covers keyboard focus.** The launcher is fixed
  bottom-left (`left-4 bottom-4`, 34 px). Tab scrolls the next footer link
  to the viewport's bottom edge, so at 320 px the focused link sits 12–28%
  under the launcher ("Share" 12%, the Jesus Film logo link 28%). Evidence:
  `round-04/screens/01-episode-320-footer-share-focus-under-launcher.png`.
- **Underline-only focus on the collection link.** The "← JESUS" parent link
  above chapter rails sets `focus-visible:outline-none` and only underlines,
  which is the same as its hover style.

## Entry Points — Read These First

1. `apps/web/src/components/FloatingSearchField.tsx` — `FloatingSearchFieldButton`.
2. `apps/web/src/components/FloatingSearchBar.tsx` — label props.
3. `apps/web/src/app/globals.css` — base `html` rule.
4. `apps/web/src/components/watch/SiblingCarousel.tsx` — parent title link.
5. `apps/web/src/components/FeedbackLauncher.tsx` — launcher geometry.

## Grep These

- `mobileDisplay`
- `floating-search-mobile-label`
- `scroll-padding-bottom`
- `sibling-carousel-parent-title`

## What To Build

- Below `sm` the pill uses `px-4 gap-2`. The phone label slot is a CSS
  container: it shows "Search videos" (`FloatingSearch.openSearch`) when the
  slot is at least 7.5rem wide, else the existing short
  `FloatingSearch.submitSearch` ("Search"). No new catalog keys. The accessible
  name stays "Search videos".
- `html { scroll-padding-bottom: calc(4rem + env(safe-area-inset-bottom)) }`
  so focus and in-page jumps stop above the launcher.
- The parent title link keeps its underline and adds an inset 2px white
  ring. The ring is inset because the truncating parent clips overflow.

## Constraints

- Do not hide or move the feedback launcher. It stays reachable.
- Do not change the home wordmark (a brand choice).
- Do not add catalog keys or hardcoded English.

## Verification

- `vitest run src/app/globals.test.ts src/components/__tests__/FloatingSearchProvider.test.tsx src/components/watch/__tests__/SiblingCarousel.test.tsx`
- Browser (local fixture with the real header, footer and `SiblingCarousel`),
  320x640:
  - the label reads "Search" (56/56 px)
  - every footer link scrolled to the bottom ends at y=576, above the
    launcher at 590, so 0% is covered
  - a real Tab press lands focus clear of the launcher
  - the parent link shows the ring
- At 390x844 the label reads "Search videos" (113/113 px).

## Resolution (2026-10-20)

Built as above in `fix/watch-mobile-chrome-fit`.
