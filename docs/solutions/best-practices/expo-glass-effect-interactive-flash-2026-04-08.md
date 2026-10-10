---
title: "expo-glass-effect GlassView: isInteractive flash bug and cross-platform integration"
date: "2026-04-08"
category: best-practices
module: apps/mobile
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - "Using expo-glass-effect GlassView in a tab-based Expo Router layout"
  - "Mounting GlassView on a component that remounts on tab switch"
  - "Targeting iOS liquid glass effect with Android fallback"
root_cause: wrong_api
resolution_type: code_fix
tags:
  - expo-glass-effect
  - glass-view
  - ios-liquid-glass
  - tab-navigation
  - android-fallback
  - mobile-v2
  - react-native
  - platform-select
  - zindex
---

# expo-glass-effect GlassView: isInteractive flash bug and cross-platform integration

## Context

Adding iOS liquid glass effect buttons to `HomeHeader.tsx` in `apps/mobile` using `expo-glass-effect` (~0.1.9; ~0.1.10 today) on Expo SDK 54 / React Native 0.81. The work required: installing the library, wrapping interactive elements correctly, providing an Android fallback, integrating with the three-layer hero z-index architecture, and fixing a white flash bug caused by `isInteractive`.

## Guidance

### Installing expo-glass-effect

Always install via `npx expo install expo-glass-effect` (not `pnpm add`) so Expo's resolver pins a compatible version for the active SDK. Requires Xcode 26 for native builds.

### Wrapping pattern: GlassView inside Pressable, not around it

Place `GlassView` as the child of `Pressable`, not as the wrapper. `Pressable` owns touch handling; `GlassView` is purely visual chrome.

```tsx
<Pressable onPress={handlePress}>
  <GlassView
    style={styles.glassButton}
    glassEffectStyle="regular"
    colorScheme="dark"
  >
    <Ionicons name="search" size={22} color={ACCENT} />
  </GlassView>
</Pressable>
```

### Do NOT set `isInteractive` when the parent is a Pressable

`isInteractive` tells the native iOS glass view to animate its highlight on touch. When the component remounts (e.g., on Expo Router tab switch), the native layer interprets the remount as a touch event and fires the highlight animation, producing a **white flash**.

**Before (causes flash on tab switch):**

```tsx
<GlassView isInteractive style={styles.glassButton} glassEffectStyle="regular" colorScheme="dark">
```

**After (correct):**

```tsx
<GlassView style={styles.glassButton} glassEffectStyle="regular" colorScheme="dark">
```

### Do NOT place `GlassView` inside a layer whose opacity animates

`GlassView` renders no material at all when an ancestor animates opacity —
invisible, not subtle, and nothing logs. Conditional mount does not help, because
there is nothing to fade. Use `PlatformBlur`
(`apps/mobile/src/components/ui/PlatformBlur.tsx`) for any frosted surface inside
fading chrome. Opacity applied to the `GlassView` itself is a separate defect with
a separate fix; both are linked under Related.

### Android fallback via Platform.select spread

`GlassView` falls back to a plain `<View {...props}/>` on non-iOS, so it is safe to render unconditionally on all platforms without a `Platform.OS` guard around the component itself. This was read directly out of the installed package's compiled GlassView module, and re-verified there at 0.1.10. Under pnpm that file sits inside the virtual store (the .pnpm directory, keyed by exact version) rather than at a flat per-package path, so look it up through the virtual store.

Use `Platform.select` in the style to add background color and overflow clipping only on Android:

```tsx
const styles = StyleSheet.create({
  glassButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      android: {
        backgroundColor: hexToRgba(SURFACE_COLOR, 0.6),
        overflow: "hidden" as const,
      },
    }),
  },
})
```

`Platform.select({ android: {...} })` returns `undefined` on iOS; spreading `...undefined` is a no-op in `StyleSheet.create`.

### z-index layering for scroll-over behavior

> **Superseded 2026-04-09 — `HomeHeader` sits at `zIndex: 10` today, not 1.** At
> zIndex 1 the FlashList intercepted touches in the header's padding, so the
> buttons rendered but never fired. The table and example below record the
> 2026-04-08 state. See
> [HomeHeader z-index touch interception](../ui-bugs/homeheader-zindex-touch-interception-glassview-opacity-2026-04-09.md).

The three-layer hero architecture in `CuratedHomeLayout`:

| Layer                | zIndex | Notes                                             |
| -------------------- | ------ | ------------------------------------------------- |
| Hero image/video     | 0      | Bottom-most, absolutely positioned                |
| HomeHeader           | 1      | Above hero, below interactive overlay             |
| FlashList            | (none) | Scrolls over header at natural stacking           |
| heroInteractiveLayer | 2      | `pointerEvents="box-none"` passes touches through |

Set `zIndex: 1` on the header container so FlashList content scrolls over the header while the header remains above the hero media and below the mute button overlay.

### Jest configuration

Add `expo-glass-effect` to `transformIgnorePatterns` in `package.json` or Jest will fail to transform the native module:

```json
"transformIgnorePatterns": [
  "/node_modules/(?!(.pnpm|react-native|@react-native|expo|expo-glass-effect|@expo|...))"
]
```

### Color tokens

Import color values from `../../lib/color` — never hardcode hex strings. Available tokens: `ACCENT`, `BLACK`, `SURFACE_COLOR`, `TEXT_SECONDARY`, and the `hexToRgba` utility.

## Why This Matters

- The `isInteractive` flash is non-obvious: it only manifests on tab navigation (remount), not during normal tap testing on first load. It will silently regress if `isInteractive` is re-added.
- `GlassView`'s non-iOS fallback being a plain `<View>` is not documented in the library — it was confirmed by reading the installed package's compiled GlassView module directly. This means no conditional rendering is needed.
- The `Platform.select` spread pattern is the idiomatic way to apply platform-specific styles without branching component render logic.
- The z-index layering contract is implicit across `HomeHeader.tsx` and `CuratedHomeLayout.tsx` — a change to either file's zIndex without updating the other will break hit-testing or scroll-over behavior.

## When to Apply

- Any `apps/mobile` component that uses `GlassView` from `expo-glass-effect`
- Any `GlassView` used inside a `Pressable` or `TouchableOpacity` — never set `isInteractive` in that context
- Any header or overlay component that needs to float above a hero layer but allow list content to scroll over it
- Any third-party native component whose press-state animation is driven by the native layer rather than React state

## Examples

### Full HomeHeader.tsx pattern

```tsx
import { Platform, Pressable, StyleSheet, View } from "react-native"
import { LinearGradient } from "expo-linear-gradient"
import { GlassView } from "expo-glass-effect"
import Ionicons from "@expo/vector-icons/Ionicons"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useRouter } from "expo-router"
import {
  ACCENT,
  BLACK,
  SURFACE_COLOR,
  TEXT_SECONDARY,
  hexToRgba,
} from "../../lib/color"

export function HomeHeader() {
  const insets = useSafeAreaInsets()
  const router = useRouter()

  return (
    <View style={[styles.container, { paddingTop: insets.top + 4 }]}>
      <LinearGradient
        colors={[hexToRgba(BLACK, 0.5), hexToRgba(BLACK, 0)]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Search"
        onPress={() => router.navigate("/(tabs)/watch")}
      >
        <GlassView
          style={styles.glassButton}
          glassEffectStyle="regular"
          colorScheme="dark"
        >
          <Ionicons name="search" size={22} color={ACCENT} />
        </GlassView>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Profile"
        onPress={() => router.navigate("/(tabs)/profile")}
      >
        <GlassView
          style={styles.glassButton}
          glassEffectStyle="regular"
          colorScheme="dark"
        >
          <Ionicons name="person" size={16} color={TEXT_SECONDARY} />
        </GlassView>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  glassButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      android: {
        backgroundColor: hexToRgba(SURFACE_COLOR, 0.6),
        overflow: "hidden" as const,
      },
    }),
  },
})
```

## Related

- [`homeheader-zindex-touch-interception-glassview-opacity-2026-04-09.md`](../ui-bugs/homeheader-zindex-touch-interception-glassview-opacity-2026-04-09.md) — same component. `GlassView` ignores an `opacity` value set on itself on iOS, so mount/unmount is the reliable show-hide. Also raises this doc's `zIndex: 1` to 10.
- [`expo-glass-effect-glassview-invisible-under-animated-opacity-ancestor.md`](./expo-glass-effect-glassview-invisible-under-animated-opacity-ancestor.md) — same component, third failure mode. `GlassView` renders nothing inside a layer whose opacity an ancestor animates; use `PlatformBlur` there.
- [`hero-mute-button-hybrid-overlay-touch-target.md`](../mobile/hero-mute-button-hybrid-overlay-touch-target.md) — Documents the three-layer hero architecture (zIndex 0/2) that HomeHeader integrates with at zIndex 1
- [`full-bleed-video-hero-with-scroll-over-content.md`](../mobile/full-bleed-video-hero-with-scroll-over-content.md) — Foundational doc for the absolutely-positioned hero behind FlashList pattern
- [`flashlist-hero-bleed-through-feed-background.md`](../mobile/flashlist-hero-bleed-through-feed-background.md) — Color token system and `hexToRgba` conventions
- [`react-native-scrollview-touch-event-z-index-fix.md`](../mobile/react-native-scrollview-touch-event-z-index-fix.md) — Why zIndex controls visual order but not touch priority with native gesture recognizers
