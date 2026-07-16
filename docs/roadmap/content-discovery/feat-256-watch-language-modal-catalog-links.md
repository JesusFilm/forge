---
id: "feat-256"
title: "Watch language modal catalog links"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-07-15"
duration: 1
depends_on:
  - "feat-196"
blocks: []
tags:
  - "web"
  - "watch"
  - "languages"
  - "content-discovery"
---

## Problem

The Watch language-switching modal lets viewers change the current video's
audio language, but it does not expose the public language catalog. Viewers
need direct paths to the all-languages index and to the video inventory for
the language currently selected in the modal.

## Entry Points - Read These First

1. `apps/web/src/components/watch/LanguagePickerModal.tsx` - existing modal layout, selected draft language state, and focus-ring conventions.
2. `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx` - modal behavior and route assertions.
3. `apps/web/src/lib/routes.ts` - `languagesIndexPath` and `languageVideosIndexPath` public route builders.
4. `docs/solutions/ui-bugs/watch-mobile-language-modal-overflow-20260619.md` - mobile width and overflow constraints.

## Grep These

- `LanguagePickerModal`
- `draftSlug`
- `languagesIndexPath`
- `languageVideosIndexPath`
- `watch-language-picker-apply`

## What To Build

- Add a compact `See all languages` link aligned to the far right of the
  Language heading row and route it to `/watch/languages` through
  `languagesIndexPath()`.
- Add an underlined, touch-friendly text link directly beneath the language
  selector for the selected draft language's
  `/watch/{language}.html/videos` route through `languageVideosIndexPath()`.
- Update the selected-language link immediately when the combobox draft changes.
- Keep both links keyboard accessible, mobile-safe, and visually subordinate to Apply.

## Constraints

- Keep the implementation inside `apps/web`.
- Use public audio language slugs, never message-catalog locale keys.
- Reuse route builders and the modal's existing colors, spacing, radii, and focus treatment.
- Do not add network requests, eager imports, or new client-side initialization.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/LanguagePickerModal.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke the modal at desktop and mobile widths, verify both hrefs, verify no horizontal overflow, and capture screenshots.
