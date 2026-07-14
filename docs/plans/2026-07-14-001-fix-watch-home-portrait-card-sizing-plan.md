---
title: "fix: Scale Watch home portrait cards at smaller widths"
type: "fix"
status: "completed"
date: "2026-07-14"
---

# fix: Scale Watch home portrait cards at smaller widths

## Summary

Increase the Watch home rail from three to four columns at the tablet breakpoint
while retaining six columns on wide screens, so portrait cards remain
appropriately scaled on tablets and small laptops.

## Problem Frame

The Video Bible collection uses three columns from the medium breakpoint until
the extra-large breakpoint. At a 1024px-class viewport this makes each portrait
tile roughly 300 CSS pixels wide, matching the oversized section shown in the
request rather than the denser wide-screen composition.

## Requirements

- R1. Watch home rail sections render four portrait cards per row from the
  standard medium breakpoint.
- R2. The current two-column mobile and six-column extra-large layouts remain
  unchanged.
- R3. Card content, ordering, navigation, aspect ratio, crop, and hover behavior
  remain unchanged.
- R4. The change adds no client-side viewport logic, runtime work, or network
  requests.
- R5. Focused automated coverage and browser screenshots verify the compact and
  wide layouts.

## Assumptions

- The first supplied screenshot represents a 1024px-class CSS viewport where
  the current medium three-column rule applies.
- Four columns at the existing medium breakpoint provide the intended
  intermediate density across tablets and small desktops.
- The responsive correction applies to all Watch home rail sections because
  they share the same portrait-card layout contract.

## Key Technical Decisions

- **Adjust the existing Tailwind breakpoint sequence:** Change the medium rail
  step from three to four columns instead of introducing CSS calculations or
  JavaScript viewport state. This keeps layout server-renderable and consistent
  with the component's current responsive pattern.
- **Keep the card component unchanged:** The oversized presentation originates
  in the rail column count, while the portrait aspect ratio, image crop, and
  overlay behavior already match the wide-screen reference.
- **Assert the responsive contract on the authored component:** Extend the
  existing `MediaCollection` component test so the rendered carousel rail's
  intermediate and extra-large column classes are explicit.

## Scope Boundaries

- In scope: Watch home rail grid density, its focused class assertion, compact
  and wide browser proof, and the associated roadmap status.
- Out of scope: non-rail grids, card typography, content truncation, image
  assets, collection data, hero layout, hover-backdrop behavior, and navigation.

## Implementation Units

### U1. Add the intermediate rail density

- **Goal:** Keep Watch home portrait cards from becoming oversized on
  large-tablet and small-desktop viewports.
- **Requirements:** R1, R2, R3, R4
- **Dependencies:** None
- **Files:**
  - Modify `apps/web/src/components/sections/MediaCollection.tsx`
  - Modify `apps/web/src/components/sections/MediaCollection.test.tsx`
- **Approach:** Extend the rail grid's existing responsive class sequence with a
  four-column medium breakpoint. Add a focused assertion beside the existing
  extra-large assertion so both intermediate and wide-screen contracts are
  explicit.
- **Patterns to follow:** The `cn`-composed Tailwind grid classes in
  `MediaCollection` and its existing variant-focused component tests.
- **Test scenarios:**
  - Render the configured Video Bible rail and verify its grid includes the
    four-column medium-breakpoint class.
  - Verify the same grid retains the six-column extra-large class so the wide
    composition does not regress.
  - Verify no responsive change is applied to a non-rail grid by keeping the
    change scoped to the rail branch.
- **Verification:** The focused Watch home test passes and the rendered class
  sequence expresses two, four, and six columns at increasing breakpoints.

### U2. Prove responsive layout and page-load neutrality

- **Goal:** Confirm the visual correction at the affected width and preserve
  the wide layout without degrading initial page load.
- **Requirements:** R4, R5
- **Dependencies:** U1
- **Files:**
  - Modify `docs/roadmap/platform/feat-252-watch-home-portrait-card-sizing.md`
- **Approach:** Run the focused web validation, inspect the section in a browser
  at 1024px and a wide viewport, and capture screenshots. Confirm the change is
  CSS-class-only and does not add scripts, requests, timers, observers, or
  hydration behavior, matching the frontend performance verification
  convention.
- **Patterns to follow:**
  `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`
  and the repo's browser-facing completion guidance.
- **Test expectation:** No new automated test file; U1 owns the responsive
  contract coverage and this unit supplies runtime visual and performance
  evidence.
- **Verification:** The compact screenshot shows four smaller portrait cards,
  the wide screenshot keeps six cards, the page remains usable, and runtime
  inspection shows no additional initial-load work.

## Completion Evidence

- `pnpm --filter @forge/web test -- MediaCollection.test.tsx` — 11 tests passed.
- `pnpm --filter @forge/web typecheck` — passed.
- `pnpm --filter @forge/web lint` — passed.
- Browser smoke at `http://127.0.0.1:3020/watch` — four cards at the compact
  viewport, six cards at the wide viewport, expected section heading present,
  and no visible error state.
- Performance proof — the production change is one responsive Tailwind class
  substitution; it adds no JavaScript, requests, timers, observers, hydration,
  or media-loading behavior.
