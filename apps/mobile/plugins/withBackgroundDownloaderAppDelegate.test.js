const {
  removeBackgroundSessionMethod,
  insertIntoAppDelegate,
} = require("./withBackgroundDownloaderAppDelegate")

// The Expo SDK 57 AppDelegate.swift, verbatim from this repo's real
// `expo prebuild` output (expo ~57.0.12, captured 2026-08-13) with ONLY the
// relocated handler and its comment removed. Re-capture on every SDK bump.
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

/** Inject a method body before the file's LAST brace — what the package's own
 *  (buggy) plugin does, landing it inside ReactNativeDelegate. */
function injectBeforeLastBrace(src, body) {
  const at = src.lastIndexOf("}")
  return src.slice(0, at) + body + src.slice(at)
}

const FLAT_METHOD = `
  public override func application(
    _ application: UIApplication,
    handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
  ) {
    RNBackgroundDownloader.setCompletionHandlerWithIdentifier(identifier, completionHandler: completionHandler)
  }
`

const NESTED_METHOD = `
  public override func application(
    _ application: UIApplication,
    handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
  ) {
    DispatchQueue.main.async {
      RNBackgroundDownloader.setCompletionHandlerWithIdentifier(identifier, completionHandler: completionHandler)
    }
  }
`

const countBraces = (s) => ({
  open: (s.match(/{/g) || []).length,
  close: (s.match(/}/g) || []).length,
})

describe("removeBackgroundSessionMethod", () => {
  it("is a no-op when the method is absent", () => {
    expect(removeBackgroundSessionMethod(APP_DELEGATE)).toBe(APP_DELEGATE)
  })

  it("excises a flat method and leaves braces balanced", () => {
    const wrong = injectBeforeLastBrace(APP_DELEGATE, FLAT_METHOD)
    const out = removeBackgroundSessionMethod(wrong)
    expect(out).not.toContain("handleEventsForBackgroundURLSession")
    expect(out).toContain("class ReactNativeDelegate")
    expect(countBraces(out)).toEqual(countBraces(APP_DELEGATE))
  })

  it("excises a method with a nested closure (brace depth > 1)", () => {
    const wrong = injectBeforeLastBrace(APP_DELEGATE, NESTED_METHOD)
    const out = removeBackgroundSessionMethod(wrong)
    expect(out).not.toContain("handleEventsForBackgroundURLSession")
    expect(out).not.toContain("DispatchQueue.main.async")
    expect(countBraces(out)).toEqual(countBraces(APP_DELEGATE))
  })
})

describe("insertIntoAppDelegate", () => {
  it("inserts the override into AppDelegate, before ReactNativeDelegate", () => {
    const out = insertIntoAppDelegate(APP_DELEGATE)
    const methodIdx = out.indexOf("handleEventsForBackgroundURLSession")
    const rnDelegateIdx = out.indexOf("class ReactNativeDelegate")
    expect(methodIdx).toBeGreaterThan(-1)
    expect(methodIdx).toBeLessThan(rnDelegateIdx)
  })

  it("is idempotent — does not double-inject when already present", () => {
    const once = insertIntoAppDelegate(APP_DELEGATE)
    const twice = insertIntoAppDelegate(once)
    expect(twice).toBe(once)
  })

  it("relocates a wrong-class injection into AppDelegate (remove + insert)", () => {
    const wrong = injectBeforeLastBrace(APP_DELEGATE, FLAT_METHOD)
    const out = insertIntoAppDelegate(removeBackgroundSessionMethod(wrong))
    const occurrences =
      out.split("handleEventsForBackgroundURLSession").length - 1
    expect(occurrences).toBe(1)
    const methodIdx = out.indexOf("handleEventsForBackgroundURLSession")
    const rnDelegateIdx = out.indexOf("class ReactNativeDelegate")
    expect(methodIdx).toBeLessThan(rnDelegateIdx)
  })

  it("falls back to the final brace when ReactNativeDelegate is absent", () => {
    const noRn = `@UIApplicationMain
public class AppDelegate: ExpoAppDelegate {
  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return true
  }
}
`
    const out = insertIntoAppDelegate(noRn)
    const methodIdx = out.indexOf("handleEventsForBackgroundURLSession")
    expect(methodIdx).toBeGreaterThan(-1)
    expect(methodIdx).toBeLessThan(out.lastIndexOf("}"))
  })
})
