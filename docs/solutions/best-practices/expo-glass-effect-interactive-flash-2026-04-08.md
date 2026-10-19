---
title: "expo-glass-effect GlassView: isInteractive on buttons only, a glass that fills the touch target, and cross-platform integration"
date: "2026-04-08"
last_updated: "2026-10-19"
category: best-practices
module: apps/mobile
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - "Giving a glass button Apple's own press response with isInteractive (GlassSurface `interactive`)"
  - "Sizing the touch target of a glass button, or adding a label or a hitSlop around one"
  - "Using expo-glass-effect GlassView in a tab-based Expo Router layout"
  - "Mounting GlassView on a component that remounts on tab switch"
  - "Targeting iOS liquid glass effect with Android fallback"
root_cause: wrong_api
resolution_type: code_fix
related_components:
  - "apps/mobile/src/components/ui/GlassSurface.tsx"
  - "apps/mobile/src/components/ui/FloatingBackButton.tsx"
  - "apps/mobile/src/components/ui/ScreenTopBar.tsx"
  - "apps/mobile/src/components/ui/HomeHeader.tsx"
  - "apps/mobile/src/components/bible/ReaderGlassButton.tsx"
  - "apps/mobile/src/components/explore/ClipOverlay.tsx"
  - "apps/mobile/src/lib/playerLayout.ts"
tags:
  - expo-glass-effect
  - glass-view
  - ios-liquid-glass
  - isinteractive
  - press-response
  - touch-target
  - tab-navigation
  - android-fallback
  - react-native
  - platform-select
  - zindex
---

# expo-glass-effect GlassView: isInteractive on buttons only, a glass that fills the touch target, and cross-platform integration

## Update 2026-10-19 (feat-705, PR #2750)

On the feat-705 branch (PR #2750, open and unmerged as of this writing), the
app gives glass buttons Apple's own press response: the glass swells and glows
under the finger. Three facts decide how you use it.

- **It is safe to turn on, as far as one device check shows.** On 0.1.9,
  `isInteractive` flashed white on remount, which is why this doc first said
  "never set it" (see History below). On 57.0.4 the owner saw no white flash
  on an iPhone 15 Pro (iOS 26.5).
- **Buttons only.** A panel or a label with the effect reacts to a touch as a
  whole surface.
- **It sees only a touch on the glass itself.** A tap on a label beside the
  glass, or in a `hitSlop` ring around it, does the action and shows no press.
  So the glass must fill the touch target. The owner accepts a ring of up to
  6 pt.

## Context

This doc started on 2026-04-08 with the iOS liquid glass buttons in
`HomeHeader.tsx`, on `expo-glass-effect` ~0.1.9, Expo SDK 54 and React Native
0.81. That work needed the install, the wrapping pattern, an Android fallback,
the three-layer hero z-index layout, and a fix for a white flash that
`isInteractive` caused.

On 2026-10-19 the app was on `expo-glass-effect` 57.0.4 and Expo SDK 57. The
press of a glass button was then the app's own 92% scale, which did not look
like a system button. The owner asked for the native response, and the change
showed that the response does not cover the whole touch target.

## Guidance

### Installing expo-glass-effect

Always install via `npx expo install expo-glass-effect` (not `pnpm add`) so Expo's resolver pins a compatible version for the active SDK. Requires Xcode 26 for native builds.

### Wrapping pattern: GlassView inside Pressable, not around it

Place `GlassView` as the child of `Pressable`, not as the wrapper. `Pressable` owns touch handling and the action. `GlassView` draws the glass, and with `isInteractive` it also draws the press response, but only for a touch that lands on the glass (see below).

```tsx
<Pressable onPress={handlePress}>
  <GlassView
    style={styles.glassButton}
    glassEffectStyle="regular"
    colorScheme="dark"
    isInteractive
  >
    <Ionicons name="search" size={22} color={ACCENT} />
  </GlassView>
</Pressable>
```

### Set `isInteractive` on buttons only

`isInteractive` sets `UIGlassEffect.isInteractive` on the native glass
(`ios/GlassView.swift:320` in the installed 57.0.4 package). A change of the
value on a mounted view replaces the effect with an empty one and installs it
again (`setInteractive`, `ios/GlassView.swift:278-284`).

- **Use `GlassSurface`'s `interactive` prop.** It maps to `isInteractive` only
  on the glass path (`apps/mobile/src/components/ui/GlassSurface.tsx:39` and
  `:75`). The buttons that draw `GlassView` outside `GlassSurface` set it too:
  the two `HomeHeader` buttons, `FloatingBackButton` (`isInteractive={glass}`),
  and `ReaderGlassButton` through `ReaderGlassSurface`
  (`interactive={!disabled}`, so a disabled button shows no response).
- **Never on a panel or a label.** The snackbar, the sheets, the player time
  pill, the skip label, the reader's notice pill and the tab bar background
  leave it unset.
- **Do not dim or scale the glass yourself.** On glass, the response is the
  only press cue. An opacity below 1 on any ancestor also stops the glass
  drawing. The fallback (Android, iOS before 26) keeps its dim through
  `GlassSurface`'s `pressed`.
- **The white flash.** The owner's device check on 57.0.4 (2026-10-19, not
  repeatable from the tree) covered tab switches, a
  video opened and closed, a return from the background, and screens that
  mount new glass buttons. The tab bar is native (`NativeTabs`), so a tab
  switch may not remount a screen. The check therefore may not have run the
  0.1.9 trigger. Check for a flash again after an `expo-glass-effect` upgrade.

The full `GlassSurface` rules, with the dissolve and the fade, are in
[GlassView fails under an animated-opacity ancestor](./expo-glass-effect-glassview-invisible-under-animated-opacity-ancestor.md)
and in `apps/mobile/CLAUDE.md`, section "Liquid Glass (feat-705)".

### The press response sees only a touch on the glass

UIKit sends a touch to the view under the finger and to the views that contain
it. `GlassView` puts its children inside its effect view
(`glassEffectView.contentView.insertSubview`, `ios/GlassView.swift:332-333`), so
a touch on the icon inside the glass reaches the glass. A label beside the
glass is a sibling, not a child. A `Pressable`'s `hitSlop` ring lies outside
the glass. A touch there fires `onPress`, but the glass never sees it, so the
button acts with no visible press.

The app's old press hid this. It scaled the glass on the `Pressable`'s pressed
state, and that state covers the whole target. When the scale gave way to
`isInteractive`, a review found two places with no press cue (2026-10-19):

- the text label under each Explore rail circle;
- the 12 pt `hitSlop` ring of the floating back button, about 60% of its
  64 pt target around a 40 pt glass.

Make the glass fill the target. The owner accepts a ring of up to 6 pt with no
press cue (2026-10-19):

| Control                       | Glass                        | Touch target                | Ring with no cue     |
| ----------------------------- | ---------------------------- | --------------------------- | -------------------- |
| Floating back button          | 44 pt (`FLOATING_BACK_SIZE`) | 56 pt (`hitSlop={6}`)       | 6 pt                 |
| Top bar back and menu buttons | 44 pt                        | 44 pt                       | none                 |
| Explore rail buttons          | 48 pt circle                 | the circle (labels removed) | none                 |
| My Watch "See all"            | 32 pt high pill              | 44 pt high                  | 6 pt above and below |

`FLOATING_BACK_SIZE` is in `apps/mobile/src/lib/playerLayout.ts:12`, and the top
bar reads it (`apps/mobile/src/components/ui/ScreenTopBar.tsx:43`). If a target
must be wider than the glass by more than 6 pt, give the rest of the target its
own cue. For example, dim a sibling label on press: a sibling's opacity does not
stop the glass.

### What tests can and cannot show

Jest never draws the native glass, so a test sees only props. Pin
`isInteractive` per node: `true` on each button, unset on each panel and label,
`false` on a disabled button. Break each rule once to prove that its test can
fail. Only a device or simulator shows the response itself, the absence of a
flash, and where a touch lands. Two places had no device result on
2026-10-19:

- the AirPlay button, a native `AVRoutePickerView` inside interactive glass;
- the reader's chapter and translation pills, which turn `isInteractive` on
  when their data loads and so reset the effect on a mounted view.

### Do NOT place `GlassView` inside a layer whose opacity animates

> **Superseded in part 2026-10-16 by feat-705 (PR #2750)** (noted 2026-10-19).
> The rule stays. Two facts below changed. On `expo-glass-effect` 57.0.4 the
> glass under a fading ancestor draws on some reveals and not on others. On
> iOS 26 the fix is no longer `PlatformBlur`: keep the glass outside the fade,
> dissolve it with `GlassSurface` (`visible={false}`), and fade the glyph inside
> the glass (`fade`). `PlatformBlur` stays the look on Android and on iOS
> before 26. See
> [GlassView fails under an animated-opacity ancestor](./expo-glass-effect-glassview-invisible-under-animated-opacity-ancestor.md).
> The paragraph below records the 0.1.10 state.

`GlassView` renders no material at all when an ancestor animates opacity —
invisible, not subtle, and nothing logs. Conditional mount does not help, because
there is nothing to fade. Use `PlatformBlur`
(`apps/mobile/src/components/ui/PlatformBlur.tsx`) for any frosted surface inside
fading chrome. Opacity applied to the `GlassView` itself is a separate defect with
a separate fix; both are linked under Related.

### Android fallback via Platform.select spread

`GlassView` falls back to a plain `<View {...props}/>` on non-iOS, so it is safe to render unconditionally on all platforms without a `Platform.OS` guard around the component itself. This was read directly out of the installed package's compiled GlassView module, and re-verified there at 0.1.10 and at 57.0.4 (2026-10-19). Under pnpm that file sits inside the virtual store (the .pnpm directory, keyed by exact version) rather than at a flat per-package path, so look it up through the virtual store.

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

### History: the 0.1.9 `isInteractive` flash (2026-04-08)

This section records why the doc first said "Do NOT set `isInteractive` when
the parent is a Pressable". On 0.1.9, `isInteractive` told the native glass to
animate its highlight on touch. When the component remounted (for example, on
an Expo Router tab switch), the native layer read the remount as a touch and
fired the highlight, which showed as a **white flash**. The fix then was to
leave the prop off:

```tsx
// 0.1.9: flashed white on a tab switch
<GlassView isInteractive style={styles.glassButton} glassEffectStyle="regular" colorScheme="dark">
// 0.1.9 fix
<GlassView style={styles.glassButton} glassEffectStyle="regular" colorScheme="dark">
```

## Why This Matters

- Without the native response, glass buttons do not feel like system buttons,
  which is the point of Liquid Glass on iOS 26.
- The touch limit fails silently. The tap still works, so every test and a
  quick tap on the glass pass, but part of the target shows no press. Only a
  tap on the label or the ring shows the gap.
- An effect on a panel or a label makes the whole surface react to a touch,
  which reads as a button that is not one.
- A dim on the glass path stops the glass drawing, so the press cue on glass
  must come from the glass.
- `GlassView`'s non-iOS fallback being a plain `<View>` is not documented in the library — it was confirmed by reading the installed package's compiled GlassView module directly. This means no conditional rendering is needed.
- The `Platform.select` spread pattern is the idiomatic way to apply platform-specific styles without branching component render logic.
- The z-index layering contract is implicit across `HomeHeader.tsx` and `CuratedHomeLayout.tsx` — a change to either file's zIndex without updating the other will break hit-testing or scroll-over behavior.

## When to Apply

- Any `apps/mobile` component that uses `GlassView` from `expo-glass-effect`
- Any glass button: set `interactive` (or `isInteractive`), make the glass fill
  the touch target, and keep any ring to 6 pt or less
- Any label, `hitSlop` or padding that makes a glass button's target larger
  than its glass
- After an `expo-glass-effect` upgrade: check a glass button for a white flash
  on mount and on a tab switch
- Any header or overlay component that needs to float above a hero layer but allow list content to scroll over it
- Any third-party native component whose press-state animation is driven by the native layer rather than React state

## Examples

### A `GlassSurface` button

From `apps/mobile/src/components/watch/ScrollTopButton.tsx`. The glass is the
whole button, so every tap lands on it:

```tsx
<Pressable
  onPress={onPress}
  accessibilityRole="button"
  accessibilityLabel={label}
>
  <GlassSurface
    style={styles.button}
    fallback={BUTTON_FALLBACK}
    visible={visible}
    dissolveSeconds={DISSOLVE_SECONDS}
    fade={opacity}
    interactive
  >
    <Ionicons name="chevron-up" size={22} color={TEXT_PRIMARY} />
  </GlassSurface>
</Pressable>
```

### A direct `GlassView` button with a 6 pt ring

From `apps/mobile/src/components/ui/FloatingBackButton.tsx`. The glass is
44 pt, the ring is 6 pt, and the scale applies only off glass:

```tsx
<Pressable
  onPress={handleBack}
  hitSlop={6}
  // On glass, Apple's own press response replaces the scale.
  style={({ pressed }) => pressed && !glass && styles.pressed}
>
  <GlassView
    style={styles.button} // FLOATING_BACK_SIZE: 44
    glassEffectStyle="regular"
    colorScheme="dark"
    isInteractive={glass}
  >
    <Ionicons name={icon} size={24} color={ACCENT} />
  </GlassView>
</Pressable>
```

The 2026-04-08 version of this doc showed the whole `HomeHeader.tsx` with
40 pt buttons, `zIndex: 1` and no `isInteractive`. Read the current file for
its code.

## Related

- [`expo-glass-effect-glassview-invisible-under-animated-opacity-ancestor.md`](./expo-glass-effect-glassview-invisible-under-animated-opacity-ancestor.md) — the `GlassSurface` contract: the dissolve, the fade inside the glass, `interactive` and `pressed`. `GlassView` fails inside a layer whose opacity an ancestor animates: no material on 0.1.10, and glass on some reveals only on 57.0.4.
- `apps/mobile/CLAUDE.md`, section "Liquid Glass (feat-705)" — the app's glass rules, including the 6 pt ring.
- [`homeheader-zindex-touch-interception-glassview-opacity-2026-04-09.md`](../ui-bugs/homeheader-zindex-touch-interception-glassview-opacity-2026-04-09.md) — same component. `GlassView` ignores an `opacity` value set on itself on iOS, so mount/unmount is the reliable show-hide. Also raises this doc's `zIndex: 1` to 10.
- [`paged-hero-overlay-chrome-touch-architecture.md`](../ui-bugs/paged-hero-overlay-chrome-touch-architecture.md) — hit-testing background: a touch goes to the view under the finger, which is why the glass must be that view.
- [`hero-mute-button-hybrid-overlay-touch-target.md`](../mobile/hero-mute-button-hybrid-overlay-touch-target.md) — Documents the three-layer hero architecture (zIndex 0/2) that HomeHeader integrates with at zIndex 1. The Experience hero's mute glass (`VideoHeroRenderer`) is only a visual box under a separate touch target, so it leaves `interactive` unset. The Home pager's mute button wraps its glass in its own `Pressable` and sets it.
- [`full-bleed-video-hero-with-scroll-over-content.md`](../mobile/full-bleed-video-hero-with-scroll-over-content.md) — Foundational doc for the absolutely-positioned hero behind FlashList pattern
- [`flashlist-hero-bleed-through-feed-background.md`](../mobile/flashlist-hero-bleed-through-feed-background.md) — Color token system and `hexToRgba` conventions
- [`react-native-scrollview-touch-event-z-index-fix.md`](../mobile/react-native-scrollview-touch-event-z-index-fix.md) — Why zIndex controls visual order but not touch priority with native gesture recognizers
