import { StyleSheet } from "react-native"
import { CastButton } from "react-native-google-cast"

/**
 * The SDK's own cast button, used as the VISIBLE control on Android.
 *
 * Android needs this and iOS does not, because `showCastDialog()` is
 * implemented differently on each side:
 *
 *  - iOS calls `[GCKCastContext.sharedInstance presentCastDialog]` directly
 *    (RNGCCastContext.m:78), so the app-drawn glyph works and this component is
 *    unnecessary there.
 *  - Android calls `RNGoogleCastButtonManager.getCurrent()` then
 *    `performClick()` (RNGCCastContext.java:128) — it can only click a native
 *    button that is already attached. Rather than mount a hidden one purely to
 *    feed that static registry, Android renders this as the real control: it
 *    owns its own press and presents the dialog itself, so there is no gap
 *    between "a glyph is visible" and "a button is registered". That gap was
 *    the original bug — the glyph appeared and did nothing.
 *
 * It lives under `src/lib/cast/` because the SDK-import guard
 * (`castImports.guard.test.js`) allows that prefix, so callers import this
 * wrapper rather than the SDK.
 *
 * Verified on an emulator 2026-08-21: renders and stays visible with no
 * receiver discoverable, and its accessibility label reaches the native view
 * (`content-desc="Cast"`). Only `tintColor` is stylable — the SDK owns the
 * glyph, so the connected-state artwork is its own, not `cast-connected`.
 */
export function NativeCastButton({
  accessibilityLabel,
  tintColor,
}: {
  accessibilityLabel: string
  tintColor: string
}) {
  return (
    <CastButton
      style={styles.button}
      tintColor={tintColor}
      accessibilityLabel={accessibilityLabel}
    />
  )
}

// Matches airPlayPicker in PlayerControls so both native route buttons sit
// identically inside the shared 44pt Frosted backplate.
const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
  },
})
