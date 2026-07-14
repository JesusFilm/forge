/* global require, module */
/* eslint-disable @typescript-eslint/no-require-imports */
const { getDefaultConfig } = require("expo/metro-config")
const path = require("path")

const projectRoot = __dirname
const monorepoRoot = path.resolve(projectRoot, "../..")

const config = getDefaultConfig(projectRoot)

// Watch the monorepo root for workspace package changes,
// preserving Expo's default watchFolders (required by expo-doctor).
config.watchFolders = [...(config.watchFolders || []), monorepoRoot]

// Resolve packages from the monorepo root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
]

// Apollo Client v4 can ship .cjs; ensure Metro resolves them
config.resolver.sourceExts.push("cjs")

// pnpm symlinks let Metro resolve duplicate react copies via .pnpm; force these
// to the single copy mobile owns. Paths feed extraNodeModules; keys also drive
// the custom resolveRequest below.
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
