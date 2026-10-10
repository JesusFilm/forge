---
title: "Datadog Mobile RUM tvOS integration: SDK platform-guard bugs, stale pnpm-patch build cache, and unusable config plugin"
date: "2026-07-02"
category: integration-issues
module: apps/tv
problem_type: integration_issue
component: tooling
severity: high
symptoms:
  - "DdSdkImplementation.swift:13 -- Unable to resolve module dependency: 'DatadogWebViewTracking' (stray unguarded top-level import; the correct guarded import sits 4 lines below inside #if os(iOS))"
  - "DdSdk.mm:129 -- no visible @interface for 'DdSdk' declares the selector 'consumeWebviewEvent:resolve:reject:' (RCT_REMAP_METHOD export block left unguarded while the Swift and ObjC implementations are both iOS-guarded)"
  - "tvOS build re-fails at the same error and line after pnpm patch-commit because CocoaPods' Pods project and Xcode 26's explicit-module DerivedData cache both still reference the stale unpatched dependency path"
  - "Error: DATADOG_CI_EXEC does not exist or is not executable in the Bundle React Native code and images build phase (expo-datadog config plugin assumes a hoisted node_modules layout that does not exist under pnpm)"
  - "DATADOG_API_KEY environment variable not set hard-fails the Upload dSYMs to Datadog build phase on every local/dev build, with no Debug-only or API-key guard and no plugin option to skip it"
root_cause: wrong_api
resolution_type: dependency_update
related_components:
  - development_workflow
tags:
  - datadog
  - react-native-tvos
  - pnpm-patch
  - cocoapods
  - xcode-deriveddata
  - expo-config-plugin
  - tvos
  - rum
---

# Datadog Mobile RUM tvOS integration: SDK platform-guard bugs, stale pnpm-patch build cache, and unusable config plugin

## Problem

Integrating `@datadog/mobile-react-native@3.5.2` into `apps/tv` (react-native-tvos 0.81, Expo SDK 54) broke the tvOS build because the SDK ships two unguarded references to `DatadogWebViewTracking` — a module with no tvOS slice — plus a stale-path trap in the pnpm/CocoaPods patch pipeline and an unusable config plugin for keyless dev builds.

## Symptoms

**Blocker 1 — Swift compile error (stray unguarded import):**

```
DdSdkImplementation.swift:13 — Unable to resolve module dependency: 'DatadogWebViewTracking'
```

v3.5.2 ships a duplicate top-level `import DatadogWebViewTracking` at module scope; the correct guarded import sits four lines below inside `#if os(iOS)`. `DatadogWebViewTracking` has no tvOS build slice, so the top-level import fails to resolve on tvOS.

**Blocker 2 — ObjC compile error (after fixing #1):**

```
DdSdk.mm:129 — no visible @interface for 'DdSdk' declares the selector 'consumeWebviewEvent:resolve:reject:'
```

The `RCT_REMAP_METHOD(consumeWebviewEvent, ...)` export block was left unguarded, while both the ObjC method implementation (`#if TARGET_OS_IOS`, ~line 172) and the Swift implementation (`#if os(iOS)`) are correctly guarded. The SDK missed only the RCT export macro.

**Toolchain trap A — stale Pods path after `pnpm patch-commit` (cost a full failed rebuild):**

After committing the pnpm patch, the identical `DdSdkImplementation.swift:13` error re-appeared at the same line and same message, even though the patch was correctly applied on disk. The pnpm virtual-store path gains a `patch_hash=` segment on patch-commit, but the CocoaPods `Pods` project still referenced the old, unpatched store path, and Xcode 26's explicit-module DerivedData cache reinforced the stale result.

**Toolchain trap B — `expo-datadog` config plugin unusable for keyless/dev builds under pnpm:**

```
Error: DATADOG_CI_EXEC does not exist or is not executable
```

followed (after a workaround) by:

```
DATADOG_API_KEY environment variable not set
```

The plugin's injected bundle phase computes `DATADOG_CI_EXEC` as `../../.bin/datadog-ci` relative to the resolved `@datadog/datadog-ci` package (a hoisted-layout assumption that doesn't hold under pnpm's symlinked store). A separate "Upload dSYMs to Datadog" phase (`set -e; $DATADOG_CI_EXEC dsyms upload ...`) has no Debug/API-key guard and no skip option.

## What Didn't Work

- **Rebuilding without re-running `pod install`.** After `pnpm patch-commit`, just re-triggering the Xcode build reproduced the exact same error at the exact same line, which looked like the patch hadn't taken. It had — the pnpm symlink target under `node_modules` was already the patched, `patch_hash=`-suffixed store path. The problem was that the CocoaPods `Pods` project (and Xcode 26's explicit-module DerivedData cache) still pointed at the pre-patch resolution and needed to be regenerated, not that the source fix was wrong.
- **`DATADOG_CI_EXEC` override via `ios/.xcode.env.local` as a full fix.** Pointing the env var at the real pnpm bin (`apps/tv/node_modules/.bin/datadog-ci`) unblocked the first build phase, but only exposed the second, unconditional problem: the plugin's dSYM-upload phase runs `set -e` with no Debug guard and hard-fails without `DATADOG_API_KEY`. There is no plugin option to skip it, so the override was a half-fix that just moved the failure one phase later — the plugin itself had to go.

## Solution

**1. Author the pnpm patch** (`patches/@datadog__mobile-react-native@3.5.2.patch`, created via `pnpm patch @datadog/mobile-react-native@3.5.2` → edit the two files → `pnpm patch-commit <tmp-dir>`):

`ios/Sources/DdSdkImplementation.swift` — remove the stray unguarded import, keep only the guarded one:

```diff
 import DatadogInternal
 import DatadogLogs
 import DatadogRUM
 import DatadogTrace
-import DatadogWebViewTracking
 import Foundation
 import React

+// tvOS fix: DatadogWebViewTracking has no tvOS slice; the guarded import below
+// covers iOS. The SDK's stray UNGUARDED import here broke the tvOS build (3.5.2).
 #if os(iOS)
     import DatadogWebViewTracking
 #endif
```

`ios/Sources/DdSdk.mm` — wrap the RCT export macro in the same guard already used by its ObjC/Swift implementations:

```diff
+// tvOS fix: consumeWebviewEvent: is TARGET_OS_IOS-only (line ~172); the SDK
+// failed to guard this RCT export, so it broke the tvOS build (3.5.2).
+#if TARGET_OS_IOS
 RCT_REMAP_METHOD(consumeWebviewEvent, withWebviewMessage:(NSString*)message
                  withResolver:(RCTPromiseResolveBlock)resolve
                  withRejecter:(RCTPromiseRejectBlock)reject)
 {
     [self consumeWebviewEvent:message resolve:resolve reject:reject];
 }
+#endif
```

**2. Register the patch** in root `package.json`:

```json
"patchedDependencies": {
  "react-native-tvos@0.81.5-2": "patches/react-native-tvos@0.81.5-2.patch",
  "@datadog/mobile-react-native@3.5.2": "patches/@datadog__mobile-react-native@3.5.2.patch"
}
```

**3. Ordering that actually clears the stale-path trap** — each step is necessary, in this order:

```
pnpm install                                              # relink node_modules to the patch_hash= store path
EXPO_TV=1 pod install                                      # from apps/tv/ios — re-resolve autolinking against the NEW symlink path
rm -rf ~/Library/Developer/Xcode/DerivedData/<App>-*        # clear Xcode 26's explicit-module cache
# then rebuild
```

`pnpm install` alone updates the symlink; without re-running `pod install`, the `Pods` Xcode project still embeds the old resolved path, so the same error resurfaces at the same line despite the fix being present on disk.

**4. Remove the `expo-datadog` config plugin** from `app.json` `plugins` entirely and re-run `EXPO_TV=1 npx expo prebuild --clean`. Runtime RUM/Logs/crash reporting only needs the autolinked `@datadog/mobile-react-native` pod (wired via `TvDatadogProvider` in `apps/tv/src/components/DatadogRum.tsx`, mounted in `app/_layout.tsx` below the root `ErrorBoundary`); the plugin exclusively wires build-time dSYM/source-map upload, which becomes a deferred, secret-gated CI step (`pnpm dlx @datadog/datadog-ci`, mirroring web/admin's `datadog:sourcemaps` npm-script pattern that only runs when `DATADOG_API_KEY` is present) instead of a mandatory Xcode build phase.

## Why This Works

- **Platform-conditional compilation semantics differ by language, and both are false/0 on tvOS.** Swift uses `#if os(iOS)`; Objective-C uses `#if TARGET_OS_IOS`. `DatadogWebViewTracking` genuinely has no tvOS build slice, so any code path that references it — import or symbol — must sit behind one of these guards. The SDK's two blockers were both "guard present everywhere except one spot": the Swift file had the right guard four lines down but an extra ungated import above it; the ObjC file guarded the method body and the Swift impl but missed the RCT export macro. Applying the same guard already used elsewhere in each file is the correct, minimal fix — not disabling the feature or forking a bigger diff.
- **`pod install` must re-run after `pnpm patch-commit` because the store path itself changes.** Committing a pnpm patch appends a `patch_hash=` segment to the package's virtual-store path. CocoaPods' autolinking resolves each native pod once, at `pod install` time, to a concrete filesystem path baked into the generated `Pods.xcodeproj`. If `pod install` isn't re-run, Xcode keeps compiling the OLD unpatched path even though `node_modules` now symlinks to the new, patched one — hence identical errors at identical line numbers post-patch. Xcode 26's explicit-module DerivedData cache adds a second layer of staleness on top, requiring its own cache clear.
- **Removing the config plugin is safe because runtime telemetry and build-time symbol upload are architecturally separate.** `@datadog/mobile-react-native`'s native SDK (autolinked via CocoaPods) is everything RUM/Logs/crash-reporting need at runtime — it works whether or not `expo-datadog` ever ran. The plugin only adds Xcode build phases for `datadog-ci` dSYM/source-map upload, a nice-to-have for readable stack traces in the dashboard, not a runtime dependency. Deferring that upload to a secret-gated CI script preserves the same end capability without forcing every keyless local/dev build through a hard failure.

## Prevention

- **pnpm only warns, never fails, on a version-mismatched patch key.** If `@datadog/mobile-react-native` is bumped without regenerating the patch, `pnpm install` prints an "unused patch" warning and succeeds — the tvOS breakage returns silently at the _next_ native build, disconnected in time from the version-bump commit that actually caused it. `apps/tv/CLAUDE.md` (Observability section) now documents "re-create this patch on any SDK bump" as the load-bearing operational step; an optional CI guard that asserts the installed dependency version matches the `patchedDependencies` key would fail fast at the point of the version bump instead. **Now implemented** (PR #1458) as the dependency-free `scripts/check-patched-deps.mjs` + an unconditional CI job — see `docs/solutions/best-practices/datadog-tvos-observability-pipeline-qoe-and-guardrails.md` (rule 6).
- **`.prettierignore` now excludes Expo prebuild output** (`apps/mobile/ios`, `apps/mobile/android`, `apps/tv/ios`, `apps/tv/android`) plus `.impeccable` caches. These directories are gitignored but not prettier-ignored, so the pre-commit `prettier --check .` hook previously failed on any machine that had run a native build — an unrelated but real fallout of doing this tvOS build locally.
- **This is the repo's second committed pnpm patch fixing a tvOS-specific native build break**, after `patches/react-native-tvos@0.81.5-2.patch` (fmt 11.0.2 → 11.2.0 for Xcode 26/Clang 21). Both are keyed to an exact dependency version and carry the same "re-create on upgrade" caveat, making "committed pnpm patch + version-pin caveat" the established pattern for vendoring tvOS-specific native fixes in this repo (auto memory [claude]).
- Operational steps (patch recreation, `pod install`/DerivedData ordering, the plugin-removal rationale) are documented in `apps/tv/CLAUDE.md`'s Observability (Datadog) section — read that first before touching Datadog on tvOS again.

## Related Issues

- `docs/solutions/best-practices/react-native-tvos-porting-pitfalls-20260414.md` — the catalog of apps/tv native-module tvOS pitfalls this instance belongs to; this case adds a new resolution path (patch-and-ship for small unguarded-symbol omissions vs avoiding the package for structural incompatibilities)
- `docs/solutions/build-errors/pnpm-patched-dependencies-filtered-docker-install-20260611.md` — same `patchedDependencies` blast-radius lesson, different failure surface (Docker COPY scope vs virtual-store `patch_hash` invalidation)
- `docs/solutions/build-errors/eas-managed-react-native-tvos-build-gotchas-20260615.md` — sibling apps/tv build-pipeline gotchas (EAS cloud/submit-time), no root-cause overlap
- PR #1434 — feat(tv): add opt-in Datadog Mobile RUM observability (ships the patch and the plugin exclusion)
