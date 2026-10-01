---
title: "A slow drag on a ScrollView inside a PanResponder pager moves the pager: on Fabric iOS, an ancestor that holds the JS responder stops the native scroll"
date: "2026-10-01"
category: "ui-bugs"
module: "apps/mobile"
problem_type: "ui_bug"
component: "frontend_stimulus"
severity: "medium"
symptoms:
  - "A slow drag on a long open clip description moves the Explore feed to the next or previous clip"
  - "A fast drag on the same text scrolls the text, so a quick test does not show the bug"
  - "A slow drag that starts while the text still coasts after a fling also moves the feed"
  - "A nested responder fix passes every unit test and still fails the coast case on a device"
  - "Nothing logs, and jest cannot show the native scroll refusal"
root_cause: "logic_error"
resolution_type: "code_fix"
framework_version: "react-native 0.86.3 (Fabric, New Architecture), expo ~57.0.26"
related_components:
  - "apps/mobile/src/components/explore/ExplorePager.tsx"
  - "apps/mobile/src/components/explore/ClipDescription.tsx"
  - "apps/mobile/src/components/explore/ClipProgressBar.tsx"
  - "apps/mobile/src/components/explore/ExploreFeed.tsx"
  - "apps/mobile/CLAUDE.md"
retire_when: "A React Native release stops letting an ancestor JS responder refuse a nested scroll (_shouldDisableScrollInteraction in RCTScrollViewComponentView.mm) or stops a coasting ScrollView from capturing the touch start (_handleStartShouldSetResponderCapture in ScrollView.js); on each React Native upgrade, read both in the installed source"
tags:
  - "mobile"
  - "react-native"
  - "ios"
  - "fabric"
  - "panresponder"
  - "gesture-conflict"
  - "scrollview"
  - "nested-scroll"
  - "touch-events"
  - "explore-feed"
---

# A slow drag on a ScrollView inside a PanResponder pager moves the pager: on Fabric iOS, an ancestor that holds the JS responder stops the native scroll

## Problem

The Explore tab is a vertical clip feed. Its pager is a JS `PanResponder` that is an ANCESTOR of each clip's open description, and the open description is a `ScrollView` on the same vertical axis. On Fabric iOS, a scroll view refuses to start a drag while any ancestor holds the JS responder. So a slow drag on long text gave the drag to the pager, which moved the feed to another clip.

Paths below that start with `RN/` are in the installed React Native 0.86.3 package (`node_modules/.pnpm/react-native@0.86.3_*/node_modules/react-native/`), and their line numbers are for that version. The fix is in PR #2528, open and unmerged as of 2026-10-01.

## Symptoms

- TestFlight, iOS: a drag up or down on a long open description (to read it, or to reach "Less") moved the feed to the next or previous clip.
- A SLOW drag reproduced it every time on the iPhone SE simulator. A FAST drag scrolled the text. So the bug looked random.
- A slow drag that started while the text still coasted after a fling also moved the feed. This case survived the first fix (see "What Didn't Work").
- Nothing logs. No unit test fails. The refusal happens in native UIKit code that jest does not run.

## What Didn't Work

1. **A responder view that WRAPS the `ScrollView`.** The wrapper is an ancestor of the scroll view. When the wrapper holds the JS responder, the scroll view refuses to drag, for the same reason the pager does (see "Why This Works"). So the wrapper only moved the bug.

2. **A nested `PanResponder` "drag owner" View INSIDE the `ScrollView`.** It claimed on start, claimed moves before the pager's 10 pt slop, refused termination, and set `onShouldBlockNativeResponder: false`. Unit tests passed, and normal drags worked on a device. It failed one case: a slow drag that starts while the text still coasts after a fling. The cause is in React Native's own `ScrollView`:
   - `_handleStartShouldSetResponderCapture` returns true while `_isAnimating()` (`RN/Libraries/Components/ScrollView/ScrollView.js:1474-1480`). `_isAnimating()` is true while momentum runs, or for 16 ms after it ends (`ScrollView.js:695`, `ScrollView.js:1321-1329`). So during a coast the `ScrollView` takes the touch start in the CAPTURE phase, ahead of every child.
   - With a responder set, the renderer starts move negotiation at the lowest common ancestor of the responder and the touch target. When that ancestor IS the responder, it skips the responder and asks only the responder's ancestors (`RN/Libraries/Renderer/implementations/ReactFabric-dev.js:16350-16393`). The drag owner is a descendant, so nobody asks it. The pager is an ancestor, so it is asked and claims the move.
   - The renderer then sends the `ScrollView` a termination request (`ReactFabric-dev.js:16447-16468`). `_handleResponderTerminationRequest` returns `!this._observedScrollSinceBecomingResponder` (`ScrollView.js:1404-1406`). That flag resets on grant (`ScrollView.js:1337`) and becomes true only on a scroll event (`ScrollView.js:1145-1146`). No scroll event arrives before a slow drag passes 10 pt, so the `ScrollView` agrees, and the pager moves the feed.
   - Reproduced on a device: a fling, then a slow drag, moved "Cleaning the Lamps" to "Poetry (Episode 9)".

3. **`onShouldBlockNativeResponder: false` does nothing on iOS.** Fabric iOS ignores the flag. `setIsJSResponder:blockNativeResponder:forShadowView:` passes only `isJSResponder` to the view (`RN/React/Fabric/Mounting/RCTMountingManager.mm:274-283`). The flag matters only on Android, where it calls `requestDisallowInterceptTouchEvent(true)` (`RN/ReactAndroid/src/main/java/com/facebook/react/fabric/mounting/SurfaceMountingManager.kt:1010-1013`, `RN/ReactAndroid/src/main/java/com/facebook/react/touch/JSResponderHandler.kt:31-42`). `PanResponder` sets it to true by default (`RN/Libraries/Interaction/PanResponder.js:468-470`).

4. **Two device-test traps gave false results.**
   - **Fast Refresh kept the old pager engine.** `ExplorePager` builds its engine once into a ref (`apps/mobile/src/components/explore/ExplorePager.tsx`), and refs survive Fast Refresh (seen in this session on React Native 0.86.3 and Expo SDK 57). So after an edit to `ExplorePager.tsx`, the new `hold` API was undefined, and the fix looked broken. In this session, `POST http://localhost:8123/reload` returned 200, but Metro logged no new bundle request, so the app did not reload. Only a cold relaunch loaded the new code (`xcrun simctl terminate`, then `openurl forgemobile://expo-development-client/?url=...`). Look for a new "iOS Bundled" line in Metro's log before you trust a result.
   - **Clip-end auto-advance looked like a leaked swipe.** The same branch makes an ended clip move the feed (`onClipEnd` in `ExploreFeed.tsx`). During long tests, a clip end changed the clip and looked like the bug. A temporary `console.log("[probe-move]", move, trigger)` in `ExploreFeed`'s `handleMove` separated `viewer` moves from `clipEnd` moves.

## Solution

The fix gives a child of the pager a way to stop the pager from claiming a drag. The child takes that "hold" from TOUCH events, not from the responder system. (Fix in PR #2528, unmerged as of 2026-10-01.)

### 1. The pager exposes a hold with two scopes

`ExplorePager.tsx` puts a `hold(scope)` function in a React context. `useExplorePagerHold()` returns it, or null outside a pager. Each call returns one release; a second call to the same release does nothing, because it deletes one token from a `Set`.

Before (`main`):

```ts
onMoveShouldSetPanResponder: (_event, gesture) =>
  Math.abs(gesture.dy) > PAN_SLOP_PX &&
  Math.abs(gesture.dy) > Math.abs(gesture.dx),
```

After (`ExplorePager.tsx`):

```ts
onMoveShouldSetPanResponder: (_event, gesture) =>
  holds.drag.size === 0 &&
  Math.abs(gesture.dy) > PAN_SLOP_PX &&
  Math.abs(gesture.dy) > Math.abs(gesture.dx),

requestMove: (move, by) => {
  if (settling != null || panning || holds.drag.size > 0) return false
  if (by === "feed" && holds.feedMove.size > 0) return false
  // ...
},
```

- `drag`: the pager claims no drag, and `requestMove` refuses.
- `feedMove`: only the feed's own move refuses. The imperative handle passes `"feed"`. The screen reader's next and previous actions pass `"viewer"`. A swipe does not go through `requestMove`, so it still moves.
- `dispose()` clears both sets.

### 2. The open description takes the `drag` hold from `onTouchStart`

Before (`main`), the open description was a bare `ScrollView` with no hold:

```tsx
<ScrollView
  style={{ maxHeight: Math.round(height * EXPANDED_MAX_SCREEN_SHARE) }}
  nestedScrollEnabled
>
```

After (`ClipDescription.tsx`):

```tsx
const holdPager = useExplorePagerHold()
const scrolls = viewport > 0 && content - viewport > 1

// Touch events reach this view whoever holds the responder: a scroll view
// that coasts takes the touch start itself, ahead of every child.
const handleTouchStart = (e: GestureResponderEvent) => {
  if (!scrolls || holdPager == null) return
  for (const finger of ownFingers(e)) {
    fingers.current.add(String(finger.identifier))
  }
  if (fingers.current.size > 0) release.current ??= holdPager("drag")
}

<ScrollView
  style={{ maxHeight }}
  nestedScrollEnabled
  onLayout={handleLayout}
  onContentSizeChange={handleContentSize}
  onTouchStart={handleTouchStart}
  onTouchEnd={handleTouchEnd}
  onTouchCancel={releasePager}
>
```

- It holds only while the text scrolls: `content - viewport > 1`, from `onLayout` and `onContentSizeChange`. Text that fits leaves the drag to the pager, so a short open description still swipes.
- It releases when its own fingers are up, on `onTouchCancel`, and on unmount. The unmount release matters because "Less" closes the view under the finger before its touch end arrives.
- It holds `feedMove` for as long as it is mounted. So a clip whose description is open loops at its end, and the text does not jump away from the reader.

### 3. The hold counts the description's OWN fingers

A code review found a stuck hold. The first version released when `touches.length === 0`. On iOS, that list holds every active touch on the surface. So a second finger resting on the video kept the list full forever, and that finger's end never reached the description. The hold stayed set and locked the feed.

The fix reads the fingers on this view (`ClipDescription.tsx`):

```ts
function ownFingers(e: GestureResponderEvent): readonly Finger[] {
  const native = e.nativeEvent as { targetTouches?: readonly Finger[] }
  return native.targetTouches ?? e.nativeEvent.changedTouches
}
```

It deletes each `changedTouches` id on touch end, and releases when its set is empty, or when the surface has no touches left. The platform facts behind this:

- iOS binds each finger to the emitter of the view it started on (`RN/React/Fabric/RCTSurfaceTouchHandler.mm:82-89`). `_dispatchActiveTouches` sends an event only to the emitters of the CHANGED fingers (`RCTSurfaceTouchHandler.mm:256-263`, `RCTSurfaceTouchHandler.mm:278-299`).
- In that event, `touches` holds every active touch on the surface (`RCTSurfaceTouchHandler.mm:266-276`). `changedTouches` holds every changed touch in the batch, across ALL emitters (`RCTSurfaceTouchHandler.mm:256-263`). `targetTouches` holds the active touches on this emitter only (`RCTSurfaceTouchHandler.mm:278-285`). `TouchEventEmitter.cpp:31-36` sends all three to JS.
- Android sends no `targetTouches` (`RN/ReactAndroid/src/main/java/com/facebook/react/uimanager/events/TouchesHelper.kt:24-25`, `TouchesHelper.kt:137-140`). But Android sends every pointer of a gesture to the target of its first pointer (`RN/ReactAndroid/src/main/java/com/facebook/react/uimanager/JSTouchDispatcher.kt:96-109`, `JSTouchDispatcher.kt:170-176`). So `changedTouches` is the right fallback there.

### 4. A scrub also holds `feedMove`

`ClipProgressBar.tsx` takes a `feedMove` hold at its pan grant, and releases it on release, on terminate, and on unmount. So a clip that ends during a scrub loops, and the release seek lands on that clip.

### 5. The rule is documented

`apps/mobile/CLAUDE.md` ("Explore clips feed") states the hold rules, the own-finger rule, the "touch events, not a nested responder" rule, and the test traps.

## Why This Works

**The root cause is a native refusal, decided by an ANCESTOR's JS responder.** `_shouldDisableScrollInteraction` walks the scroll view's superview chain. It returns YES when any ancestor `isJSResponder` (`RN/React/Fabric/Mounting/ComponentViews/ScrollView/RCTScrollViewComponentView.mm:566-582`). `touchesShouldCancelInContentView:` returns `![self _shouldDisableScrollInteraction]` (`RCTScrollViewComponentView.mm:730-735`). When that returns NO, UIKit does not cancel the content touch, so the scroll view does not start its drag.

**A race between UIKit and JS decides who wins.** On a slow drag, JS sees the 10 pt move (`PAN_SLOP_PX`, `ExplorePager.tsx`) before UIKit's pan recognizer starts the scroll. The pager becomes the JS responder, and the native scroll is refused. On a fast drag, the native scroll starts first. The `ScrollView` then becomes the JS responder through `onScrollShouldSetResponder`, which returns `_isTouching` (`ScrollView.js:1411-1417`). After it has seen a scroll event, it refuses the pager's termination request (`ScrollView.js:1404-1406`). This race is why a fast drag worked and a slow one did not (per this session's device tests).

**The hold removes the race.** With `holds.drag.size > 0`, the pager's `onMoveShouldSetPanResponder` returns false. The pager never becomes the JS responder, so no ancestor `isJSResponder`, and the scroll view is free to drag. In the coast case, the `ScrollView` itself holds the responder. That does not block it, because the walk starts at `self.superview` and never checks the scroll view itself (`RCTScrollViewComponentView.mm:568`). And because the pager never claims, no termination request is ever sent to the `ScrollView`.

**Touch events arrive in every responder order.** `SimpleEventPlugin` delivers `onTouchStart`, `onTouchEnd` and `onTouchCancel` after `ResponderEventPlugin`, apart from responder ownership. React Native's own `ScrollView` relies on this to track `_isTouching` (`ScrollView.js:1608-1624`). So `onTouchStart` on the `ScrollView` fires even when the `ScrollView` took the touch start in the capture phase during a coast. A nested responder child does not get that chance, which is why attempt 2 failed.

**The hold sets in time.** A touch start comes before any move. The pager asks `onMoveShouldSetPanResponder` only on moves, so the hold is already set when the pager first asks.

**The own-finger set makes the release certain.** The hold counts only fingers this view saw start, and it removes each one on its own end event. A finger on another view can neither keep the hold set nor reach this view's handlers.

## Prevention

**Rule.** On Fabric iOS, do not nest a same-axis `ScrollView` inside a JS `PanResponder` pager and trust UIKit to win. Whenever the pager takes the JS responder, the nested scroll view stops. Give the child a way to veto the pager's claim, and take that veto from touch events.

**For new children of `ExplorePager`.** Any child that scrolls vertically (a list, a long text, a sheet-like panel) must call `useExplorePagerHold()` and take `drag` in `onTouchStart`, as `OpenDescription` does. Gate the hold on "the content really scrolls", so a short view still swipes. Release on own-fingers-up, on cancel, and on unmount.

**Do not:**

- Wrap the scroll view in a responder view. The wrapper is an ancestor and blocks the scroll.
- Put a responder child inside the scroll view. A coasting `ScrollView` captures the touch start first and then gives the move to the pager.
- Release a touch-start hold on `touches.length === 0` alone. On iOS, a finger on another view keeps that list full.
- Rely on `onShouldBlockNativeResponder` on iOS. Fabric iOS ignores it.

**Test pattern.** Render the REAL child inside the REAL pager. Then ask the pager's own handlers whether they claim a drag (`ClipDescription.test.tsx`):

```ts
/** Whether the pager takes a new 40 pt vertical drag. */
function pagerClaims(renderer: TestInstance): boolean {
  const [root] = renderer.root.findAll(
    (n) =>
      typeof n.type === "string" &&
      typeof n.props.onMoveShouldSetResponder === "function",
  )
  const pan = root.props as unknown as PagerPan
  pan.onStartShouldSetResponderCapture(touch(0))
  const move = touch(-40)
  pan.onMoveShouldSetResponderCapture(move)
  return pan.onMoveShouldSetResponder(move)
}
```

Drive the touch handlers with explicit `touches`, `changedTouches` and `targetTouches` shapes. One case must have a finger on another view, and one must have no `targetTouches`, as Android sends (`ClipDescription.test.tsx`):

```ts
it("lets go when its own finger lifts, while a finger elsewhere stays down", () => {
  const renderer = renderInPager(LONG)
  open(renderer, 200, 480)

  fire(renderer, "onTouchStart")
  // Finger 2 lands on the video; that start never reaches this view.
  fire(renderer, "onTouchEnd", { changed: ["1"], down: ["2"], target: ["1"] })
  expect(pagerClaims(renderer)).toBe(true)
})
```

The pager suite pins the scopes: `drag` blocks claims and `requestMove`, a release frees one token only, and `feedMove` blocks only the feed's own move while a swipe and a screen-reader action still move (`ExplorePager.test.tsx`). The overlay suite pins the scrub hold (`ClipOverlay.test.tsx`). In this session, each guard was falsified one at a time, and a test went red each time.

**Jest cannot prove the native part.** It does not run `RCTScrollViewComponentView`, and it cannot make a `ScrollView` coast. Run this device matrix on iOS and Android for any change to the pager or to a scrolling child:

1. A slow drag on long text. Only the text scrolls.
2. A fast drag on long text. Only the text scrolls.
3. A fling, then a slow drag while the text coasts. No clip change. (This session ran 12 such drags on the iPhone SE simulator; none moved a clip.)
4. A drag that starts on "Less". Only the text scrolls.
5. A short open description. A drag still swipes the feed.
6. A clip that ends while its description is open. It loops.
7. A scrub held across the clip end. The clip stays.

In this session, the matrix passed on the iPhone SE, iPhone 17 and iPhone 17 Pro Max simulators and on a Pixel 9a emulator (2026-10-01). The two-finger case could not be driven, because idb and adb have no multi-touch. Jest covers it.

**Device-test hygiene.**

- After an edit to `ExplorePager.tsx`, or to any engine built once into a ref, do a cold relaunch. Do not trust Fast Refresh or `/reload`. Confirm a new "iOS Bundled" line in Metro's log.
- When an automatic move exists (clip-end auto-advance), log the move trigger (`viewer` or `clipEnd`) before you call a clip change a leaked swipe. `explore.swipe` carries `explore_swipe_trigger` for the same purpose in telemetry (`apps/mobile/CLAUDE.md`).

## Related Issues

These are different touch conflicts, not duplicates:

- `docs/solutions/ui-bugs/panresponder-slider-in-ios-formsheet-loses-drifting-drags.md`: the reverse direction. There, a native recognizer (UIKit scroll or sheet pan) beats a JS responder. Here, a JS responder on an ancestor beats a native scroll.
- `docs/solutions/ui-bugs/mobile-scrubber-ios26-fullwidth-backswipe-dismiss.md`: a native back-swipe claims the touch before `PanResponder` runs.
- `docs/solutions/ui-bugs/paged-hero-overlay-chrome-touch-architecture.md`: a list wins the responder race over hero chrome on Home.
- `apps/mobile/CLAUDE.md`, section "Explore clips feed (feat-552)": the standing hold rules for any new child of `ExplorePager`.
- Fix: PR #2528, open and unmerged as of 2026-10-01.
