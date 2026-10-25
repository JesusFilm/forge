// Loaded defensively, like the other plugins: config plugins resolve only in
// prebuild contexts, so a failed require is a no-op, not a Metro/jest crash.
let withStringsXml = null
try {
  ;({ withStringsXml } = require("expo/config-plugins"))
} catch {
  withStringsXml = null
}

/**
 * The name people see: under the launcher icon and on every notification. iOS
 * takes the same value from `ios.infoPlist.CFBundleDisplayName` in app.json.
 */
const DISPLAY_NAME = "Jesus Film Watch"

/**
 * Sets Android's `app_name` string. `expo.name` stays "forge-watch", because it
 * also names the generated native projects (`ios/forgewatch`), which docs and
 * local build recipes depend on.
 */
function setAppName(stringsXml, name) {
  const resources = stringsXml.resources ?? (stringsXml.resources = {})
  const strings = resources.string ?? (resources.string = [])
  const existing = strings.find((item) => item.$ && item.$.name === "app_name")
  if (existing) {
    existing._ = name
  } else {
    strings.push({ $: { name: "app_name" }, _: name })
  }
  return stringsXml
}

// Expo's own name mod writes `app_name` from `expo.name`. It is registered
// after app.json's plugins, and mods run last-registered-first, so this runs
// after it and wins.
function withAndroidAppName(config) {
  if (!withStringsXml) return config
  return withStringsXml(config, (cfg) => {
    cfg.modResults = setAppName(cfg.modResults, DISPLAY_NAME)
    return cfg
  })
}

module.exports = withAndroidAppName
module.exports.setAppName = setAppName
module.exports.DISPLAY_NAME = DISPLAY_NAME
