---
title: "Metro bundler resolves wrong React version via pnpm symlinks in monorepo"
category: "mobile"
severity: "critical"
date: "2026-04-07"
tags:
  - metro
  - pnpm
  - monorepo
  - react-native
  - expo
  - symlinks
  - dependency-resolution
  - turborepo
module: "apps/mobile"
last_updated: "2026-08-13"
related_issues:
  - "pnpm symlink traversal into .pnpm/ store"
  - "multiple React versions in monorepo"
  - "Metro resolver configuration"
---

> **Scope note (2026-08-13):** this doc covers the Metro BUNDLER-time layer of
> pnpm duplicate-instance hazards — Metro following symlinks to the wrong
> installed copy. The sibling LOCKFILE-time layer (pnpm's peer resolution
> silently re-keying an importer that never declared the package) is a
> different mechanism with a different fix; see
> `docs/solutions/architecture-patterns/pnpm-workspace-optional-peer-dependency-silent-borrowing.md`.
> Fixing one layer does not fix the other. The app was `apps/mobile-v2` when
> this was written; it is `apps/mobile` today, and the resolver below is live
> in `apps/mobile/metro.config.js`.

## Problem

On simulator launch, the Expo app (then `apps/mobile-v2`, now `apps/mobile`) crashed immediately with:

```
A React Element from an older version of React was rendered. This is not supported.
```

The monorepo carries multiple incompatible React versions (the 2026-04 lineup below is historical — the split itself persists, e.g. `apps/mobile` on 19.2.x and `apps/tv` on 19.1.x as of 2026-08):

| App                                   | React Version (2026-04) |
| ------------------------------------- | ----------------------- |
| `apps/cms` (Strapi v5, since retired) | 18.x                    |
| `apps/web` (Next.js)                  | 19.2.x (via react-dom)  |
| `apps/mobile-v2` (Expo)               | 19.1.0 (pinned)         |

Metro followed pnpm symlinks into `.pnpm/` and resolved the wrong React copy from a transitive dependency (e.g., Apollo Client linked to React 18 or 19.2).

## Root Cause

pnpm uses a content-addressable store with symlinks. When Metro encounters `import 'react'` inside a transitive dependency (e.g., `@apollo/client` inside `.pnpm/`), it resolves `react` relative to that package's directory — potentially finding React 18 instead of the project's React 19.1.0. Two separate React runtime instances exist simultaneously, causing the "older version" error.

`extraNodeModules` alone is insufficient: it provides a fallback map but does not override resolution when the module is already found via the local symlink chain.

## Investigation Steps

1. Launched app on iOS simulator — received "older version of React" error.
2. Ran `pnpm why react` — mobile-v2 correctly declares `react@19.1.0` at workspace level.
3. Audited pnpm store — found 4 distinct React versions: 18.2.0, 18.3.1, 19.1.0, 19.2.4.
4. Found 4 Apollo Client instances in `.pnpm/`, each linked to a different React version.
5. Confirmed Metro follows symlinks into `.pnpm/@apollo+client.../node_modules/react`.
6. **Attempted `extraNodeModules` only** — did not override transitive resolution. Error persisted.
7. **Attempted custom `resolveRequest` passing directory path** — caused "Cannot read property 'ReactCurrentDispatcher' of undefined" because Metro treated the path as a file, not a package specifier.
8. **Working fix:** Override `originModulePath` to project root and re-resolve the bare module name.

## Solution

File: `apps/mobile/metro.config.js` (path was `apps/mobile-v2/` at the time)

```js
// Paths used by extraNodeModules; keys also drive the custom resolveRequest.
const singletonPkgs = {
  react: path.resolve(projectRoot, "node_modules/react"),
  "react-native": path.resolve(projectRoot, "node_modules/react-native"),
}

config.resolver.extraNodeModules = singletonPkgs

function resolveFromProjectRoot(context, moduleName, platform) {
  return context.resolveRequest(
    {
      ...context,
      resolveRequest: undefined,
      originModulePath: path.join(projectRoot, "package.json"),
    },
    moduleName,
    platform,
  )
}

const defaultResolveRequest = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const isSingleton =
    singletonPkgs[moduleName] ||
    Object.keys(singletonPkgs).some((pkg) => moduleName.startsWith(pkg + "/"))

  if (isSingleton) {
    return resolveFromProjectRoot(context, moduleName, platform)
  }

  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform)
  }
  return context.resolveRequest(context, moduleName, platform)
}
```

## Key Insights

- **`resolveRequest: undefined` prevents infinite recursion.** This is the canonical Metro pattern — omitting it causes a stack overflow.
- **Override `originModulePath`, not the module name.** Passing a directory path as the module specifier breaks Metro. The correct lever is `originModulePath`: set it to `path.join(projectRoot, "package.json")` so Node resolution walks up from the project root.
- **`startsWith(pkg + "/")` catches deep imports safely.** `"react-native"` does not match `"react/"` — the trailing slash delimiter prevents false positives. This covers `react/jsx-runtime`, `react/jsx-dev-runtime`, and `react-native/Libraries/...`.
- **pnpm overrides are not viable** because workspace apps genuinely hold different React generations (React 18 in `apps/cms` at the time of writing; `apps/mobile` 19.2.x vs `apps/tv` 19.1.x as of 2026-08). A monorepo-wide override would force one app onto another's version.
- **`.npmrc` hoisting changes affect all workspaces.** The Metro-level fix is more surgical and scoped to the app that has the problem.

## Alternatives Considered

| Approach                                   | Why not                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `pnpm.overrides` in root `package.json`    | Would force single React version monorepo-wide, breaking `apps/cms` (React 18)        |
| `.npmrc` `public-hoist-pattern`            | Affects all workspaces, not just mobile-v2                                            |
| `extraNodeModules` alone                   | Only provides fallback; does not override transitive resolution                       |
| Passing directory path to `resolveRequest` | Metro treats it as file path, not package specifier — breaks `ReactCurrentDispatcher` |

## Prevention

1. **Treat the custom resolver as load-bearing infrastructure.** Do not remove it without auditing all React version constraints.
2. **Extend `singletonPkgs` proactively** when adding packages that must be singletons at runtime (e.g., `scheduler`, `react-is`).
3. **After any `pnpm install`/`pnpm add` in the monorepo**, verify resolution:

```bash
# Should print exactly the react version apps/mobile/package.json declares
pnpm --filter @forge/mobile exec node -e "console.log(require('react/package.json').version)"

# Should resolve to apps/mobile's own node_modules
pnpm --filter @forge/mobile exec node -e "console.log(require.resolve('react'))"
```

4. **Watch for these symptoms** — they indicate the problem has recurred:
   - "A React Element from an older version of React was rendered"
   - "Invalid hook call" (duplicate React instances)
   - "Cannot read property 'ReactCurrentDispatcher' of undefined"

## Related Documentation

- [`docs/solutions/architecture-patterns/pnpm-workspace-optional-peer-dependency-silent-borrowing.md`](../architecture-patterns/pnpm-workspace-optional-peer-dependency-silent-borrowing.md) — The sibling LOCKFILE-time layer: pnpm peer resolution silently re-keying importers that never declared the package; fixed with per-importer package.json pins, not Metro config
- [`docs/solutions/mobile/mobile-v2-sdui-app-scaffold-and-review-findings.md`](mobile-v2-sdui-app-scaffold-and-review-findings.md) — Documents Metro resolution failures during mobile-v2 scaffold
- [`docs/solutions/mobile/expo-env-file-handling.md`](expo-env-file-handling.md) — Metro's role in env var inlining and `.env` file priority
- [`docs/solutions/deployment/nextjs-pnpm-monorepo-railway-standalone.md`](../deployment/nextjs-pnpm-monorepo-railway-standalone.md) — Same class of problem (pnpm path assumptions) in deployment context
- PR: [JesusFilm/forge#659](https://github.com/JesusFilm/forge/pull/659)
