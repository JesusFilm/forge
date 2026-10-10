---
title: Expo standalone build crashes on launch with no top-level scheme defined
date: 2026-06-23
category: runtime-errors
module: apps/tv
problem_type: runtime_error
component: tooling
symptoms:
  - "Standalone/TestFlight Apple TV build crashes instantly on launch (quits to Home, no UI); simulator and dev-client builds are fine"
  - "RCTFatalException: Unhandled JS Exception: Error: Cannot make a deep link into a standalone app with no custom scheme defined"
  - "App terminated due to signal 6 (abort); JS stack shows resolveScheme -> createURL -> getRootURL -> getInitialURL -> ContextNavigator"
root_cause: config_error
resolution_type: config_change
severity: critical
related_components:
  - development_workflow
tags:
  - expo
  - react-native-tvos
  - app-scheme
  - expo-linking
  - standalone-crash
  - testflight
  - tvos
  - eas-build
---

# Expo standalone build crashes on launch with no top-level scheme defined

## Problem

The `apps/tv` Expo app crashed instantly on launch in the standalone/TestFlight build on a real Apple TV — straight back to the Home screen, no UI — while the simulator and dev-client builds ran fine. Root cause: `app.json` defined no top-level `scheme`, and expo-router throws on startup when no custom scheme exists in a non-dev build.

## Symptoms

- Standalone (TestFlight / EAS production) Apple TV build quits to Home the instant it launches; never renders any app UI.
- Simulator and dev-client builds launch normally — the crash is invisible in dev.
- The native crash log / `devicectl --console` shows:
  ```
  *** Terminating app due to uncaught exception 'RCTFatalException:
  Unhandled JS Exception: Error: Cannot make a deep link into a standalone
  app with no custom scheme defined'
    resolveScheme -> createURL -> getRootURL -> getInitialURL -> ContextNavigator
  App terminated due to signal 6.
  ```

## What Didn't Work

The "instant quit, no UI" symptom plus the heavy JS guards in `app/_layout.tsx` (a `require()` try/catch capturing `moduleError`, plus an `ErrorBoundary`) initially pointed _away_ from JavaScript. These hypotheses were investigated and ruled out before the crash log was captured:

- **Env-validation throw** (`EXPO_PUBLIC_GRAPHQL_URL` missing → `src/env.ts` Zod throw). Ruled out: the EAS `production` env var was set 8 days before the build, and a module-load throw would have been caught into `moduleError` and _rendered_, not crashed.
- **Stale build predating the fix.** Ruled out: the TestFlight build's commit shipped the current `env.ts`.
- **Native / dyld crash** (because JS errors are guarded, "instant quit" looked native). Wrong: it _is_ a JS throw — but thrown inside expo-router's `ContextNavigator`, which is the **parent** of `app/_layout.tsx`, so the guards never mount. Lesson: a JS throw above your own root component bypasses every `ErrorBoundary`/`moduleError` guard you put _inside_ it.

The decisive step was capturing the actual exception, not more reasoning. On a paired Apple TV (Developer Mode on):

```bash
xcrun devicectl device process launch --console --terminate-existing \
  --device <udid> org.jesusfilm.forgetv
```

The `--console` flag streamed the JS exception directly.

## Solution

Add a top-level `scheme` to the Expo config (`apps/tv/app.json`):

```jsonc
{
  "expo": {
    // ...name, slug, version, etc.
    "scheme": "org.jesusfilm.forgetv", // <- the fix: a top-level Expo scheme
    // ...
  },
}
```

The value is set equal to `android.package` / `ios.bundleIdentifier`, so iOS/tvOS is fixed **without changing** the deep-link scheme Android already used.

A config-contract regression test guards it (`apps/tv/src/lib/appConfig.test.ts`) — the crash only reproduces in a standalone build, so a unit test can't reproduce it; it asserts the invariant instead:

```ts
import appConfig from "../../app.json"

describe("app.json Expo config", () => {
  it("defines a non-empty top-level scheme (prevents standalone launch crash)", () => {
    // Expo `scheme` may be string | string[]; guard the non-empty invariant for either form
    const scheme: unknown = appConfig.expo.scheme
    const schemes = Array.isArray(scheme) ? scheme : [scheme]
    expect(schemes.length).toBeGreaterThan(0)
    expect(schemes.every((s) => typeof s === "string" && s.length > 0)).toBe(
      true,
    )
  })
})
```

## Why This Works

At startup expo-router's `ContextNavigator` calls `getInitialURL()` -> `getRootURL()` -> `createURL()` -> expo-linking `resolveScheme()`. In `expo-linking/src/Schemes.ts`, `resolveScheme()` throws _"Cannot make a deep link into a standalone app with no custom scheme defined"_ when `collectManifestSchemes().length === 0` in a non-dev build:

```ts
const manifestSchemes = collectManifestSchemes()
if (!manifestSchemes.length) {
  if (__DEV__ && !options.isSilent) {
    /* warn only */
  } else if (!__DEV__ || executionEnvironment !== StoreClient) {
    throw new Error(
      "Cannot make a deep link into a standalone app with no custom scheme defined",
    )
  }
}
```

Two details make this dev-invisible and easy to miss:

1. **Dev never throws.** In the Expo dev client `Constants.executionEnvironment === StoreClient`, so `resolveScheme()` returns `'exp'` early and never checks `manifestSchemes`. Only a real standalone/Release build (`__DEV__` false, `Standalone` env) hits the throw.
2. **The bundle id does NOT count.** `collectManifestSchemes()` reads only the top-level `scheme` and `ios.scheme` / `android.scheme` — it does **not** include `ios.bundleIdentifier` / `android.package` (the `nativeAppId` is added _after_ the throw guard). So having a bundle id does not satisfy the guard, and **Android standalone is very likely affected too** — adding the top-level `scheme` fixes both platforms.

Adding the top-level `scheme` makes `collectManifestSchemes()` return one element, so the throw can no longer fire.

## Prevention

- **Always set a top-level `scheme` in `app.json`** for any Expo app that uses expo-router (or expo-linking), from day one — even if you don't think you deep-link. The dev client masks the requirement.
- Keep the regression test above so removing the `scheme` fails CI loudly (the failure is otherwise invisible until a standalone build ships).
- **Verify standalone-only fixes on a real standalone build, not dev/sim.** Fastest signal here: `EXPO_TV=1 npx expo prebuild` then a local **Release** `xcodebuild` install via `devicectl` on a paired Apple TV, or `xcrun altool --validate-app -t appletvos` on the rebuilt `.ipa` as a zero-cost pre-upload smoke (see related doc). The `scheme` is baked in at build time — a config change needs a rebuild, and existing TestFlight builds keep crashing until a new build is cut and resubmitted via `xcrun altool -t appletvos` (not `eas submit`).
- Note for diagnosis: the EXConstants `app.config` manifest (which `resolveScheme` reads via `Constants.expoConfig`) regenerates from `app.json` on **every** Xcode build, so a plain rebuild picks up the change; the native `Info.plist` `CFBundleURLSchemes` only updates on `prebuild`.

## Related Issues

- `docs/solutions/build-errors/eas-managed-react-native-tvos-build-gotchas-20260615.md` — EAS/tvOS/TestFlight build + submit gotchas (managed builds default to iOS platform; submit with `xcrun altool -t appletvos`). Same standalone -> TestFlight distribution path; its `altool --validate-app` smoke applies directly here.
- `docs/solutions/best-practices/expo-tv-platform-setup-sdui-monorepo-20260410.md` — canonical `apps/tv` `app.json` reference; `scheme` is the right tier of change (a top-level `expo` key) and config changes require a `prebuild --clean` cycle to reach the native layer.
- PR: JesusFilm/forge#1340.
