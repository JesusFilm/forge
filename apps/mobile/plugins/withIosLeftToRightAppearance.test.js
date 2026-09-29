// expo/config-plugins is mocked so `withAppDelegate` runs its mod at once,
// which lets the exported entry point run under jest.
/* global jest */

const mockCalls = []
jest.mock("expo/config-plugins", () => ({
  withAppDelegate: (config, mod) => {
    mockCalls.push("withAppDelegate")
    return mod(config)
  },
}))

const withIosLeftToRightAppearance = require("./withIosLeftToRightAppearance")
const { insertLeftToRightAppearance, LEFT_TO_RIGHT_STATEMENT } =
  withIosLeftToRightAppearance
const {
  addSwiftGoogleCastAppDelegateDidFinishLaunchingWithOptions,
} = require("react-native-google-cast/lib/commonjs/plugin/withIosGoogleCast")

// The Expo SDK 57 AppDelegate.swift, as pinned verbatim in
// withBackgroundDownloaderAppDelegate.test.js. Re-capture on every SDK bump.
const APP_DELEGATE = `internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
`

const count = (src, needle) => src.split(needle).length - 1
const castInjected = (src) =>
  addSwiftGoogleCastAppDelegateDidFinishLaunchingWithOptions(src, {
    expandedController: true,
  }).contents

/** Index of the body of `didFinishLaunchingWithOptions`, and its end. */
function launchBody(src) {
  const start = src.indexOf("didFinishLaunchingWithOptions launchOptions")
  const end = src.indexOf("return super.application(application, didFinish")
  return { start, end }
}

const swiftConfig = (contents) => ({
  modResults: { language: "swift", contents },
})

describe("insertLeftToRightAppearance", () => {
  it("sets the appearance inside didFinishLaunching, before React starts", () => {
    const out = insertLeftToRightAppearance(APP_DELEGATE)
    const at = out.indexOf(LEFT_TO_RIGHT_STATEMENT)
    const { start, end } = launchBody(out)
    expect(at).toBeGreaterThan(start)
    expect(at).toBeLessThan(end)
    expect(at).toBeLessThan(out.indexOf("let delegate = ReactNativeDelegate()"))
    expect(at).toBeLessThan(out.indexOf("factory.startReactNative("))
  })

  it("keeps the rest of the file byte-identical", () => {
    const out = insertLeftToRightAppearance(APP_DELEGATE)
    const lines = out.split("\n")
    const added = lines.filter((line) => !APP_DELEGATE.includes(line))
    expect(added.map((line) => line.trim())).toContain(LEFT_TO_RIGHT_STATEMENT)
    expect(lines.filter((line) => !added.includes(line)).join("\n")).toBe(
      APP_DELEGATE,
    )
  })

  it("is idempotent: two passes leave the statement once", () => {
    const once = insertLeftToRightAppearance(APP_DELEGATE)
    const twice = insertLeftToRightAppearance(once)
    expect(twice).toBe(once)
    expect(count(twice, LEFT_TO_RIGHT_STATEMENT)).toBe(1)
  })

  it.each([
    ["before", (src) => castInjected(insertLeftToRightAppearance(src))],
    ["after", (src) => insertLeftToRightAppearance(castInjected(src))],
  ])("stays ahead of the Google Cast block when Cast runs %s it", (_, run) => {
    const out = run(run(APP_DELEGATE))
    expect(count(out, LEFT_TO_RIGHT_STATEMENT)).toBe(1)
    expect(count(out, "GCKCastContext.setSharedInstanceWith")).toBe(1)
    expect(out.indexOf(LEFT_TO_RIGHT_STATEMENT)).toBeLessThan(
      out.indexOf("GCKCastContext.setSharedInstanceWith"),
    )
  })

  it("throws when the template has no didFinishLaunching (negative control)", () => {
    const drifted = APP_DELEGATE.replace(
      "didFinishLaunchingWithOptions launchOptions",
      "willFinishLaunchingWithOptions launchOptions",
    )
    expect(() => insertLeftToRightAppearance(drifted)).toThrow(
      /withIosLeftToRightAppearance/,
    )
  })
})

describe("withIosLeftToRightAppearance (exported entry point)", () => {
  it("writes the statement into AppDelegate.swift once after two passes", () => {
    mockCalls.length = 0
    const first = withIosLeftToRightAppearance(swiftConfig(APP_DELEGATE))
    const second = withIosLeftToRightAppearance(
      swiftConfig(first.modResults.contents),
    )
    expect(mockCalls).toEqual(["withAppDelegate", "withAppDelegate"])
    expect(count(second.modResults.contents, LEFT_TO_RIGHT_STATEMENT)).toBe(1)
  })

  it("throws on an Objective-C AppDelegate (negative control)", () => {
    const config = {
      modResults: {
        language: "objcpp",
        contents: "@implementation AppDelegate",
      },
    }
    expect(() => withIosLeftToRightAppearance(config)).toThrow(
      /expected a Swift AppDelegate/,
    )
  })
})
