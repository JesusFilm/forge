---
title: Unmute button on video hero not clickable due to ScrollView gesture preemption
category: ui-bugs
date: 2026-03-30
severity: high
module: apps/mobile
tags:
  [
    react-native,
    gesture-handling,
    zindex,
    video-player,
    hero-layout,
    scrollview,
    pressable,
    controlled-component,
  ]
---

# Unmute button on video hero not clickable due to ScrollView gesture preemption

## Problem

The mute/unmute button on the video hero was visible but not tappable. Users could not unmute the autoplaying video on the Experience screen.

**Symptoms:**

- Button renders visually (emoji/icon visible in top-right corner)
- Tapping the button area has no effect
- ScrollView scroll gestures work normally
- The same button works correctly in standalone (non-fixed-hero) rendering

## Root Cause

The `FixedHeroLayout` uses a two-layer architecture:

```
View (root)
  +-- heroContainer (position: absolute, zIndex: 0)
  |     +-- VideoHeroRenderer
  |           +-- Pressable (mute button, local zIndex: 10)
  +-- ScrollView (zIndex: 1)  <-- intercepts ALL touches
        +-- overlaySpacerContainer + content sections
```

React Native's `ScrollView` uses a **native gesture recognizer** that preempts JS-side `Pressable` siblings, regardless of `zIndex`. The mute button's `zIndex: 10` only elevated it within the `heroContainer` stacking context -- it could not break out above the sibling `ScrollView`.

**Failed approach:** Rendering the button as a third child of the root View with `zIndex: 2` (above the ScrollView) also failed. The ScrollView's native gesture handler still captured touches before the JS-side Pressable could respond.

**Key insight:** `zIndex` in React Native controls visual rendering order, NOT touch event priority when a native gesture recognizer (ScrollView) is involved.

## Solution

### 1. Move the mute button inside the ScrollView content tree

Place the button inside `overlaySpacerContainer` (which has `pointerEvents="box-none"`) via the `VideoHeroOverlay` component. Inside the ScrollView's content tree, the gesture system correctly differentiates taps (go to Pressable) from scroll gestures (handled by ScrollView).

```
View (root)
  +-- heroContainer (zIndex: 0)
  |     +-- VideoHeroRenderer (muted={isMuted})
  +-- ScrollView (zIndex: 1)
        +-- overlaySpacerContainer (pointerEvents="box-none")
              +-- VideoHeroOverlay
                    +-- HeroTextContent
                          +-- headingRow (flexDirection: "row")
                                +-- heading (flex: 1)
                                +-- Pressable (mute button)  <-- TAPPABLE
```

The button is passed as `trailingContent` through `VideoHeroOverlay` into `HeroTextContent`, where it renders in a flex row alongside the heading text.

### 2. Use controlled/uncontrolled pattern for mute state

Instead of `forwardRef` + `useImperativeHandle` + `onMuteChange` callback (which creates dual state), use a simple `muted` prop -- mirroring the existing `paused` prop pattern:

```tsx
// FixedHeroLayout.tsx — parent owns state
const [isMuted, setIsMuted] = useState(true)

<VideoHeroRenderer
  muted={isMuted}      // controlled mode
  paused={paused}
  blurOpacity={blurOpacity}
/>

// Mute button directly toggles parent state
<Pressable onPress={() => setIsMuted((prev) => !prev)}>
  {isMuted ? <VolumeOffIcon /> : <VolumeOnIcon />}
</Pressable>
```

```tsx
// VideoHeroRenderer.tsx — syncs prop to player
const isControlled = mutedProp != null
const [internalMuted, setInternalMuted] = useState(true)
const isMuted = isControlled ? mutedProp : internalMuted

// Controlled mode: sync prop to player (mirrors the paused useEffect)
useEffect(() => {
  if (mutedProp == null) return
  player.muted = mutedProp
  if (!mutedProp && !hasUnmutedOnce.current) {
    hasUnmutedOnce.current = true
    player.currentTime = 0
  }
}, [mutedProp, player])

// Only show internal button in uncontrolled (standalone) mode
{
  !isControlled && (
    <Pressable onPress={handleMuteToggle}>
      {isMuted ? <VolumeOffIcon /> : <VolumeOnIcon />}
    </Pressable>
  )
}
```

**Why this is better than `forwardRef` + `useImperativeHandle`:**

- Single source of truth (no dual state synchronization)
- Fully declarative (matches the `paused` prop pattern already in the codebase)
- Simpler to test (pass prop values instead of calling imperative methods)
- ~30 fewer lines of code

### 3. Replace emoji with SVG icons

Added `react-native-svg` and created `VolumeOffIcon`/`VolumeOnIcon` in `apps/mobile/src/components/icons/VolumeIcons.tsx`. This is the first use of `react-native-svg` in the mobile app (previously used `View + Text` with Unicode characters for all icons).

## Prevention

### Interactive elements and ScrollView

- **Always place tappable elements inside the ScrollView content tree** when they overlap with a ScrollView's frame. Sibling elements at higher zIndex will NOT reliably receive touches.
- Use `pointerEvents="box-none"` on layout containers to pass through scroll gestures while allowing child taps.
- If you must have a floating button above a ScrollView, use a `Modal` or portal pattern -- not zIndex siblings.

### State sharing between parent and child

- Prefer **controlled props** over `forwardRef` + `useImperativeHandle` for state shared between parent and child. The `paused` and `muted` props in `VideoHeroRenderer` demonstrate this pattern.
- If the parent renders the UI control (button), the parent should own the state. The child syncs to the player via `useEffect`.

### Testing

- Test touch targets on both iOS and Android. Android's `VideoView` (SurfaceView) has additional z-order issues ([expo/expo#30275](https://github.com/expo/expo/issues/30275)).
- Use 44x44pt minimum touch targets (Apple HIG) / 48x48dp (Material Design).

## Files Changed

- `apps/mobile/src/components/sections/VideoHeroRenderer.tsx` — controlled/uncontrolled mute pattern, SVG icons
- `apps/mobile/src/components/sections/FixedHeroLayout.tsx` — parent mute state, button in trailingContent
- `apps/mobile/src/components/icons/VolumeIcons.tsx` — new SVG volume icons
- `apps/mobile/package.json` — added `react-native-svg`

## Related

- `docs/solutions/mobile/full-bleed-video-hero-with-scroll-over-content.md` — documents the two-layer hero architecture
- `docs/solutions/mobile/translucent-section-backgrounds-with-react-context.md` — Android z-order caveats
- `docs/solutions/mobile/decorative-icon-view-text-pattern.md` — previous icon pattern (View+Text), now supplemented by react-native-svg
