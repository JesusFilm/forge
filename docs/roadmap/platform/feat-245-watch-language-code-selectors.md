---
id: "feat-245"
title: "Watch language-code selectors"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-10"
duration: 1
depends_on: []
blocks:
  - "feat-357"
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "language-picker"
  - "ui"
---

## Problem

Watch language selectors use country flags, which can obscure the language being
selected. A user needs a concise language-code marker in the selector and next
to each globe-based switch affordance.

## Entry Points - Read These First

1. `apps/web/src/components/watch/LanguageCombobox.tsx` - shared language and
   subtitle selector used by Watch modal, search, series, and inventory routes.
2. `apps/web/src/components/watch/HeroPlayer.tsx` - publishes the selected
   language state to the floating Watch header and passes it to player chrome.
3. `apps/web/src/components/FloatingSearchProvider.tsx` - renders the Watch
   header language switcher.
4. `apps/web/src/components/watch/SeriesPageClient.tsx` - renders the series
   globe language switcher.

## What To Build

1. Replace the shared selector's flag avatar with an outlined circular BCP 47
   primary-language code marker, preserving trigger, list, search, keyboard,
   and selection behavior.
2. Show the active language code beside every Watch globe affordance: the
   floating header, player chrome, and series page.
3. Keep the search overlay's header spacing aligned when the code marker is
   visible.
4. Add regression coverage and capture before/after screenshots plus a
   recording of a real language switch.

## Constraints

- Do not alter language data, language routes, preference persistence, or
  subtitle behavior.
- Use BCP 47's primary language subtag for the visible code (for example EN,
  RU), with a compact safe fallback only when that source data is absent.
- Keep the change in `apps/web`; do not regenerate GraphQL artifacts.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/LanguageCombobox.test.tsx src/components/watch/__tests__/LanguagePickerModal.test.tsx src/components/watch/__tests__/SeriesPageClient.test.tsx src/components/__tests__/FloatingSearchProvider.test.tsx`
- `pnpm --filter @forge/web typecheck`
- Browser screenshots for the modal, search, series, and inventory selector treatments, plus a recorded language switch.
