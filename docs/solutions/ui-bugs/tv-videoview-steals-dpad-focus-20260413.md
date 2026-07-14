---
title: "TV VideoView steals D-pad focus from interactive elements"
date: "2026-04-13"
category: ui-bugs
module: apps/tv
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "Explore button on homepage hero receives initial focus but cannot be re-focused after navigating away"
  - "D-pad up navigation from Experiences rail does not reach the Explore button"
root_cause: wrong_api
resolution_type: code_fix
severity: medium
last_updated: "2026-06-25"
tags:
  - tvos
  - dpad-focus
  - videoview
  - tvfocusguideview
  - expo-video
  - react-native-tvos
---

# TV VideoView steals D-pad focus from interactive elements

## Problem

After adding inline video autoplay to the TV homepage hero (`HomeHero`), the Explore button received initial focus via `hasTVPreferredFocus` but could not be re-focused after navigating to another element (e.g., the Experiences rail). D-pad up navigation was absorbed by the `VideoView` native component.

## Symptoms

- Explore button is focused on initial mount (crimson glow visible)
- Pressing D-pad down to Experiences rail works
- Pressing D-pad up to return to Explore button fails — focus stays on the rail
- Same issue on both tvOS simulator and Android TV emulator

## What Didn't Work

- **`focusable={false}` on VideoView alone**: Prevents the `VideoView` itself from receiving focus, but the native view still blocks the tvOS focus engine from traversing through it to reach elements behind/above it in the view hierarchy.

## Solution

Two changes required:

1. **Wrap VideoView and gradient in `pointerEvents="none"` container** — makes the entire background layer invisible to the focus engine:

```tsx
<View style={StyleSheet.absoluteFill} pointerEvents="none">
  <VideoView
    player={player}
    style={StyleSheet.absoluteFill}
    nativeControls={false}
    contentFit="cover"
    focusable={false}
  />
  <LinearGradient ... />
</View>
```

2. **Replace text overlay `View` with `TVFocusGuideView`** — explicitly guides focus to the Explore button:

```tsx
const exploreRef = useRef<View>(null)

<TVFocusGuideView
  style={styles.textContainer}
  destinations={
    exploreRef.current
      ? [findNodeHandle(exploreRef.current)!].filter(Boolean)
      : undefined
  }
>
  <Text ...>{title}</Text>
  <Pressable ref={exploreRef} hasTVPreferredFocus ...>
    <Text>Explore</Text>
  </Pressable>
</TVFocusGuideView>
```

## Why This Works

The tvOS focus engine uses the view hierarchy and spatial layout to determine focus traversal. A native `VideoView` — even with `focusable={false}` — is an opaque native UIView that blocks focus traversal through it. Wrapping it in `pointerEvents="none"` tells React Native to exclude the entire subtree from the responder system. `TVFocusGuideView` with explicit `destinations` then provides a declarative focus target that the tvOS focus engine uses when navigating into that region.

## Prevention

- Any **inline** `VideoView` used as a background (non-interactive) layer on TV must be wrapped in `pointerEvents="none"` — `focusable={false}` alone is insufficient.
- **Exception: overlay VideoViews** (e.g., fullscreen player) where `TVFocusGuideView` with `trapFocusUp/Down/Left/Right` already contains D-pad navigation must NOT use the `pointerEvents="none"` wrapper. It blocks AVPlayerLayer rendering on tvOS, producing a black screen with functional controls. Use `focusable={false}` directly on the `VideoView` instead. See `docs/solutions/ui-bugs/tv-videoplayer-pointerevents-blocks-avplayerlayer-tvos-20260415.md` for the full investigation.
- **Hero-above-rail layouts** (background video hero that reacts to rail focus): **prefer removing interactivity from the hero entirely** rather than wrapping it in `TVFocusGuideView` with `destinations`. The guide-with-destinations pattern is fragile once the video is actively playing — `VideoView` continues to intercept focus despite every RN-level guard. Make the hero non-interactive and let the adjacent rail own focus. See `docs/solutions/best-practices/tv-focus-driven-hero-patterns-20260420.md`.
- For layouts where an interactive element _must_ sit above a `VideoView` and the hero pattern above doesn't apply, wrap with `TVFocusGuideView` + explicit `destinations` as a fallback and verify behavior with the video actively playing, not just paused.
- Test D-pad focus traversal after adding any native video view to a TV screen — focus away from the initial element, then verify you can navigate back.

## Related Issues

- `docs/solutions/best-practices/tv-focus-driven-hero-patterns-20260420.md` — supersedes this doc's "wrap the hero in TVFocusGuideView" prevention for hero-above-rail layouts; documents the non-interactive-hero + rail-owns-focus pattern and the VideoView focus-hijacking-while-playing behavior that the `TVFocusGuideView` approach could not fully contain
- `docs/solutions/ui-bugs/tv-video-hero-blank-autoplay-20260413.md` — the inline autoplay work that introduced this focus issue
- `docs/solutions/ui-bugs/tv-videoplayer-pointerevents-blocks-avplayerlayer-tvos-20260415.md` — the wrapper pattern breaks overlay VideoViews; documents when NOT to use it
- `docs/solutions/best-practices/expo-tv-platform-setup-sdui-monorepo-20260410.md` — TV platform setup, documents `TVFocusGuideView` pattern
- react-native-tvos issue #852 — focus lost on back-navigation (related but distinct). Restoring the exact last-focused element across a multi-focusable screen: `docs/solutions/design-patterns/tv-back-nav-focus-restoration-screen-focus-memory.md`
