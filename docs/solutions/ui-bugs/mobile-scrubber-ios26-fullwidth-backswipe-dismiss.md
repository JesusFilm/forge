---
title: "Scrubber drags dismissed the watch page: iOS 26's full-width back-swipe claims the touch before PanResponder runs"
date: "2026-08-19"
category: "ui-bugs"
module: "apps/mobile"
problem_type: "ui_bug"
component: "frontend_stimulus"
severity: "high"
symptoms:
  - "Dragging the video seek bar rightward dismisses the whole watch page instead of seeking"
  - "The thumb moves a little, then the screen pops back to the previous route"
  - "iOS 26 only: the same build scrubs correctly on earlier iOS and on Android"
  - "Nothing logs, and no unit test fails — the conflict lives in the native gesture layer"
  - "Writing gestureEnabled on the nested watch screen alone changes nothing"
root_cause: "logic_error"
resolution_type: "code_fix"
related_components:
  - "apps/mobile/src/lib/backSwipe.ts"
  - "apps/mobile/src/lib/scrubber.ts"
  - "apps/mobile/src/components/watch/Scrubber.tsx"
  - "apps/mobile/src/components/watch/PlayerControls.tsx"
  - "apps/mobile/src/hooks/useFullscreenPresentation.ts"
  - "apps/mobile/app/_layout.tsx"
  - "apps/mobile/app/__tests__/backSwipeGesture.guard.test.js"
tags:
  - "mobile"
  - "ios26"
  - "react-native-screens"
  - "panresponder"
  - "gesture-conflict"
  - "scrubber"
  - "back-swipe"
  - "video-player"
framework_version: "react-native-screens 4.26.2 / expo 57.0.14 / react-native 0.86.2"
---

# Scrubber drags dismissed the watch page: settle gesture ownership by geometry, not arbitration

## Problem

On the mobile watch page, a rightward drag on the video progress slider dismissed
the whole page mid-scrub. The viewer lost the screen instead of seeking.

The scrubber is a JavaScript `PanResponder`
(`apps/mobile/src/components/watch/Scrubber.tsx:127`). The page-dismiss gesture is
a native UIKit recognizer. On iOS 26 the two want the same touch, and the native
recognizer always wins: it claims the touch at delivery, before any JavaScript
runs. A JavaScript responder cannot outrace it. A rightward scrub _was_ the
back-swipe.

Three separate facts combine to produce the failure. Each one is verifiable in
the vendored library sources.

**1. iOS 26 makes the back-swipe full-width by default.** react-native-screens
initialises the screen's `fullScreenSwipeEnabled` to "undefined"
(`apps/mobile/node_modules/react-native-screens/ios/RNSScreen.mm:95`), and resolves
undefined to full-width on iOS 26 only:

```objc
// RNSScreen.mm:423-435 — isFullScreenSwipeEffectivelyEnabled
case RNSOptionalBooleanUndefined:
  if (@available(iOS 26, *)) {
    return YES;
  }
  return NO;
```

An app that never set the prop got an edge-only pop before iOS 26 and a
full-width pop after it. No app code changed.

**2. The native recognizer claims the touch first.** On iOS 26 the pop runs on
UIKit's `interactiveContentPopGestureRecognizer`
(`apps/mobile/node_modules/react-native-screens/ios/RNSScreenStack.mm:1111-1114`).
The React Native responder system negotiates only among React views. It has no
say over a UIKit recognizer that has already claimed the touch.

**3. A `gestureEnabled` write on the nested screen alone is inert.** The watch
route is a nested stack (`apps/mobile/app/watch/_layout.tsx`) inside the root
stack (`apps/mobile/app/_layout.tsx`). Each `RNSScreenStackView` reads
`gestureEnabled` off its OWN top screen and refuses when it holds fewer than two
view controllers:

```objc
// RNSScreenStack.mm:1083-1096
RNSScreenView *topScreen = _reactSubviews.lastObject;
...
if (![topScreen isKindOfClass:[RNSScreenView class]] || !topScreen.gestureEnabled ||
    _controller.viewControllers.count < 2 || [topScreen isModal]) {
  return NO;
```

The nested stack holds one screen, so it never serves the dismissing pop. The
ROOT stack does, and it consults only its own top screen. A write that reached
just the nested screen changed nothing.

## Symptoms

- Dragging the seek bar to the right dismissed the watch page. The seek did not
  complete.
- The failure was iOS-only and iOS-26-only. The same build on an earlier iOS, and
  on Android, scrubbed correctly.
- Nothing logged. Both gestures behaved exactly as each was written to behave.
- No unit test failed. The scrubber's own math was correct; the conflict lived in
  the native gesture layer, which no jest suite reaches.

## What Didn't Work

### Attempt 1 — `fullScreenGestureEnabled: false`

The intuitive fix. The option maps straight to the native prop
(`apps/mobile/node_modules/expo-router/build/react-navigation/native-stack/views/NativeStackView.native.js:209`,
`fullScreenSwipeEnabled: fullScreenGestureEnabled`), so it looked like a return to
the pre-26 edge-only behaviour.

It killed ALL back-swipe on iOS 26. Verified in the simulator. The sources show
why nothing was left to fall back on. With no custom swipe animation selected,
iOS 26 declines the legacy full-screen recognizer unconditionally, and gates the
only remaining path on the prop that was just turned off:

```objc
// RNSScreenStack.mm:1107-1115 (iOS 26 branch)
if ([gestureRecognizer isKindOfClass:[RNSPanGestureRecognizer class]]) {
  return customAnimationOnSwipePropSetAndSelectedAnimationIsCustom ? ... : NO;
}
if (gestureRecognizer == _controller.interactiveContentPopGestureRecognizer) {
  return customAnimationOnSwipePropSetAndSelectedAnimationIsCustom ? NO
                                                                   : topScreen.isFullScreenSwipeEffectivelyEnabled;
}
```

The library's own edge recognizer is not a fallback either — it declines unless
`customAnimationOnSwipe` is set (`RNSScreenStack.mm:838-841`). There is no
"legacy edge pop" waiting behind the full-screen one on iOS 26. Turning the
full-screen swipe off removes the page's only way back.

### Attempt 2 — a chrome-mounted `gestureEnabled` hold (shipped, then reverted)

This one shipped in an early commit on PR #1966 and code review caught it
before merge. It held `gestureEnabled` false while the player chrome — the
scrubber's host — was mounted, and correctly wrote both the screen and its
parent:

```ts
// superseded
const gestureEnabled = !isFullscreen && !backSwipeHeld
```

The hold released when the chrome auto-hid. The chrome auto-hides on an
inactivity timer, and that timer never arms while the video is paused:

```ts
// apps/mobile/src/lib/autoHide.ts:29
if (isPaused) return false
```

Paused and ended both surface as `isPaused` (`autoHide.ts:20-23`). So in either
state the chrome never hid, the hold never released, and **pausing a video killed
the edge back-swipe for the screen's whole life.** Reproduced on the iOS 26
simulator.

The trap is general: a hold whose release depends on a timer is only as reliable
as that timer's arming condition. The original manual test — swipe with the
chrome hidden — passed, because it exercised the one state where the hold was
already released.

## Solution

Stop arbitrating the touch. Split the screen by geometry so the two gestures
never want the same touch. The pop keeps a narrow left strip; the scrubber
declines any touch that starts inside it.

**One constant owns both halves** so they cannot drift apart:

```ts
// apps/mobile/src/lib/backSwipe.ts:9-20
export const BACK_SWIPE_EDGE_WIDTH = 24

export const BACK_SWIPE_RESPONSE_DISTANCE = {
  end: BACK_SWIPE_EDGE_WIDTH,
} as const
```

**Half one — confine the pop.** Every screen on a player stack carries
`gestureResponseDistance: BACK_SWIPE_RESPONSE_DISTANCE`: the root stack's `watch`
and `series` entries (`apps/mobile/app/_layout.tsx:355-371`), plus each nested
`[slug]` for episode-to-episode pops (`apps/mobile/app/watch/_layout.tsx:46`,
`apps/mobile/app/series/_layout.tsx:47`).

**Half two — decline the strip.** A pure predicate answers "may a scrub start at
this screen X?":

```ts
// apps/mobile/src/lib/scrubber.ts:76-80
export function mayStartScrub(startX: number, edgeGuardWidth: number): boolean {
  if (!Number.isFinite(startX) || !Number.isFinite(edgeGuardWidth)) return true
  if (edgeGuardWidth <= 0) return true
  return startX >= edgeGuardWidth
}
```

It fails OPEN. A non-finite input or a zero guard accepts every touch, so a bad
value degrades to the old behaviour rather than deadening the bar.

**Both responder gates consult it**, not just the start gate — a move-phase
capture would otherwise still steal a drag that began inside the strip
(`Scrubber.tsx:135-146`).

**`gestureEnabled` is a pure function of fullscreen again**, written to both the
screen and its parent:

```ts
// apps/mobile/src/hooks/useFullscreenPresentation.ts:31-38
const gestureEnabled = !isFullscreen
useEffect(() => {
  const apply = () => {
    navigation.setOptions({ gestureEnabled })
    navigation.getParent()?.setOptions({ gestureEnabled })
  }
```

The write is focus-gated (`useFullscreenPresentation.ts:42-43`) so a covered
screen cannot clobber the top screen's options, and the focus listener replays
this screen's truth on return.

### The Android half — the guard is a pure regression there

Shipping the guard unconditionally cost Android seek area and bought nothing.
Three facts, each verifiable:

- react-native-screens DISCARDS `gestureResponseDistance` on Android. The setter
  is `= Unit`
  (`apps/mobile/node_modules/react-native-screens/android/src/main/java/com/swmansion/rnscreens/ScreenViewManager.kt:281-284`),
  inside a block the library itself labels `// mark: iOS-only` (line 234) …
  `// END mark: iOS-only` (line 326).
- Android's back is the OS system gesture, popped in JavaScript. react-navigation
  forces the native prop off before it reaches native:
  `gestureEnabled: Platform.OS === 'android' ? false : gestureEnabled`, with the
  comment "This prop enables handling of system back gestures on Android / Since
  we handle them in JS side, we disable this"
  (`NativeStackView.native.js:209-213`).
- In 3-button navigation mode there is no system edge gesture at all, so the app
  certainly receives that touch — and certainly refused it.

Nothing competed, yet the scrubber declined its leftmost 24 dp. On a 390 dp-wide
screen that is about 6% of the timeline, deleted for free. The gate lives at the
single call site:

```tsx
// apps/mobile/src/components/watch/PlayerControls.tsx:350-352
edgeGuardWidth={
  Platform.OS === "ios" && !fullscreen ? BACK_SWIPE_EDGE_WIDTH : 0
}
```

Fullscreen also passes 0: fullscreen cannot pop, so the bar keeps its full width
there. `mayStartScrub` already treats 0 as "accept every touch", so no other file
changed.

### The secondary trap — `gestureState.x0` is 0 before grant

The move-phase gate first read the origin from `gestureState.x0`. PanResponder
assigns `x0` only at GRANT, and the move-capture gate runs precisely while
nothing has granted. So `mayStartScrub(g.x0, ...)` compared 0 against the guard
on every call — a constant, not an origin test. It reported "declined" for every
drag, whatever its true origin.

The fix records the origin in a ref from the start-capture gate, which is an
observer only:

```tsx
// apps/mobile/src/components/watch/Scrubber.tsx:131-146
onStartShouldSetPanResponderCapture: (e: GestureResponderEvent) => {
  touchStartXRef.current = e.nativeEvent.pageX
  return false          // observing only; true would capture every player touch
},
onStartShouldSetPanResponder: (e: GestureResponderEvent) =>
  mayStartScrub(e.nativeEvent.pageX, edgeGuardRef.current),
onMoveShouldSetPanResponderCapture: (_e, g) =>
  mayStartScrub(touchStartXRef.current, edgeGuardRef.current) &&
  Math.abs(g.dx) > Math.abs(g.dy) &&
  Math.abs(g.dx) > 2,
```

`edgeGuardRef` mirrors the live prop (`Scrubber.tsx:81-82`) because the
`PanResponder` is built once but the guard width changes with fullscreen.

## Why This Works

The design removes the contest instead of trying to win it.

**The pop stops asking for the scrubber's touches.** On iOS 26 the recognizer
consults the response rectangle and declines outside it:

```objc
// RNSScreenStack.mm:843-848
if (gestureRecognizer == _controller.interactiveContentPopGestureRecognizer &&
    ![self isInGestureResponseDistance:gestureRecognizer topScreen:topScreen]) {
  return NO;
}
```

`isInGestureResponseDistance` (`RNSScreenStack.mm:1014-1034`) rejects a touch
when `end != -1 && x > end`. With `end: 24`, only a touch at x ≤ 24 may start the
pop. Everything to the right of the strip reaches JavaScript untouched, so the
scrubber owns it outright.

**The scrubber stops asking for the pop's touches.** Inside the strip the native
recognizer wins regardless — that race is unwinnable by construction. Declining
is therefore not a concession, it is the only correct answer. Accepting is what
produced a drag half-read as a scrub and half-read as a dismiss.

**The two halves cannot disagree**, because `BACK_SWIPE_RESPONSE_DISTANCE` is
built FROM `BACK_SWIPE_EDGE_WIDTH`. There is no second number to keep in sync.

**Back-swipe survives.** Unlike `fullScreenGestureEnabled: false`, the pop is
narrowed, not removed. The full-width recognizer stays armed and simply confines
itself. `gestureEnabled` returns to a pure function of fullscreen, so no
transient UI state can strand the gesture off.

Verified on the iOS 26.4 simulator: a paused video still edge-swipes away, a
mid-track scrub seeks without dismissing, an edge-origin drag does not scrub, and
an edge swipe across the scrubber band dismisses. Verified on a Pixel 9a
(Android 15) emulator: a mid-track scrub works and the leftmost 24 dp of the
timeline responds again. Shipped on PR #1966 (open at the time of writing, on
`fix/mobile-scrubber-back-swipe-watch-polish`).

## Prevention

**Pin the WIDTH, never only the identifier.** The first version of the guard test
(early in PR #1966) matched `gestureResponseDistance:\s*BACK_SWIPE_RESPONSE_DISTANCE`
and nothing else. Setting `BACK_SWIPE_EDGE_WIDTH = 0` would restore the full-width
pop while every layout still contained the token and every test stayed green.
`apps/mobile/app/__tests__/backSwipeGesture.guard.test.js:75-83` now pins the
value AND that the rectangle is built from it. Falsify it by editing the constant
to `0`.

**Pin the platform gate as a literal, and reject the reverted form.** The guard
asserts the source contains
`'Platform.OS === "ios" && !fullscreen ? BACK_SWIPE_EDGE_WIDTH : 0'` and does NOT
contain `"edgeGuardWidth={fullscreen ? 0 : BACK_SWIPE_EDGE_WIDTH}"`
(`backSwipeGesture.guard.test.js:107-112`). A negative assertion against the
exact prior expression is what stops a silent revert to the Android regression.

**Pin both responder gates and the origin ref.** The same suite (lines 127-137)
requires `mayStartScrub(e.nativeEvent.pageX, ...)`,
`mayStartScrub(touchStartXRef.current, ...)`, the assignment
`touchStartXRef.current = e.nativeEvent.pageX`, and asserts the source does NOT
contain `"mayStartScrub(g.x0"`. That last line is the only thing standing between
the code and a gate that silently degrades to a constant.

**Give every source-text guard a positive control.** `findScreensMissingOptOut`
is a pure detector run against a fixture with one screen deliberately missing the
option (`backSwipeGesture.guard.test.js:51-65`). Without it, the suite proves
only that today's tree passes, not that the mechanism can flag a real omission.

**Never gate a navigation gesture on transient UI state.** Only fullscreen may
disable the back-swipe. `useFullscreenPresentation.test.tsx` pins that the
gesture stays enabled whenever the player is not fullscreen, and asserts
`setOptions` was never called with `{ gestureEnabled: false }` in that case. When
you must hold a gesture, enumerate every path that releases the hold and name the
state where the release condition cannot fire — here, `shouldArmHideTimer`
returning false while paused. This is the same law as the watch-autostart veil
gate: always pair a gate with an unconditional release.

**Write every `gestureEnabled` change to the screen AND its parent.** A nested
route's dismissing pop belongs to the root stack, which reads only its own top
screen (`RNSScreenStack.mm:1083-1096`). Keep the write focus-gated so a covered
screen cannot clobber the top screen's options.

**Read the vendored native source, not the docs, for gesture behaviour.** Two
answers here are invisible from JavaScript: the iOS-26 default lives in an
Objective-C switch on an optional boolean (`RNSScreen.mm:423-435`), and the
Android no-op lives in a Kotlin setter that returns `Unit`
(`ScreenViewManager.kt:281-284`). Grep the installed dependency directly under
`apps/mobile/node_modules/react-native-screens/` (`ios/` and `android/`) — those
paths are untracked, so they exist only after an install.

**Check the FORK, not the package, for react-navigation behaviour.** expo-router
ships its own copy at
`apps/mobile/node_modules/expo-router/build/react-navigation/native-stack/views/NativeStackView.native.js`.
That is the file that runs. `@react-navigation/native-stack` is also installed
and happens to agree today; treating it as authoritative is a habit that will
eventually give a confidently wrong answer.

**Verify a gesture fix on BOTH platforms before calling it done.** A guard that
buys back a native recognizer on one platform is a pure cost on a platform with
no such recognizer. Android verification is what found the deleted 6% of
timeline. In Android's 3-button navigation mode there is no system edge gesture
at all — a useful worst case, because the app definitely receives the touch it
was refusing.

**Environment stamp.** Verified 2026-08-19 against react-native-screens 4.26.2,
expo-router 57.0.14, expo 57.0.14, react-native 0.86.2, and
`@react-navigation/native-stack` 7.14.12. The iOS 26 branches above are guarded
by `@available(iOS 26, *)` and `RNS_IPHONE_OS_VERSION_AVAILABLE(26_0)`; re-check
`isFullScreenSwipeEffectivelyEnabled` and the `ScreenViewManager.kt` iOS-only
block after any react-native-screens upgrade.

## Related Issues

- PR [#1966](https://github.com/JesusFilm/forge/pull/1966) — the change documented here (open at the time of writing).
- PR [#1948](https://github.com/JesusFilm/forge/pull/1948) — immediate predecessor; introduced the `useFullscreenPresentation.ts` surface this fix also writes to.
- [Paged hero chrome unreachable](../ui-bugs/paged-hero-overlay-chrome-touch-architecture.md) — the repo's prior art for settling gesture ownership by predetermined geometry rather than a runtime race. This learning applies the same principle one layer down, at the native-stack-vs-JS boundary.
- [Autostart veil gate strands viewers](../logic-errors/mobile-watch-autostart-veil-gate-missing-release-path.md) — the rejected chrome-mounted hold failed through the exact same mechanism: `shouldArmHideTimer` never arms while paused or ended, so anything keyed off chrome visibility never releases. Second instance of the same gap.
- [A plain View needs `accessible` for `accessibilityRole`](../mobile/rn-view-accessible-required-for-accessibilityrole.md) — same `Scrubber.tsx` component, and the same meta-lesson: this control's correctness is only provable on a device, not by reading props.
- [expo-dev-launcher root VC blocks fullscreen rotate](../integration-issues/expo-dev-launcher-root-vc-blocks-fullscreen-rotate.md) — same hook, same react-native-screens native layer, and another gotcha that only reproduced on a specific build configuration.
