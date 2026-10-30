---
title: "Change an Expo app's display name without renaming expo.name"
date: "2026-09-17"
category: best-practices
module: apps/mobile
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - "Changing the name users see under the app icon on iOS or Android"
  - "expo.name also drives the prebuild iOS project folder (ios/forgewatch) that docs and recipes reference"
  - "Internal identifiers derived from the old name (SecureStore storagePrefix, storage keys) must stay stable"
  - "Writing a config plugin that must override a value Expo's built-in mods also write"
root_cause: inadequate_documentation
resolution_type: config_change
tags:
  - expo
  - config-plugins
  - app-display-name
  - ios
  - android
  - prebuild
  - eas-update
  - fingerprint
related_components:
  - apps/mobile/app.json
  - apps/mobile/plugins/withAndroidAppName.js
---

# Change an Expo app's display name without renaming expo.name

**Rule:** To change the name that people see, override the display name only. Do not rename `expo.name`. On iOS, set `ios.infoPlist.CFBundleDisplayName`. On Android, set `app_name` with a `withStringsXml` config plugin. Either change moves the OTA runtime version, so a native build must ship before the next `eas update`.

## Context

The app showed "forge-watch" under the home-screen icon and as the title of push notifications. The request was to show "Jesus Film Watch" instead. The value came from `expo.name` (`apps/mobile/app.json:3`). Expo writes `expo.name` into the iOS `CFBundleDisplayName` and into the Android `app_name` string (`@expo/config-plugins` 57.0.9, `build/ios/Name.js:30-31`, `build/android/Name.js:70`).

The simple fix is to rename `expo.name`. That fix has a cost. `expo prebuild` also derives the iOS Xcode project and target name from `expo.name`, sanitized to `forgewatch` (`ios/forgewatch/`, `ios/forgewatch.xcworkspace`). `apps/mobile/CLAUDE.md` (splash section) and `docs/solutions/developer-experience/mobile-dev-build-verification-false-signals.md` use `ios/forgewatch/...` paths. EAS builds run prebuild from a clean tree, so a renamed `expo.name` also renames the native project there.

## Guidance

Keep `expo.name`. Override the displayed name on each platform. PR #2333 added this change.

**iOS.** Set the key in `app.json` (`apps/mobile/app.json:15`):

```json
{
  "expo": {
    "name": "forge-watch",
    "ios": {
      "infoPlist": {
        "CFBundleDisplayName": "Jesus Film Watch"
      }
    }
  }
}
```

Expo's `withDisplayName` uses `createInfoPlistPluginWithPropertyGuard` (`build/ios/Name.js:30`). The guard skips the write when `ios.infoPlist.CFBundleDisplayName` is already set, and prints a warning (`build/plugins/ios-plugins.js:46-54`):

```text
» ios: name: "ios.infoPlist.CFBundleDisplayName" is set in the config. Ignoring abstract property "name": forge-watch
```

**Android.** No `app.json` field sets the label. Use a config plugin that sets `app_name` through `withStringsXml` (`apps/mobile/plugins/withAndroidAppName.js:21-42`):

```js
function setAppName(stringsXml, name) {
  const resources = stringsXml.resources ?? (stringsXml.resources = {})
  const strings = resources.string ?? (resources.string = [])
  const existing = strings.find((item) => item.$ && item.$.name === "app_name")
  if (existing) {
    existing._ = name
  } else {
    strings.push({ $: { name: "app_name" }, _: name })
  }
  return stringsXml
}

function withAndroidAppName(config) {
  if (!withStringsXml) return config
  return withStringsXml(config, (cfg) => {
    cfg.modResults = setAppName(cfg.modResults, DISPLAY_NAME)
    return cfg
  })
}
```

Register the plugin in the `plugins` array of `apps/mobile/app.json`:

```json
"plugins": [
  "./plugins/withAndroidAppName"
]
```

The plugin wins over Expo's own name mod. Mods run last-registered-first, and Expo registers its built-in plugins after the `app.json` plugins (`withAndroidAppName.js:33-35`). A reviewer in this session verified this order from `@expo/config-plugins` 57.0.9 and `@expo/prebuild-config` 57.0.16 source.

Keep the name in one place. `withAndroidAppName.js` exports `DISPLAY_NAME`, and `apps/mobile/plugins/withAndroidAppName.test.js` checks that `app.json` uses the same value.

## Why This Matters

**A renamed `expo.name` renames the native project.** Local build recipes and docs that use `ios/forgewatch/...` then point at paths that do not exist.

**Some `forge-watch` strings are storage identifiers, not names.** Do not change them with the display name:

- SecureStore `storagePrefix: "forge-watch"` (`apps/mobile/src/lib/authSession.ts`). A new prefix hides every stored session, so every user is signed out.
- The recommendations viewer key `"forge-watch.recommendation-viewer.v1"` (`apps/mobile/src/lib/recommendations/viewerIdentity.ts`). A new key gives every viewer a new identity.

**The runtime version moves.** The app uses the fingerprint `runtimeVersion` policy. On 2026-09-17, `npx expo-updates fingerprint:generate --platform ios` gave `aa76e248b54a86453ee9afbbe76f2d29a20d88f4` without the change and `4705057fab181e9bbf1225b2199d00abb7b2be09` with it. An `eas update` published after the change reaches no installed build, and `eas update` still reports success. Ship a native build first. Edits to `eas.json` move the runtime version too.

**Most other identifiers do not change.** These stay the same: `eas.json`, the EAS project, bundle id and package `org.jesusfilm.forgewatch`, scheme `forgemobile`, and slug `jesus-film-forge-v2`. The App Store Connect listing name is set in App Store Connect, and it is already "Jesus Film Watch". The Google Play listing title is set in Play Console; nobody checked it. The Expo dev launcher still shows "forge-watch", because it reads `expo.name`.

## When to Apply

- You change the name under the app icon, in notifications, or in the system app list.
- The app is an Expo managed app, and `ios/` and `android/` are gitignored prebuild output.
- Other files or docs depend on the native project name that `expo.name` produces.
- Apply the same caution to any `expo.name`-derived value that is also a storage key or a path.

## Examples

Before: `expo.name` "forge-watch" set every visible name. After: `expo.name` stays "forge-watch", and the display name is "Jesus Film Watch" on both platforms.

Verify with a throwaway prebuild. Run the commands in `apps/mobile`, then delete the generated `ios/` and `android/` folders:

```bash
CI=1 npx expo prebuild --no-install
/usr/libexec/PlistBuddy -c "Print :CFBundleDisplayName" ios/forgewatch/Info.plist
grep app_name android/app/src/main/res/values/strings.xml
grep 'android:label' android/app/src/main/AndroidManifest.xml
grep rootProject.name android/settings.gradle
```

On 2026-09-17 the output showed:

- `ios/forgewatch/Info.plist`: `CFBundleDisplayName` = "Jesus Film Watch", and `CFBundleName` = `$(PRODUCT_NAME)`.
- The iOS project folder stayed `forgewatch`.
- `strings.xml`: `<string name="app_name">Jesus Film Watch</string>`.
- `AndroidManifest.xml`: `android:label="@string/app_name"`.
- `settings.gradle`: `rootProject.name = 'forge-watch'`.

Prebuild output is not the built app (see `docs/solutions/developer-experience/mobile-dev-build-verification-false-signals.md`). To see the new name on a simulator or device, install a new native build. A local dev-client rebuild from a feature branch replaces the installed dev client, which can carry native modules from another branch.

**Open risks:**

- iOS can shorten the 16-character name under the icon ("Jesus Film Wa..."). Nobody checked it on a device.
- No test runs the Android plugin through Expo's real mod chain. `apps/mobile/plugins/withAndroidAppName.test.js` checks `setAppName` on a hand-built object and checks `app.json` consistency. `apps/mobile/plugins/withAndroidNavigationBar.test.js` pins plugin order against a real vendor mod. Use that pattern to close the gap.

Related: `docs/solutions/best-practices/expo-config-plugin-withappdelegate-mod-reverse-order.md` (verify mod order by test, not by assumption).
