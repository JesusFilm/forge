---
title: "EAS managed-workflow build & submit gotchas for a react-native-tvos app"
date: "2026-06-15"
last_updated: "2026-06-19"
category: build-errors
module: tv-app
problem_type: build_error
component: tooling
severity: high
symptoms:
  - 'eas build (tvOS) fails: Provisioning profile platforms "visionOS, watchOS, and iOS" do not match the current platform "tvOS"'
  - "Android eas build fails: aapt2 mergeReleaseResources reports Duplicate resources for ic_launcher (.webp vs .png)"
  - 'config-tv throws "One or more image paths not defined" unless all 7 appleTVImages exist at exact sizes'
  - "tvOS rejects icons with an alpha channel; sips cannot strip alpha and errors on a .png that is actually WebP"
  - "eas submit (tvOS) delivers the .ipa to App Store Connect as iOS: rejected with ITMS-90508/90545/90713/90039; the build never registers"
root_cause: config_error
resolution_type: config_change
related_components:
  - development_workflow
tags:
  - eas-build
  - eas-submit
  - react-native-tvos
  - tvos
  - config-tv
  - altool
  - provisioning-profile
  - app-icon
---

# EAS managed-workflow build & submit gotchas for a react-native-tvos app

> Searchable companion to the operational runbook at `apps/tv/DISTRIBUTION.md`.
> That file has the step-by-step commands; this one captures root cause +
> prevention so the failures are findable by symptom.

## Problem

Standing up EAS Build distribution + brand icons for the **managed-workflow**
`react-native-tvos` app (`apps/tv`) hit four distinct failures — three block the
build, one blocks submission to App Store Connect — all rooted in EAS tooling
silently defaulting a managed TV app's Apple platform to **iOS**, in the seam
between Expo's managed prebuild, the
`@react-native-tvos/config-tv` plugin, and `eas-cli`'s Apple-platform
resolution. None reproduce in a phone Expo project — they are specific to a TV
target whose native `ios/`/`android/` dirs are gitignored and regenerated on
EAS servers.

## Symptoms

1. **tvOS provisioning (XCODE_BUILD_ERROR):** `Provisioning profile … has platforms "visionOS, watchOS, and iOS", which does not match the current platform "tvOS"`.
2. **Android resources (EAS_BUILD_UNKNOWN_GRADLE_ERROR):** a local `./gradlew :app:processReleaseResources` repro shows `[mipmap-*/ic_launcher] …/ic_launcher.webp [mipmap-*/ic_launcher] …/ic_launcher.png: Error: Duplicate resources`, failing `mergeReleaseResources`.
3. **Icon generation:** config-tv throws `One or more image paths not defined` unless all 7 `appleTVImages` exist; `sips` errors `Can't write format: org.webmproject.webp` on a misnamed-`.png`-actually-WebP source; Apple rejects tvOS icons with an alpha channel.

## What Didn't Work

For the Android duplicate-resources failure specifically:

- **Assumed it was flaky** and re-ran the EAS build — it failed identically. The false "transient" assumption cost a cycle.
- **Tried to read the EAS build logs** to find the failing task — the `logFiles` artifact is binary-encoded and unreadable, so the real aapt2 message never surfaced from the cloud.
- **Suspected malformed PNGs** — verified the generated images were valid (RGB, correct magic bytes); ruled out.
- **Noted the tvOS build SUCCEEDED with the same icon source files**, which proved the failure was Android-specific, not an icon-content problem.

The breakthrough was **reproducing the exact Gradle task locally**
(`./gradlew :app:processReleaseResources`) instead of fighting the opaque cloud
logs — that surfaced the real aapt2 duplicate-resource error and pointed
straight at the two-format `ic_launcher` collision.

## Solution

### Gotcha 1 — tvOS picks an iOS provisioning profile

One-time, only when (re)creating credentials:

1. Temporarily un-gitignore `ios/` in `apps/tv/.gitignore`.
2. `EXPO_TV=1 npx expo prebuild --clean -p ios --no-install` — the generated pbxproj then carries `SDKROOT=appletvos` and `TARGETED_DEVICE_FAMILY=3`.
3. Run the **interactive** `eas build -p ios --profile production`. It now resolves tvOS, detects the stored iOS profile is absent from the tvOS list, and offers to generate the correct **tvOS App Store** profile. Reuse the org distribution certificate — do **not** generate a new cert (Apple caps a team at 2).
4. Restore `.gitignore` and `rm -rf ios/`.

The corrected profile persists on EAS servers; all subsequent managed builds run
`--non-interactive` so eas-cli uses stored creds as-is and never re-resolves the
platform (which would flip back to iOS).

### Gotcha 2 — Android `ic_launcher` duplicate resources

Remove the config-tv `androidTVIcon` param. `expo.icon` already supplies the
launcher icon as `ic_launcher.webp`; the Android TV leanback HOME tile uses
`androidTVBanner`, not the launcher icon.

```diff
  ["@react-native-tvos/config-tv", {
    "isTV": true,
    "tvosDeploymentTarget": "16.0",
-   "androidTVIcon": "./assets/tv/icon.png",
    "androidTVBanner": "./assets/tv/banner.png",
    "appleTVImages": { ...all 7... }
  }]
```

Verified `BUILD SUCCESSFUL` locally via the Gradle task, then green on EAS.

### Gotcha 3 — TV icon asset generation

config-tv's `withTVAppleIconImages.js` requires **all 7** `appleTVImages`
defined and existing, at exact sizes (Xcode validates the asset catalog):
`icon` 1280×768, `iconSmall` 400×240, `iconSmall2x` 800×480, `topShelf`
1920×720, `topShelf2x` 3840×1440, `topShelfWide` 2320×720, `topShelfWide2x`
4640×1440. tvOS icons must carry **no alpha channel**.

`sips` cannot strip alpha, and `qlmanage` rasterizes SVGs unreliably (square
letterbox placement, adds alpha). Use `sharp`: render the SVG mark, composite it
centered on an opaque background canvas, then flatten and drop alpha for an
exact-size opaque RGB PNG.

```js
await sharp({ create: { width, height, channels: 3, background } })
  .composite([{ input: markPng /* rendered SVG */, gravity: "center" }])
  .flatten({ background })
  .removeAlpha()
  .png()
  .toFile(out)
```

Verify each output with `file out.png` / `sips -g hasAlpha out.png`. If a source
`.png` is secretly WebP (`sips` says `Can't write format: org.webmproject.webp`),
force `sips -s format png` — or generate through sharp end-to-end.

### Gotcha 4 — `eas submit` delivers a tvOS `.ipa` as iOS

`eas submit --platform ios` uploads the tvOS `.ipa` to App Store Connect
**declaring the platform as iOS** — and it has no flag to declare tvOS. App Store
Connect then runs its **iOS** validation suite against the tvOS binary and rejects
every delivery; the build never registers (no record in TestFlight), and the only
feedback is a rejection email:

```
ITMS-90508  DTPlatformName 'appletvos' is invalid
ITMS-90545  provisioning profile is not compatible with iOS apps
ITMS-90713  CFBundleIconName missing            (iOS-only key)
ITMS-90039  CFBundleIcons.CFBundlePrimaryIcon type mismatch   (iOS dict form)
```

The binary is correct tvOS (`CFBundleSupportedPlatforms=[AppleTVOS]`,
`DTPlatformName=appletvos`, `UIDeviceFamily=[3]`). Bypass `eas submit` and upload
with Apple's `altool`, explicitly typed `appletvos` (ASC API key `.p8` at
`~/.appstoreconnect/private_keys/AuthKey_<KeyID>.p8`):

```bash
xcrun altool --validate-app -f <build>.ipa -t appletvos \
  --apiKey <KeyID> --apiIssuer <IssuerID>   # dry run: SAME ITMS checks, no upload
xcrun altool --upload-app   -f <build>.ipa -t appletvos \
  --apiKey <KeyID> --apiIssuer <IssuerID>   # the real upload
```

`--validate-app` on the exact `.ipa` that `eas submit` got rejected returns
"VERIFY SUCCEEDED with no errors", then `--upload-app` registers the build and it
processes to `VALID` in TestFlight. The Transporter Mac app also works (it
auto-detects tvOS from the binary). **Red herring:** before finding this, we
deleted `LSRequiresIPhoneOS` (which config-tv leaves in the Info.plist) on the
theory it forced iOS validation — it didn't. Removing it is correct tvOS hygiene
(keep the `withTVInfoPlistFixes` plugin), but **no binary edit can fix a
delivery-tool platform mislabel.**

## Why This Works

- **tvOS profile:** `eas-cli` (≤20.1.0) `getApplePlatformFromTarget` reads the pbxproj `SDKROOT`/`TARGETED_DEVICE_FAMILY` and **falls back to `ApplePlatform.IOS`** when neither is present (`build/project/ios/target.js`). In a managed workflow `ios/` is gitignored, so there is no pbxproj — eas-cli defaults to iOS and mints an `IOS_APP_STORE` profile. It never consults config-tv's `isTV` flag. One real prebuild gives eas-cli a TV pbxproj to read, so it resolves tvOS once and stores the right profile.
- **Android duplicate:** aapt2 keys resources by **name within a mipmap folder**, not by extension. `expo.icon` emits `ic_launcher.webp`; config-tv's `androidTVIcon` copies the icon in as `ic_launcher.png`. Same name, two formats → `mergeReleaseResources` aborts. Dropping `androidTVIcon` leaves exactly one `ic_launcher`.
- **Icons:** the asset catalog enforces exact pixel dimensions and Apple's tvOS icon spec forbids alpha; sharp's `.flatten({background}).removeAlpha()` on a `channels:3` canvas is the only reliable way across macOS tooling to produce opaque, exactly-sized RGB PNGs.
- **eas submit / tvOS:** `eas submit` exposes no tvOS platform declaration, so it delivers the upload as iOS and Apple runs iOS validation against the tvOS binary. The binary's own `CFBundleSupportedPlatforms`/`DTPlatformName` do **not** override the platform the delivery tool declares — the delivery-time `altool -t appletvos` flag is what selects which ruleset Apple applies.

## Prevention

- **Never set config-tv `androidTVIcon` when `expo.icon` is set** — they collide on `ic_launcher`. The Android TV home tile is `androidTVBanner`, a separate resource.
- **Run subsequent managed tvOS builds `--non-interactive`** so eas-cli reuses the stored tvOS profile instead of re-resolving (and flipping back to iOS).
- **Generate TV icons with `sharp`, not `sips`/`qlmanage`** — only sharp reliably strips alpha and hits exact sizes; verify with `file` / `sips -g hasAlpha`.
- **Reproduce the failing resource/Gradle task locally** (`./gradlew :app:processReleaseResources`) rather than fighting binary-encoded EAS logs, and don't assume a repeatable build failure is "flaky."
- **Mocked-vs-real discipline:** the managed `expo prebuild` does NOT surface the aapt2 duplicate — only the real `mergeReleaseResources` Gradle task does, and a tvOS build succeeding with the same icon sources does not clear Android. Exercise both real platform tasks before trusting the icon/credential setup.
- **Belt-and-suspenders:** config-tv enables TV when `env.EXPO_TV || params.isTV` (`build/utils/config.js`), so pinning `EXPO_TV: "1"` in **every** `eas.json` build profile guarantees the managed prebuild targets TV even if `isTV` is ever dropped.
- **Never `eas submit` a managed react-native-tvos build** — it delivers as iOS (no tvOS flag). Submit with `xcrun altool ... -t appletvos` or the Transporter app, both of which type the delivery as tvOS.
- **Suspect the delivery tool, not the binary, when rejections contradict the binary's own metadata.** A binary rejected on platform/icon/provisioning errors whose metadata is already correct tvOS is a delivery-platform mislabel. Run `altool --validate-app -t <platform>` FIRST — it runs the real ITMS checks offline at zero cost and isolates binary-vs-delivery faults. Chasing binary-side fixes first (the `LSRequiresIPhoneOS` removal, the App Store Connect platform-add) burned three deliveries that one up-front `--validate-app` would have saved.

## Related Issues

- [Expo TV Platform Setup in an SDUI Monorepo](../best-practices/expo-tv-platform-setup-sdui-monorepo-20260410.md) — parent toolchain doc covering local prebuild / dev-client setup; this doc covers the EAS cloud-build + submit layer it leaves open.
- [Mocked-shape vs real-contract discipline](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md) — META: `expo prebuild` (and a green tvOS build) is the "mocked shape"; only the real `mergeReleaseResources` task is the production contract.
- [Expo Doctor SDK 54 health checks](./expo-doctor-sdk54-health-checks-mobile-v2-20260409.md) — SDK 54 health checks apply verbatim to TV builds.
- Operational runbook: `apps/tv/DISTRIBUTION.md` (the "Gotcha" + "App icons" sections).
- GitHub issues: none found (`gh issue list --search "eas tvos icon"` returned 0).
