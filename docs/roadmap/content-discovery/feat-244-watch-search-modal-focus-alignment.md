---
id: "feat-244"
title: "Watch search modal focus alignment"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-07-09"
duration: 1
depends_on:
  - "feat-172"
blocks: []
tags:
  - "web"
  - "watch"
  - "search"
  - "ui"
---

## Problem

The public Watch floating search field regressed in two coupled ways: opening
the modal no longer reliably focuses the modal search input, and the opened
input visibly shifts away from the closed floating field's position.

## Entry Points - Read These First

1. `apps/web/src/components/SearchOverlay.tsx` - modal input, focus handling,
   and opened top-bar layout.
2. `apps/web/src/components/FloatingSearchProvider.tsx` - closed floating
   header wrapper that owns viewport positioning.
3. `apps/web/src/components/FloatingSearchField.tsx` - shared closed/open
   field visual contract.
4. `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx` -
   focused overlay and chrome regression coverage.

## What To Build

1. Restore automatic focus to the modal search input when the floating search
   field opens the modal.
2. Align the opened modal search field with the closed floating search field so
   the click-to-open transition does not visibly move the field.
3. Keep language controls, search execution, result rendering, and modal close
   behavior unchanged.
4. Add focused regression coverage for input focus and the shared field layout
   contract.

## Constraints

- Keep search in the existing global modal surface.
- Do not add or promote a new `/watch/search`, `/videos`, or query-driven
  search route.
- Do not change Algolia versus semantic search behavior.
- Do not regenerate GraphQL artifacts.

## Verification

```bash
pnpm --filter @forge/web exec vitest run src/components/__tests__/FloatingSearchProvider.test.tsx src/lib/__tests__/content-width.test.ts
pnpm --filter @forge/web exec tsc --noEmit --pretty false
pnpm --filter @forge/web lint
```

Browser smoke:

- `http://127.0.0.1:3010/watch` at `1440x950`: closed trigger and opened
  modal field both measured `left=164`, `top=48`, `width=1097`, `height=52`;
  active element was `Search videos by keyword`.
- `http://127.0.0.1:3010/watch` at `390x844`: closed trigger and opened
  modal field both measured `left=76`, `top=12`, `width=223`, `height=52`;
  active element was `Search videos by keyword`.
- Screenshots:
  `output/playwright/watch-search-overlay-aligned-desktop.png`,
  `output/playwright/watch-search-overlay-aligned-mobile.png`.
