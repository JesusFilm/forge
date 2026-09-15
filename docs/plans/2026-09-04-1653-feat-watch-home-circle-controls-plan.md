---
title: "Watch Home Circle Controls - Plan"
type: "feat"
date: "2026-09-04"
artifact_contract: "ce-unified-plan/v1"
artifact_readiness: "implementation-ready"
product_contract_source: "ce-plan-bootstrap"
execution: "code"
---

# Watch Home Circle Controls - Plan

## Goal Capsule

- **Objective:** Watch-home viewers can see and directly choose nearby videos from responsive circular thumbnail controls without losing playback status, keyboard focus, or hero performance.
- **Means:** Extend the existing Watch-home carousel state and overlay with a linear thumbnail timeline, a stable action row, and a current-video progress ring (KTD1-KTD5).
- **Authority:** The Product Contract owns user-visible behavior. The Planning Contract owns implementation choices. Repository and package instructions constrain both.
- **Execution profile:** Localized Web UI change with focused component, hook, accessibility, performance, and browser verification.
- **Stop conditions:** Stop if the available Hero Queue cannot provide the required linear window, if direct selection would change played-history semantics, or if the controls require eager thumbnail loading.
- **Tail ownership:** The LFG pipeline owns implementation verification, review fixes, PR creation, CI babysitting, and the user-authorized squash merge.

## Product Contract

### Summary

Replace the Watch-home hero's generic next-video action with responsive circular video thumbnails. Desktop shows surrounding timeline context, while mobile keeps only the current and next videos inline with Watch Now and mute.

### Problem Frame

The previous hero control exposed only a generic next action. It did not show the adjacent videos, made direct selection impossible, and separated the mute affordance from the primary action on some responsive layouts.

### Requirements

**Timeline content and behavior**

- R1. Desktop renders the actual previous video when one exists, the current video, and up to three actual future videos from the Hero Queue.
- R2. Mobile renders only the current video and the next video.
- R3. The visible timeline remains linear and never wraps a missing past or future slot to the opposite end of the Hero Queue.
- R4. Selecting any non-current circle activates that video through the existing carousel lifecycle.
- R5. The current circle remains non-advancing and exposes the timed playback-progress indicator.
- R6. Every circle uses the video's thumbnail, falls back to the existing poster and play icon chain, and remains keyboard accessible with action semantics only on selectable items.

**Responsive layout and visual treatment**

- R7. Watch Now and mute remain adjacent in the stable action row, and the compact current/next circles share that same row on mobile.
- R8. Desktop keeps its timeline right-aligned as a separate responsive group without colliding with hero copy.
- R9. Timeline circles and mute use one sharp 1 px semi-transparent light inset ring with low-opacity overlay blending and no outer outline, blur, or directional bevel.
- R10. Hover and keyboard-focus states remain clearly visible against both bright and dark footage.

**Lifecycle, accessibility, and performance**

- R11. Automatic and direct slide changes preserve focus when the focused control remains valid and recover focus to the new current circle when a focused timeline item leaves the visible window.
- R12. Slide changes preserve the existing timer, media readiness, played-history, mute, and route behavior.
- R13. Future thumbnails remain lazy-loaded with responsive size hints and do not compete with the active hero poster for LCP priority.

### Key Decisions

- **Circular thumbnail timeline** (session-settled: user-directed — chosen over the generic next-video button: viewers need visible context and direct access to nearby videos). Governs R1, R3-R6.
- **Five-position desktop window** (session-settled: user-directed — chosen over showing only the current video: desktop should expose one past and three future videos). Governs R1, R3.
- **Two-position mobile window** (session-settled: user-directed — chosen over the full desktop timeline on narrow screens: mobile needs lower visual density). Governs R2.
- **One mobile action row** (session-settled: user-directed — chosen over a separate bottom timeline row: all hero actions should stay on the same line). Governs R7-R8.
- **Mute beside Watch Now** (session-settled: user-directed — chosen over placing or duplicating mute beside the timeline: mute belongs with the primary action). Governs R7.
- **Single translucent inset ring** (session-settled: user-directed — chosen over a thin outline and directional light-top/dark-bottom bevel: the control should read as a sharp, subtle overlay-mixed circle). Governs R9-R10.

### Acceptance Examples

- AE1. **Covers R1, R3:** Given the first Hero Queue item is current, desktop shows the current video plus the next three videos and no synthetic previous item.
- AE2. **Covers R1-R3:** Given a middle Hero Queue item is current, desktop shows offsets minus one through plus three while mobile shows only offsets zero and plus one.
- AE3. **Covers R4, R5, R11:** Given a future circle has keyboard focus, selecting it makes that video current, retains focus, and restarts the progress ring for the new current item.
- AE4. **Covers R7-R10:** Given a narrow viewport, Watch Now, mute, current, and next remain on one line with visible hover and focus treatment.
- AE5. **Covers R12-R13:** Given the queue extends near its loaded tail, the carousel admits three future timeline items without changing played-history selection or eagerly preloading their images.

### Scope Boundaries

- The work does not change Hero Queue composition, random first-video selection, preview duration, played-video persistence, routing, GraphQL fields, or Admin data fetching.
- The work does not introduce a new shared thumbnail-frame abstraction because these circular playback controls have a user-directed 1 px treatment distinct from standard video cards.
- The work does not add new image assets, eager image loading, or priority loading for timeline thumbnails.

## Planning Contract

### Key Technical Decisions

- KTD1. **Derive a linear window from the active index.** Build past, current, and future entries from real in-bounds Hero Queue positions, deduplicate by slide identity, and filter the compact presentation to the current and next offsets. This implements R1-R3.
- KTD2. **Route direct selection through the carousel hook.** Expose the active index, current timeline queue, and identity-based selection from `useWatchHomeTvCarousel` so buttons reuse the existing transition, timer, media, and played-history lifecycle. This implements R4-R5 and R12.
- KTD3. **Keep actions outside keyed rotating copy.** Mount Watch Now, mute, and responsive timeline controls in a stable overlay subtree so automatic slide replacement does not recreate focused controls. This implements R7-R8 and R11.
- KTD4. **Prefetch only enough queue metadata for the visible future window.** Extend the existing bounded queue fill target to cover three future timeline positions while keeping `next/image` lazy-loading and explicit `sizes` hints. This implements R1 and R13.
- KTD5. **Render the visual ring as a non-interactive inset overlay.** Use a borderless overlay-blended layer for the user-directed 1 px ring, while the current playback SVG remains a separate progress signal. This implements R9-R10.

### Assumptions

- The existing Hero Queue slide identity remains stable across queue extension, so identity-based selection and focus recovery stay deterministic.
- The current circle uses its localized video title with `aria-current`, while selectable past and future circles retain the localized `showVideo` action label; this feature adds no visible copy or message-catalog key.
- The established 48 px desktop and 36 px compact circle geometry remains the intended responsive size after placing the compact timeline in the action row.

## Implementation Units

### U1. Extend carousel state for the timeline

- **Goal:** Make the required linear window and direct-selection behavior available without changing existing carousel semantics.
- **Requirements:** R1-R5, R11-R13; KTD1, KTD2, KTD4.
- **Dependencies:** None.
- **Files:** `apps/web/src/components/home/useWatchHomeTvCarousel.ts`, `apps/web/src/components/home/__tests__/useWatchHomeTvCarousel.test.ts`.
- **Approach:** Export the future-window bound, expose active index and queue state, retain identity-based selection, and extend bounded queue hydration only far enough to supply three future entries.
- **Patterns to follow:** Existing `advance`, played-history rollover, and queue-hydration behavior in the same hook; `docs/solutions/ui-bugs/watch-home-played-history-queue-rollover.md`.
- **Test scenarios:**
  - A middle item exposes enough queue state for one past and three future positions.
  - A direct identity selection uses the existing transition path and preserves timer and played-history behavior.
  - Queue-tail hydration remains bounded while making three future identities available.
- **Verification:** Hook tests prove selection, rollover, and bounded queue extension with no behavioral regression.

### U2. Render responsive circular controls in a stable overlay

- **Goal:** Replace the generic next action with accessible desktop and mobile timelines while keeping Watch Now and mute stable.
- **Requirements:** R1-R12; KTD1-KTD3, KTD5.
- **Dependencies:** U1.
- **Files:** `apps/web/src/components/home/WatchHomeTvCarousel.tsx`, `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx`.
- **Approach:** Derive timeline entries from the hook state, render large and compact variants, keep the action row outside rotating copy, and recover focus when a focused past item leaves the window.
- **Patterns to follow:** Existing Watch-home progress ring, `WatchHeroOverlay`, `Button`, and responsive compact-landscape conventions.
- **Test scenarios:**
  - Covers AE1. The opening desktop state has current plus three future circles and no previous circle.
  - Covers AE2. A steady-state desktop window has one past, current, and three future circles; compact has current and next only.
  - Covers AE3. Selecting a future circle activates it, retains focus, updates thumbnail order, and resets the progress ring.
  - The current circle exposes its title with `aria-current`, has no misleading action verb, and remains a no-op when activated.
  - A focused past circle moves focus to the new current circle when autoplay advances it out of the window.
  - Watch Now and mute retain DOM identity and focus through automatic queue rollover.
- **Verification:** Rendered component tests prove responsive item counts, thumbnail order, direct selection, focus behavior, and progress reset.

### U3. Verify responsive styling and performance

- **Goal:** Confirm the controls match the settled visual treatment at desktop and mobile sizes without degrading page loading.
- **Requirements:** R6-R10, R13; KTD4-KTD5.
- **Dependencies:** U2.
- **Files:** `apps/web/src/components/home/WatchHomeTvCarousel.tsx`, `apps/web/src/components/home/__tests__/WatchHomePage.test.tsx`, `design-qa.md`, `docs/roadmap/topic-experiences/feat-445-watch-home-next-video-thumbnail-control.md`.
- **Approach:** Apply the borderless 1 px inset overlay treatment, verify hover/focus contrast, capture desktop and narrow-width evidence, and record lazy-loading/resource-priority observations.
- **Execution note:** Prefer real-browser responsive and resource-timing evidence because this unit is primarily visual and performance-sensitive.
- **Patterns to follow:** Existing hero poster priority and timeline image sizing; `docs/solutions/performance-issues/watch-hero-poster-idle-autoplay-20260610.md`.
- **Test scenarios:**
  - Covers AE4. At 320 px, 375 px, and 430 px portrait widths, the four action-row controls stay on one line without overlap or horizontal clipping.
  - At a representative compact-landscape viewport, the action row stays inline and unclipped with a representative long `watchNow` translation.
  - Hover and keyboard focus remain visible on bright and dark frames without changing ring width.
  - Covers AE5. A cold-load network trace shows timeline thumbnails below the active hero poster's request priority, with no duplicate hidden-variant requests or priority preload.
- **Verification:** Browser screenshots and DOM/resource inspection confirm responsive geometry and interaction contrast; cold-load network and LCP evidence confirms the active poster remains the LCP element ahead of timeline thumbnails.

## Verification Contract

| Gate                                                              | Applies to | Done signal                                                                                                                                                               |
| ----------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused Watch-home component and hook tests                       | U1, U2     | Timeline states, selection, focus, ring reset, and rollover cases pass.                                                                                                   |
| Web TypeScript check                                              | U1-U3      | The Web package typechecks without errors.                                                                                                                                |
| Targeted Web lint and formatting                                  | U1-U3      | Touched source, tests, and documentation satisfy repository formatting and lint rules.                                                                                    |
| Diff integrity check                                              | U1-U3      | No whitespace errors or malformed patches remain.                                                                                                                         |
| Desktop browser smoke                                             | U2, U3     | Opening and steady-state timeline windows, direct selection, hover, focus, and progress are visible and functional.                                                       |
| Mobile browser smoke at 320 px, 375 px, and 430 px                | U2, U3     | Watch Now, mute, current, and next remain on one line without collision or clipped labels.                                                                                |
| Compact-landscape browser smoke with a long Watch Now translation | U2, U3     | The action row stays inline, unclipped, and meaningfully labeled.                                                                                                         |
| Cold-load browser network and LCP inspection                      | U3         | Timeline thumbnails stay below the active poster's request priority, hidden responsive variants do not duplicate requests, and the active poster remains the LCP element. |

## Definition of Done

- R1-R13 and AE1-AE5 are satisfied by tests or browser evidence.
- U1-U3 verification outcomes pass with no unresolved P0 or P1 review finding.
- The roadmap ticket records the shipped behavior and validation evidence.
- The branch contains no abandoned experiment or unrelated user-owned workspace change in the feature commit.
- The PR passes required checks and is squash-merged under the user's explicit authorization.
