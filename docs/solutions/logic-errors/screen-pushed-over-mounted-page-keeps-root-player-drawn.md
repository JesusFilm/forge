---
title: "A screen pushed over a mounted watch page kept the root player drawn over it: cover the slot from the page's own focus, not from the route"
date: 2026-10-20
category: logic-errors
module: apps/mobile
problem_type: logic_error
component: frontend_stimulus
severity: high
framework_version: "react-native 0.86.3 (expo 57, expo-router 57.0.28, @react-navigation/core 7.17.2, @react-navigation/native-stack 7.14.12)"
symptoms:
  - "A deep link to /downloads over a watch page left the full video player drawn over the Downloads header, its Select button and the first row, on iOS and Android"
  - "A push or lapse-reminder tap to /experience/<slug> or /series/<slug> while a video played kept the player over the new screen, and on iOS the sound kept playing"
  - "A video that had ended stayed drawn at its old rect over the pushed screen"
  - "Only the Bible reader routes made the player step aside; every other pushed screen was drawn over"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - apps/mobile/src/components/watch/PlayerSlot.tsx
  - apps/mobile/src/components/watch/PlaybackHost.tsx
  - apps/mobile/src/lib/miniPlayer/presentation.ts
  - apps/mobile/src/lib/miniPlayer/playbackRequest.ts
tags:
  - mobile
  - react-native
  - mini-player
  - player-slot
  - react-navigation
  - before-remove
  - screen-cover
  - expo-router-segments
---

# A screen pushed over a mounted watch page kept the root player drawn over it: cover the slot from the page's own focus, not from the route

## Problem

The app owns one video view in `PlaybackHost`, a sibling of the root `<Stack>`. A watch or series page reserves a rect with `PlayerSlot`, and the host draws into that rect above the whole stack. The slot gave up the player only on unmount. A screen pushed over the page keeps the page mounted, so the host kept drawing the full player over the new screen.

## Symptoms

- A deep link to `/downloads` over a watch page drew the full player over the top of Downloads. It was still there after 10 s.
- A push tap to `/experience/<slug>` or `/series/<slug>` while a video played kept the player over the new screen. On iOS the sound kept playing.
- A video that had ended stayed drawn at its rect over the pushed screen.
- Only the Bible reader routes covered the slot (feat-553 KTD10, `isReaderCovering`).

## What Didn't Work

- **A cover decided by the route alone.** "Cover on any route except the watch page" cannot tell a push from a pop. A back press from a watch page onto Downloads or an experience page shows that route too, while the watch page is still on its way out. The route says the same thing in both cases. Only the slot's own screen knows which happened.
- **Ending a screen cover as soon as the segments named a watch page.** A tap on the floating window pushes a new watch page for the same video. The segments change first, and the new slot attaches a commit later. In that commit the old cover ended. `uncoverSlot` then cleared the session that the cover had started, and the new page lost the session it should adopt. If its first stream URL differed, the video reloaded. The fix holds a live screen cover on the page route until the covered page has focus again.
- **One exemption list for both pages.** The first version exempted every watch and every series route for every slot. A series with no trailer mounts no `PlayerSlot` (`apps/mobile/app/series/[slug].tsx`, the `trailerHls` memo). So a push tap to such a series left the watch slot current and uncovered, and the full player was drawn over the series page. The code review found this; the fix makes each slot name its page.
- **Publishing `underScreen=false` on `beforeRemove`.** `router.dismissTo("/(tabs)")` from Downloads removes the covered page as well. The listener ended the cover before the page unmounted, so the full view grew back for a moment and then shrank again. The fix latches the leave and publishes nothing more.
- **Resetting the "started" fact in a passive effect.** Watch A never plays, a screen opens over it, watch B opens and plays, then back from B. A becomes current again and its cover starts in the same commit. The cover's layout effect ran admission before the passive reset, so it read B's "started" and floated a video that never played. The reset is now a layout effect declared before the cover's.
- **Keying "autostart off" per slot.** A reviewer expected a second page for the same video not to autostart. A test showed that it does not autostart with either key, because the autostart plays once per source and the second page reuses the paused source. The change was reverted.

## Solution

Four parts, all in `apps/mobile`. They are on branch `fix/mobile-player-cover-and-android-weights`; no PR was open and none of it was on `main` as of 2026-10-20.

1. **The slot reports its own screen's state** (`apps/mobile/src/components/watch/PlayerSlot.tsx`). It publishes `underScreen` from its screen's `focus` and `blur`, and latches `beforeRemove` first:

   ```tsx
   const publish = () => {
     const id = slotIdRef.current
     if (id == null || leavingRef.current) return
     const focused = navigation.isFocused?.() ?? true
     store.setSlotUnderScreen(id, !focused)
   }
   navigation.addListener?.("beforeRemove", () => {
     leavingRef.current = true
   })
   ```

   Each caller passes its page (`page="watch"` or `page="series"`), and `attachSlot(request, page)` stores it.

2. **One pure function decides the cover** (`slotCoverSource` in `apps/mobile/src/lib/miniPlayer/presentation.ts:149`). A reader route gives `"reader"`. A slot under a screen gets `"screen"` on every route except its own page's routes (`SLOT_PAGE_ROUTE_PATTERNS`). On the page route itself a live screen cover holds; on the page's own sheet it ends:

   ```ts
   if (!ownRoutes.has(pattern)) return "screen"
   return liveCover === "screen" && onPage ? "screen" : null
   ```

3. **The store remembers the cover's source and keeps an adopted session** (`apps/mobile/src/lib/miniPlayer/playbackRequest.ts`). `coverSlot(id, source)` records `"reader"` or `"screen"`. Only a reader cover lays the window out for the reader, and only a reader cover returns by a pop. `uncoverSlot` clears the session that the cover started only when the covered slot is current again (`apps/mobile/src/lib/miniPlayer/playbackRequest.ts:618`). So a newer slot for the same video keeps it.

4. **The started and ended facts reset in a layout effect** (`apps/mobile/src/components/watch/PlaybackHost.tsx:934`), declared before the cover's layout effect (`:1021`).

The cover reuses the reader cover's admission and return. A started video floats in the app's corner and keeps playing. Any other video hides and pauses. Back on the page, the video grows into the full view with no reload.

## Why This Works

The fix rests on the order in which React Navigation and expo-router deliver a navigation. That order was read in the installed package sources under `node_modules` (paths below are inside each package):

- **`beforeRemove` comes before the state change.** `useOnAction` runs `shouldPreventRemove` and then `setState(result)` (`@react-navigation/core/src/useOnAction.tsx:98-110`). For a nested navigator, the parent calls the child's keyed listener, so a `[slug]` screen inside the watch group receives it too.
- **A popped screen unmounts at the state change, not after the animation.** Native stack renders only `state.routes.concat(state.preloadedRoutes)` (`@react-navigation/native-stack/src/views/NativeStackView.native.tsx:531`). React Native Screens animates the native view, but the React tree of a removed route unmounts in that commit.
- **`focus` and `blur` come later, in a passive effect** (`@react-navigation/core/src/useFocusEvents.tsx`). Unmount cleanups in the same commit run first.
- **The route segments come last.** The container calls `onStateChange` from an effect (`@react-navigation/core/src/BaseNavigationContainer.tsx:395`). expo-router passes `store.onStateChange` to it and updates its route info there (`expo-router/build/global-state/store.js:102`, `ExpoRoot.js:135`). The host can therefore see the new focus before it sees the new route.

So focus plus `beforeRemove` tells a push from a pop: a pop latches `leavingRef` before any blur arrives. The route check in `slotCoverSource` then covers the other gap: when focus arrives first, the segments still name the slot's own page, and the cover waits for the new route. It also keeps the reader cover's kind, because a reader route returns `"reader"` before the screen check.

## Prevention

- **A root-owned layer drawn over the stack must ask the page, not the route, whether the page is visible.** A route pattern cannot tell "pushed above" from "being popped". Use the screen's own `isFocused()` with a `beforeRemove` latch.
- **A new page that mounts `PlayerSlot` must pass `page` and get an entry in `SLOT_PAGE_ROUTE_PATTERNS`.** `apps/mobile/src/lib/miniPlayer/__tests__/presentation.test.ts` checks that each page's sheets match `IN_APP_SHEET_ROUTE_PATTERNS`, so a sheet added to one table only fails the test.
- **Test the transition commits, not only the end state.** `apps/mobile/src/components/watch/__tests__/PlaybackHost.test.tsx` ("a screen pushed over the watch screen") drives the focus fact before the segments, the window-tap push with the route change a commit ahead of the attach, a series page with no slot, the page's own sheet, and the watch A, screen, watch B, back sequence. In the session that wrote the fix, each part was broken once on purpose, and its test went red.
- **The event order is pinned only by mocks.** The tests fire `beforeRemove`, `blur` and the segments by hand in the order above. After a React Navigation or expo-router upgrade, re-check that order in the sources cited above and on a device. A changed order keeps the suite green.
- **Known gap, not fixed here.** Back from a second watch page that was opened over a covering screen (watch A, then an experience page, then watch B, then back) gives B no floating window. `detachSlot` treats A as "a stacked watch screen waiting to take the player back" (`apps/mobile/src/lib/miniPlayer/playbackRequest.ts:573-576`). A is still under the experience page, so A then takes the player hidden and paused. This rule predates the screen cover. Before the cover, A drew its full view over the experience page instead.

## Related Issues

- `docs/solutions/logic-errors/layout-effect-commit-lag-mini-player-shrink-flash.md`: the same host's commit-lag rule. The layout-effect reset above applies it.
- `docs/solutions/logic-errors/session-identity-needs-one-slug-tolerant-predicate.md`: the window-tap adoption depends on the slug-tolerant `sameSessionContent`, also with a slug-only first request.
- `docs/solutions/logic-errors/occluding-layers-must-share-one-gate-predicate.md`: every layer reads the one `snapshot.cover` answer: the frame, the slot's poster, and both back buttons.
- `docs/solutions/runtime-errors/mini-player-playbackrequest-identity-compare-render-loop.md`: the new slot facts (`underScreen`, `page`) are scalars written through setters that return early on an equal value.
- `docs/solutions/logic-errors/expo-router-navigate-to-tabs-from-root-stack-pushes-duplicate-navigator.md`: the Downloads `dismissTo("/(tabs)")` path that removes a covered page.
- `apps/mobile/CLAUDE.md`, "Mini player and the root-owned playback session (feat-367)": the standing rules for the cover.
