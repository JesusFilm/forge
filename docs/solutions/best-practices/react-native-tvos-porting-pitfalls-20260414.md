---
title: "react-native-tvos porting pitfalls: WebView, SVG, focus engine, and scroll focus"
date: "2026-04-14"
category: best-practices
module: apps/tv
problem_type: best_practice
component: tooling
severity: high
applies_when:
  - "Porting mobile-v2 renderers or components to apps/tv"
  - "Adding npm packages with native iOS/tvOS modules to apps/tv"
  - "Building interactive overlays (Modal, bottom sheet) for the TV app"
  - "Implementing scroll-to or jump-to navigation in a TV ScrollView"
  - "pod install fails after adding a new dependency to apps/tv"
last_updated: "2026-06-25"
tags:
  - react-native-tvos
  - tvos
  - expo-tv
  - focus-engine
  - d-pad-navigation
  - react-native-webview
  - react-native-svg
  - pnpm
---

# react-native-tvos porting pitfalls: WebView, SVG, focus engine, and scroll focus

## Context

While porting 6 SDUI block renderers from `apps/mobile-v2` to `apps/tv` (Expo SDK 54, react-native-tvos 0.81, Apple TV + Android TV), four platform-specific pitfalls surfaced that are not documented in the react-native-tvos README or Expo changelog. Each manifests as either a hard crash, a build failure, or a silent UX failure that only appears when testing on a TV simulator or real hardware. None are caught by TypeScript, ESLint, or the standard test suite.

## Guidance

### 1. Lazy-require react-native-webview on tvOS -- never top-level import

tvOS ships no WebKit native module. A top-level ES `import` for `react-native-webview` triggers TurboModule registry lookup at JS bundle evaluation time -- before any `Platform.OS` guard runs -- and the app crashes immediately with:

```
Invariant Violation: TurboModuleRegistry.getEnforcing(...):
'RNCWebViewModule' could not be found.
```

Replace every top-level import with a module-scope conditional require:

```ts
// eslint-disable-next-line @typescript-eslint/no-require-imports
const WebView =
  Platform.OS === "android"
    ? (require("react-native-webview") as typeof import("react-native-webview"))
        .WebView
    : null
```

The `Platform.OS` guard prevents the `require()` call from executing on iOS/tvOS. The ESLint suppression is required because the project config bans bare `require()`.

### 2. Avoid react-native-svg on the TV app -- use pure-JS alternatives

`react-native-svg` 15.12.1's podspec calls `rnsvg_find_config()`, a Ruby helper that resolves config via Node scripts. Under pnpm's symlink structure combined with the react-native-tvos fork, the helper returns `nil` and `pod install` aborts:

```
Invalid `RNSVG.podspec` file: no implicit conversion of nil into String
```

Do not add `react-native-svg` to `apps/tv`. For QR code rendering, use `qrcode-generator` (pure JS, zero native dependencies) and render the matrix as a grid of `<View>` cells:

```ts
import qrcode from "qrcode-generator"

const qr = qrcode(0, "L")
qr.addData(url)
qr.make()
const count = qr.getModuleCount()
// Render count x count grid of <View> cells with black/white backgrounds
```

This pattern generalizes: any visual that mobile achieves via SVG (icons, shapes, charts) should use pure-View alternatives on TV (border-based triangles, rect Views for simple shapes, View grids for matrices).

### 3. Never use position: "absolute" for focusable elements on tvOS

The tvOS focus engine traverses the layout tree in flex/document order. Elements removed from normal flow via `position: "absolute"` are not reliably discovered during that traversal. `hasTVPreferredFocus` has no effect on such elements.

(session history) Prior investigation confirmed this through extensive testing: 9 approaches were tried including `TVFocusGuideView` destinations, `nextFocusDown`/`nextFocusUp` with callback refs, `useTVEventHandler`, and `trapFocusUp/Down` props -- all failed when the target element was absolutely positioned. The breakthrough came from spatial alignment testing: tvOS UIFocusEngine requires horizontal projection overlap between source and target for vertical D-pad navigation.

**Rule:** Every interactive element in the TV app must be in normal flexbox flow. Reserve `position: "absolute"` for purely decorative, non-interactive overlays.

```tsx
// WRONG -- close button unreachable by D-pad
<Pressable style={{ position: "absolute", top: 16, right: 16 }} onPress={onClose}>

// CORRECT -- close button in normal flow, reachable
<View style={{ flexDirection: "row", justifyContent: "flex-end", padding: 16 }}>
  <Pressable hasTVPreferredFocus onPress={onClose}>
    <Text>Close</Text>
  </Pressable>
</View>
```

### 4. Use invisible focus anchors + setNativeProps for programmatic scroll targets

`ScrollView.scrollTo({ y, animated: true })` moves the viewport but does not move tvOS focus. The focus engine auto-scrolls to keep the currently-focused element visible, overriding the programmatic scroll.

Fix: place invisible `Pressable` focus anchors at each scroll target. After `scrollTo`, call `setNativeProps({ hasTVPreferredFocus: true })` on the target anchor with a delay:

```tsx
const anchors = useRef<Map<number, React.ElementRef<typeof Pressable>>>(
  new Map(),
)

function scrollToSection(y: number, index: number) {
  scrollViewRef.current?.scrollTo({ y, animated: true })
  // Delay until scroll animation brings anchor on-screen
  setTimeout(() => {
    anchors.current.get(index)?.setNativeProps({ hasTVPreferredFocus: true })
  }, 400)
}

// Anchor element -- invisible but focusable
;<Pressable
  ref={(ref) => {
    if (ref) anchors.current.set(index, ref)
  }}
  style={{ height: 48, opacity: 0, position: "absolute", top: 0 }}
  accessible={false}
/>
```

Key constraints:

- The 400ms delay must be long enough for scroll animation to bring the anchor on-screen. `setNativeProps` on an off-screen element silently fails.
- `setNativeProps` is the react-native-tvos imperative API for moving focus. The ref target must be a mounted `Pressable`.
- Anchors need `accessible={false}` to be invisible to screen readers.
- Anchor height must be >= 48px for the focus engine to recognize it.
- This anchor is focused by an **explicit** `setNativeProps({ hasTVPreferredFocus })` claim, not by geometric D-pad discovery — which is why `opacity: 0` works here. The opposite case — a cell that must be caught by a _directional_ D-pad move (e.g. an over-hang catcher inside a rail) — cannot use `opacity: 0`: alpha-0 views are skipped by the geometric focus engine, so it must be transparent at alpha 1. See [`../design-patterns/tv-rail-overhang-pad-bounce-focus-20260616.md`](../design-patterns/tv-rail-overhang-pad-bounce-focus-20260616.md).

Scope: this anchor technique is for `ScrollView`. A virtualized `FlatList`
scrolls programmatically with `scrollToIndex` + `getItemLayout` instead (no
anchors needed), and its preferred-focus handling has its own pitfalls — see
`docs/solutions/best-practices/react-native-tvos-flatlist-sheet-virtualization-pitfalls.md`.

Alternative approach for a `ScrollView`: instead of anchoring focus to the
scroll, set `scrollEnabled={false}` (disabling the native focus-scroll pass)
and drive the viewport yourself from focus handlers. Prefer that when focus
maps naturally to rows and you want a fixed anchor (hero pinned, rails anchored
beneath); prefer the anchor-teleport here when you need to jump focus to an
arbitrary off-screen target. See
`docs/solutions/design-patterns/tv-home-row-anchored-scroll-native-focus-scroll-disabled-20260615.md`.

### 5. pointerEvents="none" wrapper on overlay VideoView blocks AVPlayerLayer on tvOS

Wrapping a `VideoView` in `<View pointerEvents="none">` is the documented fix for D-pad focus stealing on inline video (see Pitfall 3's related doc on VideoView focus). However, in an **overlay** context (e.g., fullscreen `VideoPlayer` with `TVFocusGuideView trapFocusUp/Down/Left/Right`), this wrapper prevents AVPlayerLayer from compositing -- the video area is black while controls remain functional.

The fix is context-dependent:

| Context                                                 | Fix                                                         |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| **Inline VideoView** (no focus trapping)                | Wrap in `<View pointerEvents="none">`                       |
| **Overlay VideoView** (TVFocusGuideView with trapFocus) | No wrapper -- use `focusable={false}` directly on VideoView |

The failure signature is a black video area with working controls (play/pause, seek respond). Always verify that video frames render on tvOS after modifying any VideoView wrapper pattern.

See `docs/solutions/ui-bugs/tv-videoplayer-pointerevents-blocks-avplayerlayer-tvos-20260415.md` for the full investigation.

### 6. Background VideoView next to focusable siblings — make the hero non-interactive

When a `VideoView` paints as a background _next to_ focusable siblings (e.g., a horizontal rail), the tvOS focus engine treats the painting surface as a focus candidate while playing — regardless of `focusable={false}`, `pointerEvents="none"`, `isTVSelectable={false}`, or self-referencing `nextFocusUp` guards. On Android TV, the `VideoView` `SurfaceView` also punches through the RN view hierarchy via the native compositor, so overlaid text/gradient `View`s also disappear unless forced discrete with `collapsable={false}`.

A complete RN-level fix would require replacing `expo-video`'s `VideoView` with a custom native module. The pragmatic rule:

- Make the hero subtree **fully non-interactive** — no `Pressable`, no `focusable`, no `hasTVPreferredFocus` anywhere inside it.
- The adjacent focusable region (the rail) owns 100% of focus via `TVFocusGuideView autoFocus`.
- Users navigate via the rail; pressing Select on a card opens the experience (or triggers whatever a hero CTA would have).
- On Android TV, wrap any `View`/`LinearGradient` above the `VideoView` with `collapsable={false}` so it renders as a discrete native view above the `SurfaceView`.

See `docs/solutions/best-practices/tv-focus-driven-hero-patterns-20260420.md` for the full pattern (including poster-hold during HLS source swap, debounced focus commits, and the gql.tada compile-time `never`-collapse assert that came out of the same work).

## Why This Matters

- **Pitfall 1** (WebView crash) kills the app at launch -- 100% failure rate on tvOS.
- **Pitfall 2** (SVG podspec) blocks the entire iOS/tvOS native build -- no engineer can run the app until resolved.
- **Pitfall 3** (absolute focus) produces a Modal with no way to dismiss via D-pad -- functionally broken for TV users.
- **Pitfall 4** (scroll focus fight) produces disorienting UX where the screen jumps back after a programmatic scroll.
- **Pitfall 5** (overlay VideoView wrapper) shows a black video screen with working controls -- appears broken to users despite correct player state.
- **Pitfall 6** (background VideoView + focusable siblings) produces a sprawling tree of RN-level focus guards that never reach a stable equilibrium while the video is playing — the only robust fix is making the hero non-interactive.

All six are invisible to type checking, linting, and unit tests. They surface only at runtime on TV hardware or simulators.

## When to Apply

- Porting any mobile-v2 renderer or component to `apps/tv`
- Evaluating any npm package with native iOS/tvOS modules for the TV app
- Building any interactive overlay (Modal, bottom sheet, popover) for TV
- Implementing scroll-to or jump-to navigation in a TV `ScrollView`
- When `pod install` fails after adding a dependency to `apps/tv`

## Examples

See `apps/tv/src/components/sections/QuizButtonRenderer.tsx` for a real implementation covering pitfalls 1-3 (conditional WebView require, pure-JS QR matrix, flexbox close button).

See `apps/tv/app/experience/[slug].tsx` for a real implementation of pitfall 4 (section position tracking via `onLayout`, focus anchors, `scrollToSection` via `ExperienceProvider` context).

## Related

- `docs/solutions/best-practices/react-native-tvos-flatlist-sheet-virtualization-pitfalls.md` -- the virtualized-list deep dive: Yoga maxHeight non-shrink inside bounded panels, one-shot `hasTVPreferredFocus` for virtualized row remounts (the FlatList instance of issue #839 below), mount-once `initialScrollIndex` under an always-mounted Modal, deterministic row heights for `getItemLayout`
- `docs/solutions/design-patterns/rntvos-video-overlay-async-native-event-patterns-2026-04-23.md` -- extends this catalog with pitfalls that aren't runtime type/layout issues: state-machine stale closures when native event callbacks (`expo-video` `playingChange`, `statusChange`) fire before React commits; `Animated.CompositeAnimation` completion callbacks clobbering force-transitioned state; focus dead-zones during opacity fades; `useTVEventHandler` whitelist-vs-denylist trade-offs; `isMountedRef` for late-emission safety. Same "invisible to type checking, only surfaces on hardware" class — complementary axis to the six pitfalls above.
- `docs/solutions/best-practices/tv-focus-driven-hero-patterns-20260420.md` -- Pitfall 6 reference doc: non-interactive hero + rail-owns-focus, poster-hold during HLS swap, `collapsable={false}` for Android TV, gql.tada compile-time `never`-collapse assert
- `docs/solutions/best-practices/expo-tv-platform-setup-sdui-monorepo-20260410.md` -- general TV platform setup guide (TurboModule/New Arch, deployment targets, FlatList swap, TVFocusGuideView basics)
- `docs/solutions/ui-bugs/tv-videoview-steals-dpad-focus-20260413.md` -- VideoView focus stealing and `pointerEvents="none"` fix
- `docs/solutions/ui-bugs/tv-video-hero-blank-autoplay-20260413.md` -- expo-video player.play() timing on tvOS
- `apps/tv/CLAUDE.md` -- TV app conventions including Crimson Gallery tokens, focus ring pattern, Math.round on Android
- react-native-tvos issue #839 -- `hasTVPreferredFocus` re-steals focus on every re-render (session history)
- react-native-tvos issue #852 -- focus lost on back-navigation workaround. For restoring the exact last-focused element across a multi-focusable screen, see `docs/solutions/design-patterns/tv-back-nav-focus-restoration-screen-focus-memory.md`
