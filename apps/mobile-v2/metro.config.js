const { getDefaultConfig } = require("expo/metro-config")
const path = require("path")

const projectRoot = __dirname
const monorepoRoot = path.resolve(projectRoot, "../..")

const config = getDefaultConfig(projectRoot)

// Watch the monorepo root for workspace package changes
config.watchFolders = [monorepoRoot]

// Resolve packages from the monorepo root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
]

// Apollo Client v4 can ship .cjs; ensure Metro resolves them
config.resolver.sourceExts.push("cjs")

module.exports = config
