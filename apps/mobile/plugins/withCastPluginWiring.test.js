/**
 * The two cast plugins' EXPORTED entry points. The sibling suites cover only
 * the pure transforms, so deleting a `cfg.modResults.contents = …` assignment,
 * or the `withAndroidStyles(...)` call itself, failed zero tests while shipping
 * stock-coloured cast sheets from a green build.
 *
 * expo/config-plugins is mocked so each `with*` helper invokes its callback
 * synchronously, which is what lets the mod bodies run under jest at all.
 */

// The plugins/ eslint block supplies describe/expect/it; these two are not.
/* global jest, beforeEach */

const CALLS = []
// Expo hands each base mod its OWN modResults (styles.xml vs colors.xml), so
// the mock must too — sharing one object would feed styles.xml's mod the
// colours resource set and prove nothing about the real composition.
const FIXTURES = { styles: null, colors: null }

jest.mock("expo/config-plugins", () => ({
  withAppDelegate: (config, mod) => {
    CALLS.push("withAppDelegate")
    return mod(config)
  },
  withAndroidStyles: (config, mod) => {
    CALLS.push("withAndroidStyles")
    return mod({ ...config, modResults: FIXTURES.styles })
  },
  withAndroidColors: (config, mod) => {
    CALLS.push("withAndroidColors")
    return mod({ ...config, modResults: FIXTURES.colors })
  },
}))

const withCastUIStyle = require("./withCastUIStyle")
const withAndroidCastTheme = require("./withAndroidCastTheme")
const {
  addSwiftGoogleCastAppDelegateDidFinishLaunchingWithOptions,
} = require("react-native-google-cast/lib/commonjs/plugin/withIosGoogleCast")

const APP_DELEGATE = `internal import Expo
import React

@main
class AppDelegate: ExpoAppDelegate {
  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`
const INJECTED = addSwiftGoogleCastAppDelegateDidFinishLaunchingWithOptions(
  APP_DELEGATE,
  { expandedController: true },
).contents

const swiftConfig = () => ({
  modResults: { language: "swift", contents: INJECTED },
})

function stylesFixture() {
  return {
    resources: {
      style: [
        {
          $: {
            name: "AppTheme",
            parent: "Theme.AppCompat.DayNight.NoActionBar",
          },
          item: [{ $: { name: "colorPrimary" }, _: "@color/colorPrimary" }],
        },
      ],
    },
  }
}

beforeEach(() => {
  CALLS.length = 0
  FIXTURES.styles = stylesFixture()
  FIXTURES.colors = { resources: { color: [] } }
})

describe("withCastUIStyle entry point", () => {
  it("routes the AppDelegate mod through insertCastUIStyle", () => {
    const cfg = withCastUIStyle(swiftConfig())
    expect(CALLS).toEqual(["withAppDelegate"])
    // The assignment itself is the thing with no other coverage: without it the
    // transform runs, returns a styled string, and the result is discarded.
    expect(cfg.modResults.contents).toContain(
      withCastUIStyle.castUIStyleBeginMarker(),
    )
    expect(cfg.modResults.contents).toContain(
      "GCKUIStyle.sharedInstance().apply()",
    )
  })

  it("returns the same config object the mod received", () => {
    const input = swiftConfig()
    expect(withCastUIStyle(input)).toBe(input)
  })

  it("throws on a non-Swift AppDelegate instead of silently skipping", () => {
    expect(() =>
      withCastUIStyle({
        modResults: { language: "objc", contents: INJECTED },
      }),
    ).toThrow(/expected a Swift AppDelegate/)
  })

  it("propagates the vendor-drift throw from the transform", () => {
    expect(() =>
      withCastUIStyle({
        modResults: { language: "swift", contents: APP_DELEGATE },
      }),
    ).toThrow(/react-native-google-cast/)
  })
})

describe("withAndroidCastTheme entry point", () => {
  it("writes the colour resources through the colors mod", () => {
    withAndroidCastTheme({})
    expect(FIXTURES.colors.resources.color.map((c) => c.$.name)).toContain(
      "forge_cast_accent",
    )
  })

  it("wires mediaRouteTheme onto AppTheme through the styles mod", () => {
    withAndroidCastTheme({})
    const styles = FIXTURES.styles.resources.style
    const appTheme = styles.find((s) => s.$.name === "AppTheme")
    expect(appTheme.item.map((i) => i.$.name)).toContain("mediaRouteTheme")
    expect(styles.map((s) => s.$.name)).toContain("Theme.Forge.MediaRouter")
  })

  // Colours must be registered before styles: the styles reference
  // @color/forge_cast_* by name, so dropping the colours mod leaves dangling
  // references that only aapt2 would catch.
  it("registers both mods, colours first", () => {
    withAndroidCastTheme({})
    expect(CALLS).toEqual(["withAndroidColors", "withAndroidStyles"])
  })

  it("propagates the AppTheme-missing throw from the transform", () => {
    FIXTURES.styles.resources.style = []
    expect(() => withAndroidCastTheme({})).toThrow(/AppTheme not found/)
  })
})

// The fail-silent branch each plugin takes when expo/config-plugins cannot be
// resolved. Reviewed and kept as the repo's existing convention, but it had no
// coverage at all, so a change to it was invisible.
describe("unresolvable config-plugins", () => {
  it("both plugins return the config unchanged and warn", () => {
    jest.resetModules()
    jest.doMock("expo/config-plugins", () => {
      throw new Error("Cannot find module 'expo/config-plugins'")
    })
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const ios = require("./withCastUIStyle")
      const android = require("./withAndroidCastTheme")
      const iosCfg = { modResults: { language: "swift", contents: INJECTED } }
      const androidCfg = { modResults: { resources: {} } }

      expect(ios(iosCfg)).toBe(iosCfg)
      expect(android(androidCfg)).toBe(androidCfg)
      // Unchanged means UNSTYLED — this is the documented trade, pinned so a
      // change to the posture is a visible test change.
      expect(iosCfg.modResults.contents).toBe(INJECTED)
      expect(warn).toHaveBeenCalledTimes(2)
      expect(warn.mock.calls.flat().join(" ")).toMatch(/expo\/config-plugins/)
    } finally {
      warn.mockRestore()
      jest.dontMock("expo/config-plugins")
      jest.resetModules()
    }
  })
})
