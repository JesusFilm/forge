---
title: "Expo Doctor CI fails 5/17 checks in mobile-v2 (SDK 54, pnpm monorepo)"
date: "2026-04-09"
category: build-errors
module: mobile-v2
problem_type: build_error
component: tooling
severity: medium
symptoms:
  - "expo-doctor exits code 1 with 5/17 checks failing"
  - ".expo/ directory tracked in git with machine-local files"
  - "Metro watchFolders overwritten instead of spread, dropping Expo defaults"
  - "expo-constants and expo-linking missing as peer deps of expo-router"
  - "@react-native-async-storage/async-storage 3.0.2 vs expected 2.2.0 for SDK 54"
  - "pnpm auto-installs newer expo-router peers, producing duplicate Expo SDK packages"
  - "mobile-v2 floats graphql to 16.13.1 while @forge/graphql stays on 16.12.0"
root_cause: config_error
resolution_type: dependency_update
related_components:
  - development_workflow
tags:
  - expo
  - expo-doctor
  - sdk-54
  - metro-config
  - peer-dependencies
  - pnpm-monorepo
---

# Expo Doctor CI fails 5/17 checks in mobile-v2 (SDK 54, pnpm monorepo)

## Problem

Expo Doctor CI job (`npx expo-doctor@1.18.17`) failed with 5/17 checks in `apps/mobile-v2`. These were pre-existing SDK health issues that accumulated silently until the CI job was introduced (commit ff13556). The app functioned normally despite the failures.

## Symptoms

- CI job `expo-doctor` exits with code 1
- `.expo/` directory tracked in git (contains machine-local `README.md` and `devices.json`)
- Metro `config.watchFolders` overwritten instead of spread, losing Expo's internal defaults
- `expo-constants` and `expo-linking` missing as direct dependencies (required by `expo-router`)
- Duplicate `expo-constants` (v18 from Expo SDK, v55 resolved transitively by `expo-router`)
- `@react-native-async-storage/async-storage` at 3.0.2 instead of SDK 54's tested 2.2.0

## What Didn't Work

No failed investigation attempts — the fixes were straightforward from the `expo-doctor` output. The real issue was that these problems existed silently because `expo-doctor` was never run locally or in CI before commit ff13556.

## Solution

**Fix 1 — `.expo/` tracked in git**

```bash
# Add to root .gitignore
echo ".expo/" >> .gitignore

# Untrack already-committed files
git rm -r --cached apps/mobile-v2/.expo/
```

**Fix 2 — Metro watchFolders overwriting Expo defaults**

Before (`apps/mobile-v2/metro.config.js`):

```js
config.watchFolders = [monorepoRoot]
```

After:

```js
config.watchFolders = [...(config.watchFolders || []), monorepoRoot]
```

**Fix 3 — Missing peer deps required by expo-router**

```bash
npx expo install expo-constants expo-linking
# Installed: expo-constants@~18.0.13, expo-linking@~8.0.11
```

This also resolved Fix 4 (duplicate `expo-constants`) by giving pnpm a single direct version to hoist.

**Fix 5 — async-storage version mismatch**

```bash
npx expo install @react-native-async-storage/async-storage --fix
# Downgraded: 3.0.2 → 2.2.0
```

**Fix 6 — Stop pnpm from auto-installing newer Expo peers**

Create root `.npmrc`:

```ini
auto-install-peers=false
dedupe-peer-dependents=true
```

Without this, pnpm auto-installed `expo-router` peers in a separate context and pulled SDK 55 `expo-constants` / `expo-linking` into the SDK 54 app graph.

**Fix 7 — Pin Expo app GraphQL to the same version as `@forge/graphql`**

```json
// apps/mobile/package.json
// apps/mobile-v2/package.json
"graphql": "16.12.0"
```

Leaving this as `^16.12.0` allowed `apps/mobile-v2` to resolve `graphql@16.13.1`, which created a second `expo@54.0.33` installation keyed only by a different GraphQL peer set.

After all fixes: `expo-doctor` passes 17/17.

## Why This Works

- Spreading `watchFolders` preserves Expo's internal Metro configuration rather than clobbering it — Expo sets its own entries before user config runs.
- `npx expo install` consults the SDK 54 compatibility matrix and pins to the exact tested version. `pnpm add` cannot do this because it is unaware of the SDK version contract.
- Installing peer deps directly forces pnpm to hoist a single SDK-compatible version, preventing the monorepo resolver from picking a different version through `expo-router`'s transitive graph.
- `auto-install-peers=false` stops pnpm from inventing a second Expo dependency graph for `expo-router`'s missing peers.
- Pinning the Expo apps to the same exact `graphql` version as `@forge/graphql` prevents duplicate `expo@54.0.33` installations that differ only by peer metadata.
- Removing `.expo/` from git eliminates machine-local state from polluting CI and other developers' environments.

## Prevention

- **Always use `npx expo install`** (not `pnpm add`) for Expo ecosystem packages — it resolves SDK-compatible versions.
- **Keep Expo workspace GraphQL versions exact and aligned** with `packages/graphql` so pnpm can dedupe Expo's peer-resolved packages.
- **Keep pnpm peer auto-install disabled in this monorepo** unless Expo's dependency model changes.
- **Always spread existing Metro config arrays** rather than replacing them: `config.watchFolders = [...(config.watchFolders || []), addition]`.
- **Add `.expo/` to `.gitignore` at project creation time**, before the first commit.
- **Run `npx expo-doctor` locally** before pushing after dependency changes in `apps/mobile-v2/`.
- The Expo Doctor CI job now catches regressions automatically — keep it green.

## Related Issues

- [Mobile-v2 SDUI app scaffold and review findings](../mobile/mobile-v2-sdui-app-scaffold-and-review-findings.md) — establishes `npx expo install --check` as the prevention rule; this CI job is the automated enforcement
- [Metro pnpm symlink React duplicate resolution](../mobile/metro-pnpm-symlink-react-duplicate-resolution.md) — related Metro config and pnpm duplicate resolution patterns
- [Expo env file handling](../mobile/expo-env-file-handling.md) — related `.gitignore` patterns for Expo projects
