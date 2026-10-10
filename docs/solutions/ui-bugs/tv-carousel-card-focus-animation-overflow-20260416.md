---
title: "TV Carousel Card Focus: Animated Scale Transition and Overflow Clipping Fix"
date: "2026-04-16"
last_updated: "2026-06-24"
category: ui-bugs
module: apps/tv
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "Cards snapped to 1.05x scale instantly on D-pad focus instead of animating smoothly"
  - "Focused cards were trimmed at top and bottom edges within carousel FlatList rows"
  - "Crimson glow shadow was invisible inside FlatList carousels due to overflow:hidden clipping"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags:
  - tv
  - react-native-tvos
  - animation
  - focus
  - overflow
  - flatlist
  - d-pad
  - expo
---

# TV Carousel Card Focus: Animated Scale Transition and Overflow Clipping Fix

## Problem

FocusableCard in the TV app used React state to toggle a scale transform on focus, causing an instant visual jump instead of a smooth animation. Cards in horizontal FlatList carousels were also clipped when scaled up because FlatList clips to its own frame and the card's `overflow: "hidden"` (needed for borderRadius image clipping) also clipped the crimson glow shadow.

## Symptoms

- Cards snapped to 1.05x scale instantly on D-pad focus rather than animating smoothly
- Scaled cards were trimmed at the top and bottom edges within carousel rows
- Crimson glow shadow was invisible because the card's own `overflow: "hidden"` clipped it
- Shadow was visible on standalone cards but disappeared inside FlatList carousels

## What Didn't Work

- **`paddingVertical` on `contentContainerStyle`**: Adds space inside the scroll content but does not expand FlatList's clip boundary — scaled cards were still trimmed
- **Applying `style` to both outer and inner Views**: Doubled padding and background color on cards with internal padding (e.g., BibleQuotesCarousel)
- **Applying `style` only to the inner View**: VideoCardRenderer stretched full-width because the outer Animated.View had no size constraint (width, height, alignSelf were only on the inner View)
- (session history) **The original plan specified state-based transform toggling** without animation — the `focusScale` prop was designed as a dynamic inline style via `useState`, not `Animated.spring`. The animation gap was a design omission, not a regression.

## Solution

### Part 1: Animated Spring (FocusableCard.tsx)

Replace `useState` boolean + conditional style with `Animated.Value` and `Animated.spring`:

```tsx
// Before: instant jump
const [isFocused, setIsFocused] = useState(false)
// style={[isFocused && { transform: [{ scale: 1.05 }] }]}

// After: smooth spring animation
const scale = useRef(new Animated.Value(1)).current

const animateIn = () => {
  setIsFocused(true)
  Animated.spring(scale, {
    toValue: 1.05,
    tension: 150,
    friction: 10,
    useNativeDriver: true,
  }).start()
}

const animateOut = () => {
  setIsFocused(false)
  Animated.spring(scale, {
    toValue: 1,
    tension: 150,
    friction: 10,
    useNativeDriver: true,
  }).start()
}
```

### Part 2: Outer/Inner Layer Split (FocusableCard.tsx)

Split the card into two layers — outer for shadow/transform, inner for content clipping. Use a `LAYOUT_KEYS` Set to partition the incoming `style` prop:

```tsx
const LAYOUT_KEYS = new Set<keyof ViewStyle>([
  "width",
  "height",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
  "alignSelf",
  "flex",
  "flexGrow",
  "flexShrink",
  "flexBasis",
  "margin",
  "marginTop",
  "marginBottom",
  "marginLeft",
  "marginRight",
  "marginHorizontal",
  "marginVertical",
  "position",
  "top",
  "left",
  "right",
  "bottom",
  "zIndex",
])

// Style split: layout keys -> outer, visual keys -> inner (else branch)
for (const [key, value] of Object.entries(style)) {
  if (LAYOUT_KEYS.has(key as keyof ViewStyle)) {
    layout[key] = value
  } else {
    visual[key] = value
  }
}

// Outer: layout + transform + shadow, overflow: "visible"
;<Animated.View
  style={[
    styles.outer,
    layoutStyle,
    isFocused && styles.focusGlow,
    { transform: [{ scale }] },
  ]}
>
  {/* Inner: content styles + overflow: "hidden" + borderRadius */}
  <View style={[styles.inner, visualStyle]}>{children}</View>
</Animated.View>
```

### Part 3: Item Wrapper Padding (all carousel renderers)

Wrap each FlatList `renderItem` in a View with `paddingVertical: 40` so items are taller than the cards, giving scaled cards room within the FlatList's clip boundary:

```tsx
// Applied in: VideoCarouselRenderer, NavigationCarouselRenderer,
// MediaCollectionRenderer, BibleQuotesCarouselRenderer, ContentRail
renderItem={({ item }) => (
  <View style={styles.cardWrapper}>
    <FocusableCard .../>
  </View>
)}

// styles
cardWrapper: { paddingVertical: 40 }
```

### Part 4: Unified Crimson Glow

> **Superseded (2026-06-24):** the crimson glow is no longer the focus default.
> apps/tv standardized on an app-wide white **border ring** (FocusableCard's
> `focusRing` default flipped crimson→white; crimson is opt-in only on near-white
> surfaces like the RelatedQuestions FallbackPill). The two-layer split + clipping
> fix in this doc still apply unchanged — only the ring's color/shape changed, and
> the values below are now historical. See
> `docs/solutions/best-practices/tv-focus-white-ring-default-and-light-surface-exception.md`.

All focusable elements use `COLORS.primary` (`#CB333B`) for shadow:

| Element                 | shadowRadius | shadowOpacity |
| ----------------------- | ------------ | ------------- |
| FocusableCard           | 16           | 0.6           |
| HomeHero explore button | 30           | 1.0           |
| VideoPlayer controls    | 30           | 1.0           |
| RelatedQuestions        | 30           | 1.0           |

## Why This Works

React Native's `Animated` API with `useNativeDriver: true` bypasses the JavaScript thread — the animation runs on the native UI thread at 60fps. State-toggled transforms update in a single frame because the render happens synchronously once React processes the state change.

The clipping fix works because a View with `overflow: "hidden"` clips all children including shadow effects. By separating the shadow/transform layer (outer, `overflow: "visible"`) from the content clipping layer (inner, `overflow: "hidden"`), each layer does exactly one job. The FlatList clipping is different — FlatList is a ScrollView that always clips to its measured frame. Making items taller via `paddingVertical` on the wrapper gives the scaled card physical space within the FlatList frame.

The `LAYOUT_KEYS` split ensures the outer View gets size/position constraints (so the shadow renders at the correct card size) while the inner View gets visual properties (so padding and background don't double up).

## Prevention

- **Always use `Animated` or Reanimated for visual transitions** — never toggle `transform` or `opacity` via React state. State changes re-render in one frame; Animated runs natively at 60fps.
- **Separate shadow/transform from content-clip layers** — any component needing both a visible overflow effect (glow, shadow, scale bleed) and content clipping (borderRadius) requires two Views: outer `overflow: "visible"`, inner `overflow: "hidden"`.
- **FlatList clips its content frame** — `contentContainerStyle` padding does not expand the clip boundary. Add `paddingVertical` to item wrapper Views so scaled or glowing children have physical room within the scroll container.
- **Split style props by concern** — when routing styles to outer/inner Views, use an explicit allowlist (`LAYOUT_KEYS`) with an `else` branch to ensure layout and visual properties are mutually exclusive partitions. Missing the `else` causes properties to leak to both Views.
- **Android TV has no colored shadows** — `shadowColor`/`shadowRadius` are iOS-only, so the crimson glow was invisible on Android TV. The border-based fallback this recommends was since adopted app-wide: a white **border ring** is now the default focus indicator (visible on both platforms). See `docs/solutions/best-practices/tv-focus-white-ring-default-and-light-surface-exception.md`. (session history)

## Related Issues

- [docs/solutions/best-practices/tv-focus-white-ring-default-and-light-surface-exception.md](../best-practices/tv-focus-white-ring-default-and-light-surface-exception.md) — the white-ring focus default that superseded the crimson glow (the "border-based fallback" this doc's Prevention recommends)
- [docs/solutions/best-practices/react-native-tvos-porting-pitfalls-20260414.md](../best-practices/react-native-tvos-porting-pitfalls-20260414.md) — Pitfall 3: never use `position: "absolute"` for focusable elements; UIFocusEngine requires flexbox flow
- [docs/solutions/best-practices/expo-tv-platform-setup-sdui-monorepo-20260410.md](../best-practices/expo-tv-platform-setup-sdui-monorepo-20260410.md) — Section 6: TVFocusGuideView and focus management patterns; Section 7: FlatList zero-height on tvOS
- [docs/solutions/ui-bugs/tv-videoplayer-pointerevents-blocks-avplayerlayer-tvos-20260415.md](tv-videoplayer-pointerevents-blocks-avplayerlayer-tvos-20260415.md) — Context-dependent `pointerEvents="none"`: correct for inline cards, breaks overlay VideoViews
- [docs/solutions/ui-bugs/tv-videoview-steals-dpad-focus-20260413.md](tv-videoview-steals-dpad-focus-20260413.md) — VideoView focus stealing and `pointerEvents="none"` wrapper pattern
- [docs/solutions/mobile/linear-gradient-dark-banding-transparent-keyword.md](../mobile/linear-gradient-dark-banding-transparent-keyword.md) — `hexToRgba(color, 0)` for gradient stops; applies to glow gradients on TV
- PR: [JesusFilm/forge#779](https://github.com/JesusFilm/forge/pull/779)
