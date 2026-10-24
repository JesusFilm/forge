---
title: "Home Language Modal Parity - Plan"
type: "fix"
date: "2026-08-24"
artifact_contract: "ce-unified-plan/v1"
artifact_readiness: "implementation-ready"
product_contract_source: "ce-plan-bootstrap"
execution: "code"
---

# Home Language Modal Parity - Plan

## Goal Capsule

- **Objective:** The Watch homepage and utility-page language picker presents the same coherent interaction and visual system as inner Watch pages while remaining appropriate for pages without media playback.
- **Means:** Reuse the inner-page language-picker presentation helpers and preserve the global picker's existing loading and navigation contract (KTD1, KTD2).
- **Authority:** The user-directed parity and no-subtitles requirements override implementation convenience. Existing Watch routing, accessibility, lazy-loading, and package conventions constrain the implementation.
- **Execution profile:** Review and harden the current branch diff, then validate it with component, provider, browser, and page-load evidence.
- **Stop conditions:** Stop if parity requires changing public language availability, route contracts, subtitle behavior on inner pages, or the initial homepage loading boundary.
- **Tail ownership:** The shipping pipeline owns review fixes, browser validation, commit, pull request creation, and CI resolution.

## Product Contract

### Summary

Align the homepage and utility-page language picker with the established inner-page language modal. Keep the global picker language-only and preserve its global catalog and route-family behavior.

### Problem Frame

The global picker uses a boxed dialog treatment while video and series pages use a transparent Watch overlay with a richer language section. Users encounter two designs for the same language action, and the inner-page component also contains subtitle controls that do not belong on pages without a player.

### Key Decisions

- **Use the inner-page design for the global picker** (session-settled: user-directed — chosen over retaining a distinct boxed home dialog: one language action should have one visual system). Governs R1 and R2.
- **Keep the global picker language-only** (session-settled: user-directed — chosen over rendering the complete inner-page language-and-subtitles surface: homepage routes have no player subtitle state). Governs R3.

### Requirements

- R1. The global picker uses the inner-page transparent overlay, responsive width, spacing, header, combobox, catalog links, and pill actions.
- R2. The global and inner-page pickers reuse shared structural presentation components for the language header, catalog links, combobox framing, multilingual tooltips, focus treatment, and pill actions.
- R3. The global picker renders no subtitle heading, selector, toggle, unavailable message, or translation action.
- R4. Loading, empty, error, retry, focus restoration, preference persistence, route-family navigation, prefetch, and pending navigation behavior remain intact.
- R5. The global picker remains off the initial critical path and may warm after page-load idle, while the global catalog request remains gated on opening the modal and the modal UI remains unrendered before activation.

### Acceptance Examples

- AE1. Given the global picker opens on the English homepage and its catalog loads, when the modal renders, then it shows the inner-page language header, language count, catalog links, combobox, and Close and Apply actions without subtitle controls.
- AE2. Given a user selects Spanish from a utility route, when Apply is pressed, then the preference is written once and navigation uses the Spanish destination for that route family.
- AE3. Given catalog loading fails, when the user activates Retry and the next load succeeds, then the language selector becomes available and receives focus.
- AE4. Given the global picker is closed through its viewport button, footer action, overlay, or Escape, then it closes without navigation and restores focus to the trigger.

### Scope Boundaries

- Do not change inner-page subtitle controls or subtitle playback behavior.
- Do not change public language availability, language identities, URL shapes, or preference ordering.
- Do not eagerly load the modal module or global catalog on homepage render.
- Do not add GraphQL, message-catalog, or generated-artifact changes.

## Planning Contract

### Key Technical Decisions

- KTD1. Extract shared structural presentation primitives for the language header, catalog links, combobox framing, multilingual tooltips, focus treatment, and pill actions. Keep global loading and navigation behavior and inner-page subtitle behavior in their owning modal components.
- KTD2. Keep global catalog loading and route-family navigation in `GlobalLanguagePickerModal`. The global surface has availability and destinations that differ from playable video variants, so only presentation helpers should be shared.
- KTD3. Keep the live status announcement in an assistive-only region while the visible header owns the language count and loading indicator. This preserves R4 without reintroducing the boxed modal's extra status row.

### Assumptions

- The existing `LanguagePickerModal` layout is the current design authority for Watch language selection.
- Browser validation can use the local Watch environment or an equivalent isolated environment with language catalog data.
- The current branch implementation is a candidate to review against this contract rather than an immutable solution.

## Implementation Units

### U1. Share the inner-page language presentation

- **Goal:** Make the global picker use the established inner-page modal presentation while retaining global behavior.
- **Requirements:** R1, R2, R3, R4, R5
- **Dependencies:** None
- **Files:**
  - `apps/web/src/components/watch/GlobalLanguagePickerModal.tsx`
  - `apps/web/src/components/watch/LanguagePickerModal.tsx`
  - `apps/web/src/components/watch/LanguageCombobox.tsx`
- **Approach:** Keep catalog state and destination selection in the global component per KTD2. Extract and reuse the language-section structure per KTD1, with state and behavior supplied by each owning modal. Match the inner-page modal frame and language-only section, and preserve the existing status semantics per KTD3.
- **Patterns to follow:** Mirror `LanguagePickerModal` and keep `WatchModalViewportCloseButton` inside `DialogContent` so Base UI focus isolation and viewport-safe positioning remain correct.
- **Test scenarios:**
  - Covers AE1. Load valid options and assert the transparent inner-page structure, links, combobox, and actions render with no subtitle test IDs.
  - Covers AE2. Select a valid changed language and assert one preference write followed by one route-family-aware navigation.
  - Covers AE3. Reject the first catalog load, retry successfully, and assert the selector appears and receives focus.
  - Covers AE4. Exercise every close path and assert no preference write or navigation occurs and trigger focus returns.
  - Open on a narrow viewport and assert the modal does not create horizontal document overflow.
- **Verification:** The global picker matches the inner-page language section in ready state, remains usable in loading and failure states, and does not change the inner-page modal.

### U2. Prove integration and loading posture

- **Goal:** Confirm the shared provider still mounts the global picker only after interaction and the visual change does not degrade page loading.
- **Requirements:** R4, R5
- **Dependencies:** U1
- **Files:**
  - `apps/web/src/components/watch/__tests__/GlobalLanguagePickerModal.test.tsx`
  - `apps/web/src/components/watch/GlobalLanguagePickerModal.aliases.test.tsx`
  - `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx`
  - `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`
- **Approach:** Extend structural regression coverage for parity and subtitle absence. Retain provider integration coverage for lazy modal ownership. Use paired browser evidence at matching desktop and mobile viewports for responsive geometry, focus, interaction, and the mount-window loading boundary.
- **Execution note:** Prefer an interaction smoke and resource/load observation because this work changes a lazily mounted UI surface.
- **Patterns to follow:** Use the existing jsdom modal harnesses and the repository's frontend page-load verification convention.
- **Test scenarios:**
  - The global alias catalog still finds and applies supported Chinese aliases.
  - The inner-page language and subtitle modal suite remains unchanged and green after helper exports.
  - The provider does not render the global picker before the language trigger is activated.
  - Paired desktop and mobile browser captures show that the global and inner-page language sections share structure, spacing, typography, responsive geometry, and action treatment, with only subtitle and state-specific content differences.
  - Resource evidence shows the global modal stays off the initial critical path, may warm after page-load idle, remains unrendered before activation, and requests the catalog only after the modal opens.
  - Inspect the interaction chunk or module graph against the pre-change boundary; if subtitle-only or full inner-modal dependencies enter the global interaction path, move shared presentation into a dedicated module consumed by both modals.
- **Verification:** Focused modal and provider suites, TypeScript, lint, formatting, browser interaction, and page-load evidence all pass.

## Verification Contract

- Run the focused global and inner-page modal tests, including alias behavior.
- Run the `FloatingSearchProvider` integration suite.
- Run `@forge/web` TypeScript and ESLint checks plus locale-catalog and formatting drift checks.
- Browser-test the Watch homepage and an inner Watch page at matching desktop and mobile widths with the modal open, retaining paired comparison evidence for the shared language surface.
- Verify focus restoration, canonical navigation, no horizontal overflow, and the absence of subtitle controls.
- Verify the modal stays off the initial critical path and unrendered before activation, its permitted idle warmup does not add critical initialization work, the catalog request remains interaction-gated, and shared presentation does not pull subtitle-only dependencies into the global interaction chunk.

## Definition of Done

- R1 through R5 are satisfied and AE1 through AE4 have automated or paired browser evidence.
- U1 and U2 verification outcomes pass without regressions in the inner-page picker.
- The final diff contains no abandoned alternative markup, generated-file drift, or unrelated package-manager changes.
- The roadmap ticket for this work is complete.
- Review findings are resolved or recorded through the pipeline's residual handoff before shipping.
