---
title: Android system nav bar showed the platform contrast scrim, not the app surface
date: 2026-08-26
category: docs/solutions/ui-bugs/
module: "apps/mobile"
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "System navigation bar rendered near-white (#e9e8e8) in light system appearance under the app's near-black #1c1917 surface"
  - "Same bar rendered #110f0e in dark system appearance — dimmed, still not the app colour"
  - "Setting android:navigationBarColor had no effect at all"
  - "Bar icon appearance followed the SYSTEM dark-mode setting, not the app's always-dark theme"
  - "The cold-launch splash window showed the wrong colour too"
root_cause: config_error
resolution_type: code_fix
severity: medium
framework_version: "expo 57 / react-native 0.86.2"
related_components:
  - withAndroidCastTheme
  - expo-splash-screen
tags:
  - android
  - edge-to-edge
  - navigation-bar
  - expo-config-plugin
  - android-theme
  - splash-screen
---

# Android system nav bar showed the platform contrast scrim, not the app surface

Merged in PR [#2024](https://github.com/JesusFilm/forge/pull/2024), from branch
`fix/mobile-android-nav-bar-theme`. Line numbers come from the tree at that
commit.

## Problem

On Android the system navigation bar (the three-button bar) did not render the
app's own dark surface `#1c1917`. It rendered the platform's contrast scrim.
Every other surface in `apps/mobile` is hard-coded dark, so the bar looked like
a foreign band at the bottom of the screen. In the system LIGHT appearance that
band was nearly white under a nearly black app. The scrim covered the launch
window too, so the first frame of a cold launch was also wrong.

## Symptoms

The bar was MEASURED by sampling screenshot pixels
(`adb exec-out screencap -p` -> `ffmpeg -pix_fmt rgb24` -> read the bytes), not
judged by eye. Device: physical Galaxy S20 (SM-G981U1, Android 13 / API 33,
One UI 5.1), three-button navigation (`settings get secure navigation_mode` = 0).

| State                                   | Before      | After     |
| --------------------------------------- | ----------- | --------- |
| System LIGHT appearance                 | `#e9e8e8`   | `#1c1917` |
| System DARK appearance                  | `#110f0e`   | `#1c1917` |
| Splash / launch window                  | light scrim | `#1c1917` |
| Pixel 9a emulator, API 35, three-button | —           | `#1c1917` |

`#110f0e` is exactly the platform's `#66000000` composited over `#1c1917`. That
arithmetic confirmed the scrim model to the byte before any code changed.

The API 35 emulator reading is weaker evidence than the S20 reading: the
emulator was not cold-booted, and this repo's own notes warn against a warm
emulator for Android rendering claims.

## What Didn't Work

### 1. Setting `android:navigationBarColor`

Inert. React Native overwrites it at runtime, after reading the theme —
`WindowUtil.kt:173` assigns `navigationBarColor = Color.TRANSPARENT`
unconditionally on API 29+.

Expo already proves the point. `@expo/config-plugins`'s `SystemBars.js:35-40`
writes `android:navigationBarColor` = `@android:color/transparent` into
`AppTheme` on every prebuild, which is why the generated
`apps/mobile/android/app/src/main/res/values/styles.xml:6` carries it (that
whole `android/` tree is gitignored prebuild output, not tracked). The item
lands, RN assigns the same colour again in code, and neither is visible — the
platform draws the scrim OVER the transparent bar.

### 2. `expo.androidNavigationBar` in `app.json`

Dead in SDK 57. `SystemBars.js:48-50` detects the key and warns
`` `androidNavigationBar` is deprecated and has no effect ``, then ignores it.
`expo-navigation-bar` is not a dependency of `apps/mobile`.

### 3. `userInterfaceStyle: "dark"` in `app.json`

Inert on Android without `expo-system-ui`. In package `@expo/prebuild-config`
(57.0.14 at time of writing — it floats transitively off `expo`, so re-derive
the line numbers after a `pnpm install`), file
`build/plugins/unversioned/expo-system-ui/withAndroidUserInterfaceStyle.js:12-22`,
the key is read and the only effect is a warning: `Install expo-system-ui in
your project to enable this feature.` The app already sets
`"userInterfaceStyle": "automatic"`, so that warning appears on every prebuild
already.

### 4. Painting the root React Native `View`

Cannot work by construction. The platform draws its scrim OVER app content in
the bar region, so no JavaScript-only paint reaches above it.

## Solution

A new Expo config plugin writes two theme items into the generated
`styles.xml`.

Files: `apps/mobile/plugins/withAndroidNavigationBar.js` (plugin),
`withAndroidNavigationBar.test.js` (26 unit tests),
`apps/mobile/plugins/androidStyleXml.js` (shared helpers),
`apps/mobile/app.json` (registration), `apps/mobile/CLAUDE.md` (new section).

```js
const NAVIGATION_BAR_ITEMS = {
  "android:enforceNavigationBarContrast": "false",
  "android:windowLightNavigationBar": "false",
}
```

They are strings because they land as XML item text, not booleans.

Both `AppTheme` and `Theme.App.SplashScreen` are written. `AppTheme` is
required — the plugin throws and fails prebuild when absent, rather than emit
items that reach nothing. The splash style is optional, because a config without
`expo-splash-screen` has none.

`androidStyleXml.js` exists because `withAndroidCastTheme.js` carried a
byte-identical copy of the same item-matching logic, and both plugins mutate the
SAME `AppTheme` in one prebuild pass. Two copies could drift and then disagree
about how items land on the one style RN reads; no compiler and no per-plugin
suite would catch that. The module is dependency-free on purpose, so a plugin
whose own `expo/config-plugins` require failed can still load it.

## Why This Works

### The mechanism

Edge-to-edge is on because of a Gradle property, not the platform:
`android/gradle.properties:47` sets `edgeToEdgeEnabled=true`. So RN calls
`Window.enableEdgeToEdge()` at every React Activity creation
(`ReactActivityDelegate.java:141` -> `WindowUtil.kt:66-68`).

On API 29+, `enableEdgeToEdge()` does three things that matter
(`WindowUtil.kt:172-190`, the API 29+ branch, react-native 0.86.2):

1. `:173` — sets `navigationBarColor = Color.TRANSPARENT`, unconditionally.
2. `:175-186` — reads `android.R.attr.enforceNavigationBarContrast` off
   `context.theme`, defaulting to `true` (`:180`), into
   `isNavigationBarContrastEnforced` (`:186`).
3. `:188-190` — ONLY when contrast is enforced, overwrites
   `isAppearanceLightNavigationBars = !isDarkMode`, where `isDarkMode` is the
   SYSTEM dark-mode setting (`:168`).

`enforceNavigationBarContrast` is therefore the one attribute RN reads and
obeys, and it gates both remaining problems. Left at its default, step 2 tells
the platform to draw the scrim and step 3 discards any
`windowLightNavigationBar` the theme sets.

### Why the two items must ship together

Turning contrast enforcement off skips the scrim AND skips step 3, which was the
only thing overwriting the icon appearance. With it skipped, the theme's
`windowLightNavigationBar=false` survives and produces LIGHT buttons.

Note the inverted sense: the attribute names the BACKGROUND, not the icons, so
`false` means "the background is not light" and therefore "draw light buttons".

Set `enforceNavigationBarContrast=false` alone and the bar is transparent but
the buttons follow the system appearance. Set `windowLightNavigationBar=false`
alone and RN discards it. Neither item is useful without the other.

### Why both styles are written

`AndroidManifest.xml:29` gives MainActivity
`android:theme="@style/Theme.App.SplashScreen"`, and that style does NOT inherit
`AppTheme` — `styles.xml:15` gives it parent `Theme.SplashScreen`.

The generated MainActivity has `setTheme(R.style.AppTheme)` commented out
(`MainActivity.kt:20`). `AppTheme` becomes the Activity theme only because
`expo-splash-screen`'s generated `SplashScreenManager.registerOnActivity(this)`
(`MainActivity.kt:22`) applies `postSplashScreenTheme` (`styles.xml:18`) before
`super.onCreate` (`MainActivity.kt:24`).

Writing `AppTheme` alone fixes the app but leaves the launch window on the
scrim. Writing both fixes the launch window, which the measurement confirms.

### The ordering hazard

This trades one cross-plugin dependency for another; it does not remove one.

`expo-splash-screen` REPLACES `Theme.App.SplashScreen` rather than merging.
In package `expo-splash-screen` (57.0.8), file
`plugin/build/withAndroidSplashStyles.js:35-67`, `addSplashScreenStyle` filters
the style out by name (`:57`) and pushes a FRESH style with exactly four items
(`:38-55`).

Expo runs mods LAST-registered-first, so `withAndroidNavigationBar` must appear
BEFORE `expo-splash-screen` in the `plugins` array to run AFTER the vendor mod.
It does: index 7 against index 14. Reverse them and the two items are silently
wiped with every unit test still green. Two tests pin this — `survives the REAL
expo-splash-screen mod only in the registered order` and `is registered before
expo-splash-screen in app.json`.

This is the same last-registered-first law recorded for iOS in
[expo-config-plugin-withappdelegate-mod-reverse-order.md](../best-practices/expo-config-plugin-withappdelegate-mod-reverse-order.md),
appearing on a different mod type with the opposite failure signature: that case
throws on a missing anchor, this one fails silently.

### androidx sets the opposite on API 33+

The items deliberately reverse an androidx default. Inside the
`core-splashscreen` 1.2.0 AAR (resolvable from the Gradle cache, not the repo),
`res/values-v33/values-v33.xml` sets `Base.Theme.SplashScreen.DayNight` with
BOTH attributes = `true`, and `res/values-v31/values-v31.xml` re-parents
`Base.Theme.SplashScreen` to `android:Theme.DeviceDefault.DayNight`.

The S20 measurement (API 33, light appearance, cold launch) confirms the
override wins. API 31 and 32 are NOT measured.

### Scope: API 29 and above only

`minSdkVersion` is 24 (Expo default; the app sets no `ext.minSdkVersion`). On
API 24-28 `enableEdgeToEdge` takes the else-branch at `WindowUtil.kt:191-198`,
which picks the bar colour itself and always overwrites the appearance flag, so
neither item reaches those devices. What they get splits at API 26
(`Build.VERSION_CODES.O`), where RN starts asking for light nav bars
(`WindowUtil.kt:192-193`):

- API 24-25 keep RN's `DarkNavigationBarColor` `#801b1b1b` (`WindowUtil.kt:32`).
- API 26-28 in night mode keep the same dark colour.
- API 26-28 outside night mode get `LightNavigationBarColor` `#e6ffffff`
  (`WindowUtil.kt:27`) — the same near-white bar this plugin removes.

API 26-28 stay unfixable by any theme lever, because RN assigns the colour in
code there, not from the theme.

## Prevention

### Sample pixels, in BOTH appearances, after a cold relaunch

Do not judge a system bar colour by eye. The stock scrim over a dark app looks
"a bit off", not obviously wrong, and `#110f0e` against `#1c1917` is invisible
at a glance. The bug was severe in light appearance and nearly invisible in dark
appearance, so a dark-only check reads as a pass.

**Cold-relaunch between appearance changes.** MainActivity declares
`android:configChanges="...uiMode..."` (`AndroidManifest.xml:29`), so the
Activity does NOT restart when the system appearance changes and
`enableEdgeToEdge` does not re-run. A toggle without a relaunch shows a stale
bar, and that reads as a false pass.

### The removed guarantee is a known limitation, not a fixed one

The scrim was the platform's only assurance that the buttons stay legible over
ARBITRARY content. This change removes it app-wide, so any surface drawing light
pixels behind the bar — a bright fullscreen video frame — can hide the light
buttons. This ships as a known limitation; no replacement scrim exists yet.

### A theme change cannot ship over the air

It moves the Expo fingerprint runtime version, so an EAS Update cannot deliver
it. It needs a new native build.

### `AppTheme` now has two writers

`withAndroidCastTheme.js` and `withAndroidNavigationBar.js` both mutate
`AppTheme` in one prebuild pass, both through
`apps/mobile/plugins/androidStyleXml.js`. Add any third writer the same way.
Three tests pin the composition: two run the plugins in each order, and one
asserts their item names stay disjoint.

### Read the vendor mod before relying on plugin order

The order requirement is invisible in `app.json` — nothing in the array says
"this must come first", and reversing it breaks the fix with the whole suite
green. When a plugin writes into a style another plugin also writes, read the
other plugin's build output and check whether it MERGES or REPLACES. Then pin
the answer with a test that runs the real vendor mod, not a stub.

## Related Issues

- [expo-config-plugin-withappdelegate-mod-reverse-order.md](../best-practices/expo-config-plugin-withappdelegate-mod-reverse-order.md)
  — origin of the last-registered-first law, recorded for iOS `withAppDelegate`.
  This doc is a second instance on `withAndroidStyles`, with a silent-clobber
  failure mode that doc does not yet name.
- [expo-splash-screen-sdk57-full-bleed-default-change.md](expo-splash-screen-sdk57-full-bleed-default-change.md)
  — companion `expo-splash-screen` gotcha; that plugin silently changing
  generated native output with no `app.json` diff signal.
- [android-home-hero-black-refreshcontrol-surfaceview-compositing.md](android-home-hero-black-refreshcontrol-surfaceview-compositing.md)
  — same "jest cannot see native Android rendering; verify by sampling pixels on
  real hardware" theme, and the origin of that verification recipe.
- `apps/mobile/CLAUDE.md` — "Android system navigation bar" and "Cast SDK sheet
  theming" sections carry the committed conventions this plugin follows.
