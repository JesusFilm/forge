---
title: "fix: Pause Watch background playback under search"
type: fix
status: completed
date: 2026-08-05
---

# fix: Pause Watch background playback under search

## Summary

Prove and lock the existing Watch modal-playback contract for floating search at the real search-provider-to-media integration. Opening search must pause background media continuously across the instant-shell and full-controller lifecycle without changing other modal behavior or poster-first loading.

---

## Problem Frame

A reported floating-search session appeared to leave Watch background video playing. Live browser characterization found that the current layout-scoped modal activity registry and identity-aware media pause hook already pause the only underlay video immediately and keep it paused through populated search results. The remaining gap is that search state and media state are tested mostly in isolation, so this real provider-to-media contract could regress while both unit suites remain green.

---

## Requirements

### Playback behavior

- R1. Opening floating search from an actively playing Watch surface pauses the background media before the search overlay is usable.
- R2. Background media remains paused while either the instant shell, full search controller, or closing transition owns the overlay.
- R3. Closing search resumes only the exact media and playback identity that was playing before search opened.
- R4. Media that was already paused before search opened remains paused after search closes.

### Integration and regression safety

- R5. Search continues to register modal activity from its authoritative provider lifecycle rather than from lazy overlay content.
- R6. Language, share, download, question, feedback, beta-tester, quiz, and other existing modal owners retain the shared registry contract.
- R7. Search first-open autofocus, close/reset behavior, blur treatment, and instant-shell loading remain unchanged.
- R8. The repair does not mount or start hero media earlier and does not degrade the poster-first page-loading path.
- R9. Automated coverage connects the actual floating search lifecycle to a media consumer so the reported regression cannot pass through isolated mocks.

---

## Assumptions

- The requested background video is a Watch hero, home-carousel, or authored media element underneath the global search overlay, not a media preview intentionally rendered inside search results.
- Search close preserves the established identity-aware resume behavior after its visible closing state ends.
- The existing shared modal activity registry remains the architectural owner; this task does not introduce a search-specific pause effect.

---

## Key Technical Decisions

- KTD1. **Characterize the integration before fixing it:** reproduce cold first-open search with the real provider and a pausable media consumer so execution identifies the broken handoff rather than guessing from isolated unit coverage.
- KTD2. **Repair the existing shared seam:** keep search ownership in `FloatingSearchProvider` and playback ownership in `WatchModalActivityProvider`; change the smallest seam shown faulty by the characterization test.
- KTD3. **Keep pause ownership continuous across lazy loading:** modal activity follows search `open || closing`, independent of whether the instant shell or full controller is mounted.
- KTD4. **Preserve media provenance:** any change must retain exact element and source identity checks so closing search cannot resume replaced, late-attached, or previously paused media.

---

## Reproduction Baseline

Start on the desktop `/watch` route shown in the report at an approximately 2:1 viewport. Let the Watch Home hero/carousel background media advance, record its element identity, source, `paused`, and `currentTime`, then cold-open search before its lazy controller is warm. Also record the cold-load media element count and resource timing through `load` so the same browser profile can be compared after the fix.

If this exact composition does not reproduce, inspect every advancing media element to determine whether playback belongs to the Watch underlay or to a search-result preview. Do not edit production code until a failing route and playback owner are identified. If the observed owner lies outside the provider-to-registry seam assumed below, revise U2's files and approach to match that evidence before continuing.

---

## Implementation Units

### U1. Track and characterize the reported search playback behavior

- **Goal:** Create the follow-up roadmap record, identify the reported playback owner, and add an integration guard for the search-to-background-media behavior.
- **Requirements:** R1-R5, R9.
- **Dependencies:** None.
- **Files:** `docs/roadmap/platform/feat-336-watch-search-background-playback-pause.md`, `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`.
- **Approach:** Reproduce the reported `/watch` composition first, identify the advancing media and production registration owner, then render that registration path with `WatchModalActivityProvider` and the real `FloatingSearchProvider`. Drive the actual search activation and close controls without pre-warming the lazy controller.
- **Execution outcome:** Production characterization identified one full-screen Watch underlay video. It changed from playing to paused on search open, remained frozen through the full controller and Russian results, and stayed paused across a carousel source change. Per the falsification gate, no production code was edited.
- **Patterns to follow:** `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`, `apps/web/src/components/watch/WatchModalActivityProvider.test.tsx`, and `apps/web/src/components/watch/ModalPlaybackRegistration.test.tsx`.
- **Test scenarios:**
  - A playing media element pauses when the first search click opens the instant shell.
  - Media stays paused when the lazy full controller replaces the shell.
  - Closing search does not resume until the closing lifecycle releases activity.
  - The exact prior-playing media resumes after the final release.
  - Media that begins paused is never played by the open-close cycle.
  - Keyboard activation focuses the instant-shell input, preserves input focus through the full-controller handoff, and keeps media paused when Escape starts closing search.
  - Escape resets transient query state without releasing playback during close.
- **Verification:** The integration test connects the real provider lifecycle to a registered media owner and fails if search stops acquiring shared modal activity. If the browser baseline or characterization does not fail, stop production edits and retain the test as the regression boundary.

### U2. Validate search modal playback coordination

- **Goal:** Confirm the search lifecycle acquires shared modal activity early enough to pause every registered Watch media surface, repairing only a demonstrated gap.
- **Requirements:** R1-R8.
- **Dependencies:** U1.
- **Files:** `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`; inspect `apps/web/src/components/FloatingSearchProvider.tsx`, `apps/web/src/components/watch/WatchModalActivityProvider.tsx`, and `apps/web/src/components/watch/WatchModalActivityProvider.test.tsx` without editing when the contract is already correct.
- **Approach:** Use the characterization result to correct the smallest existing lifecycle or state-publication gap only when one is proven. Preserve token aggregation, synchronous activity observation, close-transition coverage, and identity-aware resume semantics.
- **Patterns to follow:** The provider-owned `open || closing` registration in `FloatingSearchProvider` and provenance checks in `usePauseForWatchModal`.
- **Test scenarios:**
  - Cold and warm search opens both pause playing media.
  - Rapid open-close-reopen does not produce an intermediate resume.
  - A media attachment or source replacement during search remains paused and receives no stale resume entitlement.
  - Another active modal token prevents search close from resuming media.
- **Execution outcome:** The real search provider already acquires modal activity from `open || closing`, and registered media already enforce identity-aware pause/resume. The integrated test locks that seam without adding a duplicate search-specific pause effect.
- **Verification:** Focused search and activity-provider coverage pass without duplicate pause or play calls; broader player suites remain unchanged because runtime code did not change.

### U3. Prove the browser behavior and close the tracked work

- **Goal:** Verify the fix on the real Watch UI, capture visual evidence, and complete the roadmap and plan records.
- **Requirements:** R1-R9.
- **Dependencies:** U2.
- **Files:** `docs/roadmap/platform/feat-336-watch-search-background-playback-pause.md`, `docs/plans/2026-08-05-002-fix-watch-search-playback-pause-plan.md`, `docs/solutions/ui-bugs/watch-modal-playback-coordination.md` (conditional: update only when the regression reveals a reusable failure mode).
- **Approach:** Repeat the U1 browser profile with an actively advancing background video through cold search open, lazy-controller handoff, and close. Record paused/current-time evidence in addition to a screenshot, verify keyboard focus and Escape close, and update the durable solution only if the regression reveals a reusable failure mode.
- **Patterns to follow:** The browser and resource-timing proof documented in `docs/solutions/ui-bugs/watch-modal-playback-coordination.md` and poster-first verification in `docs/solutions/performance-issues/watch-hero-poster-idle-autoplay-20260610.md`.
- **Test scenarios:** Test expectation: none -- this unit verifies runtime behavior and updates durable records after automated coverage passes.
- **Execution outcome:** On production `/watch`, the only underlay video changed from `paused: false` at 1.457 s to `paused: true` at 1.565 s immediately after search opened. It remained paused at 0 s through six Russian-query results and a carousel source change. A separate same-source open/close cycle resumed playback after the 200 ms close boundary, advancing from 3.161 s to 3.878 s. The search input retained focus while open and the browser console remained clean.
- **Verification:** While search is open, the inspected media reports `paused === true` and its `currentTime` remains stable; normal identity-aware playback behavior returns after close. The cold-load comparison retains zero video elements and no Mux stream requests at `load`, with player mounting still gated by load-plus-idle or explicit user intent.

---

## Scope Boundaries

### In scope

- Floating search modal activity and every Watch media surface already registered with the shared pause hook.
- Cold first-open, lazy-controller handoff, closing transition, and exact-media resume behavior.

### Deferred to Follow-Up Work

- Media previews intentionally rendered inside search results, unless browser reproduction shows they are the reported source and should follow a separate product rule.
- Playback coordination outside the Watch route layout.
- Search-launcher focus restoration after Escape, tracked in `docs/roadmap/content-discovery/feat-337-watch-search-focus-restoration.md` after browser verification found the pre-existing focus fallback.

---

## Risks & Dependencies

- A test that preloads the search controller can miss the cold first-open regression; the first scenario must exercise the instant shell before lazy work settles.
- React effect ordering and synchronous token state are part of the existing safety contract. A fix that adds another boolean or modal-specific effect can restore pause while weakening overlap and resume correctness.
- Browser proof must inspect `paused` and `currentTime`; a blurred screenshot alone cannot prove playback stopped.

---

## Sources & Research

- `docs/solutions/ui-bugs/watch-modal-playback-coordination.md` defines the shared ownership and media-provenance contract.
- `docs/solutions/ui-bugs/watch-search-first-open-lazy-shell-autofocus.md` establishes the cold first-open shell as a distinct interaction path.
- `docs/solutions/ui-bugs/watch-search-modal-close-reset.md` defines the shared search close boundary.
- `docs/roadmap/platform/feat-264-watch-modal-playback-coordination.md` is complete, so this regression receives a new follow-up ticket.
