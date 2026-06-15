---
id: "feat-191"
title: "Watch Language Switch Timeout Feedback"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-06-15"
duration: 1
depends_on:
  - "feat-107"
blocks: []
tags:
  - "web"
  - "watch"
  - "ux"
---

## Problem

The Watch language picker now keeps the modal open and shows `Switching...` after Apply, but its 5 second navigation safety timeout can clear the pending state before the App Router transition commits. On slow language switches the button returns to `Apply`, appears idle, and then the modal closes a few seconds later when the destination route finally resolves.

## Entry Points - Read These First

1. `apps/web/src/components/watch/LanguagePickerModal.tsx` - `pendingNavTo`, `NAVIGATING_TIMEOUT_MS`, `navigating`, `handleApply`, and the Apply button rendering.
2. `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx` - in-flight navigation guard and safety-timeout tests.
3. `docs/roadmap/topic-experiences/feat-107-watch-language-switch-pending-feedback.md` - original pending-feedback scope and constraints.

## Grep These

- `pendingNavTo|NAVIGATING_TIMEOUT_MS|navigatingRef|Switching` in `apps/web/src/components/watch/LanguagePickerModal.tsx`
- `releases the navigation guard after the safety timeout` in `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx`
- `clears the switching state when the current language catches up` in `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx`

## What To Build

1. Keep the Apply button in an honest pending state while the route can still commit.
   - Do not let the 5 second recovery path change visible copy from `Switching...` back to `Apply` for the same unresolved navigation.
   - Keep duplicate-submit protection active while the unresolved navigation is still represented.
   - Keep the modal Close action available as the user escape path.
2. Preserve existing navigation and preference contracts.
   - Keep `writePreferredLanguageSlug` before `router.push`.
   - Keep route construction through `watchVideoPath` / `watchEpisodePath`.
   - Keep language-route prefetch best-effort.
3. Preserve the successful catch-up behavior.
   - When the parent route prop updates to the selected language, the pending state clears naturally and the modal closes/remounts through existing page state.

## Constraints

- Do not change Admin GraphQL fragments, generated types, route shapes, language identity, or Watch route data fetching.
- Do not add a global page overlay in this slice.
- Do not remove the Close affordance from the modal.
- Do not solve cold-route latency here; this ticket fixes misleading feedback.

## Verification

- Update `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx`.
- Run the focused LanguagePickerModal Vitest file.
- Run web typecheck.
- Browser smoke with Helium: switch the supplied Watch route from Russian to another playable language, press Apply, and confirm the button does not flash back to `Apply` before the modal closes or the page updates.
