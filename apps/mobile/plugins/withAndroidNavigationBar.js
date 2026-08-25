// Loaded defensively: Expo config plugins are only resolvable in prebuild
// contexts. On resolution failure, no-op rather than crash Metro/jest — the
// prebuilt android/ resources are already patched.
let withAndroidStyles = null
try {
  ;({ withAndroidStyles } = require("expo/config-plugins"))
} catch {
  withAndroidStyles = null
}

const { setItem, findStyle, getRequiredStyle } = require("./androidStyleXml")

/**
 * Make the Android system navigation bar show the app's own surface colour.
 *
 * The app is edge-to-edge (android/gradle.properties `edgeToEdgeEnabled=true`),
 * so React Native runs `Window.enableEdgeToEdge()` at every REACT Activity
 * creation (`ReactActivityDelegate.onCreate`). Activities RN never touches --
 * `RNGCExpandedControllerActivity` inherits AppTheme and is one -- carry the
 * items below but never run that function, so there the change alters PLATFORM
 * behaviour rather than React Native's. That surface is unmeasured.
 * On API 29+ that function does three things
 * (react-native@0.86.2 ReactAndroid/.../views/view/WindowUtil.kt:164-196):
 *
 *   1. `navigationBarColor = Color.TRANSPARENT` — unconditionally. Setting
 *      `android:navigationBarColor` therefore cannot work; not the lever.
 *   2. Reads `android.R.attr.enforceNavigationBarContrast` off the Activity
 *      theme (defaulting to true) into `isNavigationBarContrastEnforced`.
 *   3. ONLY when contrast is enforced, overwrites
 *      `isAppearanceLightNavigationBars` from the SYSTEM dark-mode setting.
 *
 * So `enforceNavigationBarContrast` is the one attribute RN reads and obeys,
 * and it gates both remaining problems. With it left at its default:
 *
 *   - The platform draws a contrast scrim over the transparent bar. Measured on
 *     a Galaxy S20 (SM-G981U1, Android 13, One UI 5.1, three-button nav):
 *     #e9e8e8 with the system in LIGHT appearance — a near-white bar under this
 *     app's near-black #1c1917 — and #110f0e in dark appearance, which is the
 *     platform's #66000000 over #1c1917.
 *   - Step 3 fires, so any `android:windowLightNavigationBar` we set is
 *     discarded on the next launch.
 *
 * Turning it off skips the scrim AND skips step 3, which is why the two items
 * below ship together. The bar then renders genuinely transparent and the app's
 * own content shows through it. Verified after the change: #1c1917 on a Galaxy
 * S20 (API 33, physical) and a Pixel 9a emulator (API 35), three-button
 * navigation, in both light and dark system appearance. The API 35 reading came
 * from an emulator that was not cold-booted, which this repo's own notes warn
 * against for Android rendering claims; treat it as weaker than the S20 one.
 *
 * BOTH styles are written, and that is load-bearing. MainActivity's manifest
 * theme is `Theme.App.SplashScreen`, which does NOT inherit AppTheme. AppTheme
 * only becomes the Activity theme because expo-splash-screen's generated
 * `SplashScreenManager.registerOnActivity` applies `postSplashScreenTheme`
 * before `super.onCreate`. Writing the splash style too fixes the launch
 * window itself, which otherwise keeps the platform scrim.
 *
 * ORDER REQUIREMENT — this trades one cross-plugin dependency for another, it
 * does not remove it. `expo-splash-screen` REPLACES `Theme.App.SplashScreen`
 * rather than merging into it (`addSplashScreenStyle` filters the style out and
 * pushes a fresh four-item one), and Expo runs mods LAST-registered-first. So
 * this plugin must appear BEFORE `expo-splash-screen` in app.json's `plugins`
 * array — it does (line ~63 vs ~86) — or its two items are silently wiped with
 * every test still green. `splash theme wiring` pins this against the real
 * expo-splash-screen mod.
 *
 * On API 31+ androidx re-parents `Theme.SplashScreen` to
 * `android:Theme.DeviceDefault.DayNight` and its `values-v33` sets BOTH of
 * these attributes true, so the items below deliberately reverse an androidx
 * default there. Measured on the S20 (API 33, light appearance, cold launch):
 * the splash window's bar reads #1c1917. API 31-32 are NOT measured.
 *
 * SCOPE: API 29+. minSdkVersion is 24, and on API 24-28 `enableEdgeToEdge`
 * takes an else-branch that picks the bar colour itself and always overwrites
 * the appearance flag, so neither item reaches those devices. What they get
 * splits at API 26 (`Build.VERSION_CODES.O`), where RN starts asking for light
 * nav bars: API 24-25 keep RN's dark #801b1b1b, and so do API 26-28 in night
 * mode, but API 26-28 outside night mode get `LightNavigationBarColor`
 * (#e6ffffff) — the same near-white bar this plugin removes, still unfixable
 * there because RN assigns the colour in code, not from the theme.
 */

// Values are strings because they land as XML item text, not booleans.
const NAVIGATION_BAR_ITEMS = {
  // false = no platform scrim, and RN stops overwriting the item below.
  "android:enforceNavigationBarContrast": "false",
  // false = LIGHT buttons, for our dark surface. The attribute names the
  // BACKGROUND, so its sense is inverted from the icon colour it produces.
  "android:windowLightNavigationBar": "false",
}

const APP_THEME = "AppTheme"
const SPLASH_THEME = "Theme.App.SplashScreen"

/**
 * Add the navigation-bar items to AppTheme, and to the splash theme when it
 * exists. AppTheme is required — RN reads these attributes off the Activity
 * theme, so on a renamed template the items would reach nothing. The splash
 * style is optional: a config without expo-splash-screen simply has none.
 */
function applyNavigationBarTheme(resources) {
  const appTheme = getRequiredStyle(
    resources,
    APP_THEME,
    "[withAndroidNavigationBar] AppTheme not found in android styles.xml. " +
      "The Expo template renamed the application theme; React Native reads " +
      "enforceNavigationBarContrast off the Activity theme, so these items " +
      "must land on the real one. Failing prebuild instead of shipping a " +
      "white navigation bar under a dark app.",
  )

  const targets = [appTheme, findStyle(resources, SPLASH_THEME)].filter(Boolean)
  for (const style of targets) {
    for (const [item, value] of Object.entries(NAVIGATION_BAR_ITEMS)) {
      setItem(style, item, value)
    }
  }
  return resources
}

module.exports = function withAndroidNavigationBar(config) {
  if (!withAndroidStyles) {
    console.warn(
      "[withAndroidNavigationBar] expo/config-plugins not resolvable; " +
        "skipping the Android navigation bar theme. Run `pnpm install` so " +
        "apps/mobile has expo, then re-run `expo prebuild`.",
    )
    return config
  }
  return withAndroidStyles(config, (cfg) => {
    cfg.modResults.resources = applyNavigationBarTheme(
      cfg.modResults.resources ?? {},
    )
    return cfg
  })
}

// Exported for unit tests — the transform is pure. Both items are silently
// inert if dropped: nothing throws, the bar just goes white again in light mode.
module.exports.applyNavigationBarTheme = applyNavigationBarTheme
module.exports.NAVIGATION_BAR_ITEMS = NAVIGATION_BAR_ITEMS
module.exports.NAVIGATION_BAR_STYLES = { APP_THEME, SPLASH_THEME }
