# Mobile tab bar — floating liquid-glass pill on iOS, unchanged on Android

**Date:** 2026-09-08
**App:** `apps/mobile`
**Status:** design approved, pending spec review
**Worktree:** `.claude/worktrees/feat-ios-glass-tab-bar`

## Problem

The bottom tab bar is a flat opaque bar. It sits flush against the bottom of the
screen and it fills its background with `#1c1917`.

On iOS the bar must become a floating capsule. The capsule is frosted. Content
scrolls behind it. On Android the bar must stay exactly as it is today.

## Decisions taken before design

| Question                                   | Answer                                            |
| ------------------------------------------ | ------------------------------------------------- |
| What do iOS versions below 26 get?         | The same floating pill, drawn with `expo-blur`.   |
| What goes in the pill?                     | The icon and the label, as today.                 |
| How wide is the pill?                      | Near-full width, with a 16pt margin on each side. |
| Does content scroll behind the pill?       | Yes.                                              |
| What happens to the Library selection bar? | It becomes a pill with the same shape.            |

## Current state

- `app/(tabs)/_layout.tsx` holds the whole tab bar. It exports the module-scope
  constant `TAB_BAR_STYLE` (`{ backgroundColor: "#1c1917", borderTopColor: "transparent" }`).
- `app/(tabs)/library.tsx:13` imports that constant. Lines 118 and 128 write it
  back with `navigation.setOptions` to restore the bar after selection mode.
  Each write replaces the whole style object.
- `src/components/watch/PlaybackHost.tsx:140` declares
  `TAB_BAR_CONTENT_HEIGHT = Platform.select({ ios: 49, android: 56 })`. Its
  comment says an operator read the number from `app/(tabs)/_layout.tsx`.
  Nothing enforces that.
- `src/components/ui/PlatformBlur.tsx` already gives the repo's blur convention:
  `BlurView` on iOS, a flat dim on Android.
- `src/components/ui/FloatingBackButton.tsx` and `HomeHeader.tsx` already use
  `GlassView` with `glassEffectStyle="regular"` and `colorScheme="dark"`.

### Correction to a common assumption

`@react-navigation/bottom-tabs` **does not resolve from `apps/mobile`**.
`require.resolve` returns `MODULE_NOT_FOUND`. The app runs against the fork that
`expo-router@57.0.19` vendors, at
`expo-router/build/react-navigation/bottom-tabs/`. Import
`useBottomTabBarHeight` from `expo-router/js-tabs`. The obvious import passes
`tsc` and then fails when Metro builds the bundle.

## Architecture — the seam

`tabBarStyle` carries the geometry. `tabBarBackground` carries the material.

The bar renders the element that `tabBarBackground()` returns as its first
child, inside `StyleSheet.absoluteFill` with `pointerEvents: "none"`
(`BottomTabBar.js:258`). The material therefore fills the pill exactly, a
`borderRadius` with `overflow: "hidden"` clips it to the capsule shape, and it
can never take a tab press.

### Why not a custom `tabBar` render prop

The prop exists. It costs each of these, and each is free today:

- the `onLayout` callback that feeds `BottomTabBarHeightCallbackContext`;
- the `tabPress` and `tabLongPress` events, plus the navigate dispatch;
- the iOS accessibility label `"<label>, tab, <n> of <total>"`;
- badges, `tabBarButton`, and the hide animation;
- the `{ display: "none" }` write that `library.tsx:118` depends on.

### Why not `expo-router/unstable-native-tabs`

It exists, and `react-native-screens@4.26.2` ships the full native
implementation, including `UITabBarMinimizeBehavior`. On iOS 26 it would give
Apple's own glass capsule with no custom code.

It is rejected because it cannot meet the decisions above. Below iOS 26 it draws
a plain opaque UIKit bar, not a frosted pill. Android would need a second
navigator with a different options API and a different way to hide the bar.
Revisit it when the deployment target reaches iOS 26.

### The one ordering trap

`BottomTabBar.js:220` sets
`backgroundColor: tabBarBackgroundElement != null ? "transparent" : colors.card`.
`tabBarStyle` is appended **after** it, at line 258. So `tabBarStyle` wins.

- On iOS the `backgroundColor` must be absent. If it stays, the glass renders
  behind an opaque block. Nothing warns you.
- On Android `tabBarBackground` must return `null`, which restores
  `colors.card`, which today's `#1c1917` then overrides. That is the present
  behaviour, unchanged.

`GlassView` off iOS is a bare transparent `<View>`. An unguarded glass pill on
Android is therefore an invisible bar.

## New module — `src/lib/tabBar.ts`

This module replaces the exported `TAB_BAR_STYLE` constant. It is the only place
that spells the pill's numbers.

```ts
export const TAB_BAR_PILL_HEIGHT = 56
export const TAB_BAR_PILL_LIFT = 12
export const TAB_BAR_PILL_SIDE_MARGIN = 16
export const TAB_BAR_PILL_RADIUS = TAB_BAR_PILL_HEIGHT / 2

/** Space the bar occupies ABOVE the safe-area inset. The mini player reserves
 *  this. Android keeps its present (already 7pt optimistic) value. */
export const TAB_BAR_OCCUPIED_HEIGHT = Platform.select({
  ios: TAB_BAR_PILL_HEIGHT + TAB_BAR_PILL_LIFT, // 68
  android: 56,
  default: 49,
})

/** The navigator's `tabBarStyle`. A hook because the pill's lift is measured
 *  from the safe area. */
export function useTabBarStyle(): ViewStyle

/** What a scroll surface must clear. Zero on Android, where the bar still
 *  displaces content. */
export function useTabBarClearance(): number
```

`useTabBarClearance()` returns `insets.bottom + TAB_BAR_OCCUPIED_HEIGHT + 12` on
iOS. The final 12 is a breathing gap so the last row does not touch the pill.

`PlaybackHost.tsx` imports `TAB_BAR_OCCUPIED_HEIGHT` and re-exports it under the
existing name `TAB_BAR_CONTENT_HEIGHT`, so its two test files keep working.

`library.tsx` calls `useTabBarStyle()` and writes that value back. It can no
longer drift from the navigator.

## Geometry (iOS only)

| Property            | Value                                 | Why                                                                  |
| ------------------- | ------------------------------------- | -------------------------------------------------------------------- |
| `height`            | 56                                    | The icon is 24 and the label is 10pt. 56 leaves comfortable padding. |
| `position`          | `"absolute"`                          | Content must pass behind the pill.                                   |
| `marginBottom`      | `insets.bottom + 12`                  | See below.                                                           |
| `marginHorizontal`  | `16 + max(insets.left, insets.right)` | Keeps the pill clear of a landscape notch.                           |
| `borderRadius`      | 28                                    | Half the height makes a true capsule.                                |
| `overflow`          | `"hidden"`                            | Clips the material to the capsule.                                   |
| `paddingBottom`     | 0                                     | Override. See below.                                                 |
| `paddingHorizontal` | 0                                     | The margin already clears the notch.                                 |
| `borderTopWidth`    | 0                                     | The bar draws an unconditional hairline.                             |

The bar sets `styles.bottom = { start: 0, end: 0, bottom: 0, elevation: 8 }`.
That style is inert while the bar is in flow and becomes live once the bar is
absolute. So `position: "absolute"` alone pins the bar, and the two margins
inset it.

### Two rules that are load-bearing

**`paddingBottom` must be 0.** The bar's own style sets
`paddingBottom: insets.bottom` inside the height box (`BottomTabBar.js:252`).
With a numeric height the home indicator would eat the pill's content instead of
sitting below it.

**The lift is measured from the safe area, never from the screen edge.**
`getTabBarHeight` returns a numeric `height` verbatim and never adds the inset
(`BottomTabBar.js:100-113`). Measured from the screen edge, the space the pill
occupies above the safe area becomes `height + margin - insets.bottom`, which
differs on every device, so no single constant can be correct. Measured from the
safe area it is `56 + 12 = 68` everywhere.

## Material — `src/components/ui/TabBarBackground.tsx`

| Condition                                                                   | Render                                                                       |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| iOS, `isLiquidGlassAvailable()` and `isGlassEffectAPIAvailable()` both true | `GlassView`, `glassEffectStyle="regular"`, `colorScheme="dark"`, pill radius |
| iOS, otherwise                                                              | `PlatformBlur`, dark tint, pill radius                                       |
| Android                                                                     | `null`                                                                       |

`colorScheme="dark"` is required. `app.json` sets
`userInterfaceStyle: "automatic"` while every React Native surface in this app
is hard-coded dark. An unset colour scheme renders a light pill on a light-mode
phone.

Do not set `isInteractive`. Inside a pressable it flashes white on remount. See
`docs/solutions/best-practices/expo-glass-effect-interactive-flash-2026-04-08.md`.

`isGlassEffectAPIAvailable()` exists because some iOS 26 beta builds crash
without it (expo/expo#40911). The app calls neither guard today.

## Clearance — seven surfaces

The navigator adds no padding when the bar leaves the flow. The screen container
simply grows to full height. Each surface below adds `useTabBarClearance()`,
which is 0 on Android.

Only **list-level** padding takes the clearance.
`HomeMissionSection.tsx:191` holds `paddingBottom: 24`, but that is spacing
inside one feed item. The `HomeScreen` content container already clears the
whole feed, so adding the clearance in both places would double-count it.

| Surface                                            | Today                | Hidden without the fix                                          |
| -------------------------------------------------- | -------------------- | --------------------------------------------------------------- |
| `src/components/home/HomeScreen.tsx:389`           | 48                   | the bottom of the feed, including the mission rail              |
| `app/(tabs)/watch.tsx:840`                         | 32                   | the last result row, the `Load more` button and the retry block |
| `src/components/search/BrowseTopics.tsx:62`        | 24                   | the bottom row of topic cards                                   |
| `app/(tabs)/library.tsx:498`                       | 24                   | the last download row                                           |
| `app/(tabs)/profile.tsx:34`                        | 24                   | the last link rows                                              |
| `src/components/ui/Snackbar.tsx:81`                | `insets.bottom + 16` | the whole toast                                                 |
| `src/components/library/SelectionActionBar.tsx:32` | `insets.bottom + 14` | becomes a pill — see below                                      |

`library.tsx:501` holds `scrollContentSelecting.paddingBottom: 120`. That path
is already correct today, because `{ display: "none" }` already gives the screen
a full-height container. It must go **down**, not up. Testing Library only in
selection mode therefore suggests the whole tab is fine. It is not.

Discover is the highest priority. Its `ListFooterComponent` at
`watch.tsx:722-750` holds the live `Load more` button. Behind a transparent pill
it renders, and the bar takes the touch. The user reads that as a broken button.

`BrowseTopics` is easy to miss. It is Discover's default view, before anyone
types, and it is a second scroller behind an `absoluteFill` layer.

### Two fixes that look right and are wrong

**Do not use `sceneStyle`.** It lands on the screen's outer box, so a
`paddingBottom` there shrinks Home's `absoluteFill` hero layer with it. The hero
would stop above the pill and the glass would have nothing to show.
`sceneContainerStyle` does not exist in this version and is ignored in silence.

**Do not paint Home's padding region.** `HomeScreen.tsx:365-368` forbids an
opaque `contentContainerStyle`, because that region is deliberately transparent
down to the moving hero video.

## Mini player

The window rests at
`screenHeight - insets.bottom - chrome.bottom - WINDOW_EDGE_MARGIN - windowHeight`
(`src/lib/miniPlayer/layout.ts:123-139`, margin 12).

On a 390x844 iPhone with a 34pt inset, today:

- the window's bottom edge sits at 749;
- the bar's top edge sits at 761;
- the gap is 12, which is exactly `WINDOW_EDGE_MARGIN`.

With the pill and no change, the window overlaps the pill by 13pt.
`DEFAULT_CORNER` is `bottomRight`, so it is the first thing a user sees. Raising
the reservation from 49 to 68 restores the 12pt gap.

Do **not** change `android: 56`. It is already 7pt optimistic. Correcting it
here would move the Android mini player and read as a regression that the pill
caused.

`src/lib/miniPlayer/__tests__/layout.test.ts:21` hard-codes
`chrome: { bottom: 49 }` and does not import production, so it goes red by
coincidence. Point it at the shared constant.

## Selection bar and keyboard

On iOS, `SelectionActionBar` takes the same height, margins, radius and material
as the pill. **On Android it does not change at all** — it keeps its present
flush, full-width, opaque bar. The platform fork runs through the same
`useTabBarStyle()` and `TabBarBackground` pieces, so the two bars cannot
disagree about the shape.

The tab bar still hides with `{ display: "none" }` on both platforms.

Set `tabBarHideOnKeyboard` on iOS only. It is unset today, so on Discover the
pill would sit glued to the top edge of the keyboard.

## What must not change on Android

- The bar keeps `backgroundColor: "#1c1917"` and stays in the flow.
- `tabBarBackground` returns `null`.
- Every clearance value returns 0, so no padding moves.
- `TAB_BAR_OCCUPIED_HEIGHT` keeps `android: 56`.
- `tabBarHideOnKeyboard` stays unset.

An Android screenshot must be identical to a screenshot taken before the change.

## Testing

**No test can see this change work.** Every render suite mocks `GlassView` and
`PlatformBlur` to `() => null`. No test in the app asserts a bottom padding. The
tests below guard structure. A simulator decides the result.

1. **A guard that `PlaybackHost.tsx` imports the shared height** and does not
   spell a number. This closes the top risk by construction. Today the two
   suites that assert on `TAB_BAR_CONTENT_HEIGHT` both import it, so the
   constant cancels out on both sides of every assertion.
2. **A render suite on `app/(tabs)/_layout.tsx`** that pins the platform fork:
   iOS has no `backgroundColor` and has a radius; Android has the
   `backgroundColor` and no radius. Use the technique in
   `PlayerControls.test.tsx:142-150` — save the `Platform.OS` descriptor,
   redefine it, restore it in `afterEach`. jest-expo defaults to `ios`, so the
   Android branch must be entered on purpose or it never runs. Mock
   `@expo/vector-icons/Ionicons` as `AccountSection.test.tsx:14-26` does.
3. **A guard on the Library restore round trip** — what `library.tsx` writes
   must be what the navigator was configured with.
4. **Update `layout.test.ts`** to read the shared constant.

Known limit: `TAB_BAR_OCCUPIED_HEIGHT` resolves its `Platform.select` at module
scope. A test that redefines `Platform.OS` after import can never exercise the
Android value. Do not write a test that appears to.

## Verification (simulator, not jest)

Run `bash scripts/setup-sim-env.sh mobile` first. Run this worktree's own Metro.

1. **iOS 26** — the pill renders glass. Home is the important tab: its backdrop
   is moving video. Read the label contrast there. If the labels wash out, add a
   tint floor, as `src/lib/bibleCardTreatment.ts:8-20` records for the Bible
   card.
2. **iOS 18** — the pill renders blur, in the same place and the same shape.
3. **Android** — the screenshot matches a before shot.
4. Scroll each of the six lists to its end. Confirm the last row clears the
   pill. Press Discover's `Load more`.
5. Enter and leave Library selection mode. Confirm the pill returns.
6. Open a video, minimise it, and confirm the mini player rests above the pill
   in the bottom-right corner.
7. Focus Discover's search field. Confirm the pill hides.

## Out of scope

- **Hiding or shrinking the bar on scroll.** `GlassView` renders nothing inside
  a layer whose opacity an ancestor animates. Any fade forces `PlatformBlur` on
  every iOS version and changes the look on both platforms. This needs its own
  design.
- **Correcting the Android mini-player height.** See above.
- **Android parity.** If Android ever adopts the pill, note that
  `plugins/withAndroidNavigationBar` sets `enforceNavigationBarContrast=false`,
  so no platform scrim protects the system buttons from bright video.

## Delivery

`expo-glass-effect` is already a dependency with five call sites. This change
adds no native module and does not move the fingerprint runtime version, so it
ships over the air.
