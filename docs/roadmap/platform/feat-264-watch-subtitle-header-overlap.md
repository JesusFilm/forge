---
id: "feat-264"
title: "Watch subtitle header overlap"
owner: "vlad"
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
  - "responsive"
  - "accessibility"
---

## Problem

The Watch language modal keeps the subtitle heading and toggle inline on narrow
screens, but the conditional Translate with AI action shares the same
non-shrinking control group. When translated subtitles exist without a subtitle
matching the selected audio language, the AI action and toggle collapse the
heading's flex area and paint over its text.

## Entry Points - Read These First

1. `docs/plans/2026-07-16-001-fix-watch-subtitle-header-overlap-plan.md` - responsive hierarchy, requirements, and verification scenarios.
2. `apps/web/src/components/watch/LanguagePickerModal.tsx` - subtitle heading, conditional AI request, and toggle layout.
3. `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx` - same-language, translated-only, and empty-subtitle states.
4. `docs/solutions/ui-bugs/watch-mobile-language-modal-overflow-20260619.md` - established mobile stacking and localized pill constraints.

## Grep These

- `watch-language-picker-subtitles-header`
- `watch-language-picker-request-ai-translation`
- `sameLanguageSubtitleOptions`
- `hasSelectableSubtitleOptions`

## What To Build

1. Keep the subtitle heading/count and toggle in the primary mobile row.
2. Place Translate with AI on a secondary mobile row when no same-language subtitle exists.
3. Keep source order, visual order, and keyboard order aligned: heading, toggle, then AI request.
4. Let localized heading text wrap inside a bounded title/count stack instead of clipping or overlapping.
5. Use an inline desktop composition only when the modal's fixed width contains the longest supported localized labels.

## Constraints

- Preserve subtitle selection, availability, toggle, tooltip, and request-sent behavior.
- Do not hide the subtitle count, reduce typography, or clip overflowing content.
- Do not change the language section, player cue rendering, mobile app, or TV app.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/LanguagePickerModal.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke `/watch/jesus.html/russian.html` at 390px and the 608px modal width, with bounding-rectangle overlap checks before and after Request sent.
- Capture mobile and desktop screenshots and verify the CTA-present state has no horizontal overflow.

## Completion

- Replaced the competing mobile flex row with a two-column grid: heading and toggle form the primary row, and Translate with AI uses a secondary row. At `sm`, the controls use separate inline columns.
- Preserved heading → toggle → AI source/focus order, subtitle state behavior, tooltips, request-sent behavior, and localized wrapping.
- Focused component tests pass (29/29), along with `@forge/web` typecheck and lint.
- At 390px, heading/toggle/request rectangles had zero intersections before and after Request sent, the request action remained below the primary row, and the header had no horizontal overflow.
- At the exact 608px modal width, the longest Nepali label set and the longest RTL Arabic label set stayed on one aligned row with zero intersections and no header or button overflow.
- Changing to Request sent added no resource requests or long tasks: the resource count stayed at 76 and the long-task count stayed at 0. The layout-only implementation adds no data-fetching path.
- The current Russian fixture now has a same-language subtitle, so the CTA-present browser state was rendered with a temporary local-only condition after two real no-same-language routes hit the local Admin timeout boundary. That condition was removed immediately after proof; the final worktree contains only the production fix.
- Local proof images are under `output/playwright/watch-subtitle-header-{mobile-before,mobile-request-sent,desktop-longest-labels,desktop-rtl}.png`.
