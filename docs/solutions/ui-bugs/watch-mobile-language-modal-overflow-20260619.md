---
title: Watch mobile language modal overflow
date: 2026-06-19
category: docs/solutions/ui-bugs
module: apps/web
problem_type: ui_bug
component: watch-page
severity: medium
related_components:
  - apps/web/src/components/watch/LanguagePickerModal.tsx
  - apps/web/src/components/watch/LanguageCombobox.tsx
  - apps/web/src/components/ui/button.tsx
tags:
  - watch-page
  - language-picker
  - mobile
  - localization
  - overflow
applies_when:
  - A Watch modal looks clipped or too narrow on a mobile viewport
  - Localized pill buttons overlap adjacent controls
  - A shared `Button` child is used in a constrained mobile flex row
---

# Watch mobile language modal overflow

## Context

The Watch language picker used a centered `max-w-[min(90vw,608px)]` dialog
shell. On a phone viewport this left narrow gutters while localized controls
inside the subtitles row still needed more horizontal space.

The subtitle request action also used the shared `Button` base, which applies
`whitespace-nowrap` and `shrink-0`. That is usually right for compact buttons,
but it lets translated pill labels push or overlap nearby controls in a tight
mobile row.

## Pattern

- Make mobile modal shells use the available viewport first, then restore the
  desktop cap at `sm`.
- Keep the modal content centered with an inner `max-w-*` container, not by
  narrowing the fixed dialog surface on mobile.
- Stack dense header/action rows on mobile and switch back to side-by-side from
  `sm` up.
- When a localized action pill sits in a mobile flex row, explicitly override
  shared button defaults with `min-w-0`, `flex-1`, `shrink`, and
  `whitespace-normal`; restore `sm:flex-none sm:whitespace-nowrap` if desktop
  should stay compact.

## Verification

Use a mobile-width browser smoke with the language modal open and inspect both
horizontal overflow and row overlap:

```bash
pnpm --filter @forge/web test -- src/components/watch/__tests__/LanguagePickerModal.test.tsx
pnpm --filter @forge/web lint
```

For browser proof, open `/watch/jesus.html/russian.html` at 390px width, click
the floating globe, and assert `document.documentElement.scrollWidth <=
window.innerWidth` plus no modal descendants extend beyond the viewport.
