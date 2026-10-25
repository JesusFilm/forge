---
title: "Language Globe Line Height and PR Readiness - Plan"
type: "fix"
date: "2026-08-24"
artifact_contract: "ce-unified-plan/v1"
artifact_readiness: "implementation-ready"
product_contract_source: "ce-plan-bootstrap"
execution: "code"
---

# Language Globe Line Height and PR Readiness - Plan

## Goal Capsule

- **Objective:** Make the Watch language-globe promotion readable when “Choose a language” wraps, without changing the compact 404 treatment, and deliver the complete globe experience as a reviewed pull request.
- **Means:** Give the experience and not-found heading variants explicit line-height treatments in the shared section, protect the distinction with component tests, and verify the integrated desktop and mobile surfaces before shipping.
- **Authority:** The user's current visual direction takes precedence, followed by the completed language-globe roadmap tickets and existing Watch UI conventions.
- **Stop conditions:** Stop if the change breaks the unified surface, regresses either variant, violates the mobile performance profile, or leaves a P0/P1 review finding unresolved.
- **Tail ownership:** The invoking LFG workflow owns simplification, code review, browser QA, commit, PR creation, and CI follow-through.

## Product Contract

### Summary

The Watch experience needs a multilingual globe that can be reused on the homepage and 404 surface. Its promotional typography must read as part of the same framed composition as the animation, and the “Choose a language” heading needs enough line spacing to remain legible when it wraps on narrow screens.

### Problem Frame

The shared section currently applies the same compact `0.98` line height to both the experience headline and the 404 headline. That density works for the shorter not-found treatment but crowds the two-line “Choose a language” treatment, especially on mobile.

### Requirements

- **R1:** The experience variant gives a wrapped “Choose a language” heading visibly comfortable line spacing on narrow and wide viewports.
- **R2:** The not-found variant retains its compact headline rhythm.
- **R3:** Promo copy and the canvas remain one framed visual surface, with no second card or detached heading block.
- **R4:** The existing globe remains reusable on the Watch homepage, preview route, and 404 surface with its multilingual verse, adaptive rendering, reduced-motion behavior, and accessible fallback.
- **R5:** The pull request includes the feature's tests and supporting QA/roadmap documentation, while production deployment and a CMS-authored globe block remain outside this change.

### Key Decisions

- **KD1 — One visual surface** _(session-settled: user-directed — chosen over separate promo typography and globe rectangles because the user said the split treatment looked like two unrelated elements)._ Keep the promo copy and animation inside one bordered, rounded container. **Governs R3.**

### Scope Boundaries

In scope: the complete language-globe feature currently captured in this worktree, the experience-specific line-height correction, regression coverage, browser verification, and pull-request delivery.

Out of scope: production deployment, editorial CMS schema work, and unrelated Watch typography changes.

## Planning Contract

### Key Technical Decisions

- **KTD1:** Keep one shared `LanguageGlobeSection`; use the established Watch title token `leading-[1.08]` on the experience variant and preserve `leading-[0.98]` on the not-found variant. This implements **R1–R3** without forking the composition.
- **KTD2:** Assert the variant class contract in the existing server-rendered component test so future shared-class edits cannot silently collapse the distinction.

### Assumptions

- The committed worktree snapshot is the intended pull-request scope; this plan adds the final user-requested refinement and shipping evidence.
- The existing adaptive canvas profiles, tests, and documented QA form the baseline; this change does not redesign the globe renderer.

## Implementation Units

### U1 — Separate experience and 404 headline rhythm

- **Requirements:** R1, R2, R3; per KTD1.
- **Files:** `apps/web/src/components/sections/LanguageGlobeSection.tsx`
- **Approach:** Remove line height from the heading's shared class list. Apply `leading-[1.08]`, already used by large wrapping Watch titles, to the experience variant and keep `leading-[0.98]` on the not-found variant, leaving size, weight, tracking, and surface structure unchanged.
- **Test scenarios:**
  - Render the experience variant with “Choose a language”; its heading includes `leading-[1.08]` and does not include the compact 404 value.
  - Render the not-found variant; its heading still includes the compact line-height class and does not inherit the experience value.
  - Inspect the mobile experience preview; a two-line title has a clear gap without colliding with the description or globe.

### U2 — Lock the variant contract and verify integration

- **Requirements:** R1–R5; per KTD2.
- **Depends on:** U1.
- **Files:** `apps/web/src/components/sections/LanguageGlobeSection.test.tsx`, `docs/roadmap/topic-experiences/feat-400-watch-language-globe-sections.md`, existing language-globe/home/404 tests, and QA evidence if browser findings require an update.
- **Approach:** Mark the owning roadmap ticket `in-progress` before source edits. Add focused markup assertions for both heading variants, run the affected suite and static gates, then browser-check the standalone experience and not-found previews at mobile and desktop widths. Record the refinement in the ticket's completion notes and restore `complete` after verification.
- **Test scenarios:**
  - The shared section test fails if both variants receive the same line-height class.
  - Existing homepage and 404 tests continue to pass with one globe surface each.
  - Desktop and mobile browser checks show one continuous framed design, readable copy, smooth animation, and no console errors.
  - Reduced-motion and low-powered mobile profiles continue to avoid continuous high-cost rendering.

## Verification Contract

- Run the focused `LanguageGlobeSection`, `WatchLanguageGlobeSection`, `WatchNotFound`, and `LanguageGlobe` Vitest suites.
- Run the web package's lint, TypeScript, and formatting checks for every changed source and test file.
- Use the real preview routes for desktop and mobile browser QA; confirm wrapping, single-surface composition, zero horizontal overflow, and console cleanliness. Over a three-second animation sample, main-thread task time must remain below `0.25s` at the desktop target viewport and below `0.10s` at `390×844`.
- Review the final diff for unintended changes before commit, then require the PR's GitHub checks to reach a terminal success state or report the exact blocker.

## Definition of Done

- The experience heading has visibly readable line spacing when wrapped.
- The 404 heading preserves its intentionally compact spacing.
- The promo copy and globe remain one visual block on homepage and 404 uses.
- Focused tests, static checks, and browser QA pass with no unresolved P0/P1 review finding.
- The complete feature is committed on a branch, pushed, opened as a pull request, and monitored through CI.
