/* global require, module */
/* eslint-disable @typescript-eslint/no-require-imports */
const { withInfoPlist } = require("expo/config-plugins")

/**
 * config-tv leaves `LSRequiresIPhoneOS: true` in the Info.plist; tvOS apps must
 * not declare it, so delete it (hygiene only — NOT the cause of the
 * ITMS-90508/90545/90713/90039 rejections, which come from `eas submit` typing
 * the tvOS binary as iOS; submit via `xcrun altool -t appletvos`, see DISTRIBUTION.md).
 */
module.exports = function withTVInfoPlistFixes(config) {
  return withInfoPlist(config, (cfg) => {
    delete cfg.modResults.LSRequiresIPhoneOS
    return cfg
  })
}
