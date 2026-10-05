// Runs the REAL expo/config-plugins chain and the REAL expo-localization
// plugin, so the mod order and the pinned line shape are both real.
const path = require("path")
const { withPlugins } = require("expo/config-plugins")
const withExpoLocalization = require("expo-localization/app.plugin").default

const withoutAndroidResourceConfigurations = require("./withoutAndroidResourceConfigurations")
const { removeResourceConfigurations } = withoutAndroidResourceConfigurations

// The `android {}` block of the Expo SDK 57 app/build.gradle, verbatim from
// this repo's `expo prebuild` output (2026-09-10). Re-capture on every SDK bump.
const BUILD_GRADLE = `android {
    ndkVersion rootProject.ext.ndkVersion

    buildToolsVersion rootProject.ext.buildToolsVersion
    compileSdk rootProject.ext.compileSdkVersion

    namespace 'org.jesusfilm.forgewatch'
    defaultConfig {
        applicationId 'org.jesusfilm.forgewatch'
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode 1
        versionName "1.0.0"

        buildConfigField "String", "REACT_NATIVE_RELEASE_LEVEL", "\\"\${findProperty('reactNativeReleaseLevel') ?: 'stable'}\\""
    }
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    androidResources {
        ignoreAssetsPattern '!.svn:!.git:!.ds_store:!*.scc:!CVS:!thumbs.db:!picasa.ini:!*~'
    }
}
`

const LOCALES = ["ab", "en", "zh-Hans"]

// The exact line expo-localization 57.0.2 writes for LOCALES, at the end of
// defaultConfig. A package bump that changes it fails the pin test below.
const PINNED_LINE =
  '        resourceConfigurations += ["b+ab", "b+en", "b+zh+Hans"]'
const DEFAULT_CONFIG_END = "\n    }\n    signingConfigs {"
const WITH_FILTER = BUILD_GRADLE.replace(
  DEFAULT_CONFIG_END,
  `\n${PINNED_LINE}${DEFAULT_CONFIG_END}`,
)

const LOCALIZATION = [withExpoLocalization, { supportedLocales: LOCALES }]

/** Registers the plugins in array order, then runs the build.gradle mods. */
async function runGradleMods(
  plugins,
  contents = BUILD_GRADLE,
  language = "groovy",
) {
  const projectRoot = path.join(__dirname, "..")
  const config = withPlugins(
    { name: "forge-watch", slug: "fixture", _internal: { projectRoot } },
    plugins,
  )
  const result = await config.mods.android.appBuildGradle({
    ...config,
    modRequest: {
      platform: "android",
      modName: "appBuildGradle",
      projectRoot,
      platformProjectRoot: path.join(projectRoot, "android"),
    },
    modResults: { language, contents },
  })
  return result.modResults.contents
}

describe("expo-localization's build.gradle line (the pin)", () => {
  it("is exactly the pinned resourceConfigurations line in defaultConfig", async () => {
    expect(BUILD_GRADLE).toContain(DEFAULT_CONFIG_END)
    expect(await runGradleMods([LOCALIZATION])).toBe(WITH_FILTER)
  })
})

describe("withoutAndroidResourceConfigurations in the real mod chain", () => {
  it("restores build.gradle byte for byte when listed before expo-localization", async () => {
    const plugins = [withoutAndroidResourceConfigurations, LOCALIZATION]
    expect(await runGradleMods(plugins)).toBe(BUILD_GRADLE)
  })

  it("leaves the filter when listed after expo-localization (negative control)", async () => {
    const plugins = [LOCALIZATION, withoutAndroidResourceConfigurations]
    expect(await runGradleMods(plugins)).toBe(WITH_FILTER)
  })

  it("leaves a Kotlin build script alone", async () => {
    const plugins = [withoutAndroidResourceConfigurations]
    expect(await runGradleMods(plugins, WITH_FILTER, "kt")).toBe(WITH_FILTER)
  })
})

describe("removeResourceConfigurations", () => {
  it("removes every copy that a reused android/ folder collected", () => {
    const twice = WITH_FILTER.replace(
      PINNED_LINE,
      `${PINNED_LINE}\n${PINNED_LINE}`,
    )
    expect(removeResourceConfigurations(twice)).toBe(BUILD_GRADLE)
  })

  it.each([
    ['        resourceConfigurations += ["en", "fr"]'],
    ['        resourceConfigurations "b+en"'],
    ["        androidResources.localeFilters += ['en']"],
  ])("keeps a line expo-localization did not write: %s", (line) => {
    const src = BUILD_GRADLE.replace(
      DEFAULT_CONFIG_END,
      `\n${line}${DEFAULT_CONFIG_END}`,
    )
    expect(removeResourceConfigurations(src)).toBe(src)
  })
})
