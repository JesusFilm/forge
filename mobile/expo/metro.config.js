const { getDefaultConfig } = require("expo/metro-config")

const config = getDefaultConfig(__dirname)
// Apollo Client v4 can ship .cjs; ensure Metro resolves them (Expo/Metro compatibility).
config.resolver.sourceExts.push("cjs")

module.exports = config
