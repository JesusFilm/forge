// Plain JS (like the other guard suites): the RN tsconfig has no Node types,
// and this guard needs fs/path to read the native sources.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

const MODULE = path.join(__dirname, "..")
const KOTLIN = path.join(
  MODULE,
  "android/src/main/java/org/jesusfilm/layoutdirection",
)
const REACT_NATIVE = path.dirname(require.resolve("react-native/package.json"))

const read = (...parts) => fs.readFileSync(path.join(...parts), "utf8")

function kotlinString(source, name) {
  const match = source.match(new RegExp(`const val ${name} =\\s*"([^"]+)"`))
  return match ? match[1] : null
}

// The JavaScript tests mock the native module, so only this suite can see a
// React Native upgrade or a config edit that leaves the native side unwired.
describe("the layout-direction native contract", () => {
  const ours = read(KOTLIN, "NativeDirection.kt")
  const reactNative = read(
    REACT_NATIVE,
    "ReactAndroid/src/main/java/com/facebook/react/modules/i18nmanager/I18nUtil.kt",
  )

  it.each([
    ["RN_PREFS", "SHARED_PREFS_NAME"],
    ["RN_KEY_ALLOW_RTL", "KEY_FOR_PREFS_ALLOWRTL"],
    ["RN_KEY_FORCE_RTL", "KEY_FOR_PREFS_FORCERTL"],
  ])("writes React Native's own %s (I18nUtil %s)", (mine, theirs) => {
    const expected = kotlinString(reactNative, theirs)
    expect(expected).not.toBeNull()
    expect(kotlinString(ours, mine)).toBe(expected)
  })

  it("registers the iOS module, the app delegate subscriber, and the Android module", () => {
    const config = JSON.parse(read(MODULE, "expo-module.config.json"))
    expect(config.apple.modules).toEqual(["LayoutDirectionModule"])
    expect(config.apple.appDelegateSubscribers).toEqual([
      "LayoutDirectionAppDelegateSubscriber",
    ])
    expect(config.android.modules).toEqual([
      "org.jesusfilm.layoutdirection.LayoutDirectionModule",
    ])
    expect(read(MODULE, "ios/LayoutDirectionModule.swift")).toMatch(
      /^public class LayoutDirectionModule: Module \{/m,
    )
    expect(
      read(MODULE, "ios/LayoutDirectionAppDelegateSubscriber.swift"),
    ).toMatch(
      /^public class LayoutDirectionAppDelegateSubscriber: ExpoAppDelegateSubscriber \{/m,
    )
    const module = read(KOTLIN, "LayoutDirectionModule.kt")
    expect(module).toMatch(/^package org\.jesusfilm\.layoutdirection$/m)
    expect(module).toMatch(/^class LayoutDirectionModule : Module\(\) \{/m)
  })

  // Autolinking finds an Android Package by a scan, not by the config file.
  it("keeps the Android launch listener in a Package in the same package", () => {
    const pkg = read(KOTLIN, "LayoutDirectionPackage.kt")
    expect(pkg).toMatch(/^package org\.jesusfilm\.layoutdirection$/m)
    expect(pkg).toMatch(/^class LayoutDirectionPackage : Package \{/m)
    expect(pkg).toMatch(/override fun createReactActivityLifecycleListeners\(/)
  })
})
