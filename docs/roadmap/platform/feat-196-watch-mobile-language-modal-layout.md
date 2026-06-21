---
id: "feat-196"
title: "Watch mobile language modal layout"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-19"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "mobile"
  - "language-picker"
---

## Problem

The Watch language picker modal is too narrow on mobile Safari and its
localized subtitle controls can overflow the visible screen.

## Entry Points - Read These First

1. `apps/web/src/components/watch/LanguagePickerModal.tsx` - modal shell,
   subtitle header, and action layout.
2. `apps/web/src/components/watch/LanguageCombobox.tsx` - reusable language
   selector used inside the modal.
3. `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx` -
   focused modal regression coverage.
4. `docs/solutions/design-patterns/watch-language-player-chrome-layout-20260609.md`
   - existing language picker layout and affordance decisions.

## Grep These

- `watch-language-picker-modal`
- `watch-language-picker-request-ai-translation`
- `watch-language-picker-subtitles-toggle`
- `LanguagePickerModal`

## What To Build

1. Let the language picker use the full available mobile viewport width while
   preserving the desktop max width.
2. Prevent horizontal overflow from localized subtitle actions, counts, and
   controls.
3. Keep the language and subtitle combobox rows full width.
4. Preserve the existing icon-first affordances and multilingual tooltips.

## Constraints

- Do not change language switching, subtitle state, public Watch URLs, or Admin
  data fetching.
- Do not change generated GraphQL or locale artifacts.
- Keep the fix local to Watch modal layout unless tests expose a shared
  combobox issue.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/LanguagePickerModal.test.tsx`
- Mobile browser smoke on `/watch/jesus.html/russian.html` with the language
  modal open confirms the modal fills the available width and controls do not
  overflow horizontally.
