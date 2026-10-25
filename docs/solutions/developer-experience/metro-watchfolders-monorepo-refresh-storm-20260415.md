---
title: "Metro watchFolders watching entire monorepo causes constant Refreshing toasts"
date: "2026-04-15"
category: developer-experience
module: apps/tv
problem_type: developer_experience
component: tooling
severity: medium
symptoms:
  - '"Refreshing..." notification popup flashes repeatedly during development on Apple TV simulator'
  - "Fast Refresh triggers on the TV app when unrelated files in other apps or packages change"
  - "Any file save anywhere in the monorepo causes a TV app reload cycle"
root_cause: config_error
resolution_type: config_change
tags:
  - metro
  - watchfolders
  - fast-refresh
  - expo
  - tv-app
  - monorepo
  - pnpm
---

# Metro watchFolders watching entire monorepo causes constant Refreshing toasts

## Problem

Metro bundler's `watchFolders` in `apps/tv/metro.config.js` was set to the entire monorepo root, causing every file change across unrelated apps, docs, or git operations to trigger a Fast Refresh cycle in the TV app, showing a constant "Refreshing..." toast during development.

## Symptoms

- "Refreshing..." notification popup flashes repeatedly on the Apple TV simulator with no apparent trigger from TV app code
- Fast Refresh fires when editing files in `apps/web/`, `apps/cms/`, `docs/`, or any other monorepo directory
- The toast appears even from editor autosaves, git operations, or other dev servers writing files

## What Didn't Work

- **Searching app code for "Refreshing"** — no matches, because the toast is emitted by Metro/Expo internals, not app code. This is a dead end that wastes time. (session history)
- **Searching for Apollo Client polling or refetch patterns** — found `useQuery` calls with `refetch` but nothing causing a loop at the GraphQL layer. The issue is at the bundler level, not the data-fetching level.
- **Considered disabling Fast Refresh notification entirely** via `DevSettings.setHotLoadingEnabled(false)` — this suppresses the symptom but masks legitimate refreshes too. Not pursued.

## Solution

Scope `watchFolders` to only the packages the TV app actually imports instead of the monorepo root.

**Before:**

```javascript
// Watch the monorepo root for workspace package changes,
// preserving Expo's default watchFolders (required by expo-doctor).
config.watchFolders = [...(config.watchFolders || []), monorepoRoot]
```

**After:**

```javascript
// Only watch packages the TV app imports — watching the entire monorepo root
// causes spurious Fast Refresh ("Refreshing...") toasts on every unrelated change.
config.watchFolders = [
  ...(config.watchFolders || []),
  path.resolve(monorepoRoot, "packages/graphql"),
]
```

The TV app's `package.json` declares exactly one workspace dependency (`@forge/graphql`), so `packages/graphql` is the complete and accurate watch list.

## Why This Works

Metro watches the listed folders for file changes and triggers Fast Refresh on any detected change. When the entire monorepo root is watched, changes to `apps/web`, `apps/cms`, `docs/`, and everything else register as potential module changes. Scoping to `packages/graphql` eliminates all spurious triggers while preserving live-reload for the one shared package the TV app actually uses.

The spread pattern `[...(config.watchFolders || []), ...]` must be preserved because Expo injects its own default `watchFolders` entries at config load time; a direct assignment would clobber them (see `docs/solutions/build-errors/expo-doctor-sdk54-health-checks-mobile-v2-20260409.md`).

## Prevention

- **When bootstrapping a new app in the monorepo from an existing Metro config**, immediately audit the `watchFolders` list against the app's `package.json` workspace dependencies. Do not copy the broad `monorepoRoot` pattern verbatim.
- **Keep `watchFolders` entries as a strict 1:1 match** with `dependencies`/`devDependencies` entries that are local workspace packages. If a second workspace package is added (e.g., `@forge/ui`), add its directory to `watchFolders` at the same time.
- **Always use the spread pattern** (`[...(config.watchFolders || []), newEntry]`) — never assign directly — to avoid clobbering Expo's default watch entries.
- **If a "Refreshing..." toast appears with no in-app trigger**, check Metro `watchFolders` scope before searching app code. The toast originates from Metro internals and will never appear in a codebase search.

## Related Issues

- `docs/solutions/build-errors/expo-doctor-sdk54-health-checks-mobile-v2-20260409.md` — watchFolders must be spread, not overwritten. Complementary: that doc covers the spread pattern, this doc covers scoping the watched value.
- `docs/solutions/best-practices/expo-tv-platform-setup-sdui-monorepo-20260410.md` — canonical TV platform setup guide; covers Metro singleton resolver but not watchFolders scoping.
- `docs/solutions/mobile/metro-pnpm-symlink-react-duplicate-resolution.md` — singleton resolver for pnpm React deduplication; orthogonal fix that coexists in the same `metro.config.js`.
