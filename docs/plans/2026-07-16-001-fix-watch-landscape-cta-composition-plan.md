---
title: "fix: Watch Landscape CTA Composition"
type: "fix"
status: "active"
date: "2026-07-16"
roadmap: "docs/roadmap/platform/feat-264-watch-landscape-section-cta-composition.md"
---

# fix: Watch Landscape CTA Composition

## Summary

Make the Download and Ask Yours actions read as part of their respective Watch
body sections on landscape phones. Both columns will use a repeated
heading-then-action composition at that viewport, while portrait mobile and
large desktop retain their existing responsive behavior.

## Problem Frame

The supplied landscape-phone screenshot shows a long localized title wrapping
around a trailing Download button. That places Download in the visual middle of
the left column rather than under the title. In the right column, limited width
already wraps Ask Yours under the Related Questions eyebrow, so the two CTAs
follow different alignment rules and appear unrelated to their headings.

The current behavior comes from independent flex header rows in
`WatchBody.tsx` and `WatchStudyQuestions.tsx`. This is a responsive composition
issue only: CTA semantics, destinations, availability rules, and section
content are working and remain out of scope.

## Requirements

- R1. At landscape-phone widths, the video title uses the available left-column
  width and Download sits directly beneath it, aligned to the same leading edge.
- R2. At the same viewport range, Ask Yours sits directly beneath the Related
  Questions eyebrow, aligned to the same leading edge.
- R3. Download errors remain grouped with Download, and all CTA semantics,
  destinations, pending states, and question interactions remain unchanged.
- R4. Portrait-mobile and large-desktop layouts do not inherit the
  landscape-phone stacking override.
- R5. The corrected composition is visually verified with long localized copy
  at a representative landscape-phone viewport and compared at desktop width.

## Key Decisions

- KTD1. Use one explicit landscape-phone media contract for both columns:
  `orientation: landscape` with a `1023px` maximum width. This covers common
  phone landscape CSS widths without changing the `lg` desktop composition.
- KTD2. Keep CTA ownership inside each existing section. A shared cross-column
  action rail would disconnect actions from their content and complicate the
  current mobile DOM order.
- KTD3. Override only flex direction and leading-edge alignment. Shared eyebrow
  and pill styles, grid proportions, content order, and interaction code remain
  unchanged.

## Assumptions

- The user-visible defect is limited to landscape phones; the existing portrait
  and desktop compositions are intentionally preserved.
- The supplied Russian screenshot is representative of the long-copy case that
  should drive browser proof, even if local fixtures use another long localized
  title with equivalent geometry.

## Scope Boundaries

- In scope: responsive composition classes in the Watch body title/Download row
  and Related Questions/Ask Yours header.
- In scope: focused component assertions and landscape/desktop browser proof.
- Out of scope: CTA styling redesign, copy changes, modal behavior, question
  content behavior, page-grid proportions, and data contracts.

## Implementation Units

### U1. Landscape Section Header Composition

**Goal:** Give both Watch body columns the same heading-then-action hierarchy
on landscape phones.

**Requirements:** R1, R2, R3, R4.

**Dependencies:** None.

**Files:**

- `apps/web/src/components/watch/WatchBody.tsx`
- `apps/web/src/components/watch/WatchStudyQuestions.tsx`
- `apps/web/src/components/watch/__tests__/WatchBody.test.tsx`

**Approach:** Add matching landscape-phone responsive variants to the two
existing header rows. The left row becomes a leading-aligned column so the
title can use full width; its Download/error wrapper drops the trailing auto
margin and aligns to the start. The right header becomes a leading-aligned
column with explicit spacing between its eyebrow and Ask Yours CTA. Retain
the current base and large-screen classes so the override is isolated.

**Patterns to follow:** Mirror the explicit orientation media variants already
used by `apps/web/src/components/watch/HeroPlayer.tsx`, and keep responsive
class-contract assertions alongside existing WatchBody layout tests.

**Test scenarios:**

1. A downloadable video with long title content renders the landscape-phone
   column override on the title row and leading-edge override on the Download
   group, while retaining the existing base row classes.
2. Related Questions renders the same landscape-phone column/start alignment
   and an explicit gap between its eyebrow and Ask Yours CTA.
3. Download remains inside its title section, errors remain inside its CTA
   group, and Ask Yours remains inside the Related Questions header.
4. The responsive variants include both maximum-width and landscape clauses,
   preventing the stacking rule from becoming an unconditional mobile or
   desktop layout.

### U2. Responsive Visual Verification

**Goal:** Prove the two CTA compositions are visually coherent at the failing
viewport without regressing desktop.

**Requirements:** R5.

**Dependencies:** U1.

**Files:**

- `output/playwright/watch-landscape-cta-composition.png`
- `output/playwright/watch-desktop-cta-composition.png`

**Approach:** Run the local Watch app through the repo browser workflow, open a
video page with downloads, study questions, and long localized copy, then
capture the settled body section at approximately `844x390`. Confirm each CTA
starts on the same edge as its own heading and no CTA overlaps or narrows its
heading. Capture a desktop comparison at `1280x900` to verify the existing
horizontal composition remains intact.

**Patterns to follow:** Use the established Watch browser-proof convention:
wait for the localized page to settle, inspect the target DOM geometry, retain
at least one screenshot, and restore the page to its default state after any
interaction.

**Test scenarios:**

1. At `844x390` in landscape, Download is below and leading-aligned with the
   video title; Ask Yours is below and leading-aligned with Related Questions.
2. Long localized title and CTA copy fit without overlap, clipping, or a button
   floating between columns.
3. At `1280x900`, the pre-existing desktop title/Download and eyebrow/Ask Yours
   row composition remains visible and usable.

## Verification

- Run `pnpm --filter @forge/web test -- src/components/watch/__tests__/WatchBody.test.tsx`.
- Run `pnpm --filter @forge/web typecheck`.
- Run `pnpm --filter @forge/web lint`.
- Complete the landscape and desktop browser scenarios in U2 and inspect the
  captured screenshots.

## Risks and Mitigations

- Arbitrary responsive variants can silently drift between the two components.
  Keep the media condition identical and assert it in the focused component
  test.
- Very long translations can increase vertical height. Giving headings the full
  column width reduces wrapping pressure; browser proof must use long localized
  copy rather than English-only content.
- Changing shared pill or grid tokens would broaden the regression surface.
  Limit implementation to local composition classes.

## Sources and Research

- Supplied landscape-phone screenshot showing the Russian long-copy failure.
- `apps/web/src/components/watch/WatchBody.tsx` and
  `apps/web/src/components/watch/WatchStudyQuestions.tsx` current responsive
  structure.
- `apps/web/src/components/watch/__tests__/WatchBody.test.tsx` existing layout
  contract coverage.
- `docs/solutions/design-patterns/always-render-cta-section-with-placeholder-row-20260505.md`
  for the Related Questions ownership and always-visible CTA contract.
