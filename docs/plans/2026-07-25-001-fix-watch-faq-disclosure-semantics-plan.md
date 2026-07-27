---
title: "fix: Add Watch FAQ disclosure semantics"
type: "fix"
status: "completed"
date: "2026-07-25"
---

# fix: Add Watch FAQ disclosure semantics

## Summary

Add the missing disclosure state and control relationship to Watch FAQ rows while preserving their current single-open accordion behavior and visual design.

## Problem Frame

FGE-40 reports that the FAQ buttons rendered by `RelatedQuestions` do not expose whether their answers are expanded or identify the answer panels they control. Screen-reader and switch users therefore receive a button without the state and context needed to understand the interaction.

## Requirements

- R1. Every FAQ trigger exposes `aria-expanded="false"` while collapsed and `aria-expanded="true"` while its answer is open.
- R2. Every FAQ trigger exposes `aria-controls` pointing to a unique answer panel in the same row.
- R3. The controlled panel remains a valid DOM target in both states and is hidden from layout and assistive technology while collapsed.
- R4. Opening a second FAQ closes the first, and activating the open FAQ closes it.
- R5. Focused component tests cover the collapsed, expanded, switched, and re-collapsed disclosure states.

## Assumptions

- This work addresses only the FAQ accordion acceptance criterion from FGE-40. Hero rotation controls, modal semantics, focus management, touch targets, and wider page-level axe coverage remain outside this fix.
- Keeping collapsed answer panels mounted with the native `hidden` attribute is acceptable because it preserves the current visible behavior while keeping each `aria-controls` reference valid.

## Key Technical Decisions

- **Keep the existing component boundary:** Update the hand-rolled `RelatedQuestions` disclosure instead of migrating the section to another accordion implementation, avoiding unrelated styling or content changes.
- **Use React-generated panel identity:** Follow `WatchStudyQuestions`, `AdventCountdown`, and `EasterDates` by deriving per-instance IDs with `useId`, which stays unique across repeated sections and stable across server rendering and hydration.
- **Test the DOM contract and interaction:** Assert state attributes and resolved control targets before and after clicks rather than testing internal React state.

## Scope Boundaries

### In scope

- FAQ trigger and panel semantics in the Watch `RelatedQuestions` section.
- Focused jsdom regression coverage for disclosure state and single-open behavior.
- A local roadmap entry linking the implementation plan and FGE-40 scope.

### Deferred to Follow-Up Work

- The remaining FGE-40 carousel, dialog, focus-management, touch-target, page-level axe, and screen-reader acceptance criteria.

## Implementation Units

### U1. Record the scoped Watch accessibility fix

- **Goal:** Create the required local roadmap entry and mark it in progress before code changes, then complete it when verification passes.
- **Requirements:** R1-R5
- **Dependencies:** None
- **Files:**
  - `docs/roadmap/platform/feat-317-watch-faq-disclosure-semantics.md`
- **Approach:** Link the roadmap item to FGE-40 and this plan, name the exact `RelatedQuestions` entry point, and keep all unrelated FGE-40 acceptance criteria out of its active scope.
- **Patterns to follow:** `docs/roadmap/platform/feat-183-watch-cover-sequenced-transition.md`
- **Test expectation:** none -- this unit is roadmap tracking only.
- **Verification:** The roadmap file uses the required frontmatter, concrete entry points, constraints, and verification outcomes; its final status matches the shipped work.

### U2. Add and verify the FAQ disclosure contract

- **Goal:** Give every FAQ button accurate expanded state and a stable relationship to its controlled answer panel.
- **Requirements:** R1-R5
- **Dependencies:** U1
- **Files:**
  - `apps/web/src/components/sections/RelatedQuestions.tsx`
  - `apps/web/src/components/sections/RelatedQuestions.test.tsx`
- **Approach:** Generate a panel ID inside each `QuestionItem`, add `type="button"`, `aria-expanded`, and `aria-controls` to the trigger, and give the answer container the matching ID. Render the panel in both states and use `hidden` while collapsed so the relationship always resolves without changing the visible single-open behavior.
- **Patterns to follow:** `apps/web/src/components/watch/WatchStudyQuestions.tsx`, `apps/web/src/components/sections/AdventCountdown.tsx`, and `apps/web/src/components/sections/EasterDates.tsx`
- **Test scenarios:**
  1. Render two FAQ rows and verify both native buttons start with `aria-expanded="false"`, distinct non-empty `aria-controls` values, and matching hidden panel elements.
  2. Activate the first trigger and verify its state becomes expanded, its controlled panel becomes visible, and the second row remains collapsed.
  3. Activate the second trigger and verify the first row returns to collapsed and hidden while the second row expands.
  4. Activate the open second trigger again and verify it returns to collapsed with its controlled panel hidden.
- **Verification:** Focused component tests pass, TypeScript accepts the new attributes and test fixture, and browser DOM inspection confirms each trigger's `aria-controls` resolves to the expected panel as state changes.
