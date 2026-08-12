---
title: "EAS Update white screen: Metro env var inlining fails inside nested function args"
date: 2026-04-10
category: runtime-errors
module: apps/mobile
problem_type: runtime_error
component: tooling
severity: high
symptoms:
  - "White screen when scanning EAS Update QR code in Expo Go"
  - "App works in iOS simulator but fails in preview channel"
  - "Splash screen appears briefly then white screen — no error shown"
  - "'Invalid environment variables' when module-level createEnv() throws silently"
root_cause: config_error
resolution_type: code_fix
related_components:
  - development_workflow
tags:
  - expo
  - eas-update
  - metro
  - env-vars
  - expo-go
  - white-screen
  - t3-oss-env-core
  - module-crash
  - error-boundary
  - react-native
---

# EAS Update white screen: Metro env var inlining fails inside nested function args

## Problem

The mobile-v2 Expo app showed a white screen when stakeholders scanned the EAS Update QR code in Expo Go. The app loaded correctly in the iOS simulator. The splash screen appeared briefly before the white screen, indicating the JS bundle loaded but crashed during initialization.

## Symptoms

- White screen after splash in Expo Go when loading an EAS Update
- App works correctly locally via `expo start` or `expo run:ios`
- No error message visible — completely silent crash
- Splash screen appears briefly (confirming the bundle downloads), then white
- Legacy project (`apps/mobile`) previews work fine with identical EAS Update setup

## What Didn't Work

1. **Suspected `expo-glass-effect` incompatibility with Expo Go** — Wrong. It's included in Expo Go for SDK 54 and confirmed working.
2. **Suspected EAS Update requires a development build** — Wrong. Expo Go can preview EAS Updates directly via QR code.
3. **Fixed channel-to-branch mapping** (`eas channel:edit preview --branch preview`) — The channel already existed and was correctly linked. White screen persisted.
4. **Sourced `.env.production` into the shell** (`set -a && . ./.env.production && set +a && eas update`) — Metro ignores shell env vars. It reads from `.env` files via its own `@expo/env` loader, not from `process.env`.
5. **Cleared Metro cache directories** (`rm -rf /tmp/metro-* node_modules/.cache`) — Didn't reliably fix the issue because Metro's cache is keyed by source file mtime, not by env file content.

## Solution

Three changes were needed:

### 1. Force Metro env var inlining at module scope (`env.ts`)

Metro's `process.env.EXPO_PUBLIC_*` replacement transform does not reliably inline values when references only exist inside nested function call arguments (e.g., inside `createEnv({runtimeEnvStrict: {...}})`). Top-level module-scope references force Metro to track the env var dependencies and inline them correctly.

**Before:**

```typescript
export const env = createEnv({
  clientPrefix: "EXPO_PUBLIC_",
  client: {
    /* ... */
  },
  runtimeEnvStrict: {
    EXPO_PUBLIC_GRAPHQL_URL_IOS: process.env.EXPO_PUBLIC_GRAPHQL_URL_IOS,
    EXPO_PUBLIC_GRAPHQL_URL_ANDROID:
      process.env.EXPO_PUBLIC_GRAPHQL_URL_ANDROID,
    EXPO_PUBLIC_STRAPI_TOKEN: process.env.EXPO_PUBLIC_STRAPI_TOKEN,
  },
  // ...
})
```

**After:**

```typescript
// Metro only reliably inlines process.env.EXPO_PUBLIC_* at module scope.
// References nested inside createEnv() arguments are not consistently
// replaced during eas update bundling.
const _inlined = {
  ios: process.env.EXPO_PUBLIC_GRAPHQL_URL_IOS,
  android: process.env.EXPO_PUBLIC_GRAPHQL_URL_ANDROID,
  token: process.env.EXPO_PUBLIC_STRAPI_TOKEN,
}
void _inlined

let env: ReturnType<typeof createEnv>
try {
  env = createEnv({
    /* ...same config... */
  })
} catch (e) {
  throw new Error(
    `Env validation failed. Inlined: IOS="${_inlined.ios}" ANDROID="${_inlined.android}" TOKEN=${_inlined.token ? "set" : "MISSING"}. Original: ${e instanceof Error ? e.message : e}`,
    { cause: e },
  )
}
export { env }
```

### 2. Replace static imports with `require()` in try/catch (`_layout.tsx`)

When `createEnv()` throws at module evaluation time, static ES `import` statements cause the entire module graph to fail silently — producing a white screen with zero diagnostic information. Using `require()` inside try/catch catches these module-level crashes and displays a visible error screen.

> **Scope qualification — added 2026-08-11.** This catches a throw only when the guarded `require` is the **first** evaluation path into the throwing module. In an expo-router app that is a property of the current import graph, not of the pattern: route modules are evaluated through expo-router's own graph, and a static import chain from any screen can reach the throwing module without passing through this block. Both outcomes have been observed on `apps/mobile` four days apart, with neither `_layout.tsx` nor the throwing module changed in between. The guard is still worth having — it just is not a guarantee. See `../best-practices/expo-router-require-guard-containment-is-order-dependent.md`.

```typescript
let moduleError: string | null = null
let Stack: typeof import("expo-router").Stack
// ... typed declarations for all imports

try {
  const router = require("expo-router")
  Stack = router.Stack
  // ... all requires inside try
  getApolloClient = require("../src/lib/apolloClient").getApolloClient
} catch (e: unknown) {
  const err = e instanceof Error ? e : new Error(String(e))
  moduleError = `${err.message}\n\n${err.stack ?? ""}`
}
```

Also added an `ErrorBoundary` class component wrapping the app tree for render-time errors.

### 3. `update:preview` script with env swap + cache invalidation

> **Superseded 2026-08-07 (feat-339).** Do not copy the script below. The
> `.env.local` swap was replaced by naming the EAS environment and disabling
> dotenv outright:
>
> ```json
> "update:preview": "touch src/env.ts && EXPO_NO_DOTENV=1 eas update --channel preview --environment preview --message \"preview update\"",
> "update:production": "touch src/env.ts && EXPO_NO_DOTENV=1 eas update --channel production --environment production --message \"production update\""
> ```
>
> `--environment` makes `eas-cli` inject `EXPO_NO_DOTENV=1` into the export
> subprocess, so dotenv files become unreachable rather than merely outranked;
> the variable is set explicitly as well so the guarantee does not rest on a CLI
> internal. `.env.production` was dead Strapi-era configuration — the swap that
> prevented the leak also stripped published previews of their Datadog variables
> and search bearer. The `touch` stays as belt-and-braces for the cache problem
> this document is actually about. See `apps/mobile/CLAUDE.md` § Publishing an
> EAS Update.

The original recipe, kept for the record:

```json
"update:preview": "bash -c 'cp .env.local .env.local.bak 2>/dev/null; trap \"mv .env.local.bak .env.local 2>/dev/null\" EXIT; cp .env.production .env.local && touch src/env.ts && eas update --channel preview --message \"preview update\"'"
```

Key elements:

- **`.env.local` swap**: Copies `.env.production` over `.env.local` so Metro reads production env vars (Metro reads `.env.local`, not shell env vars)
- **`touch src/env.ts`**: Updates the file's mtime to force Metro to re-process it and re-inline env values (Metro caches inlined values keyed by source file mtime)
- **`trap ... EXIT`**: Restores `.env.local` even if the process is killed mid-flight
- Restore runs unconditionally on exit via `trap`, preventing `.env.local` from being left with production credentials

## Why This Works

**Metro's env var inlining** works by replacing `process.env.EXPO_PUBLIC_*` references with string literals at bundle time. However, the replacement transform has a quirk: references nested deep inside function call arguments (like `createEnv({runtimeEnvStrict: {EXPO_PUBLIC_GRAPHQL_URL_IOS: process.env.EXPO_PUBLIC_GRAPHQL_URL_IOS}})`) are not consistently replaced during `eas update` bundling. The `_inlined` const at module scope forces Metro to recognize the file's dependency on these env vars.

**Metro's cache** is keyed by source file mtime. Swapping `.env.local` changes the env values but doesn't change any `.ts` file, so Metro serves a cached bundle with old values. `touch src/env.ts` forces cache invalidation.

**Static ES imports** evaluate eagerly at module load time. If any module in the import chain throws, the entire module graph fails with no recovery path. In production mode this manifests as a white screen with no error. Using `require()` defers evaluation into a try/catch, letting us catch the throw and display a diagnostic error screen — _when that require is the first path into the throwing module_. Where another importer reaches it first, the throw escapes the block (see the scope qualification in section 2).

## Prevention

1. **Always add top-level `process.env.EXPO_PUBLIC_*` references** in any module that uses `@t3-oss/env-core` with `createEnv()`. Don't rely on Metro inlining references inside nested function arguments.
2. **Use `require()` with try/catch** in root layout files for Expo apps distributed via EAS Update. This converts a silent white screen into a visible error **for throws in the root layout's own require chain**. It is not a general containment guarantee — see the scope qualification in section 2. If the guarantee has to hold, encode the module-graph precondition as a test rather than assuming it.
3. **Use `trap` in scripts** that temporarily modify env files to guarantee restore on any exit.
4. **Use `touch` to invalidate Metro cache** when swapping env files — Metro keys on source file mtime, not env file content.
5. **Test EAS Update bundles on a real device** before sharing with stakeholders — simulator behaviour (via `expo start` or `expo run:ios`) does not match EAS Update behaviour. _Updated 2026-08-11:_ use a **dev client or an internal-distribution build**, not Expo Go. `apps/mobile` now depends on native modules Expo Go does not bundle (background-downloader, Datadog RUM, Google/Apple sign-in, secure-store), so Expo Go cannot run this app at all.

## Related Issues

- [EAS Update Stakeholder Preview Setup](../mobile/eas-update-stakeholder-preview-setup.md) — the original EAS Update setup; does not cover the Metro inlining bug. (Written before `apps/mobile-v2` was renamed to `apps/mobile`, so its "legacy vs v2" framing predates the current layout.)
- [expo-router require-guard containment is order-dependent](../best-practices/expo-router-require-guard-containment-is-order-dependent.md) — bounds section 2's guard: it contains a module-scope throw only when its require is the first path into the throwing module
- [Expo Env File Handling](../mobile/expo-env-file-handling.md) — Env file priority, shell env vars vs Metro, and `@expo/env` behavior
- [Metro pnpm Symlink Resolution](../mobile/metro-pnpm-symlink-react-duplicate-resolution.md) — Another Metro bundling quirk in the monorepo
