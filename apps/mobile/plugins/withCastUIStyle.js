// Loaded defensively: Expo config plugins are only resolvable in prebuild
// contexts. On resolution failure, no-op rather than crash Metro/jest — the
// prebuilt ios/ AppDelegate is already patched.
let withAppDelegate = null
try {
  ;({ withAppDelegate } = require("expo/config-plugins"))
} catch {
  withAppDelegate = null
}

const { createHash } = require("crypto")

/**
 * react-native-google-cast presents the Cast SDK's own view controllers and
 * exposes no styling hook, so every cast sheet renders in Google's palette.
 * GCKUIStyle is the only lever; it is native-only, so it ships here.
 *
 * Two ordering facts make this plugin's position load-bearing:
 *
 *  1. GCKUIStyle.sharedInstance()'s dispatch_once block reads
 *     GCKCastContext.sharedInstance(), which raises an uncatchable ObjC
 *     exception when the context is unset. The injected block MUST therefore
 *     sit AFTER the vendor's GCKCastContext.setSharedInstanceWith(options).
 *  2. AppDelegate mods run in REVERSE plugins-array order (verified
 *     empirically against @expo/config-plugins 57.0.7). So this plugin is
 *     listed BEFORE "react-native-google-cast" in app.json — that is what
 *     makes it EXECUTE AFTER the vendor injection.
 *
 * Colors only, deliberately. -[GCKUIStyle contentSizeDidChange:] re-runs
 * initDefaultFonts then applyStyle, so a custom font is wiped the first time
 * the reader changes text size. Colors survive that path.
 *
 * Scope is every surface the SDK can present, including the mini controller
 * and the instructions overlay that no current screen reaches — an unstyled
 * surface would otherwise appear in Google's blue the day something mounts it.
 */

const ANCHOR = "GCKCastContext.setSharedInstanceWith(options)"

// A content HASH, not a bare sentinel. `expo prebuild` reuses an existing ios/
// rather than recreating it, so a name-only marker would make an edited block
// look already-applied and silently keep building the previous palette.
const MARKER_PREFIX =
  "// forge: cast views repainted (withCastUIStyle.js) sync-"
const MARKER_END = "// forge: end cast views repainted"

// Hex literals mirror src/lib/color.ts. `#CB333B` (ACCENT) measures ~3.4:1 on
// `#1c1917` — fine for fills, sliders and glyphs, below AA for normal text, so
// bare text buttons take ACCENT_ON_DARK instead.
const STYLE_BODY = [
  "func forgeCastColor(_ rgb: UInt32, _ alpha: CGFloat = 1) -> UIColor {",
  "  return UIColor(",
  "    red: CGFloat((rgb >> 16) & 0xFF) / 255.0,",
  "    green: CGFloat((rgb >> 8) & 0xFF) / 255.0,",
  "    blue: CGFloat(rgb & 0xFF) / 255.0,",
  "    alpha: alpha)",
  "}",
  "let forgeBackground = forgeCastColor(0x1C1917)",
  "let forgeBlack = forgeCastColor(0x000000)",
  "let forgeSurface = forgeCastColor(0x292524)",
  "let forgeTextPrimary = forgeCastColor(0xF5F5F4)",
  "let forgeTextSecondary = forgeCastColor(0xA8A29E)",
  "let forgeTextBody = forgeCastColor(0xD6D3D1)",
  "let forgeAccent = forgeCastColor(0xCB333B)",
  "let forgeAccentOnDark = forgeCastColor(0xE96067)",
  "let forgeTextOnOverlay = forgeCastColor(0xFFFFFF)",
  "let forgeTrack = forgeCastColor(0xFFFFFF, 0.30)",
  "let forgeTrackBuffered = forgeCastColor(0xFFFFFF, 0.35)",
  "let forgeTrackUnseekable = forgeCastColor(0xFFFFFF, 0.15)",
  "",
  "let forgeCastViews = GCKUIStyle.sharedInstance().castViews",
  "let forgeChooser = forgeCastViews.deviceControl.deviceChooser",
  "let forgeConnection = forgeCastViews.deviceControl.connectionController",
  "let forgeNoDevices = forgeCastViews.deviceControl.noDevicesAvailableController",
  "let forgeNavigation = forgeConnection.navigation",
  "let forgeToolbar = forgeConnection.toolbar",
  "let forgeExpanded = forgeCastViews.mediaControl.expandedController",
  "let forgeMini = forgeCastViews.mediaControl.miniController",
  "let forgeTracks = forgeCastViews.mediaControl.trackSelector",
  "let forgeInstructions = forgeCastViews.instructions",
  "",
  "// The root and the two group nodes are set too, so a surface this list does",
  "// not name still inherits the palette instead of Google's default.",
  "func forgeApplyCastBase(_ attributes: GCKUIStyleAttributes) {",
  "  attributes.backgroundColor = forgeBackground",
  "  attributes.headingTextColor = forgeTextPrimary",
  "  attributes.bodyTextColor = forgeTextPrimary",
  "  attributes.captionTextColor = forgeTextSecondary",
  "  attributes.iconTintColor = forgeTextSecondary",
  "  attributes.buttonTextColor = forgeAccentOnDark",
  "}",
  "for forgeAttributes in [",
  "  forgeCastViews,",
  "  forgeCastViews.deviceControl,",
  "  forgeCastViews.mediaControl,",
  "  forgeChooser,",
  "  forgeConnection,",
  "  forgeNoDevices,",
  "  forgeNavigation,",
  "  forgeToolbar,",
  "  forgeExpanded,",
  "  forgeMini,",
  "  forgeTracks,",
  "  forgeInstructions,",
  "] as [GCKUIStyleAttributes] {",
  "  forgeApplyCastBase(forgeAttributes)",
  "}",
  "",
  "// The nav subtree also owns the CHOOSER's title and Cancel button:",
  "// _styleAttributesForNavigation is captured once in viewDidLoad from the",
  "// connectionController and syncWithCastState never reassigns it.",
  "forgeNavigation.buttonTextColor = forgeTextSecondary",
  "forgeToolbar.buttonTextColor = forgeAccentOnDark",
  "",
  "// Empty-state copy is secondary text, not a heading.",
  "forgeNoDevices.bodyTextColor = forgeTextSecondary",
  "",
  "// The connected sheet's play/pause IS the primary action, so it keeps full",
  "// contrast; the chooser's row glyphs stay decorative at TEXT_SECONDARY.",
  "forgeConnection.iconTintColor = forgeTextPrimary",
  "",
  "// The expanded controls are a full-screen PLAYER, which is what the BLACK",
  "// token is for; the mini controller is a bar docked over content, so it",
  "// takes SURFACE_COLOR. Only the sheets use BG_COLOR.",
  "forgeExpanded.backgroundColor = forgeBlack",
  "forgeMini.backgroundColor = forgeSurface",
  "",
  "// Expanded-controller glyphs sit over artwork, so they stay pure white.",
  "forgeExpanded.bodyTextColor = forgeTextBody",
  "forgeExpanded.iconTintColor = forgeTextOnOverlay",
  "forgeMini.bodyTextColor = forgeTextBody",
  "",
  "for forgeVolumeHost in [forgeConnection, forgeExpanded, forgeMini]",
  "  as [GCKUIStyleAttributes] {",
  "  forgeVolumeHost.volumeSliderMinimumTrackTintColor = forgeAccent",
  "  forgeVolumeHost.volumeSliderMaximumTrackTintColor = forgeTrack",
  "  forgeVolumeHost.volumeSliderThumbTintColor = forgeAccent",
  "}",
  "for forgeSeekHost in [forgeExpanded, forgeMini] as [GCKUIStyleAttributes] {",
  "  forgeSeekHost.sliderProgressColor = forgeAccent",
  "  forgeSeekHost.sliderSecondaryProgressColor = forgeTrackBuffered",
  "  forgeSeekHost.sliderUnseekableProgressColor = forgeTrackUnseekable",
  "  forgeSeekHost.sliderTooltipBackgroundColor = forgeAccent",
  "  forgeSeekHost.liveIndicatorColor = forgeAccent",
  "}",
  "",
  "// Without this the attributes only reach views created afterwards.",
  "// `apply()`, NOT the header's `applyStyle` — Swift renames the selector, and",
  '// only a real compile catches it. Do not "correct" this back.',
  "GCKUIStyle.sharedInstance().apply()",
]

/** Short content hash of the emitted Swift — the whole point of the sentinel. */
function styleHash() {
  return createHash("sha1")
    .update(STYLE_BODY.join("\n"))
    .digest("hex")
    .slice(0, 12)
}

function beginMarker() {
  return MARKER_PREFIX + styleHash()
}

/** Remove a previously injected block, whatever hash it carries. */
function excisePreviousBlock(src, beginIdx) {
  const blockStart = src.lastIndexOf("\n", beginIdx) + 1
  const endIdx = src.indexOf(MARKER_END, beginIdx)
  if (endIdx === -1) {
    throw new Error(
      "[withCastUIStyle] found the block's begin marker but no end marker in " +
        "AppDelegate. The generated file was hand-edited or truncated; delete " +
        "ios/ and re-run `expo prebuild` rather than letting this plugin splice " +
        "a partial block.",
    )
  }
  const endLine = src.indexOf("\n", endIdx)
  const after = endLine === -1 ? src.length : endLine + 1
  return src.slice(0, blockStart) + src.slice(after)
}

/**
 * Insert the GCKUIStyle block after the vendor's setSharedInstanceWith line.
 * Throws on vendor drift — a missing anchor means the sheets silently keep
 * Google's palette, which is exactly the outcome this plugin exists to stop.
 */
function insertCastUIStyle(src) {
  const beginIdx = src.indexOf(MARKER_PREFIX)
  if (beginIdx !== -1) {
    // Matching hash: already current. Different hash: the emitted Swift
    // changed, so the stale block must be excised before the new one lands.
    if (src.includes(beginMarker())) return src
    src = excisePreviousBlock(src, beginIdx)
  }
  const anchorIdx = src.indexOf(ANCHOR)
  if (anchorIdx === -1) {
    throw new Error(
      "[withCastUIStyle] Swift GCKCastContext injection from " +
        "react-native-google-cast not found in AppDelegate. The vendor plugin " +
        "changed its injected code, no-opped (pnpm layout?), or ran after this " +
        "plugin — this plugin must sit BEFORE react-native-google-cast in " +
        "app.json plugins (mods run in reverse array order). Failing prebuild " +
        "instead of shipping unstyled cast sheets.",
    )
  }
  const lineStart = src.lastIndexOf("\n", anchorIdx) + 1
  const indent = src.slice(lineStart, anchorIdx)
  const lineEnd = src.indexOf("\n", anchorIdx)
  const insertAt = lineEnd === -1 ? src.length : lineEnd + 1
  const lines = [beginMarker(), ...STYLE_BODY, MARKER_END]
  const block =
    lines.map((line) => (line === "" ? "" : indent + line)).join("\n") + "\n"
  return src.slice(0, insertAt) + block + src.slice(insertAt)
}

module.exports = function withCastUIStyle(config) {
  if (!withAppDelegate) {
    console.warn(
      "[withCastUIStyle] expo/config-plugins not resolvable; skipping the " +
        "GCKUIStyle block. Run `pnpm install` so apps/mobile has expo, then " +
        "re-run `expo prebuild`.",
    )
    return config
  }
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== "swift") {
      throw new Error(
        "[withCastUIStyle] expected a Swift AppDelegate, got " +
          `"${cfg.modResults.language}". The Expo template changed language; ` +
          "port the GCKUIStyle block before building.",
      )
    }
    cfg.modResults.contents = insertCastUIStyle(cfg.modResults.contents)
    return cfg
  })
}

// Exported for unit tests — the transform is pure; a silent regression here
// ships cast sheets in Google's palette with CI green.
module.exports.insertCastUIStyle = insertCastUIStyle
module.exports.CAST_UI_STYLE_MARKER_PREFIX = MARKER_PREFIX
module.exports.CAST_UI_STYLE_MARKER_END = MARKER_END
module.exports.castUIStyleBeginMarker = beginMarker
