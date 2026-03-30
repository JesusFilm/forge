---
title: "fix: Video hero unmute button not clickable"
type: fix
status: active
date: 2026-03-30
---

# fix: Video hero unmute button not clickable

## Overview

The unmute button on the video hero is visible but not tappable. Users cannot unmute the autoplaying video on the Experience screen.

## Problem Statement

The `FixedHeroLayout` uses a two-layer architecture:

```
View (root)
  ├── heroContainer (zIndex: 0, position: absolute)
  │     └── VideoHeroRenderer
  │           └── Pressable (mute button, local zIndex: 10)
  └── ScrollView (zIndex: 1)  ← intercepts ALL touches
        └── overlaySpacerContainer + content sections
```

The mute `Pressable` lives inside `VideoHeroRenderer` which is rendered inside `heroContainer` at `zIndex: 0`. The sibling `ScrollView` at `zIndex: 1` covers the entire viewport and intercepts all touch events before they reach the button. The button's local `zIndex: 10` only elevates it within the `heroContainer` stacking context — it cannot break out above the sibling `ScrollView`.

**Key files:**

- `apps/mobile/src/components/sections/FixedHeroLayout.tsx:184-193` — hero container + ScrollView layering
- `apps/mobile/src/components/sections/VideoHeroRenderer.tsx:229-242` — mute button Pressable
- `apps/mobile/src/components/sections/VideoHeroRenderer.tsx:176-184` — `handleMuteToggle` logic

**Note:** The mute button works correctly when `VideoHeroRenderer` is rendered standalone (non-fixed-hero path via `SectionDispatcher`), since there is no overlapping ScrollView in that case.

## Proposed Solution

Elevate the mute button above the ScrollView by rendering it as a third child of the root `View` in `FixedHeroLayout`, with `zIndex: 2`:

```
View (root)
  ├── heroContainer (zIndex: 0)
  │     └── VideoHeroRenderer (hideMuteButton=true)
  ├── ScrollView (zIndex: 1)
  └── Pressable (mute button, zIndex: 2, position: absolute)  ← NEW
```

### State sharing approach

Use a **callback prop + forwarded ref** pattern:

1. `VideoHeroRenderer` accepts a new `onMuteChange?: (isMuted: boolean) => void` callback prop and a new `hideMuteButton?: boolean` prop.
2. `VideoHeroRenderer` uses `React.forwardRef` + `useImperativeHandle` to expose `{ toggleMute: () => void }`.
3. `FixedHeroLayout` holds `[isMuted, setIsMuted] = useState(true)` and a ref to `VideoHeroRenderer`.
4. The elevated mute button calls `ref.current?.toggleMute()` on press.
5. `VideoHeroRenderer` calls `onMuteChange(newMuted)` after toggling, which updates `FixedHeroLayout`'s state for the button icon.

This keeps all mute logic (including the `hasUnmutedOnce` restart-from-beginning behavior) encapsulated inside `VideoHeroRenderer`.

### Button visibility during scroll

The elevated mute button should fade out with `blurOpacity` and become non-interactive (`pointerEvents: "none"`) when `paused === true` (user has scrolled away from the hero). This prevents a floating button from obstructing content sections.

## Technical Considerations

- **Standalone rendering path:** `VideoHeroRenderer` must retain its internal mute button when `hideMuteButton` is not set (default). `SectionDispatcher` renders `VideoHeroRenderer` without `FixedHeroLayout`, and the internal button works fine there.
- **Android VideoView z-order:** `SurfaceView`-backed `VideoView` on Android can interfere with touch targets. The elevated button at `zIndex: 2` is a sibling of the `heroContainer`, not a child, so it should receive touches correctly. Verify on Android.
- **Hit target size:** Current button is 40×40. Consider increasing to 44×44 or adding `hitSlop` to meet platform guidelines (44pt iOS, 48dp Android).
- **Safe area positioning:** The button uses `insets.top + 16`. This is correct for full-bleed screens. If the Experience screen has a visible navigation header, verify the button doesn't overlap with the back button area.

## Acceptance Criteria

- [ ] Mute button is tappable on the video hero in `FixedHeroLayout` (Experience screen)
- [ ] Tapping the button toggles mute/unmute with correct icon change
- [ ] First unmute restarts video from beginning (existing `hasUnmutedOnce` behavior preserved)
- [ ] Mute button still works in standalone `VideoHeroRenderer` (non-hero path) — no regression
- [ ] Button fades out when user scrolls past hero
- [ ] Works on both iOS and Android
- [ ] Existing tests pass; new tests cover the elevated button behavior

## MVP

### FixedHeroLayout.tsx — Add elevated mute button

```tsx
// New imports
import { forwardRef, useCallback, useMemo, useRef, useState } from "react"
import { Animated, Pressable, Text } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

// In FixedHeroLayout (hero path):
const videoRef = useRef<VideoHeroRef>(null)
const [isMuted, setIsMuted] = useState(true)
const insets = useSafeAreaInsets()

// Render:
<View style={styles.root}>
  <View style={styles.heroContainer} pointerEvents="box-none">
    <VideoHeroRenderer
      ref={videoRef}
      section={heroSection}
      heroHeight={viewportHeight}
      hideOverlay
      hideMuteButton           // ← NEW: suppress internal button
      paused={paused}
      blurOpacity={blurOpacity}
      onMuteChange={setIsMuted} // ← NEW: sync mute state
    />
  </View>

  <ScrollView ...>
    {/* existing content */}
  </ScrollView>

  {/* Elevated mute button — above ScrollView */}
  {!paused && (
    <Pressable
      style={[styles.elevatedMuteButton, { top: insets.top + 16, opacity: 1 - blurOpacity }]}
      onPress={() => videoRef.current?.toggleMute()}
      accessibilityRole="button"
      accessibilityLabel={isMuted ? "Unmute video" : "Mute video"}
      pointerEvents={blurOpacity >= 1 ? "none" : "auto"}
    >
      <Text style={styles.muteIcon}>
        {isMuted ? "\u{1F507}" : "\u{1F50A}"}
      </Text>
    </Pressable>
  )}
</View>
```

### VideoHeroRenderer.tsx — Expose imperative handle

```tsx
export interface VideoHeroRef {
  toggleMute: () => void
}

export interface VideoHeroRendererProps {
  section: VideoHeroSection
  heroHeight?: number
  hideOverlay?: boolean
  hideMuteButton?: boolean   // ← NEW
  paused?: boolean
  blurOpacity?: number
  onMuteChange?: (isMuted: boolean) => void  // ← NEW
}

export const VideoHeroRenderer = forwardRef<VideoHeroRef, VideoHeroRendererProps>(
  function VideoHeroRenderer({ section, ..., hideMuteButton, onMuteChange }, ref) {
    // ... existing logic ...

    const handleMuteToggle = useCallback(() => {
      if (isMuted && !hasUnmutedOnce.current) {
        hasUnmutedOnce.current = true
        player.currentTime = 0
      }
      const newMuted = !isMuted
      player.muted = newMuted
      setIsMuted(newMuted)
      onMuteChange?.(newMuted)  // ← NEW: notify parent
    }, [isMuted, player, onMuteChange])

    useImperativeHandle(ref, () => ({ toggleMute: handleMuteToggle }), [handleMuteToggle])

    // Conditionally render internal button
    {!hideMuteButton && (
      <Pressable style={[styles.muteButton, { top: insets.top + 16 }]} onPress={handleMuteToggle} ...>
        ...
      </Pressable>
    )}
  }
)
```

### New styles in FixedHeroLayout.tsx

```tsx
elevatedMuteButton: {
  position: "absolute",
  right: 16,
  width: 44,
  height: 44,
  borderRadius: 22,
  backgroundColor: "rgba(0, 0, 0, 0.5)",
  justifyContent: "center",
  alignItems: "center",
  zIndex: 2,
},
```

## Sources

- Documented architecture: `docs/solutions/mobile/full-bleed-video-hero-with-scroll-over-content.md`
- Related learnings: `docs/solutions/mobile/translucent-section-backgrounds-with-react-context.md` (Android z-order caveats)
