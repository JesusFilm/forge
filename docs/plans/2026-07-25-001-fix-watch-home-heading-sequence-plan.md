---
title: "fix: Complete Watch home heading sequence"
type: "fix"
status: "completed"
date: "2026-07-25"
---

# fix: Complete Watch home heading sequence

## Summary and Problem Frame

FGE-20 shipped one stable Watch homepage H1 and removed rotating carousel
headings, but the promotional Text renderer still emits its first Markdown
subheading as H3 when the block heading is H1. That leaves the live outline
ordered H1, H3, then later section H2s.

This follow-up will make promotional Markdown subheadings respect the parent
heading level without changing their visible presentation or the carousel.

## Requirements

- R1. A promotional Text block whose authored heading is H1 must render its
  Markdown subheadings as H2.
- R2. Promotional Text blocks whose authored heading is H2 must continue to
  render Markdown subheadings as H3.
- R3. The change must preserve promotional typography, Markdown sanitization,
  links, lists, quotes, and layout.
- R4. Server-rendered DOM coverage must prove the H1 promotional outline no
  longer skips directly to H3.
- R5. The existing single-H1 and carousel heading invariants must remain
  unchanged.

## Key Technical Decisions

- **Choose the Markdown heading renderer from the authored parent level:** the
  Text component already receives `headingLevel`, so it can select an H2
  subheading map only for H1 promotional blocks and retain the existing H3 map
  for all other promotional blocks.
- **Keep source Markdown heading normalization:** existing promotional content
  maps authored Markdown H1-H3 syntax to one visual and semantic subheading
  role. This fix changes only that role's level under a page H1.
- **Test the server-rendered component contract:** the regression is present in
  server HTML, and `Text.test.tsx` already owns the real promotional renderer
  coverage without mocking its semantics.

## Implementation Units

### U1. Make promotional subheading levels parent-aware

- **Goal:** Render promotional Markdown subheadings at H2 beneath an authored
  H1 while preserving the current H3 behavior beneath authored H2 content.
- **Requirements:** R1, R2, R3, R4, R5.
- **Dependencies:** None.
- **Files:**
  - `apps/web/src/components/sections/Text.tsx`
  - `apps/web/src/components/sections/Text.test.tsx`
- **Approach:** Add a page-subheading renderer that reuses the current
  typography classes, build an H1-specific Markdown component map, and select
  it only when the promotional block's valid authored level is H1.
- **Patterns to follow:** Preserve the current
  `PROMOTIONAL_MARKDOWN_COMPONENTS` normalization and the static-markup DOM
  assertions in `Text.test.tsx`.
- **Test scenarios:**
  - Render a promotional block with an H1 heading and Markdown subheading; the
    ordered heading elements are H1 then H2, with no H3.
  - Render the existing promotional H2 fixture; its Markdown subheading remains
    H3 and retains the same CSS classes.
  - Run the existing Watch home composition and carousel heading tests to prove
    the single-H1 and heading-free-carousel contracts still pass.
- **Verification:** Focused tests pass, the web package typechecks and lints,
  and the rendered Watch homepage outline begins with H1 followed by H2
  headings at desktop and mobile widths.

### U2. Close the FGE-20 follow-up record

- **Goal:** Keep the existing roadmap and durable solution documentation
  accurate for the residual hierarchy fix.
- **Requirements:** R1, R4, R5.
- **Dependencies:** U1.
- **Files:**
  - `docs/roadmap/platform/feat-307-watch-home-heading-hierarchy.md`
  - `docs/solutions/ui-bugs/watch-home-carousel-heading-hierarchy.md`
  - `docs/plans/2026-07-25-001-fix-watch-home-heading-sequence-plan.md`
- **Approach:** Reopen the existing FGE-20 roadmap item while work is active,
  record the parent-aware promotional subheading rule in its build and
  prevention guidance, then mark both the roadmap item and this plan complete
  when implementation and verification finish.
- **Patterns to follow:** Extend the existing FGE-20 ticket and solution rather
  than creating a duplicate roadmap item.
- **Test expectation:** None -- this unit updates planning and operational
  documentation only.
- **Verification:** The roadmap item and plan report complete only after the
  code, tests, browser proof, and PR handoff are finished.

## Scope Boundaries

- No carousel markup, active-slide naming, animation, playback, or navigation
  changes.
- No Experience content, GraphQL, localization, routing, or data-fetching
  changes.
- No broad rewrite of Markdown heading semantics outside promotional Text
  blocks.

## Sources and Research

- `docs/roadmap/platform/feat-307-watch-home-heading-hierarchy.md` defines the
  original FGE-20 single-H1 and stable-section hierarchy requirements.
- `docs/solutions/ui-bugs/watch-home-carousel-heading-hierarchy.md` records the
  shipped carousel and authored-heading design.
- `apps/web/src/components/sections/Text.tsx` contains the unconditional H3
  promotional subheading renderer responsible for the residual outline.
