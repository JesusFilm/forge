import { Platform, StyleSheet, View } from "react-native"
import { CastButton } from "react-native-google-cast"

/**
 * An invisible native cast button, mounted for its SIDE EFFECT on Android.
 *
 * `CastContext.showCastDialog()` is implemented per platform and only one half
 * needs help:
 *
 *  - iOS calls `[GCKCastContext.sharedInstance presentCastDialog]` directly and
 *    always resolves true (RNGCCastContext.m:78). No button is involved, so
 *    mounting a `GCKUICastButton` here would be a behaviour change to a working
 *    platform for no gain.
 *  - Android calls `RNGoogleCastButtonManager.getCurrent()` then
 *    `button.performClick()` (RNGCCastContext.java:128). That registry is filled
 *    ONLY by `ColorableMediaRouteButton.onAttachedToWindow`. With no button
 *    mounted, `getCurrent()` returns null and the promise resolves FALSE — and
 *    the app's cast glyph appears whenever a device is discovered, so an Android
 *    viewer gets a button that does nothing at all.
 *
 * This component is why the Android cast dialogs open, which is in turn why the
 * Android theming in plugins/withAndroidCastTheme.js is observable.
 *
 * It lives under `src/lib/cast/` on purpose: the SDK-import guard
 * (`castImports.guard.test.js`) allows that prefix, so callers import this
 * wrapper and the guard needs no new allowlist entry.
 *
 * More than one instance is safe. The vendor keeps a LIST and hands out the last
 * attached; every instance is an equivalent MediaRouteButton on the same
 * Activity, and `onDetachedFromWindow` removes only itself.
 */
/** Test handle: the component draws nothing, so nothing else identifies it. */
export const CAST_ROUTE_BUTTON_TEST_ID = "cast-route-button"

export function CastRouteButton() {
  if (Platform.OS !== "android") return null
  return (
    // collapsable={false}: RN Android flattens views that draw nothing, and a
    // flattened wrapper would never attach — which is the whole point here.
    <View
      testID={CAST_ROUTE_BUTTON_TEST_ID}
      style={styles.host}
      pointerEvents="none"
      collapsable={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <CastButton style={styles.button} />
    </View>
  )
}

// Absolute and 1pt so it disturbs no sibling layout, and transparent so it is
// invisible. Size and opacity do not affect attachment; being in the tree does.
const styles = StyleSheet.create({
  host: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 1,
    height: 1,
    opacity: 0,
    overflow: "hidden",
  },
  button: {
    width: 1,
    height: 1,
  },
})
