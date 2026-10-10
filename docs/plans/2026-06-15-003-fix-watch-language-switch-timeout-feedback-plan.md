---
title: Watch Language Switch Timeout Feedback Fix Plan
type: fix
status: completed
date: 2026-06-15
origin: docs/roadmap/topic-experiences/feat-191-watch-language-switch-timeout-feedback.md
---

# Watch Language Switch Timeout Feedback Fix Plan

## Summary

Keep the Watch language picker in a truthful pending state when language navigation takes longer than the current 5 second safety timeout. The fix narrows to modal state and tests; route generation, language identity, prefetch, and server data fetching stay unchanged.

---

## Problem Frame

The original pending-feedback work in `feat-107` fixed the older no-feedback path by keeping the modal open and showing `Switching...` after Apply. The remaining bug is the recovery path: if the route has not committed after 5 seconds, `pendingNavTo` clears, the button says `Apply` again, and the eventual route commit makes the modal close later. Viewers interpret that idle gap as a failed apply action even though navigation is still in flight.

---

## Requirements

- R1. A dirty-language Apply action must show `Switching...` until the target language route commits or the user intentionally closes the modal.
- R2. The 5 second recovery path must not present `Apply` as available for the same unresolved navigation.
- R3. Duplicate Apply clicks must remain ignored while a language navigation is unresolved.
- R4. Existing successful navigation catch-up must still clear pending state when `currentLanguageSlug` matches the selected target language.
- R5. Existing route, timestamp, autoplay, cookie-write, and selective-prefetch contracts must remain unchanged.

---

## Key Technical Decisions

- **Separate visible pending from retry recovery:** The timeout can remain as a guard for internal bookkeeping only if it does not make the primary action look idle while the original navigation may still finish.
- **Use Close as the visible escape hatch:** A stalled route should leave the user with the existing Close control rather than a misleading second Apply button.
- **Keep the fix inside the modal:** This is a localized feedback bug; a page-level overlay or route-performance work would broaden the slice beyond the reported behavior.

---

## Assumptions

- A route that has not committed after 5 seconds can still commit successfully, so returning to `Apply` is more misleading than keeping `Switching...`.
- Users who want to abandon a slow switch can use the modal Close action; a separate retry affordance can be planned later if production evidence shows failed navigations are common.

---

## Implementation Units

### U1. Keep Unresolved Navigation Visibly Pending

- **Goal:** Adjust the `LanguagePickerModal` in-flight state so timeout recovery does not clear the visible `Switching...` state for the current unresolved language switch.
- **Requirements:** R1, R2, R3, R4, R5.
- **Dependencies:** None.
- **Files:** `apps/web/src/components/watch/LanguagePickerModal.tsx`.
- **Approach:** Preserve the current `pendingNavTo` catch-up model, but stop the safety timeout from resetting the UI back to a dirty, enabled Apply state while `currentLanguageSlug` still differs from the target. Keep the synchronous `navigatingRef` guard aligned with the visible pending state so duplicate clicks remain blocked.
- **Patterns to follow:** Existing `pendingNavTo` derivation and open-state reset in `LanguagePickerModal.tsx`; existing route builders in `apps/web/src/lib/routes.ts`.
- **Test scenarios:** Covered in U2.
- **Verification:** Applying a changed language leaves the button disabled with `Switching...` until either the destination slug arrives or the modal is closed.

### U2. Update Navigation Guard Regression Tests

- **Goal:** Replace the stale safety-timeout expectation with coverage for the truthful pending behavior and keep the existing catch-up and duplicate-click tests.
- **Requirements:** R1, R2, R3, R4, R5.
- **Dependencies:** U1.
- **Files:** `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx`.
- **Approach:** Update the fake-timer test that currently expects Apply to re-enable after 5 seconds so it instead asserts `Switching...` remains visible and duplicate pushes do not occur. Keep the catch-up test that re-renders with `currentLanguageSlug` equal to the target and expects pending to clear.
- **Patterns to follow:** Current jsdom tests in `LanguagePickerModal.test.tsx` using `act`, fake timers, `routerPushMock`, and `writePreferredLanguageSlugMock`.
- **Test scenarios:**
  - Changed language Apply writes the cookie before `router.push`, dispatches one navigation, and shows `Switching...`.
  - Advancing timers beyond the previous 5 second recovery window keeps the button disabled with `Switching...`.
  - A second Apply click after the old timeout window does not dispatch a second `router.push`.
  - Re-rendering with the target language slug clears pending state and disables Apply because the draft matches the current route language.
  - Existing invalid-route, subtitle-only, video, series, collection-context, and prefetch tests continue to pass unchanged.
- **Verification:** The focused LanguagePickerModal test file passes.

---

## Scope Boundaries

- Do not change Admin GraphQL queries, generated GraphQL outputs, Watch route parsing, or language slug identity.
- Do not introduce a global Watch loading overlay in this slice.
- Do not change subtitles behavior except where existing combined Apply tests require compatibility.

### Deferred to Follow-Up Work

- Route performance work for cold/stale language pages if production evidence shows transitions remain too slow even with truthful modal feedback.
- A dedicated retry/cancel UI if failed navigations are observed often enough that Close is not sufficient.

---

## Risks & Dependencies

- **Risk:** If a navigation truly fails, the user may remain in `Switching...` until they close the modal. Mitigation: keep Close enabled and preserve open-state reset so reopening starts cleanly.
- **Risk:** Changing the guard can accidentally allow duplicate `router.push` after the old timeout. Mitigation: add an explicit post-timeout duplicate-click test.

---

## Sources & Research

- `docs/roadmap/topic-experiences/feat-107-watch-language-switch-pending-feedback.md` documents the original pending-feedback design and the 5 second safety timeout.
- `apps/web/src/components/watch/LanguagePickerModal.tsx` owns the current pending state and Apply button rendering.
- `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx` already pins the in-flight guard, route builders, cookie ordering, catch-up, and prefetch contracts.
