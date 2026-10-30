---
title: "The iOS Simulator never shows the Local Network alert, so check its text on a physical iPhone"
date: 2026-10-14
category: developer-experience
module: apps/mobile
problem_type: developer_experience
component: development_workflow
severity: medium
applies_when:
  - "Checking the text of the iOS Local Network alert (NSLocalNetworkUsageDescription), in English or translated through expo.locales"
  - "Writing the Verification section of a ticket, or a PR test plan, that names the Local Network alert"
  - "Planning a device check for a change to Google Cast discovery, Bonjour, or another local-network connection on iOS"
  - "The Expo dev launcher shows 'There was a problem loading the project' at the first launch of a fresh install on a physical iPhone"
symptoms:
  - "A fresh install on a new iOS Simulator finds Metro servers through Bonjour, and no Local Network alert appears"
  - "The Simulator system log has no nehelper events for the app"
retire_when: "Apple makes the iOS Simulator apply Local Network privacy. To check, install an app that browses Bonjour on a new Simulator and look for the Local Network alert at the first launch."
tags:
  [
    mobile,
    ios,
    ios-simulator,
    local-network,
    permission-alert,
    localization,
    physical-device,
    google-cast,
  ]
---

# The iOS Simulator never shows the Local Network alert, so check its text on a physical iPhone

## Context

iOS shows a Local Network alert the first time an app looks for devices on the local network. In `apps/mobile`, the `react-native-google-cast` plugin sets `iosStartDiscoveryAfterFirstTapOnCastButton: false` (`apps/mobile/app.json:83`), so Cast discovery starts at launch. iOS writes the alert's title and buttons. The app supplies only the sentence in the middle, `NSLocalNetworkUsageDescription` (`apps/mobile/app.json:17`). feat-627 (PR #2710) translates that sentence through `expo.locales` (`apps/mobile/app.json:382`), so prebuild writes one `<tag>.lproj/InfoPlist.strings` file for each locale.

The feat-627 ticket told the reader to check the translated alert on an iOS Simulator, with a fresh install and the launch argument `-AppleLanguages "(es)"`. The PR test plan said the same. On 2026-10-14 that check ran on a new iPhone 17 Simulator (iOS 26.5, Xcode 26), with a fresh install of the dev client:

- The dev launcher found four Metro servers through Bonjour, and the system log showed successful Bonjour connections from the app.
- No alert appeared in 30 seconds, and the log had no `nehelper` events.

So the Simulator lets the app use the local network with no prompt. It does not apply Local Network privacy, and it cannot show the alert or its text. The same day, the check on a physical iPhone passed at the first try.

## Guidance

**Do not plan a Simulator check of the Local Network alert.** Split the check into two parts:

1. **The files (Mac, no device).** Build the app, then read the compiled `.app`. The `apps/mobile/ios` folder that prebuild writes (git ignores it) shows only what Xcode will copy. The `.app` shows what the phone gets.
2. **The alert (physical iPhone only).** Use the build and launch recipe in [the physical-iPhone doc](physical-iphone-dev-build-signing-team-and-devicectl-launch.md).

For the device check:

- **Start with no app on the phone.** iOS asks once for each install and keeps the answer until the app is deleted. Check with `xcrun devicectl device info apps --device <coredevice-id> --bundle-id org.jesusfilm.forgewatch`. An empty list means a fresh install.
- **Set the phone language before the first launch.** In a dev client the alert appears at the first launch, so the language at that moment decides which `InfoPlist.strings` file iOS uses. The app's own language picker does not change it: no code in `apps/mobile/src`, `app`, `modules`, or `plugins` writes `AppleLanguages`. This session did not test a launch argument such as `-AppleLanguages` on a device.
- **Know what the first launch proves.** The dev launcher also searches Bonjour for Metro (`_expo._tcp`), so in a dev client either search can raise the alert. The alert text is the same either way. But a dev-client check does not prove when a release build shows the alert, because only Cast searches there. No one has measured a release build yet.
- **Read only the middle sentence.** iOS writes the title, the buttons, and (on iOS 26) a map and a privacy line under it, all in the phone's language. Only the middle sentence comes from the app, so only that sentence proves the check.
- **Expect an error screen behind the alert.** The dev launcher shows "There was a problem loading the project", because iOS blocks the app's connection to Metro on the Mac until the user answers. That screen does not mean the build or the Metro address is wrong. Tap Allow, then launch again with `devicectl device process launch --terminate-existing --payload-url ...`.
- **One install gives one alert.** To check a second language, delete the app, install the same `.app` again (about one minute with `devicectl device install app`), change the phone language, and launch.

## Why This Matters

A Simulator check of this alert cannot pass or fail. It only uses time, and a ticket that names it sends the next agent to a check that cannot work. The Simulator also connects to Metro with no prompt, so a Simulator run hides the error screen that a physical iPhone shows on the first launch.

Each install gives one alert. A launch in the wrong phone language uses that alert, and the next try needs a delete and a new install.

## When to Apply

- A change edits `NSLocalNetworkUsageDescription`, the `expo.locales` map, or the files in `apps/mobile/i18n/native/`.
- A change edits the Cast plugin options, `NSBonjourServices`, or any code that browses Bonjour or connects to a LAN address on iOS.
- A ticket or test plan names the Local Network alert. Write the check as a physical-iPhone check.
- Other permission alerts may act differently on the Simulator. This doc covers only the Local Network alert.

## Examples

Check the files in the compiled dev client (the paths come from the build in the physical-iPhone doc):

```bash
APP=apps/mobile/ios/build/Build/Products/Debug-iphoneos/forgewatch.app
ls "$APP"/*.lproj/InfoPlist.strings | wc -l                 # one per locale (224 on 2026-10-14)
plutil -p "$APP/ar.lproj/InfoPlist.strings"                # the Arabic sentence
plutil -extract CFBundleLocalizations raw "$APP/Info.plist" # the locale count iOS can pick from
```

The device check that passed on 2026-10-14:

- Phone: iPhone 15 Pro, iOS 26.5, phone language Arabic. The app was not on the phone.
- Build: a Debug dev client from the feat-627 branch, built with `xcodebuild ... -allowProvisioningUpdates` and installed with `devicectl device install app`.
- Result: at the first launch, the middle sentence of the alert was the text in `apps/mobile/i18n/native/ar.json`. The title and the buttons were Arabic. After Allow and a second launch, the app loaded from Metro and reached local admin.

## Related

- [Physical-iPhone dev build and devicectl launch](physical-iphone-dev-build-signing-team-and-devicectl-launch.md): the build, sign, install, and launch recipe this check uses.
- [Prove the artifact and prove the instrument](mobile-dev-build-verification-false-signals.md): the general rule. A Simulator is an instrument that cannot contain this alert, and the compiled `.app` is the artifact to read.
- [Verifying mobile worktree changes in the iOS simulator](verifying-mobile-expo-worktree-changes-in-simulator-20260608.md): the default Simulator recipe. The Local Network alert is one surface it cannot show.
- [iOS text alignment follows the native localization](../ui-bugs/ios-natural-text-alignment-follows-native-localization.md): another native surface that follows the phone or per-app language, not the app's UI locale.
- `apps/mobile/CLAUDE.md`, bullet "Text in iOS permission alerts (feat-627)": how the translated files are made, and why every locale gets a file.
- `docs/roadmap/platform/feat-627-mobile-ios-local-network-prompt-localization.md`: the ticket, with a dated correction of its Simulator check.
