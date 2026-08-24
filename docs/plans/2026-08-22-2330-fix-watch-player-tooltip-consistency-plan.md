---
title: "Watch Player Tooltip Consistency - Plan"
type: "fix"
date: "2026-08-22"
artifact_contract: "ce-unified-plan/v1"
artifact_readiness: "implementation-ready"
product_contract_source: "ce-plan-bootstrap"
execution: "code"
---

# Watch Player Tooltip Consistency - Plan

## Goal Capsule

- **Objective:** Watch viewers can understand every icon-only player action, including the active subtitle state and language, without a tooltip wrapping or obscuring playback at rest.
- **Means:** Give the five shared chrome buttons one localized tooltip contract and use edge-aware, intrinsic-width positioning.
- **Authority:** The user-approved subtitle states and tooltip interaction in this Product Contract govern behavior. `apps/web/AGENTS.md`, `apps/web/CLAUDE.md`, and the cited solution documents govern implementation constraints.
- **Stop conditions:** Stop if existing translated tokens cannot form clear grammar-safe labels, if any supported derived label cannot fit the verified compact viewport without wrapping or truncation, if the change requires new locale catalog keys, changes subtitle availability or delivery, changes modal ownership, or overlaps FGE-70, FGE-72, or FGE-75.
- **Execution profile:** Focused component implementation, unit characterization, real-browser mouse and keyboard proof, compact-layout measurements, and page-load evidence.
- **Tail ownership:** Create and complete the next platform roadmap record, open a follow-up PR, and reach a terminal CI and review decision without deploying or replying in Help Scout.

---

## Product Contract

### Summary

Replace the wrapped `Subtitles · EN` popup with concise, single-line state copy. Extend the same hidden-until-hover-or-focus treatment to play, mute, audio language, and fullscreen controls.

### Problem Frame

The current subtitle tooltip is positioned inside a narrow button with a wrapping width constraint. Its middle dot can therefore start a second line, which separates the subtitle label from its active language. The other icon-only controls expose accessible names but no equivalent visible explanation for pointer or keyboard users.

The current reviewer supplied a compact-player screenshot where `Subtitles` and `· EN` appear on separate lines. The active language therefore reads like detached punctuation instead of one subtitle state. Leaving it unchanged preserves the exact ambiguity this follow-up must remove; Help Scout #1712505 remains provenance for the broader FGE-92 subtitle-discoverability work rather than evidence for this new layout defect.

### Requirements

**Tooltip behavior and coverage**

- R1. Play or pause, mute or unmute, audio language, subtitles, and fullscreen must each show a concise localized tooltip.
- R2. A tooltip must be visually hidden at rest and appear only while its button is hovered or keyboard-focused.
- R3. Tooltip text and the owning button's accessible name must express the same current action or state.
- R4. Dynamic tooltips must update after playback, volume, subtitle, and fullscreen state changes.

**Subtitle state**

- R5. Available disabled subtitles must read `Subtitles: Off` using localized existing tokens.
- R6. Available enabled subtitles must read `Subtitles: On (EN)` when a language code exists and `Subtitles: On` when it does not.
- R7. Unavailable subtitles must read `Subtitles: Not available`, remain focusable for explanation, and remain non-interactive.
- R8. The visible subtitle icon and language-code states from FGE-92 must remain unchanged.

**Layout and compatibility**

- R9. Every supported derived tooltip string must remain complete, on one line, and inside the viewport at the verified compact widths; wrapping and truncation are not acceptable fallbacks.
- R10. Sliders, modal behavior, subtitle preferences, catalog availability, track delivery, fullscreen portals, and chrome reveal behavior must remain unchanged.
- R11. The change must add no message key, dependency, data request, eager media work, or material page-load regression.
- R12. Existing translated token composition must produce clear state-and-action labels across representative language families before merge.

### Key Decisions

- **Show explicit subtitle state and language.** (session-settled: user-directed — chosen over an `On`-only tooltip: viewers need to know which subtitle language is active.) Governs R5-R7.
- **Reveal tooltips only on hover or keyboard focus.** (session-settled: user-directed — chosen over persistent popups: playback stays unobstructed at rest.) Governs R1-R3.
- **Use one tooltip pattern for every icon-only player button.** (session-settled: user-directed — chosen over subtitle-only help: equivalent player controls should provide equivalent visible explanations.) Governs R1-R4.

### Acceptance Examples

- AE1. **Covers R1-R4.** Given a paused player, Play appears only on play-button hover or keyboard focus; activation changes the tooltip and accessible name to Pause.
- AE2. **Covers R1-R4.** Given nonzero audible volume, Mute appears on the volume button; muting or reducing effective volume to zero changes it to Unmute.
- AE3. **Covers R1-R4.** Given an audio language code, the audio button exposes the localized change-audio-language action with that code without changing the modal callback.
- AE4. **Covers R5-R8.** Given subtitles are off, on in English, on without a code, or unavailable, the tooltip reads the corresponding localized colon-form state and the existing icon/code presentation remains truthful.
- AE5. **Covers R1-R4 and R10.** Given windowed or fullscreen playback, the fullscreen tooltip names the available action and updates after activation without breaking the portal transfer.
- AE6. **Covers R2 and R9.** Given a 320 CSS-pixel viewport, each tooltip is hidden at rest, remains one line on hover and focus, and stays within the viewport.

### Success Criteria

- All five icon-only controls have matching visible tooltip and accessible-name semantics.
- No tooltip contains a middle dot, wraps at 320 CSS pixels, or crosses the measured viewport bounds.
- A reviewer can identify subtitles as off, unavailable, on without a code, or on in the displayed language from the tooltip alone at the reported compact width.
- Existing player, modal, subtitle, and chrome tests remain green, and browser checks find no interaction or page-load regression.

### Scope Boundaries

**In scope**

- Shared tooltip rendering and edge alignment in `ChromeButton`.
- Dynamic localized tooltip composition in `HeroPlayerControls`.
- Focused tests, compact browser measurement, keyboard and pointer proof, and proportional performance verification.
- A new platform roadmap record for this follow-up to FGE-92.

**Outside this product's identity**

- Tooltips for timeline or volume sliders, which already expose persistent context and accessible values.
- Changes to the Language & Subtitles modal, subtitle availability, preferences, VTT loading, or catalog data.
- Changes to the FGE-92 visible subtitle icon, filled state, dimmed state, or language code.
- FGE-70, FGE-72, FGE-75, production deployment, and Help Scout communication.

### Sources

- `docs/solutions/ui-bugs/watch-subtitle-discoverability-hydration.md`
- `docs/solutions/design-patterns/watch-language-player-chrome-layout-20260609.md`
- `docs/solutions/design-patterns/mux-player-custom-react-chrome-pattern-20260430.md`
- `docs/solutions/conventions/frontend-change-page-load-performance-verification.md`
- `docs/solutions/developer-experience/measurement-driven-layout-iteration-chrome-mcp-20260505.md`

---

## Planning Contract

### High-Level Technical Design

This state projection is directional. The implementation may preserve the current component boundaries while keeping one source of truth for each label.

```text
player state + existing localized tokens
                 |
                 v
       HeroPlayerControls label
          /               \
         v                 v
button aria-label   ChromeButton tooltip
                           |
                           v
             hover/focus + edge alignment
```

The subtitle label state machine is:

```text
unavailable -> Subtitles: Not available
available + off -> Subtitles: Off
available + on + no code -> Subtitles: On
available + on + code -> Subtitles: On (CODE)
```

### Key Technical Decisions

- KTD1. **Keep tooltip behavior in `ChromeButton`.** Add a small alignment input, intrinsic single-line sizing, and viewport-aware horizontal clamping. Start-align the leftmost play control and end-align right-side controls, then clamp the rendered box when alignment alone cannot contain it. Governs R1, R2, and R9.
- KTD2. **Reuse existing localized action and state tokens only when validation proves the composition works.** Compose colon and parentheses around `HeroPlayerControls` and `LanguagePickerModal` messages. Enumerate all catalog-derived candidates, render the widest candidates with the production font, and review representative language families for grammar. A failure blocks implementation and returns for approval of localized full-message keys instead of shipping wrapping, truncation, or awkward copy. This implements the session-settled Product Decisions for R1 and R5-R7 and governs R12.
- KTD3. **Compute each label once in `HeroPlayerControls`.** Pass the string as `ariaLabel`; `ChromeButton` renders that same accessible name as its presentational tooltip so the two cannot drift. Governs R3, R4, and R7.
- KTD4. **Keep the tooltip presentational.** Preserve `aria-hidden`, `role="tooltip"`, pointer-event suppression, focus-visible reveal, and `aria-disabled` on the unavailable subtitle button. Gate hover reveal to hover-capable fine pointers so touch activation cannot retain a synthetic hover tooltip. Governs R2, R3, R7, and R10.
- KTD5. **Use static markup and existing player state.** A button-local measurement handler clamps on hover or focus and may attach a transient `ResizeObserver` only while the tooltip is open; add no provider, persistent global listener, React state, dependency, message catalog, or request. Governs R10 and R11.

### Assumptions

- Existing translated action and state strings are candidate product vocabulary; KTD2 must validate their combined grammar and width before they become the shipped copy.
- The five `ChromeButton` instances define the icon-only tooltip scope; sliders do not need conventional tooltips.
- Existing focus-driven chrome reveal keeps a focused tooltip perceivable; browser QA must record any contrary evidence before expanding the chrome visibility state machine.

### Implementation Constraints

- Preserve `WatchPageClient` state ownership, `onLanguageClick`, the combined modal, subtitle preferences, and track selection.
- Preserve the three-state player chrome, pointer lockout, touch activation, fullscreen portal, volume expansion, and iOS synchronous play path.
- Preserve the FGE-92 distinction between offered-track delivery and Xhosa catalog availability.
- Do not change generated GraphQL artifacts or locale catalogs.

### Sequencing

U1 establishes the roadmap, shared tooltip primitive, and dynamic player labels as one testable change. U3 validates that implementation in the real portaled player before completing the roadmap record.

---

## Implementation Units

### U1. Implement the shared tooltip and dynamic player labels

- **Goal:** Make every icon-only chrome action truthful, single-line, viewport-contained, and consistent without changing button behavior.
- **Requirements:** R1-R12; AE1-AE6.
- **Dependencies:** None.
- **Files:**
  - `docs/roadmap/platform/feat-419-watch-player-tooltip-consistency.md`
  - `apps/web/src/components/watch/ChromeButton.tsx`
  - `apps/web/src/components/watch/HeroPlayerControls.tsx`
  - `apps/web/src/components/watch/__tests__/HeroPlayerControls.test.tsx`
  - `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`
- **Approach:** Create the in-progress roadmap record before production edits. Extend `ChromeButton` per KTD1 and KTD4. Build one label per control per KTD2 and KTD3, pass it as the accessible name, and let `ChromeButton` reuse it for the tooltip. Replace the subtitle middle-dot form while preserving visible icons, codes, callbacks, and unavailable behavior.
- **Execution note:** Start with assertions that fail against the wrapping treatment and current subtitle-only tooltip coverage.
- **Test scenarios:**
  1. A tooltip remains visually hidden at rest and has hover and focus-visible reveal selectors.
  2. Tooltip markup is presentational and does not replace the button's accessible name.
  3. Hover reveal is limited to hover-capable fine pointers, while focus-visible reveal remains available to keyboards.
  4. Play uses start alignment, right-side controls use end alignment, and the shared primitive supports viewport clamping.
  5. Every tooltip uses intrinsic single-line sizing without the prior wrapping constraint.
  6. Play and pause, mute and unmute, and enter and exit fullscreen labels update and match their tooltips.
  7. Audio language exposes the localized change action and active code when present.
  8. Subtitle labels cover Off, On with code, On without code, and Not available without a middle dot.
  9. Existing callbacks open the combined modal once, while unavailable subtitles remain focusable and non-interactive.
  10. Existing subtitle outline, filled, dimmed, and visible-code assertions remain unchanged.
- **Verification:** Focused hero and controls suites pass across all dynamic branches, and the diff contains no new runtime primitive, dependency, or locale-catalog change.

### U3. Prove compact layout, interaction, and loading behavior

- **Goal:** Validate the portaled player chrome in production-shaped browser flows and record the follow-up learning.
- **Requirements:** R1-R12; AE1-AE6.
- **Dependencies:** U1.
- **Files:**
  - `docs/solutions/ui-bugs/watch-subtitle-discoverability-hydration.md`
  - `docs/roadmap/platform/feat-419-watch-player-tooltip-consistency.md`
  - `docs/roadmap/README.md`
- **Approach:** Enumerate all 225 catalog-derived tooltip candidates and identify the widest string for each control. Review composition in representative language families, then render the width extremes with the production font. Exercise a canonical Watch route after auto-hide with pointer, keyboard, and touch input. Measure tooltip rectangles and computed white-space at desktop, 320 CSS-pixel portrait, and compact landscape widths. Record the result, complete the roadmap ticket, and regenerate the index.
- **Patterns to follow:** The cited measurement-driven layout and frontend page-load conventions.
- **Test scenarios:**
  1. Every icon-button tooltip is absent visually at rest and appears only on hover or keyboard focus.
  2. Each widest derived tooltip rectangle stays complete within the viewport and computed white-space remains non-wrapping at 320 CSS pixels and compact landscape; any failure blocks the change under KTD2.
  3. Play, mute, subtitle, and fullscreen transitions update their visible tooltip without stale text.
  4. Keyboard activation opens the existing language modal and unavailable subtitles remain explanatory but inert.
  5. Touch activation remains single-tap and does not leave a sticky tooltip.
  6. Xhosa catalog availability and an offered subtitle track remain truthful and unchanged.
  7. Representative language families produce clear composed action and state labels; any failure blocks the change under KTD2.
  8. Initial requests, dependencies, and pre-interaction media or modal work do not increase.
- **Verification:** Browser evidence names exact routes, locales, viewports, bounding rectangles, interaction results, console state, and page-load comparison before the roadmap record is completed.

---

## Verification Contract

| Gate                     | Command or evidence                                                                                                                                                                                                                                                                       | Covers |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Focused behavior         | `pnpm --filter @forge/web exec vitest run src/components/watch/__tests__/HeroPlayerControls.test.tsx src/components/watch/__tests__/HeroPlayer.test.tsx`                                                                                                                                  | U1     |
| Web contracts            | `pnpm --filter @forge/web typecheck` and changed-file ESLint                                                                                                                                                                                                                              | U1     |
| Locale/catalog integrity | Enumerate all 225 catalog-derived candidates, review representative language families, and render the widest per-control candidates with the production font; `git diff -- apps/web/messages` must remain empty                                                                           | U1, U3 |
| Production composition   | `pnpm --filter @forge/web build` with the repository's supported non-secret environment                                                                                                                                                                                                   | U1-U3  |
| Roadmap index            | `pnpm --filter roadmap generate:readme`                                                                                                                                                                                                                                                   | U1, U3 |
| Formatting               | Changed-file Prettier and `git diff --check`                                                                                                                                                                                                                                              | U1-U3  |
| Browser interaction      | Pointer, keyboard, touch, dynamic states, modal behavior, and no app-attributable console error on a canonical Watch route                                                                                                                                                                | U3     |
| Compact geometry         | `getBoundingClientRect()` and computed white-space for every tooltip at desktop, 320 CSS-pixel portrait, and compact landscape; no viewport crossing or horizontal overflow                                                                                                               | U3     |
| Page loading             | Compare the same production build and route before and after the change. Initial request count, browser data requests, dependencies, eager media, and pre-interaction modal work must not increase; changed application bytes are reported and any material regression blocks completion. | U3     |
| Review and CI            | CE review has no unresolved eligible finding; the PR reaches a terminal CI and review decision                                                                                                                                                                                            | U1-U3  |

---

## Definition of Done

- U1 is done when the shared tooltip is one-line, viewport-contained, hidden at rest, touch-safe, and all five controls have matching localized tooltip and accessible-name text for every relevant state.
- U3 is done when compact geometry, pointer, keyboard, touch, modal, subtitle truthfulness, and page-loading evidence are durable.
- The final diff contains no middle-dot tooltip, locale-catalog edit, new dependency, subtitle-delivery change, FGE-70/FGE-72/FGE-75 work, deployment action, or Help Scout reply.
- The follow-up roadmap record is complete, required checks pass, the PR is open, and CI and review reach a terminal decision.
