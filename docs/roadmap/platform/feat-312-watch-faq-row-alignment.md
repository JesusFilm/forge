---
id: "feat-312"
title: "Watch FAQ row alignment"
owner: "unassigned"
priority: "P2"
status: "complete"
start_date: "2026-07-24"
duration: 1
depends_on:
  - "feat-023"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
---

## Problem

Authored Watch FAQ rows use a decorative square question icon, semibold
question copy, top-aligned row contents, and vertical-only padding. The
highlighted row therefore feels uneven and visually heavier than intended.

## Entry Points - Read These First

1. `apps/web/src/components/sections/RelatedQuestions.tsx` - authored FAQ
   accordion layout and styling.
2. `apps/web/src/components/sections/RelatedQuestions.test.tsx` - focused FAQ
   presentation and interaction coverage.

## Grep These

- `QuestionIcon`
- `RelatedQuestionsSection`
- `hover:bg-white/5`

## What To Build

1. Remove the decorative question-mark icon from every FAQ row.
2. Vertically center the question and chevron within each highlighted row.
3. Apply equal padding on all four sides of the row.
4. Render question copy at normal font weight.
5. Preserve authored copy, accordion behavior, answer rendering, and the
   Ask Yours action.

## Constraints

- Do not change the Watch study-question accordion, which is a separate surface.
- Keep the chevron and existing open/close interaction.
- Preserve responsive text sizing and localization.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/sections/RelatedQuestions.test.tsx`
- `pnpm --filter @forge/web typecheck`
- Browser smoke confirms highlighted FAQ rows have equal inset spacing and
  vertically centered text.

## Completion Notes

- Removed the decorative square question-mark glyph from authored FAQ rows.
- Replaced vertical-only padding with equal `p-4` inset spacing and centered
  the question/chevron row on the cross axis.
- Changed question typography from semibold to normal weight while preserving
  responsive sizing and line height.
- Added focused presentation and expand-interaction coverage.
- Two focused tests, Web typecheck, targeted ESLint, Prettier, and `git diff
--check` passed.
- Browser verification on the published local Easter experience confirmed
  16px padding on all four sides, vertically centered row content, normal
  question weight, and only the chevron SVG remaining.
- Page-loading performance is unaffected: the change removes one decorative
  inline SVG per FAQ row and does not add client work, network requests, or
  dependencies.
