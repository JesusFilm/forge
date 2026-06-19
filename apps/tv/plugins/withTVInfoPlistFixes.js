const { withInfoPlist } = require("expo/config-plugins")

/**
 * @react-native-tvos/config-tv leaves `LSRequiresIPhoneOS: true` in the
 * generated Info.plist (its withTVInfoPlist only sets UIRequiredDeviceCapabilities).
 * tvOS apps must NOT declare LSRequiresIPhoneOS — delete it for correct tvOS hygiene.
 *
 * NOTE: this is hygiene, NOT the cause of the ITMS-90508/90545/90713/90039 submission
 * rejections. Those come from `eas submit` delivering the tvOS binary typed as iOS;
 * submit via `xcrun altool -t appletvos` instead (see apps/tv/DISTRIBUTION.md).
 */
module.exports = function withTVInfoPlistFixes(config) {
  return withInfoPlist(config, (cfg) => {
    delete cfg.modResults.LSRequiresIPhoneOS
    return cfg
  })
}
