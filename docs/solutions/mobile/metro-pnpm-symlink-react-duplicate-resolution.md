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
module: "apps/mobile-v2"
related_issues:
  - "pnpm symlink traversal into .pnpm/ store"
  - "multiple React versions in monorepo"
  - "Metro resolver configuration"
---

## Problem

On simulator launch, the Expo app (`apps/mobile-v2`) crashed immediately with:

```
A React Element from an older version of React was rendered. This is not supported.
```

The monorepo has three incompatible React versions:

| App                     | React Version          |
| ----------------------- | ---------------------- |
| `apps/cms` (Strapi v5)  | 18.x                   |
| `apps/web` (Next.js)    | 19.2.x (via react-dom) |
| `apps/mobile-v2` (Expo) | 19.1.0 (pinned)        |

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

File: `apps/mobile-v2/metro.config.js`

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
- **pnpm overrides are not viable** because `apps/cms` genuinely requires React 18. A monorepo-wide override would break the CMS.
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
# Should show only react@19.1.0 for mobile-v2
pnpm --filter @forge/mobile-v2 exec node -e "console.log(require('react/package.json').version)"

# Should resolve to mobile-v2's own node_modules
pnpm --filter @forge/mobile-v2 exec node -e "console.log(require.resolve('react'))"
```

4. **Watch for these symptoms** — they indicate the problem has recurred:
   - "A React Element from an older version of React was rendered"
   - "Invalid hook call" (duplicate React instances)
   - "Cannot read property 'ReactCurrentDispatcher' of undefined"

## Related Documentation

- [`docs/solutions/mobile/mobile-v2-sdui-app-scaffold-and-review-findings.md`](mobile-v2-sdui-app-scaffold-and-review-findings.md) — Documents Metro resolution failures during mobile-v2 scaffold
- [`docs/solutions/mobile/expo-env-file-handling.md`](expo-env-file-handling.md) — Metro's role in env var inlining and `.env` file priority
- [`docs/solutions/deployment/nextjs-pnpm-monorepo-railway-standalone.md`](../deployment/nextjs-pnpm-monorepo-railway-standalone.md) — Same class of problem (pnpm path assumptions) in deployment context
- PR: [JesusFilm/forge#659](https://github.com/JesusFilm/forge/pull/659)
