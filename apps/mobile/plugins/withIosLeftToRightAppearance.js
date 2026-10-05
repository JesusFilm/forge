// Loaded defensively: Expo config plugins are only resolvable in prebuild
// contexts. On resolution failure, no-op rather than crash Metro/jest.
let withAppDelegate = null
try {
  ;({ withAppDelegate } = require("expo/config-plugins"))
} catch {
  withAppDelegate = null
}

// Declaring ar, fa, or ur in CFBundleLocalizations mirrors UIKit containers
// outside React Native views (sheets, menus, alerts). KTD4 keeps them LTR from
// launch. UIView needs no import: the template already uses UIWindow.

const LEFT_TO_RIGHT_STATEMENT =
  "UIView.appearance().semanticContentAttribute = .forceLeftToRight"

const LINES = [
  "// plugins/withIosLeftToRightAppearance.js: the app keeps a left-to-right",
  "// layout in every language, so UIKit must not mirror it (R6).",
  LEFT_TO_RIGHT_STATEMENT,
]

// The declaration's opening brace, not the `super.application(...)` call.
const LAUNCH_METHOD =
  /func\s+application\(\s*_\s+application:\s*UIApplication,\s*didFinishLaunchingWithOptions\s+launchOptions:[^{]*\{[^\n]*\n/

/** Put the statement first in didFinishLaunching; throw on template drift. */
function insertLeftToRightAppearance(src) {
  if (src.includes(LEFT_TO_RIGHT_STATEMENT)) return src
  const match = LAUNCH_METHOD.exec(src)
  if (!match) {
    throw new Error(
      "[withIosLeftToRightAppearance] didFinishLaunchingWithOptions not found " +
        "in AppDelegate.swift. The Expo template changed; port the " +
        "left-to-right appearance line before building, or UIKit containers " +
        "mirror for Arabic, Farsi, and Urdu.",
    )
  }
  const bodyStart = match.index + match[0].length
  const indent = /^[ \t]*/.exec(src.slice(bodyStart))[0] || "    "
  const block = LINES.map((line) => indent + line + "\n").join("")
  return src.slice(0, bodyStart) + block + src.slice(bodyStart)
}

module.exports = function withIosLeftToRightAppearance(config) {
  if (!withAppDelegate) {
    console.warn(
      "[withIosLeftToRightAppearance] expo/config-plugins not resolvable; " +
        "skipping the UIKit left-to-right appearance. Run `pnpm install` so " +
        "apps/mobile has expo, then re-run `expo prebuild`.",
    )
    return config
  }
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== "swift") {
      throw new Error(
        "[withIosLeftToRightAppearance] expected a Swift AppDelegate, got " +
          `"${cfg.modResults.language}". The Expo template changed language; ` +
          "port the left-to-right appearance line before building.",
      )
    }
    cfg.modResults.contents = insertLeftToRightAppearance(
      cfg.modResults.contents,
    )
    return cfg
  })
}

// Exported for unit tests: the transform is pure, and a silent regression
// ships mirrored UIKit containers with CI green.
module.exports.insertLeftToRightAppearance = insertLeftToRightAppearance
module.exports.LEFT_TO_RIGHT_STATEMENT = LEFT_TO_RIGHT_STATEMENT
