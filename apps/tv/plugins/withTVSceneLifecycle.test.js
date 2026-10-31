/* global require, describe, it, expect, jest */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs")
const path = require("path")

jest.mock("expo/config-plugins", () => ({
  withInfoPlist: (config, action) => {
    config.infoAction = action
    return config
  },
  withAppDelegate: (config, action) => {
    config.delegateAction = action
    return config
  },
}))

const plugin = require("./withTVSceneLifecycle")
const template = `import Expo
import React
public class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?
  var reactNativeFactory: RCTReactNativeFactory?
  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    bindReactNativeFactory(factory)
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
class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {}
`

describe("TV scene lifecycle", () => {
  it("prepares the Debug launcher before Expo's launch subscribers run", () => {
    const result = plugin.patchAppDelegate(template)
    const appLaunch = result.slice(
      0,
      result.indexOf("class ForgeSceneDelegate:"),
    )
    const debugStartup = appLaunch.match(/#if DEBUG\n([\s\S]*?)#endif/)[1]
    expect(debugStartup).toContain(
      "window = UIWindow(frame: UIScreen.main.bounds)",
    )
    expect(debugStartup).toContain("factory.startReactNative(")
    expect(appLaunch.indexOf("bindReactNativeFactory(factory)")).toBeLessThan(
      appLaunch.indexOf("factory.startReactNative("),
    )
    expect(appLaunch.indexOf("factory.startReactNative(")).toBeLessThan(
      appLaunch.indexOf("return super.application(application"),
    )
  })

  it("keeps Release React startup in the connected window scene", () => {
    const result = plugin
      .patchAppDelegate(template)
      .replace(/#if DEBUG\n[\s\S]*?#endif\n/g, "")
    const appLaunch = result.slice(
      0,
      result.indexOf("class ForgeSceneDelegate:"),
    )
    expect(appLaunch).not.toContain("UIWindow(frame: UIScreen.main.bounds)")
    expect(appLaunch).not.toContain("factory.startReactNative(")
    expect(result).toContain("forgeLaunchOptions = launchOptions")
    expect(result).toContain("bindReactNativeFactory(factory)")
    expect(result).toContain("return super.application(application")
    expect(result).toContain("UIWindow(windowScene: windowScene)")
    expect(result).toContain("appDelegate.window = window")
    expect(result).toContain("factory.startReactNative(")
    expect(result).toContain("if let existingWindow = appDelegate.window")
  })

  it("attaches the Debug window and forwards scene links without starting React twice", () => {
    const result = plugin.patchAppDelegate(template)
    const existingWindow = result.match(
      /if let existingWindow = appDelegate.window \{([\s\S]*?)\n {4}\}/,
    )[1]
    expect(existingWindow).toContain("window = existingWindow")
    expect(existingWindow).toContain("existingWindow.windowScene = windowScene")
    expect(existingWindow).toContain("existingWindow.makeKeyAndVisible()")
    expect(existingWindow).toContain("appDelegate.forgeLaunchOptions = nil")
    expect(existingWindow).toContain(
      "openURLContexts: connectionOptions.urlContexts",
    )
    expect(existingWindow).toContain("self.scene(scene, continue: activity)")
    expect(existingWindow).toContain("return")
    expect(existingWindow).not.toContain("factory.startReactNative(")
  })

  it("is idempotent", () => {
    const result = plugin.patchAppDelegate(template)
    expect(plugin.patchAppDelegate(result)).toBe(result)
    expect(result.match(/class ForgeSceneDelegate/g)).toHaveLength(1)
  })

  it("fails before writing when the generated template changes", () => {
    expect(() =>
      plugin.patchAppDelegate(template.replace("  var window: UIWindow?", "")),
    ).toThrow("window")
    expect(() =>
      plugin.patchAppDelegate(
        template.replace("UIWindow(frame: UIScreen.main.bounds)", "UIWindow()"),
      ),
    ).toThrow("startup")
  })

  it("preserves cold URL and universal-link launch options", () => {
    const result = plugin.patchAppDelegate(template)
    expect(result).toContain("launchOptions[.url] = context.url")
    expect(result).toContain(
      "launchOptions[.sourceApplication] = context.options.sourceApplication",
    )
    expect(result).toContain("launchOptions[.userActivityDictionary]")
    expect(result).toContain(
      '"UIApplicationLaunchOptionsUserActivityKey": activity',
    )
    expect(result).toContain("appDelegate.forgeLaunchOptions = nil")
  })

  it("forwards warm URLs, universal links and Expo lifecycle callbacks", () => {
    const result = plugin.patchAppDelegate(template)
    expect(result).toContain(
      "openURLContexts URLContexts: Set<UIOpenURLContext>",
    )
    expect(result).toContain("continue userActivity: NSUserActivity")
    for (const method of [
      "applicationDidBecomeActive",
      "applicationWillResignActive",
      "applicationDidEnterBackground",
      "applicationWillEnterForeground",
    ]) {
      expect(result).toContain(`appDelegate?.${method}(UIApplication.shared)`)
    }
    expect(result).not.toContain("NotificationCenter.default.post")
  })

  it("declares one programmatically constructed scene and preserves other plist keys", () => {
    const result = plugin({}).infoAction({
      modResults: { ForgeTopShelfAppGroup: "group.test" },
    }).modResults
    expect(result.ForgeTopShelfAppGroup).toBe("group.test")
    expect(
      result.UIApplicationSceneManifest.UIApplicationSupportsMultipleScenes,
    ).toBe(false)
    expect(
      result.UIApplicationSceneManifest.UISceneConfigurations
        .UIWindowSceneSessionRoleApplication,
    ).toEqual([
      {
        UISceneConfigurationName: "Watch",
        UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).ForgeSceneDelegate",
      },
    ])
  })

  it("patches Swift delegates and rejects other languages", () => {
    const action = plugin({}).delegateAction
    expect(
      action({ modResults: { language: "swift", contents: template } })
        .modResults.contents,
    ).toContain("ForgeSceneDelegate")
    expect(() =>
      action({ modResults: { language: "objc", contents: template } }),
    ).toThrow("Swift")
  })

  it("is registered in TV config only", () => {
    const config = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../app.json"), "utf8"),
    )
    expect(config.expo.plugins).toContain("./plugins/withTVSceneLifecycle")
  })
})
