---
id: "feat-240"
title: "Watch language modal focus ring visibility"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "language-picker"
  - "accessibility"
---

## Problem

Focused controls in the Watch language and subtitles modal can show a clipped focus ring when an outside ring or outline sits against the modal's clipped content edge.

## Entry Points - Read These First

1. `apps/web/src/components/watch/LanguagePickerModal.tsx` - modal shell, overflow behavior, and selector placement.
2. `apps/web/src/components/watch/LanguageCombobox.tsx` - shared full-width selector trigger focus treatment.
3. `apps/web/src/components/watch/WatchModalViewportCloseButton.tsx` - shared modal viewport close affordance.
4. `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx` - modal layout and focus-ring regression coverage.
5. `docs/solutions/design-patterns/watch-language-player-chrome-layout-20260609.md` - existing language picker accessibility and layout decisions.

## Grep These

- `watch-language-picker-modal`
- `language-combobox-trigger`
- `watch-language-picker-close`
- `focus-visible:ring`
- `overflow-x-hidden`

## What To Build

1. Keep the modal's horizontal overflow guard in place.
2. Ensure visible language picker controls render a fully visible focus indicator inside their own bounds, including selectors, switches, retry/request actions, close controls, and Apply.
3. Preserve current language switching, subtitle state, tooltip, and action behavior.

## Constraints

- Do not change public Watch URLs, Admin data fetching, or generated locale artifacts.
- Do not loosen modal overflow behavior in a way that can reintroduce mobile horizontal scroll.
- Keep the fix local to the Watch language picker modal and shared Watch modal viewport close affordance.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/LanguagePickerModal.test.tsx src/components/watch/__tests__/LanguageCombobox.test.tsx`
- Browser smoke on `/watch/jesus.html/russian.html` with the language modal open and controls keyboard-focused confirms the focus ring is not clipped.
