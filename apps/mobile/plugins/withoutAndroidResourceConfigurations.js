// Loaded defensively: Expo config plugins are only resolvable in prebuild
// contexts. On resolution failure, no-op rather than crash Metro/jest.
let withAppBuildGradle = null
try {
  ;({ withAppBuildGradle } = require("expo/config-plugins"))
} catch {
  withAppBuildGradle = null
}

// expo-localization's supportedLocales also appends a resourceConfigurations
// filter, which drops library strings kept under region and legacy folders
// (zh-rCN, pt-rBR, in, iw). Per-app language needs only locales_config.xml.

// The exact line that expo-localization 57.0.2 appends inside defaultConfig:
// `resourceConfigurations += ["b+ab", "b+zh+Hans"]`, every entry a b+ qualifier.
const EXPO_LOCALIZATION_LINE =
  /^[ \t]*resourceConfigurations \+= \["b\+[^"\n]+"(?:, "b\+[^"\n]+")*\][ \t]*\n/gm

/** Remove every copy of that line; a no-op when it is absent. */
function removeResourceConfigurations(src) {
  return src.replace(EXPO_LOCALIZATION_LINE, "")
}

// Register BEFORE expo-localization in app.json: mods run last-registered
// first, so an earlier entry sees the build.gradle that expo-localization wrote.
// Verified 2026-09-30, expo-localization 57.0.2: `expo prebuild --platform android`.
module.exports = function withoutAndroidResourceConfigurations(config) {
  if (!withAppBuildGradle) {
    console.warn(
      "[withoutAndroidResourceConfigurations] expo/config-plugins not " +
        "resolvable; skipping. Run `pnpm install` so apps/mobile has expo, " +
        "then re-run `expo prebuild`.",
    )
    return config
  }
  return withAppBuildGradle(config, (cfg) => {
    // expo-localization writes the filter into a Groovy script only.
    if (cfg.modResults.language !== "groovy") return cfg
    cfg.modResults.contents = removeResourceConfigurations(
      cfg.modResults.contents,
    )
    return cfg
  })
}

// Exported for unit tests: a silent regression re-enables the filter, and
// the Cast and AndroidX strings fall back to English with CI green.
module.exports.removeResourceConfigurations = removeResourceConfigurations
