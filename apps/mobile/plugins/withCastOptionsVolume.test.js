const { insertVolumeFlag } = require("./withCastOptionsVolume")

// Real producer symbol: the vendor's own Swift injector builds the fixture, so
// a vendor bump that changes the injected block fails this suite, not prebuild.
const {
  addSwiftGoogleCastAppDelegateDidFinishLaunchingWithOptions,
} = require("react-native-google-cast/lib/commonjs/plugin/withIosGoogleCast")

// The Expo SDK 57 AppDelegate.swift, verbatim from this repo's real
// `expo prebuild` output (expo ~57.0.12, captured 2026-08-13). Re-capture on
// every SDK bump. Kept in sync with withBackgroundDownloaderAppDelegate.test.js.
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
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }
}
`

// The vendor injection with this app's app.json plugin config (no
// receiverAppId, suspend-when-backgrounded off, discovery autostart on).
const INJECTED = addSwiftGoogleCastAppDelegateDidFinishLaunchingWithOptions(
  APP_DELEGATE,
  {
    startDiscoveryAfterFirstTapOnCastButton: false,
    suspendSessionsWhenBackgrounded: false,
    expandedController: true,
  },
).contents

const FLAG = "options.physicalVolumeButtonsWillControlDeviceVolume = true"

describe("vendor fixture sanity", () => {
  it("contains the anchor the transform amends", () => {
    expect(INJECTED).toContain("GCKCastContext.setSharedInstanceWith(options)")
    expect(INJECTED).toContain("let options = GCKCastOptions")
  })
})

describe("insertVolumeFlag", () => {
  it("inserts the volume flag before setSharedInstanceWith", () => {
    const out = insertVolumeFlag(INJECTED)
    const flagIdx = out.indexOf(FLAG)
    const anchorIdx = out.indexOf(
      "GCKCastContext.setSharedInstanceWith(options)",
    )
    expect(flagIdx).toBeGreaterThan(-1)
    expect(flagIdx).toBeLessThan(anchorIdx)
  })

  it("inserts after the GCKCastOptions instance exists", () => {
    const out = insertVolumeFlag(INJECTED)
    expect(out.indexOf(FLAG)).toBeGreaterThan(
      out.indexOf("let options = GCKCastOptions"),
    )
  })

  it("is idempotent — applying twice equals applying once", () => {
    const once = insertVolumeFlag(INJECTED)
    const twice = insertVolumeFlag(once)
    expect(twice).toBe(once)
    expect(twice.split(FLAG).length - 1).toBe(1)
  })

  it("throws when the vendor injection is absent (vendor drift must fail prebuild)", () => {
    expect(() => insertVolumeFlag(APP_DELEGATE)).toThrow(
      /react-native-google-cast/,
    )
  })
})
