---
title: "HomeHeader buttons untappable due to z-index layering with FlashList; GlassView ignores opacity on iOS"
date: "2026-04-09"
category: ui-bugs
module: mobile-v2
problem_type: ui_bug
component: tooling
severity: high
symptoms:
  - "HomeHeader search and profile buttons were visible but untappable on the home screen"
  - "FlashList scroll view intercepted all touch events in the header's padding area"
  - "GlassView from expo-glass-effect ignored opacity style prop on iOS"
root_cause: config_error
resolution_type: code_fix
related_components:
  - HomeHeader.tsx
  - CuratedHomeLayout.tsx
  - VideoHeroRenderer.tsx
tags:
  - zindex
  - touch-events
  - flashlist
  - react-native
  - expo-glass-effect
  - scroll-animation
  - mobile-v2
---

# HomeHeader buttons untappable due to z-index layering with FlashList; GlassView ignores opacity on iOS

## Problem

Home screen search and profile navigation buttons in `HomeHeader` were untappable in `apps/mobile-v2`. The header had `zIndex: 0`, placing it below the `FlashList` and `heroInteractiveLayer` (`zIndex: 2`). FlashList's native gesture recognizer intercepted all touches within its entire rendered frame, including the padding area where the header buttons sat.

## Symptoms

- Tapping the search button in `HomeHeader` produced no response
- Tapping the profile button in `HomeHeader` produced no response
- Both buttons were visually present and rendered correctly
- Touch interception occurred because FlashList overlapped the header region
- When building the scroll-driven title pill, applying `opacity` directly to `GlassView` had no visible effect on iOS

## What Didn't Work

- **Raised HomeHeader zIndex to 3** (above heroInteractiveLayer at 2): Buttons became tappable, but they visually covered scroll content as it scrolled up past the header area.
- **Moved HomeHeader into heroInteractiveLayer** (zIndex 2, `pointerEvents="box-none"`): Same scroll-covering visual problem. User wanted buttons always tappable AND a title that appears on scroll.
- **Applied `opacity: 0` on GlassView to hide the title pill when not scrolled**: On iOS, GlassView's native blur layer ignores the `opacity` style prop entirely. The pill was always visible.
- **Wrapped GlassView in a plain View and applied opacity to the wrapper**: Also did not work on iOS -- the native blur layer still rendered visibly through the transparent wrapper.

## Solution

Raised HomeHeader `zIndex` to 10 (always on top, always tappable). Instead of scroll content covering buttons, added a scroll-driven Experience title that fades in as a frosted glass pill when the hero heading scrolls off screen.

**HomeHeader.tsx -- before:**

```tsx
export function HomeHeader() {
  // No title props, zIndex: 0
}

const styles = StyleSheet.create({
  container: {
    zIndex: 0,
    // ...
  },
})
```

**HomeHeader.tsx -- after:**

```tsx
type HomeHeaderProps = {
  title: string | null
  titleOpacity: number
}

export function HomeHeader({ title, titleOpacity }: HomeHeaderProps) {
  // ...
  return (
    <View style={[styles.container, { paddingTop: insets.top + 4 }]}>
      {/* search button */}

      {title != null && titleOpacity > 0 && (
        <GlassView
          style={[styles.glassPill, { opacity: titleOpacity }]}
          glassEffectStyle="regular"
          colorScheme="dark"
        >
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </GlassView>
      )}

      {/* profile button */}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    zIndex: 10, // above FlashList and heroInteractiveLayer (2)
    // ...
  },
  glassPill: {
    flexShrink: 1, // prevents long CMS titles from pushing buttons off screen
    height: 40,
    borderRadius: 20,
    // ...
  },
})
```

**CuratedHomeLayout.tsx -- scroll-driven fade:**

```tsx
const [titleOpacity, setTitleOpacity] = useState(0)

const handleScroll = useCallback(
  (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const scrollY = e.nativeEvent.contentOffset.y
    const fadeStart = heroHeight * 0.6
    const fadeEnd = heroHeight * 0.75
    setTitleOpacity(
      Math.min(1, Math.max(0, (scrollY - fadeStart) / (fadeEnd - fadeStart))),
    )
  },
  [heroHeight],
)

<HomeHeader title={experience?.title ?? null} titleOpacity={titleOpacity} />
```

## Why This Works

- `zIndex: 10` places HomeHeader above all other layers (FlashList, heroInteractiveLayer at 2), so FlashList's native gesture recognizer no longer captures touches in the header area.
- The scroll-covering visual conflict is eliminated by design: the header only shows the title pill when the user has scrolled past the hero heading, so there is no meaningful visual overlap.
- GlassView visibility is controlled via conditional mount (`titleOpacity > 0 && <GlassView>`), not via `opacity: 0`, because the native iOS blur layer does not fully hide at `opacity: 0` -- it retains a minimum visible blur. Non-zero opacity values (e.g., 0.3, 0.7) work correctly for fade-in animation, so the `{ opacity: titleOpacity }` style handles the gradual fade once mounted.
- `flexShrink: 1` on the pill prevents CMS-sourced titles of arbitrary length from pushing the search/profile buttons off screen.

## Prevention

1. **Never use `opacity: 0` to hide `GlassView` on iOS.** The native blur layer retains a minimum visible blur at zero opacity. Use conditional rendering (`condition && <GlassView>`) for show/hide. Non-zero opacity values (0.1-1.0) work correctly for fade animation once mounted.
2. **Wrapping `GlassView` in a `View` and applying `opacity: 0` to the wrapper also fails.** Mount/unmount is the only reliable mechanism for fully hiding GlassView on iOS.
3. **Use `flexShrink: 1` on dynamically-sized elements** between fixed-width siblings in a row layout, especially when content is CMS-sourced.
4. **Document z-index layer ordering** near the style definitions. For the home screen: `heroLayer` (0), `heroInteractiveLayer` (2), `HomeHeader` (10).
5. **FlashList intercepts touches across its entire rendered frame on iOS**, including padding/inset regions. Any fixed UI overlapping FlashList's frame must have a higher z-index.

## Related Issues

- [expo-glass-effect interactive flash](../best-practices/expo-glass-effect-interactive-flash-2026-04-08.md) -- same component, different bug (`isInteractive` flash)
- [Hero mute button hybrid overlay touch target](../mobile/hero-mute-button-hybrid-overlay-touch-target.md) -- same root cause (FlashList touch interception), different fix (hybrid overlay with `measureLayout`)
- [React Native ScrollView touch event z-index fix](../mobile/react-native-scrollview-touch-event-z-index-fix.md) -- foundational reference on ScrollView/FlashList gesture preemption
- [Full-bleed video hero with scroll-over content](../mobile/full-bleed-video-hero-with-scroll-over-content.md) -- three-layer hero architecture this fix builds upon
