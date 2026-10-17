/* global require, module */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs")
const path = require("path")
const { withInfoPlist, withAppDelegate } = require("expo/config-plugins")

const startup = `    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)`

function patchAppDelegate(source) {
  if (source.includes("class ForgeSceneDelegate:")) return source
  if (!source.includes("  var window: UIWindow?")) {
    throw new Error("TV scene lifecycle: expected AppDelegate window property")
  }
  if (!source.includes(startup)) {
    throw new Error(
      "TV scene lifecycle: unexpected React Native startup template",
    )
  }
  const delegate = fs.readFileSync(
    path.join(__dirname, "scene-lifecycle/ForgeSceneDelegate.swift"),
    "utf8",
  )
  return (
    source
      .replace(
        "  var window: UIWindow?",
        "  var window: UIWindow?\n  var forgeLaunchOptions: [UIApplication.LaunchOptionsKey: Any]?",
      )
      .replace(startup, "    forgeLaunchOptions = launchOptions") +
    "\n" +
    delegate
  )
}

module.exports = function withTVSceneLifecycle(config) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Watch",
            UISceneDelegateClassName:
              "$(PRODUCT_MODULE_NAME).ForgeSceneDelegate",
          },
        ],
      },
    }
    return mod
  })
  return withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== "swift") {
      throw new Error("TV scene lifecycle requires a Swift AppDelegate")
    }
    mod.modResults.contents = patchAppDelegate(mod.modResults.contents)
    return mod
  })
}

module.exports.patchAppDelegate = patchAppDelegate
