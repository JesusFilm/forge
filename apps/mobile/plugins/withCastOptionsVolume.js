// Loaded defensively: Expo config plugins are only resolvable in prebuild
// contexts. On resolution failure, no-op rather than crash Metro/jest — the
// prebuilt ios/ AppDelegate is already patched.
let withAppDelegate = null
try {
  ;({ withAppDelegate } = require("expo/config-plugins"))
} catch {
  withAppDelegate = null
}

/**
 * react-native-google-cast's plugin builds GCKCastOptions in AppDelegate but
 * exposes no option for physicalVolumeButtonsWillControlDeviceVolume (KTD8:
 * iOS hardware volume must route to the TV). This amends the injected block.
 *
 * AppDelegate mods run in REVERSE plugins-array order (verified empirically
 * against @expo/config-plugins 57.0.7: the later array entry's action runs
 * first). So this plugin is listed BEFORE "react-native-google-cast" in
 * app.json — that is what makes it EXECUTE AFTER the vendor injection.
 */

const FLAG_LINE = "options.physicalVolumeButtonsWillControlDeviceVolume = true"
const ANCHOR = "GCKCastContext.setSharedInstanceWith(options)"

/** Insert the volume flag before setSharedInstanceWith; throw on vendor drift. */
function insertVolumeFlag(src) {
  if (src.includes("physicalVolumeButtonsWillControlDeviceVolume")) return src
  const anchorIdx = src.indexOf(ANCHOR)
  if (anchorIdx === -1) {
    throw new Error(
      "[withCastOptionsVolume] Swift GCKCastOptions injection from " +
        "react-native-google-cast not found in AppDelegate. The vendor plugin " +
        "changed its injected code, no-opped (pnpm layout?), or ran after this " +
        "plugin — this plugin must sit BEFORE react-native-google-cast in " +
        "app.json plugins (mods run in reverse array order). Failing prebuild " +
        "instead of silently dropping hardware-volume support.",
    )
  }
  const lineStart = src.lastIndexOf("\n", anchorIdx) + 1
  const indent = src.slice(lineStart, anchorIdx)
  return (
    src.slice(0, lineStart) + indent + FLAG_LINE + "\n" + src.slice(lineStart)
  )
}

module.exports = function withCastOptionsVolume(config) {
  if (!withAppDelegate) {
    console.warn(
      "[withCastOptionsVolume] expo/config-plugins not resolvable; skipping " +
        "GCKCastOptions volume amendment. Run `pnpm install` so apps/mobile " +
        "has expo, then re-run `expo prebuild`.",
    )
    return config
  }
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== "swift") {
      throw new Error(
        "[withCastOptionsVolume] expected a Swift AppDelegate, got " +
          `"${cfg.modResults.language}". The Expo template changed language; ` +
          "port the GCKCastOptions volume amendment before building.",
      )
    }
    cfg.modResults.contents = insertVolumeFlag(cfg.modResults.contents)
    return cfg
  })
}

// Exported for unit tests — the transform is pure; a silent regression here
// drops hardware-volume routing to the TV with CI green.
module.exports.insertVolumeFlag = insertVolumeFlag
