---
id: "feat-264"
title: "Watch landscape section CTA composition"
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
  - "mobile"
  - "responsive-layout"
---

## Problem

On landscape phones, the Watch body renders its Download and Ask Yours CTAs
with inconsistent alignment. Download remains at the trailing edge of a long,
wrapping video title while Ask Yours wraps beneath the Related Questions
eyebrow. The buttons consequently float at unrelated horizontal and vertical
positions instead of reading as actions belonging to their section headings.

## Entry Points - Read These First

1. `apps/web/src/components/watch/WatchBody.tsx` - left-column title,
   Download CTA, description, and the two-column body grid.
2. `apps/web/src/components/watch/WatchStudyQuestions.tsx` - right-column
   heading, Ask Yours CTA, and question list.
3. `apps/web/src/components/watch/__tests__/WatchBody.test.tsx` - responsive
   class and semantic regression coverage for both CTA compositions.
4. `apps/web/src/components/watch/watch-section-styles.ts` - shared Watch
   eyebrow and pill styling that must remain unchanged.

## Grep These

- `watch-body-title-row`
- `watch-download-button`
- `watch-study-questions-ask-yours`
- `watch-related-questions-heading`
- `orientation:landscape`

## What To Build

1. At landscape-phone widths, stack Download beneath the video title and align
   both to the left edge of the left column so the title can use the full
   column width.
2. At the same viewport range, stack Ask Yours beneath the Related Questions
   eyebrow and align both to the left edge of the right column.
3. Preserve the existing portrait-mobile and large-desktop compositions,
   button semantics, download error placement, and question interactions.
4. Add focused component regression assertions and visually verify a localized
   Watch page at a representative landscape-phone viewport.

## Constraints

- Scope the override to landscape phones; do not redesign all Watch section
  headers or change shared pill sizing.
- Do not change CTA copy, destinations, download gating, modal loading, or
  question expand/collapse behavior.
- Keep Download conditional on available downloads and Ask Yours always
  available with the existing placeholder-question behavior.
- Do not change GraphQL contracts, generated files, or public Watch routes.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/WatchBody.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke at a landscape-phone viewport such as `844x390`, using long
  localized title and CTA copy, plus a large-desktop comparison.
