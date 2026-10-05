// Plain JS (like the other guard suites): the RN tsconfig has no Node types,
// and this guard needs fs/path to read the config.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global afterEach, describe, expect, it, jest, require */
const fs = require("fs")
const path = require("path")
const { act, createElement } = require("react")

const withExpoLocalization = require("expo-localization/app.plugin").default
const { TestRenderer, unmount } = require("../../src/test-utils/rnTestRenderer")
const { resolveLocale } = require("../../src/i18n/resolveLocale")
const { CATALOG_TAGS } = require("../../src/i18n/catalogs.generated")

// Guard (KTD4): the platform offers the per-app language on iOS and Android,
// and it never mirrors the app for a right-to-left phone (R6).
const MOBILE_DIR = path.join(__dirname, "..", "..")
const APP_JSON = path.join(MOBILE_DIR, "app.json")
const NATIVE_LOCALES = path.join(MOBILE_DIR, "i18n", "native-locales.json")
const MOBILE_MESSAGES = path.join(MOBILE_DIR, "messages")
const WEB_MESSAGES = path.join(MOBILE_DIR, "..", "web", "messages")

const LOCALIZATION_PLUGIN = "expo-localization"
const LTR_PLUGIN = "./plugins/withIosLeftToRightAppearance"
const GRADLE_PLUGIN = "./plugins/withoutAndroidResourceConfigurations"

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"))
const clone = (value) => JSON.parse(JSON.stringify(value))
const catalogTags = (dir) =>
  fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))

const expo = () => readJson(APP_JSON).expo
const nativeLocales = () => readJson(NATIVE_LOCALES)

/** Each plugins-array entry with this name, and its position. */
function pluginEntries(config, name) {
  return (config.plugins ?? [])
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => (Array.isArray(entry) ? entry[0] : entry) === name)
}

function localizationOptions(config) {
  const [found] = pluginEntries(config, LOCALIZATION_PLUGIN)
  return Array.isArray(found?.entry) ? (found.entry[1] ?? {}) : {}
}

// The plugin's own rule: an array serves both platforms, and an object gives
// each platform its own list.
function localesFor(supportedLocales, platform) {
  const perPlatform =
    typeof supportedLocales === "object" &&
    supportedLocales !== null &&
    !Array.isArray(supportedLocales)
  return perPlatform ? supportedLocales[platform] : supportedLocales
}

/** Every rule on the config; an empty list means the config is correct. */
function localizationProblems(config, declared) {
  const entries = pluginEntries(config, LOCALIZATION_PLUGIN)
  if (entries.length !== 1) {
    return [
      `expected one ${LOCALIZATION_PLUGIN} entry, found ${entries.length}`,
    ]
  }
  const problems = []
  const options = localizationOptions(config)
  if (options.supportsRTL !== false) problems.push("supportsRTL must be false")
  // The plugin writes forcesRTL for any non-null value, from its options or
  // from expo.extra. iOS then forces right-to-left on a right-to-left phone.
  if ("forcesRTL" in options) problems.push("remove forcesRTL from the plugin")
  if ("forcesRTL" in (config.extra ?? {})) {
    problems.push("remove forcesRTL from expo.extra")
  }
  if ("ExpoLocalization_forcesRTL" in (config.ios?.infoPlist ?? {})) {
    problems.push("remove ExpoLocalization_forcesRTL from ios.infoPlist")
  }
  if (options.allowDynamicLocaleChangesAndroid !== true) {
    problems.push("allowDynamicLocaleChangesAndroid must be true")
  }
  for (const platform of ["ios", "android"]) {
    const list = localesFor(options.supportedLocales, platform)
    if (JSON.stringify(list) !== JSON.stringify(declared)) {
      problems.push(`${platform} supportedLocales must equal native-locales`)
    }
  }
  if (config.ios?.infoPlist?.UIPrefersShowingLanguageSettings !== true) {
    problems.push("ios.infoPlist.UIPrefersShowingLanguageSettings must be true")
  }
  const ltr = pluginEntries(config, LTR_PLUGIN)
  if (ltr.length !== 1) {
    problems.push(`expected one ${LTR_PLUGIN} entry, found ${ltr.length}`)
  } else if (ltr[0].index < entries[0].index) {
    problems.push(`register ${LTR_PLUGIN} after ${LOCALIZATION_PLUGIN}`)
  }
  // Mods run last-registered first, so the gradle plugin must come BEFORE
  // expo-localization to strip the resourceConfigurations line it appends.
  const gradle = pluginEntries(config, GRADLE_PLUGIN)
  if (gradle.length !== 1) {
    problems.push(`expected one ${GRADLE_PLUGIN} entry, found ${gradle.length}`)
  } else if (gradle[0].index > entries[0].index) {
    problems.push(`register ${GRADLE_PLUGIN} before ${LOCALIZATION_PLUGIN}`)
  }
  return problems
}

/** The Info.plist keys that the installed plugin writes for a config. */
function pluginInfoPlist(config) {
  // expo-cli supplies `_internal`; the plugin's withPlugins asserts it.
  const copy = { ...clone(config), _internal: { projectRoot: MOBILE_DIR } }
  return withExpoLocalization(copy, localizationOptions(copy)).ios.infoPlist
}

/** A copy of the config with new plugin options. */
function withOptions(config, change) {
  const copy = clone(config)
  const { index } = pluginEntries(copy, LOCALIZATION_PLUGIN)[0]
  copy.plugins[index] = [LOCALIZATION_PLUGIN, change(copy.plugins[index][1])]
  return copy
}

describe("expo-localization plugin options (KTD4)", () => {
  it("holds every rule in app.json", () => {
    expect(localizationProblems(expo(), nativeLocales())).toEqual([])
  })

  it.each([
    ["forcesRTL", false, "remove forcesRTL from the plugin"],
    ["forcesRTL", true, "remove forcesRTL from the plugin"],
    ["forcesRTL", null, "remove forcesRTL from the plugin"],
    ["supportsRTL", true, "supportsRTL must be false"],
    ["supportsRTL", undefined, "supportsRTL must be false"],
    [
      "allowDynamicLocaleChangesAndroid",
      false,
      "allowDynamicLocaleChangesAndroid must be true",
    ],
    [
      "allowDynamicLocaleChangesAndroid",
      undefined,
      "allowDynamicLocaleChangesAndroid must be true",
    ],
  ])("rejects %s set to %s (negative control)", (key, value, problem) => {
    const config = withOptions(expo(), (o) => ({ ...o, [key]: value }))
    expect(localizationProblems(config, nativeLocales())).toEqual([problem])
  })

  it("rejects a forcesRTL key in expo.extra or ios.infoPlist", () => {
    const config = clone(expo())
    config.extra = { ...config.extra, forcesRTL: false }
    config.ios.infoPlist.ExpoLocalization_forcesRTL = false
    expect(localizationProblems(config, nativeLocales())).toEqual([
      "remove forcesRTL from expo.extra",
      "remove ExpoLocalization_forcesRTL from ios.infoPlist",
    ])
  })

  it("rejects a missing UIPrefersShowingLanguageSettings (negative control)", () => {
    const config = clone(expo())
    delete config.ios.infoPlist.UIPrefersShowingLanguageSettings
    expect(localizationProblems(config, nativeLocales())).toEqual([
      "ios.infoPlist.UIPrefersShowingLanguageSettings must be true",
    ])
  })

  it("rejects a left-to-right plugin registered before expo-localization", () => {
    const config = clone(expo())
    const ltr = pluginEntries(config, LTR_PLUGIN)[0]
    config.plugins.splice(ltr.index, 1)
    config.plugins.unshift(LTR_PLUGIN)
    expect(localizationProblems(config, nativeLocales())).toEqual([
      `register ${LTR_PLUGIN} after ${LOCALIZATION_PLUGIN}`,
    ])
  })

  it("rejects the gradle plugin registered after expo-localization", () => {
    const config = clone(expo())
    const gradle = pluginEntries(config, GRADLE_PLUGIN)[0]
    config.plugins.splice(gradle.index, 1)
    config.plugins.push(GRADLE_PLUGIN)
    expect(localizationProblems(config, nativeLocales())).toEqual([
      `register ${GRADLE_PLUGIN} before ${LOCALIZATION_PLUGIN}`,
    ])
  })

  it("rejects a missing gradle plugin (negative control)", () => {
    const config = clone(expo())
    config.plugins.splice(pluginEntries(config, GRADLE_PLUGIN)[0].index, 1)
    expect(localizationProblems(config, nativeLocales())).toEqual([
      `expected one ${GRADLE_PLUGIN} entry, found 0`,
    ])
  })

  // The two tests below read the installed plugin's output, which is what the
  // native module reads at launch, not the options that feed it.
  it("makes the installed plugin write the left-to-right Info.plist keys", () => {
    const plist = pluginInfoPlist(expo())
    expect(plist.ExpoLocalization_supportsRTL).toBe(false)
    expect("ExpoLocalization_forcesRTL" in plist).toBe(false)
    expect(plist.CFBundleLocalizations).toEqual(nativeLocales())
  })

  it("sees the installed plugin write forcesRTL: false (the premise)", () => {
    const config = withOptions(expo(), (o) => ({ ...o, forcesRTL: false }))
    expect(pluginInfoPlist(config).ExpoLocalization_forcesRTL).toBe(false)
  })
})

describe("declared native locales (R5)", () => {
  it("lists unique catalog tags in code-point order, en included", () => {
    const declared = nativeLocales()
    expect(declared).toEqual([...new Set(declared)].sort())
    expect(declared).toContain("en")
  })

  it("spells every tag as a web catalog file does", () => {
    const web = new Set(catalogTags(WEB_MESSAGES))
    expect(nativeLocales().filter((tag) => !web.has(tag))).toEqual([])
  })

  it("passes the plugin's own BCP-47 check on every tag", () => {
    const invalid = nativeLocales().filter((tag) => {
      try {
        return !new Intl.Locale(tag)
      } catch {
        return true
      }
    })
    expect(invalid).toEqual([])
  })

  it.each(["ios", "android"])(
    "rejects a %s list that drifts from native-locales (negative control)",
    (platform) => {
      const declared = nativeLocales()
      const config = withOptions(expo(), (o) => ({
        ...o,
        supportedLocales: { ios: declared, android: declared },
      }))
      expect(localizationProblems(config, declared)).toEqual([])
      localizationOptions(config).supportedLocales[platform] = declared.slice(1)
      expect(localizationProblems(config, declared)).toEqual([
        `${platform} supportedLocales must equal native-locales`,
      ])
    },
  )

  it("does not fail when the list lags web's catalogs", () => {
    const declared = nativeLocales()
    const lagging = declared.filter((tag) => tag !== "zu")
    // Not vacuous: web still ships the dropped catalog.
    expect(catalogTags(WEB_MESSAGES)).toContain("zu")
    expect(lagging).toHaveLength(declared.length - 1)
    const config = withOptions(expo(), (o) => ({
      ...o,
      supportedLocales: lagging,
    }))
    expect(localizationProblems(config, lagging)).toEqual([])
  })

  it("resolves a declared locale with no mobile catalog to a shipped one", () => {
    const shipped = new Set(catalogTags(MOBILE_MESSAGES))
    const missing = nativeLocales().filter((tag) => !shipped.has(tag))
    for (const tag of missing) {
      const { tag: resolved } = resolveLocale([tag], CATALOG_TAGS)
      expect(resolved).not.toBe(tag)
      expect(CATALOG_TAGS).toContain(resolved)
      const language = tag.split("-")[0]
      const sameLanguage = CATALOG_TAGS.some(
        (catalog) => catalog.split("-")[0] === language,
      )
      if (!sameLanguage) expect(resolved).toBe("en")
    }
  })
})

// The `mock` prefix is required: babel-plugin-jest-hoist lifts jest.mock above
// this declaration and rejects any other out-of-scope name in the factory.
const mockNativeTabsProps = { current: undefined }

jest.mock("expo-router/unstable-native-tabs", () => {
  const Trigger = Object.assign(() => null, {
    Icon: () => null,
    Label: () => null,
  })
  return {
    NativeTabs: Object.assign(
      (props) => {
        mockNativeTabsProps.current = props
        return props.children
      },
      { Trigger },
    ),
  }
})
jest.mock("../../src/lib/explore/availability", () => ({
  isExploreAvailable: () => true,
}))

// The iOS host reads `direction` at the top level of `unstable_nativeProps`.
// An `ios` slice or a trigger's own native props never reaches the tab bar.
const forcesLeftToRight = (props) =>
  props?.unstable_nativeProps?.direction === "ltr"

describe("iOS native tab bar direction (R6)", () => {
  afterEach(() => {
    mockNativeTabsProps.current = undefined
  })

  it.each([
    ["no native props", {}],
    ["an empty native props object", { unstable_nativeProps: {} }],
    ["rtl", { unstable_nativeProps: { direction: "rtl" } }],
    ["inherit", { unstable_nativeProps: { direction: "inherit" } }],
    ["an ios slice", { unstable_nativeProps: { ios: { direction: "ltr" } } }],
    ["a top-level direction", { direction: "ltr" }],
  ])("rejects %s (negative control)", (_, props) => {
    expect(forcesLeftToRight(props)).toBe(false)
  })

  it("passes direction ltr to NativeTabs in _layout.ios.tsx", async () => {
    const IosTabLayout = require("../(tabs)/_layout.ios.tsx").default
    let renderer
    await act(async () => {
      renderer = TestRenderer.create(createElement(IosTabLayout))
    })
    await unmount(renderer)
    expect(mockNativeTabsProps.current).toBeDefined()
    expect(forcesLeftToRight(mockNativeTabsProps.current)).toBe(true)
  })
})
