---
id: "feat-264"
title: "Keep Watch language search above the mobile keyboard"
owner: "unassigned"
priority: "P1"
status: "complete"
start_date: "2026-07-16"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "language-picker"
  - "mobile"
  - "accessibility"
---

## Problem

The Watch language picker measures its popover from `window.innerHeight`.
Mobile Safari can shrink or shift the visible viewport for the software
keyboard without equivalently changing that layout-viewport height, leaving
the focused search field and results behind the keyboard or browser toolbar.

## Entry Points — Read These First

1. `apps/web/src/components/watch/LanguageCombobox.tsx` — shared searchable
   audio and subtitle language selector and popover geometry.
2. `apps/web/src/components/watch/LanguagePickerModal.tsx` — Watch modal shell,
   compact combobox usage, and fullscreen portal boundary.
3. `apps/web/src/components/watch/__tests__/LanguageCombobox.test.tsx` — focused
   above/below placement, constrained-height, search, and keyboard coverage.
4. `docs/plans/2026-07-16-001-fix-watch-language-picker-mobile-keyboard-plan.md`
   — requirements, decisions, and mobile verification scenarios.

## Grep These

- `updatePopoverLayout`
- `window.innerHeight`
- `visualViewport`
- `language-combobox-popover`
- `language-combobox-search`

## What To Build

1. Prefer the Visual Viewport bounds when placing and sizing the open language
   popover so the software keyboard and browser chrome reduce usable space.
2. Recalculate while open when the Visual Viewport resizes or shifts.
3. Keep the existing `window.innerHeight` and resize behavior as a fallback for
   browsers without the Visual Viewport API.
4. Preserve search ranking, keyboard navigation, virtualization, selection,
   fullscreen portals, and the existing Watch visual system.
5. Add focused regression coverage and mobile browser proof that the focused
   search field and actionable results remain unobscured.

## Constraints

- Do not redesign the language modal as a mobile bottom sheet in this ticket.
- Do not change language data, display labels, ranking, route navigation, or
  subtitle selection behavior.
- Do not change the shared dialog primitive or unrelated Watch dialogs.
- Do not introduce a new dependency for viewport measurement.

## Verification

- Focused `LanguageCombobox` tests for Visual Viewport initial placement,
  resize/shift updates, and the `window.innerHeight` fallback.
- Existing `LanguageCombobox` and `LanguagePickerModal` behavior tests.
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Mobile browser proof with the Watch language search focused and a query
  entered while the visible viewport is reduced by the keyboard.
