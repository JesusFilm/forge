/* global require, module */
/* eslint-disable @typescript-eslint/no-require-imports */
const { getDefaultConfig } = require("expo/metro-config")
const path = require("path")

const projectRoot = __dirname
const monorepoRoot = path.resolve(projectRoot, "../..")

const config = getDefaultConfig(projectRoot)

// Only watch packages the TV app imports — watching the entire monorepo root
// causes spurious Fast Refresh ("Refreshing...") toasts on every unrelated change.
config.watchFolders = [
  ...(config.watchFolders || []),
  path.resolve(monorepoRoot, "packages/admin-graphql"),
]

// Resolve packages from the monorepo root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
]

// Apollo Client v4 can ship .cjs; ensure Metro resolves them
config.resolver.sourceExts.push("cjs")

// pnpm symlinks let Metro resolve a duplicate react from another workspace pkg;
// force every import to the single copy this app owns.
// Note: react-native resolves to react-native-tvos via the npm alias.
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
  // Exact match (e.g. "react") or deep import (e.g. "react/jsx-runtime")
  const isSingleton =
    singletonPkgs[moduleName] ||
    Object.keys(singletonPkgs).some((pkg) => moduleName.startsWith(pkg + "/"))

  if (isSingleton) {
    return resolveFromProjectRoot(context, moduleName, platform)
  }

  // Fall through to any prior resolver, or Metro's built-in default
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform)
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
