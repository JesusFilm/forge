---
id: "feat-144"
title: "Web language modal count chip polish"
owner: "urim"
priority: "P2"
status: "complete"
start_date: "2026-05-27"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "i18n"
  - "design"
---

## Problem

The web watch language modal currently renders language counts as descriptive
right-aligned text such as "8 languages" and places the subtitle toggle beside
the "Subtitles" heading. The requested design needs tighter count chips placed
near each section title, with the subtitle switch moved to the right-side
control area.

## Entry Points - Read These First

1. `apps/web/src/components/watch/LanguagePickerModal.tsx` - modal layout,
   language count, subtitle count, and subtitle switch.
2. `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx` -
   focused jsdom coverage for the modal shell and subtitle controls.
3. `docs/plans/2026-05-25-001-feat-video-subtitle-controls-plan.md` -
   existing subtitle control layout context.

## Grep These

1. `watch-language-picker-count`
2. `watch-language-picker-subtitle-count`
3. `watch-language-picker-subtitles-toggle`

## What To Build

1. Render the playable language count as a chip immediately after the
   "Language" title.
2. Render only the numeric count inside the language count chip.
3. Render the subtitle count as a numeric chip next to the "Subtitles" title.
4. Move the subtitle switch to the right-side control cluster, preserving its
   existing state, disabled behavior, and click handler.
5. Keep the existing language/subtitle combobox behavior and Apply/Close flows
   unchanged.

## Constraints

- Do not change language routing, subtitle preference state, or translation
  request behavior.
- Do not introduce a new UI primitive for this small polish.
- Preserve the existing `data-testid` hooks used by modal tests.
- Keep the modal usable at mobile widths without title, chip, and switch
  overlap.

## Verification

1. `pnpm --filter @forge/web test src/components/watch/__tests__/LanguagePickerModal.test.tsx`
2. `pnpm --filter @forge/web typecheck`
3. Browser smoke on a watch page language modal at mobile width.
