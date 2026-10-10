---
title: "Single Collection Header - Plan"
type: "fix"
date: "2026-08-21"
artifact_contract: "ce-unified-plan/v1"
artifact_readiness: "implementation-ready"
product_contract_source: "ce-plan-bootstrap"
execution: "code"
---

# Single Collection Header - Plan

## Goal Capsule

- **Objective:** A Watch episodes rail with one eligible collection presents that collection as fixed information instead of implying that the viewer can open a selector.
- **Means:** Branch the existing `SiblingCarousel` header by selectable-parent cardinality while preserving the data model and multi-collection control behavior (KTD1).
- **Authority:** The Product Contract defines behavior; the Planning Contract defines implementation; repository instructions and tests define delivery quality.
- **Stop conditions:** Stop if the one-item array is required to render an interactive collection control for a still-current contract, or if the presentation branch changes contextual episode routing or carousel behavior.
- **Execution profile:** Lightweight, single-package Web UI fix.
- **Tail ownership:** LFG owns review, browser proof, commit, push, PR creation, and CI follow-through.

## Product Contract

### Summary

Render the sole collection title as plain, non-interactive text when `SiblingCarousel` receives exactly one selectable parent. Keep the native collection selector and all switching behavior when two or more selectable parents exist. Keep the contextual linked-title header unchanged when the block has no selectable-parent payload.

### Problem Frame

The current one-option native select looks actionable even though it has no alternative choice. This exposes a misleading dropdown affordance in the Watch episodes rail and gives keyboard and assistive-technology users a control that cannot change state.

### Requirements

- R1. Exactly one selectable parent renders its resolved collection title as visible, non-interactive text with no select, link, button, control role, focus target, or busy state.
- R2. Two or more selectable parents retain the existing native select, selection state, busy behavior, live announcement, option switching, truncation, and focus styling.
- R3. A block with no selectable parents retains the existing contextual linked-title header.
- R4. The single-parent branch preserves the selected parent, contextual child links, clip position, section accessible name, active child, pending navigation, carousel state, and mobile overflow containment.
- R5. Focused tests and browser proof cover all three header cardinalities without adding data fetching, resources, effects, dependencies, or client initialization.

### Key Decisions

- **Single-option collection identity is fixed text** (session-settled: user-directed — chosen over retaining the styled one-option dropdown: a dropdown implies a choice that does not exist). Governs R1, R2.

### Scope Boundaries

- In scope: `SiblingCarousel` header presentation, its focused regression tests, page-load evidence, and a new roadmap ticket that records the superseding behavior.
- Out of scope: selectable-parent construction, route admission, GraphQL, structured data, episode navigation, carousel geometry, and any visual redesign of the multi-option selector.

## Planning Contract

### Key Technical Decisions

- KTD1. **Preserve the non-empty `selectableParents` model and branch only in the header.** Do not coerce a one-item array to `null`, because the null branch owns the distinct contextual linked-title behavior. This implements R1-R4.
- KTD2. **Reuse the existing standalone header layout and plain title typography.** The single title stays beside the unchanged clip-position label, but omits control-only border, background, padding, height, focus, disabled, and live-region semantics. This implements R1 and R4.
- KTD3. **Replace the obsolete one-option selector assertion and keep multi-option tests as the regression boundary.** The single-option test proves the absence of interaction; existing switching, pending-busy, and contextual-title tests continue to prove R2-R3.

### Assumptions

- The completed `feat-287` requirement that kept a one-option selector visible is historical and is superseded only for header presentation by this request.
- A dedicated stable test identifier for the plain parent title is acceptable if it makes the non-interactive contract clear without coupling tests to layout structure.
- Page-load risk is low because the change removes DOM and adds no resources or effects, but the above-the-fold rendering convention still requires lightweight browser evidence.

## Implementation Units

### U1. Render the single collection as fixed header text

- **Goal:** Implement R1-R4 and record the superseding roadmap contract.
- **Requirements:** R1, R2, R3, R4.
- **Dependencies:** None.
- **Files:**
  - `docs/roadmap/platform/feat-411-watch-single-collection-header.md`
  - `apps/web/src/components/watch/SiblingCarousel.tsx`
  - `apps/web/src/components/watch/__tests__/SiblingCarousel.test.tsx`
- **Approach:**
  1. Before editing, record request count, transferred bytes, long tasks, and LCP for the same production-shaped route and desktop/compact conditions used by U2.
  2. Create `feat-411` with `status: "in-progress"`, exact entry points, behavior boundaries, and verification requirements.
  3. Keep the existing `selectableParents` derivation and selected-parent state intact.
  4. Render the native select only for two or more selectable parents.
  5. Render the resolved single parent title as bounded plain text in the existing flex header, followed by the unchanged position label.
  6. Leave the no-selectable-parent linked-title branch and all carousel content unchanged.
  7. Replace the old one-option-selector test with the new fixed-text contract.
- **Patterns to follow:** The existing contextual plain header in `apps/web/src/components/watch/SiblingCarousel.tsx`; semantic text guidance in `docs/solutions/ui-bugs/watch-home-carousel-heading-hierarchy.md`; overflow constraints in `docs/solutions/ui-bugs/watch-mobile-sibling-carousel-horizontal-rubber-band.md`.
- **Test scenarios:**
  1. Given one selectable parent, rendering the rail shows `First Collection` as plain text, renders no parent selector or header link/control, and keeps the correct clip-position label and section accessible name.
  2. Given two selectable parents, the existing selector still switches collections, rekeys the carousel, updates contextual child links, and announces the new collection and chapter count.
  3. Given a pending valid chapter navigation with multiple parents, the selector remains disabled and exposes its existing busy state.
  4. Given no selectable parents, the contextual header remains a link to the canonical parent and no selector is rendered.
- **Verification:** The focused component suite passes, and the diff contains no data-model, routing, carousel-content, or resource-loading changes.

### U2. Verify the presentation and close the roadmap ticket

- **Goal:** Prove R5 at desktop and compact widths, then complete the roadmap record.
- **Requirements:** R5.
- **Dependencies:** U1.
- **Files:**
  - `docs/roadmap/platform/feat-411-watch-single-collection-header.md`
- **Approach:**
  1. Run the focused Web test and static-quality gates.
  2. Browser-smoke a production-shaped single-parent Watch route at desktop and compact widths.
  3. Confirm the title/count alignment, absence of dropdown chrome and interaction, no horizontal overflow, and no console errors.
  4. Compare against U1's pre-change baseline and confirm the change adds no resource request, transferred bytes, long task, or client initialization while LCP/resource timing stays within normal run variance.
  5. Mark the roadmap ticket `status: "complete"` with the verified outcomes.
- **Execution note:** Prefer a focused runtime smoke and request/performance observation because this is an above-the-fold presentation change with no new logic outside the render branch.
- **Patterns to follow:** `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`.
- **Test scenarios:**
  1. At desktop width, the single title and clip count align without dropdown chrome and the rail remains usable.
  2. At compact width, the title stays bounded, the header does not cause document-level horizontal overflow, and the carousel bleed behavior remains unchanged.
  3. During page load, the single-title branch adds no request, resource, effect, or long task compared with the current branch.
- **Verification:** Browser evidence and focused command output are recorded in the ticket, and the ticket is complete only after every listed gate passes.

## Verification Contract

- `pnpm --filter @forge/web exec vitest run src/components/watch/__tests__/SiblingCarousel.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web exec eslint src/components/watch/SiblingCarousel.tsx src/components/watch/__tests__/SiblingCarousel.test.tsx`
- `pnpm exec prettier --check apps/web/src/components/watch/SiblingCarousel.tsx apps/web/src/components/watch/__tests__/SiblingCarousel.test.tsx docs/roadmap/platform/feat-411-watch-single-collection-header.md docs/plans/2026-08-21-1955-fix-single-collection-header-plan.md`
- `git diff --check`
- Browser smoke at desktop and compact widths with DOM semantics, console, horizontal overflow, request count/resources, long tasks, and LCP/resource timing inspected.

## Definition of Done

- U1 is complete when exactly one selectable parent renders plain title text, two or more retain the selector, no selectable parents retain the contextual link, and focused tests prove all three contracts.
- U2 is complete when browser and page-load evidence pass and `feat-411` is marked complete.
- All Verification Contract gates pass.
- The diff contains no abandoned experiments, unrelated refactors, generated-file edits, route/data changes, or new dependencies.
