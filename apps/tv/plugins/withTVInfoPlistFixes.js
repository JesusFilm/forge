const { withInfoPlist } = require("expo/config-plugins")

/**
 * @react-native-tvos/config-tv leaves `LSRequiresIPhoneOS: true` in the
 * generated Info.plist (its withTVInfoPlist only sets UIRequiredDeviceCapabilities).
 * That single key makes App Store Connect validate the tvOS binary as an iOS app,
 * triggering ITMS-90508 / ITMS-90545 / ITMS-90713 / ITMS-90039 on submission.
 * tvOS apps must NOT declare LSRequiresIPhoneOS — delete it.
 */
module.exports = function withTVInfoPlistFixes(config) {
  return withInfoPlist(config, (cfg) => {
    delete cfg.modResults.LSRequiresIPhoneOS
    return cfg
  })
}
