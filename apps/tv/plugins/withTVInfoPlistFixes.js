/* global require, module */
/* eslint-disable @typescript-eslint/no-require-imports */
const { withInfoPlist } = require("expo/config-plugins")

/**
 * config-tv leaves `LSRequiresIPhoneOS: true` in the Info.plist; tvOS apps must not declare it, so delete it (hygiene only).
 * NOT the cause of the ITMS-90508/90545/90713/90039 rejections, which come from `eas submit` typing the tvOS binary as iOS;
 * submit via `xcrun altool -t appletvos`, see DISTRIBUTION.md.
 *
 * Also strips the `NSAllowsLocalNetworking` ATS exception unless a build explicitly
 * opts in with `EXPO_TV_ALLOW_LOCAL_NETWORKING=1`. That exception exists only so a dev
 * build can reach Metro or a local admin over plain http; a store build has no use for
 * it. Gating is opt-IN rather than opt-out on purpose — the default path is the shipped
 * one, so forgetting the flag degrades a laptop, never a release. It is not an
 * arbitrary-loads exception and was never a review failure; this is hygiene, and it
 * keeps the shipped ATS posture honest about what the app actually needs.
 */
module.exports = function withTVInfoPlistFixes(config) {
  return withInfoPlist(config, (cfg) => {
    delete cfg.modResults.LSRequiresIPhoneOS

    if (process.env.EXPO_TV_ALLOW_LOCAL_NETWORKING !== "1") {
      const ats = cfg.modResults.NSAppTransportSecurity
      if (ats && typeof ats === "object") {
        delete ats.NSAllowsLocalNetworking
        // Drop the dictionary entirely once it carries no exceptions, rather than
        // shipping an empty NSAppTransportSecurity that implies a deliberate posture.
        if (Object.keys(ats).length === 0) {
          delete cfg.modResults.NSAppTransportSecurity
        }
      }
    }

    return cfg
  })
}
