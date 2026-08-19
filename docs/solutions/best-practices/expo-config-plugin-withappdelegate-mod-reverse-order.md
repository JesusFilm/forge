---
title: "Expo config-plugin withAppDelegate mods execute in reverse plugins-array order"
date: "2026-08-18"
category: best-practices
module: apps/mobile
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - "Writing a local Expo config plugin that amends AppDelegate code another (vendor) plugin injects via withAppDelegate"
  - "Deciding where to register a local mod plugin relative to a vendor plugin in app.json's plugins array"
  - "Porting a sibling plugin's 'register AFTER the vendor plugin' comment to a new mod without checking whether that plugin also anchors on vendor-injected text"
  - "A local mod plugin's anchor-string search cannot find the expected vendor-injected code during prebuild"
root_cause: inadequate_documentation
tags:
  - expo
  - config-plugins
  - app-delegate
  - ios
  - google-cast
  - plugin-registration-order
  - prebuild
  - mod-execution-order
related_components:
  - apps/mobile/plugins/withCastOptionsVolume.js
  - apps/mobile/plugins/withBackgroundDownloaderAppDelegate.js
  - apps/mobile/app.json
---

# Expo config-plugin withAppDelegate mods execute in reverse plugins-array order

## Context

The mobile-player-casting feature (PR #1953, `feat(mobile): cast to Chromecast and AirPlay from the video player`, open and unmerged as of this writing) added KTD8: iOS hardware volume buttons must route to the Cast device during a session. `react-native-google-cast`'s own config plugin builds the `GCKCastOptions` object in the Swift `AppDelegate` but exposes no option for `physicalVolumeButtonsWillControlDeviceVolume`. The fix is a local Expo config plugin, `apps/mobile/plugins/withCastOptionsVolume.js`, that finds the vendor-injected block and inserts one line into it.

The feature plan told the implementer to "register the local plugin AFTER the vendor plugin," mirroring the comment on the sibling plugin `apps/mobile/plugins/withBackgroundDownloaderAppDelegate.js`, which reads (line 14, quoted exactly):

> "Relocates it; register AFTER the package plugin (app.json)."

Empirical testing during implementation (against `@expo/config-plugins` 57.0.7; re-confirmed against the currently installed 57.0.8 by reading `withMod.js`/`withPlugins.js` — `withPlugins` reduces the array left-to-right, and each `withBaseMod` wraps the previously registered action as its `nextMod`, so the outermost, first-to-run wrapper is the last array entry) showed the opposite is true for a mod that must read another mod's output. `withAppDelegate` mods compose like middleware: each plugin's mod action wraps the next plugin's result, so the LAST entry in the `plugins` array runs its mod FIRST. Following the plan's instruction verbatim would have listed `withCastOptionsVolume` after `react-native-google-cast`, so it would run BEFORE the vendor plugin ever wrote the `GCKCastOptions` block — the code the transform searches for would not exist yet, and the plugin would throw on every prebuild.

The sibling plugin's "register AFTER" comment happens to give the right answer for the wrong reason: `withBackgroundDownloaderAppDelegate.js` only removes a method if it finds one (`removeBackgroundSessionMethod` returns the source unchanged when the method is absent) and always inserts its own copy. It does not need the other plugin's output to already exist, so any order works and the comment's claimed reason is not the true mechanism.

## Guidance

**The law:** for a mod type that must observe a change another plugin already made in the SAME file (here, `withAppDelegate`), list your plugin BEFORE the plugin whose output you depend on in `app.json`'s `plugins` array. The array is not execution order for these mods — it is push order onto a wrapping chain, and the chain unwinds last-pushed-first.

`apps/mobile/app.json` shows the shipped order:

```json
"@kesha-antonov/react-native-background-downloader",
"./plugins/withBackgroundDownloaderAppDelegate",
"./plugins/withCastOptionsVolume",
[
  "react-native-google-cast",
  { "iosSuspendSessionsWhenBackgrounded": false }
]
```

`./plugins/withCastOptionsVolume` sits BEFORE the `react-native-google-cast` vendor entry — that ordering is what makes the local plugin's mod execute AFTER the vendor's mod has already written the `GCKCastOptions` block.

The defensive pattern that makes wrong ordering (or a vendor update that changes the injected code) fail loudly instead of silently, from `apps/mobile/plugins/withCastOptionsVolume.js`:

```js
function insertVolumeFlag(src) {
  if (src.includes("physicalVolumeButtonsWillControlDeviceVolume")) return src
  const anchorIdx = src.indexOf(ANCHOR)
  if (anchorIdx === -1) {
    throw new Error(
      "[withCastOptionsVolume] Swift GCKCastOptions injection from " +
        "react-native-google-cast not found in AppDelegate. ... " +
        "this plugin must sit BEFORE react-native-google-cast in " +
        "app.json plugins (mods run in reverse array order). Failing prebuild " +
        "instead of silently dropping hardware-volume support.",
    )
  }
  // ... insert FLAG_LINE before the anchor
}
```

Three defensive pieces work together:

1. **Throw on missing anchor**: if the vendor's `GCKCastContext.setSharedInstanceWith(options)` string is not found, the plugin throws instead of returning the source unchanged. This fails `expo prebuild` / EAS build, not just silently shipping without the feature.
2. **Idempotent transform**: a second application detects the flag is already present and returns the source unchanged, so running the plugin twice (or across an incremental prebuild) does not duplicate the line.
3. **Real-producer-symbol test fixture**: `apps/mobile/plugins/withCastOptionsVolume.test.js` builds its fixture by importing the actual vendor function, `addSwiftGoogleCastAppDelegateDidFinishLaunchingWithOptions`, from `react-native-google-cast/lib/commonjs/plugin/withIosGoogleCast`, then runs it against a captured real `AppDelegate.swift` to produce the injected block. A `react-native-google-cast` version bump that changes the shape of its injection therefore breaks this jest suite in CI, rather than only being caught later at prebuild or EAS build time. The suite also asserts idempotence (applying twice equals applying once) and the throw-on-drift behavior.

## Why This Matters

A config plugin's output is a Swift/Kotlin/plist file generated at `expo prebuild` or EAS build time. Jest never runs `expo prebuild`, so a config-plugin bug that silently no-ops (returns the source unchanged instead of throwing) produces a build that compiles, a CI run that stays green, and an app that ships — with the one line of native code the feature depends on simply missing. For KTD8, that means hardware volume buttons stop controlling the Cast device, and no test, lint, or typecheck would catch it. The only place the regression is visible is manual verification on a device during an active cast session, which is easy to skip on a routine dependency bump. The throw-on-missing-anchor pattern converts that silent regression into a hard prebuild failure, and the real-producer-symbol test converts it further into a CI failure precisely when `react-native-google-cast` changes shape.

## When to Apply

- A local config plugin must locate and amend code that ANOTHER plugin injected into the same generated file — AppDelegate (iOS), MainActivity/MainApplication (Android), Info.plist, or entitlements. List it before the plugin whose output it depends on, and pair it with the three-part defensive pattern.
- Not needed when a mod only appends its own independent code and does not search for another plugin's output. `withBackgroundDownloaderAppDelegate.js` is the counter-example: it removes its own target method if present (a no-op if absent) and inserts its own replacement, so it has no ordering dependency on the vendor plugin at all. Do not copy that plugin's "register AFTER" comment as a general rule; verify the actual dependency direction per plugin.

## Examples

**Wrong order (would throw on every prebuild):** if `./plugins/withCastOptionsVolume` were listed AFTER `react-native-google-cast` in `app.json`, mod composition would run the local plugin's `withAppDelegate` action first (reverse-array order), before the vendor plugin has written the `GCKCastOptions` block. `insertVolumeFlag` would not find `GCKCastContext.setSharedInstanceWith(options)`, hit the `anchorIdx === -1` branch, and throw — failing `expo prebuild` immediately with a clear message naming the fix.

**Right order (shipped):** `./plugins/withCastOptionsVolume` before the `react-native-google-cast` entry in `app.json`. The local plugin's mod runs after the vendor plugin's mod has already produced the `GCKCastOptions` block, so the anchor is present and the insert succeeds.

**The sibling-comment trap:** `withBackgroundDownloaderAppDelegate.js`'s header comment says "register AFTER the package plugin," and that ordering does work — but only because that plugin does not require the other plugin's output to exist first. Reading that comment as a general Expo config-plugin ordering rule and applying it to `withCastOptionsVolume` (which DOES require prior output) would have shipped a plugin that throws on every build.

## Related

- `docs/solutions/integration-issues/datadog-mobile-rum-tvos-integration.md` — the closest neighbor: a different config-plugin failure class in this monorepo (pnpm layout + build caches vs. mod execution order), same "verify plugin behavior empirically" prevention theme.
- `apps/mobile/plugins/withBackgroundDownloaderAppDelegate.js` line 14 — the misleading "register AFTER" comment this doc corrects; a follow-up should reword it (see PR #1953's plan for the casting-side plugin).
