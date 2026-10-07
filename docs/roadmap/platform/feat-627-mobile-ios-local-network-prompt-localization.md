---
id: "feat-627"
title: "Translate the iOS Local Network permission prompt"
owner: "urim"
priority: "P2"
status: "not-started"
start_date: "2026-10-09"
duration: 2
depends_on: []
blocks: []
tags:
  - "mobile"
  - "i18n"
---

## Problem

iOS asks for permission before an app looks for devices on the local network. Google Cast finds TVs that way, so iOS shows a Local Network alert the first time the app looks for Cast devices. The alert has three parts. iOS writes the title and the buttons in the phone's language. The app writes the sentence under the title, `NSLocalNetworkUsageDescription`, and that sentence is English in every language.

Example on a Spanish phone: the title and the buttons are Spanish, and the middle sentence says "The app uses your local network to find Cast devices, so you can play videos on your TV." So the one sentence that explains the permission is the one sentence the user may not understand. A user who taps "Don't Allow" cannot cast until they change it in iOS Settings.

The UI catalogs (`apps/mobile/messages/*.json`, feat-604 U16) cannot fix this. iOS reads the sentence from `Info.plist`, or from a per-language `InfoPlist.strings` file, before and outside the app's JavaScript. The app ships no per-language `InfoPlist.strings`, because `apps/mobile/app.json` has no `locales` setting.

When the prompt shows: `app.json` sets the `react-native-google-cast` plugin option `iosStartDiscoveryAfterFirstTapOnCastButton: false`, so Cast discovery most likely starts at app launch. iOS then shows the prompt soon after the first launch (read from the setting, not tested on a device).

## Entry Points — Read These First

1. `apps/mobile/app.json`: `expo.ios.infoPlist.NSLocalNetworkUsageDescription` (the English sentence), the `react-native-google-cast` plugin options, and the `expo-localization` plugin's `supportedLocales` (225 tags, the app's native localizations).
2. Expo SDK 57 documentation for the app config `locales` key ("Localizing your app" and the app config reference). Confirm the exact shape of a locale file (top-level `Info.plist` keys, or an `ios` object) for SDK 57 before you write any file.
3. `apps/mobile/CLAUDE.md`, section "Localization": "Translate with Claude (local mode)", "Check the translations", the English-only list, and "Native configuration and the native-build window".
4. `apps/mobile/i18n/translation-policy.json` (`englishOnlyLocales`) and `apps/mobile/i18n/translation-contexts.json` (namespace and key notes for the translator).
5. `apps/mobile/app/__tests__/localizationConfig.guard.test.js`: the guard for the native locale config.
6. `docs/solutions/workflow-issues/full-local-claude-translation-run-of-mobile-ui-catalogs.md`: the traps of a local translation run.
7. `docs/roadmap/platform/feat-604-mobile-ui-translation-run-and-device-checks.md`: the planned production native build that this change can join.

## Grep These

- `NSLocalNetworkUsageDescription`
- `iosStartDiscoveryAfterFirstTapOnCastButton`
- `supportedLocales`
- `"locales"` (in `apps/mobile/app.json`; no match today)
- `InfoPlist.strings`, `.lproj`
- `englishOnlyLocales`

## What To Build

1. **Put the sentence in the translation pipeline.** Add one key to `apps/mobile/messages/en.json`, with the exact current English:

   ```json
   "NativePermissions": {
     "localNetworkUsageDescription": "The app uses your local network to find Cast devices, so you can play videos on your TV."
   }
   ```

   Add `namespaces.NativePermissions` and a key note to `i18n/translation-contexts.json`. The note says that iOS shows the sentence in its own system alert, under an iOS title that asks for local-network access, and that it must be one plain sentence with no ICU syntax. Then run the documented steps: restamp or mark pending, `--local-export`, translate with subagents, one `--local-import --locales <answered tags>`, and `generate-catalog-index.mjs`.

2. **Generate the iOS locale files from the catalogs.** Write a script, for example `scripts/i18n/generate-native-strings.mjs`, that reads `NativePermissions.localNetworkUsageDescription` from each translated catalog and writes one locale file per tag (for example `i18n/native/<tag>.json`), in the shape that step 2 of Entry Points confirms:

   ```json
   { "NSLocalNetworkUsageDescription": "<translated sentence>" }
   ```

   Then add `expo.locales` to `app.json`, with one entry per translated tag (`"es": "./i18n/native/es.json"`). Skip `en` and the `englishOnlyLocales` tags: iOS falls back to the English sentence in `infoPlist`. Give the script a `--check` mode, as `generate-catalog-index.mjs` has, so CI fails on drift.

3. **Keep one source for the English.** `infoPlist.NSLocalNetworkUsageDescription` and the `en.json` key must hold the same text. Add a guard test that compares them.

4. **Optional, owner decision first:** `iosStartDiscoveryAfterFirstTapOnCastButton: true` delays the prompt until the first tap on the Cast button, so the user sees it when they want to cast. This changes when Cast finds TVs, so it is a product decision and not part of the translation.

## Constraints

- Do not change the meaning of the sentence. The translator follows the U16 rules; the equals-English check and the explicit-script rule apply to this key as to any other.
- The change moves the native fingerprint, so it ships only in a native build. No over-the-air update can deliver it. Plan it into the feat-604 production native build when possible.
- Do not hand-edit `ios/` (it is gitignored and regenerated by prebuild).
- Do not change `apps/web`.
- The Face ID string (`NSFaceIDUsageDescription`, the `expo-secure-store` plugin default) is out of scope: the app never asks for Face ID, so no user sees it.

## Verification

- `pnpm --filter @forge/mobile test` passes, including the new guard (English source matches `infoPlist`) and the generator's `--check`.
- `node scripts/i18n/translate-catalogs.mjs --dry-run` shows 0 requests after the import.
- `npx expo prebuild --platform ios --no-install`, then `plutil -p ios/forgewatch/es.lproj/InfoPlist.strings` shows the Spanish sentence. Spot-check `ar`, `zh-Hans` and `sr-Latn` too. Delete `ios/` afterwards if it did not exist before.
- On an iOS simulator with a fresh install (erase the simulator, or use a new one, because iOS keeps the Local Network answer per install), launch with `-AppleLanguages "(es)" -AppleLocale es_ES`, and screenshot the Local Network alert: the middle sentence is Spanish.
- Repeat with an English-only tag (for example `ff`): the alert shows the English sentence.
