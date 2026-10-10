---
title: "pnpm hidden-hoist re-key exposes a phantom @babel/types dependency in react-native-worklets, breaking every Metro bundle"
date: "2026-08-13"
category: "build-errors"
module: "apps/mobile Metro bundling / pnpm workspace hidden-hoist dependency resolution"
problem_type: build_error
component: tooling
severity: high
symptoms:
  - "Every Metro bundle of apps/mobile failed with WorkletsBabelPluginError at @expo/ui/src/State/index.fx.ts: [Worklets] Babel plugin exception: NumericLiterals must be non-negative finite numbers."
  - "The failure appeared only after a pnpm dedupe commit, with zero changes to any mobile source file"
  - "CI stayed fully green (jest, typecheck, lint, expo-doctor all passed) because no CI job runs a Metro bundle"
  - "The error stack mixed @babel/traverse@7.29.0 frames with @babel/types@8.0.4 frames — a Babel major-version boundary inside one transform"
root_cause: config_error
resolution_type: config_change
related_components:
  - "apps/mobile"
  - "apps/tv"
  - "apps/mastra"
  - "react-native-worklets"
  - "@expo/ui"
  - "expo-router"
tags:
  - pnpm
  - hidden-hoist
  - phantom-dependency
  - package-extensions
  - metro
  - babel
  - react-native-worklets
  - monorepo
---

# pnpm hidden-hoist re-key exposes a phantom @babel/types dependency in react-native-worklets, breaking every Metro bundle

## Problem

On the Expo SDK 57 / React Native 0.86 upgrade branch (PR #1926), every Metro bundle of `apps/mobile` failed. The cause was a phantom dependency inside `react-native-worklets@0.8.3`: its Babel plugin calls `require("@babel/types")` (first at `plugin/index.js:36`, repeated at many call sites), but the package's own manifest declares no `@babel/types` in either `dependencies` or `peerDependencies`. Its only Babel-adjacent peer is `@babel/core: "*"`.

Under pnpm's isolated `node_modules` layout, a require with no declared dependency falls through to the hidden hoist at `node_modules/.pnpm/node_modules/`, which pnpm populates with one winner per package name across the whole lockfile. A `pnpm dedupe` commit ("chore: dedupe the lockfile to prune pre-fix resolution residue") re-keyed that winner for `@babel/types` from 7.29.0 to 8.0.4. Babel 8 is in the graph because `@mastra/deployer` (apps/mastra) depends on `@babel/core@8.0.1`, which brings Babel 8's `@babel/types` into the store. Babel 8's `numericLiteral` validator rejects negative literals that Babel 7 accepted, so the worklets plugin threw while transforming `@expo/ui`'s worklet source files — and `expo-router@57` depends on `@expo/ui`, so every bundle hits them.

## Symptoms

- Every Metro bundle attempt for `apps/mobile` failed with:

  ```
  WorkletsBabelPluginError: .../@expo/ui/src/State/index.fx.ts: [Worklets] Babel plugin
  exception: NumericLiterals must be non-negative finite numbers. You can use t.valueToNode(-2) instead.
  ```

- The stack mixed `@babel/traverse@7.29.0` frames with `@babel/types@8.0.4` frames — the strongest early clue that the failure crossed a Babel major-version boundary rather than being a worklets bug.
- CI stayed green throughout. No CI job runs `expo export` or any Metro bundle, so jest, typecheck, lint, and `expo-doctor` were all blind. The break surfaced only when a device regression pass bundled the app.
- `apps/tv` shares the same hidden hoist, so its worklets plugin had the same exposure; the break there was never observed directly because TV was not bundled during the window.

## What Didn't Work

- **Bumping `react-native-worklets`.** `npm view` showed 0.8.4, 0.8.6, and 0.9.1 still declare no `@babel/types` dependency. The phantom is present in every current release.
- **pnpm `overrides`.** Overrides can only rewrite the range of a dependency a package already declares. They cannot add a dependency the package never listed.
- **Excluding `@babel/types` from the hidden hoist.** That removes the phantom require's only fallback target, turning a wrong-version resolution into a resolution failure.
- **A pnpm patch of the plugin.** Viable — the repo already patches `@datadog/mobile-react-native` and `react-native-tvos` — but heavier than declaring the true dependency, and it would need re-creating on every worklets bump.

## Solution

Declare the phantom dependency explicitly with pnpm's `packageExtensions`, so pnpm's resolver — not the hidden hoist — decides which `@babel/types` the plugin sees. Root `package.json`:

```json
"pnpm": {
  "packageExtensions": {
    "react-native-worklets": {
      "dependencies": {
        "@babel/types": "^7.29.0"
      }
    }
  }
}
```

`pnpm install` then resolves the plugin's `@babel/types` to the store's existing 7.29.0 and records `packageExtensionsChecksum` in `pnpm-lock.yaml`. No other package's resolved version or peer keying moved. Three unrelated metadata-plane deltas rode along in the regeneration and were traced as ordinary lockfile-canonicalization artifacts: a `libsql` cpu-field removal, `transitivePeerDependencies` pruning of `bufferutil`/`utf-8-validate` under `@react-native/metro-config`, and an `eslint-plugin-import` peer-suffix expansion.

## Why This Works

`packageExtensions` makes pnpm treat a third-party manifest as if it declared the extra dependency, without touching the package's files. Every peer-variant of `react-native-worklets` — including the `react-native-tvos`-keyed variant `apps/tv` reaches transitively — gets a correctly-versioned `@babel/types` linked into its virtual directory, resolved from the declared `^7.29.0` range instead of from whichever version won the hidden hoist that install. The fix closes the gap at its source; controlling the hoist winner is not possible, because the winner is recomputed by any lockfile-wide operation.

Verification walked the exact require chain Metro exercises — resolve `react-native-worklets/plugin` starting from `babel-preset-expo`, then resolve `@babel/types` from the plugin's directory:

```bash
node -e "
const fs = require('fs');
const preset = fs.realpathSync('apps/mobile/node_modules/babel-preset-expo');
const plugin = require.resolve('react-native-worklets/plugin', { paths: [preset] });
const types = require.resolve('@babel/types', { paths: [require('path').dirname(plugin)] });
console.log(types);  // .pnpm/@babel+types@7.29.0/... after the fix
"
```

Metro bundle probes then returned HTTP 200 for both platforms, and the same smoke passed for `apps/tv` on both targets:

```bash
curl "http://localhost:8090/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true&minify=false"
curl "http://localhost:8090/.expo/.virtual-metro-entry.bundle?platform=android&dev=true&minify=false"
```

## Prevention

- CI has no Metro bundle or `expo export` job, so this failure class produces no CI signal. Until such a job exists, treat every lockfile-wide operation (`pnpm dedupe`, wide bumps, SDK upgrades) as requiring a manual Metro bundle smoke on the RN apps before trusting green CI. The served-bundle curl probe above is the cheap, CI-free check.
- Treat pnpm's hidden hoist as unstable by construction: it holds one winner per package name, recomputed on any dedupe. A package with a phantom dependency is one lockfile-wide operation away from silently receiving a different major of that dependency.
- When a phantom dependency is found, declare it via `pnpm.packageExtensions` rather than patching the package or trying to steer the hoist.

## Related Issues

- `docs/solutions/architecture-patterns/pnpm-workspace-optional-peer-dependency-silent-borrowing.md` — sibling LOCKFILE-time peer-resolution hazard from the same SDK 57 upgrade; fixed with per-importer pins rather than packageExtensions.
- `docs/solutions/mobile/metro-pnpm-symlink-react-duplicate-resolution.md` — sibling Metro BUNDLE-time resolution hazard (symlink-following to a stray declared React copy), fixed via a metro.config.js resolveRequest override.
- Together the three docs cover three distinct pnpm-resolution hazard shapes: peer-graph borrowing (lockfile time), symlink duplicate resolution (bundle time, declared deps), and hidden-hoist phantom resolution (bundle time, undeclared deps).
