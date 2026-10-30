// Plain JS (like the other guard suites): the RN tsconfig has no Node types,
// and this guard needs fs/path to read the native sources.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

const MODULE = path.join(__dirname, "..")
const REACT_NATIVE = path.dirname(require.resolve("react-native/package.json"))

const read = (...parts) => fs.readFileSync(path.join(...parts), "utf8")

function swiftString(source, call) {
  const match = source.match(new RegExp(`\\b${call}\\(\\s*"([^"]+)"`))
  return match ? match[1] : null
}

// The JavaScript tests mock the native module, so only this suite can see a
// config edit or a renamed Swift name that leaves the module inert.
describe("the system-appearance native contract", () => {
  const swift = read(MODULE, "ios/SystemAppearanceModule.swift")
  const entry = read(MODULE, "index.ts")

  it("registers the iOS module and the app delegate subscriber, and no Android module", () => {
    const config = JSON.parse(read(MODULE, "expo-module.config.json"))
    expect(config.platforms).toEqual(["apple"])
    expect(config.apple.modules).toEqual(["SystemAppearanceModule"])
    expect(config.apple.appDelegateSubscribers).toEqual([
      "SystemAppearanceAppDelegateSubscriber",
    ])
    expect(config.android).toBeUndefined()
    expect(swift).toMatch(/^public class SystemAppearanceModule: Module \{/m)
    expect(
      read(MODULE, "ios/SystemAppearanceAppDelegateSubscriber.swift"),
    ).toMatch(
      /^public class SystemAppearanceAppDelegateSubscriber: ExpoAppDelegateSubscriber \{/m,
    )
  })

  it("names the module, the getter, and the event as index.ts reads them", () => {
    expect(swiftString(swift, "Name")).toBe("SystemAppearance")
    expect(entry).toContain('requireOptionalNativeModule("SystemAppearance")')

    expect(swift).toMatch(/\bFunction\("getColorScheme"\)/)
    expect(entry).toMatch(/\bnative\.getColorScheme\(\)/)

    const event = swift.match(/static let changeEvent = "([^"]+)"/)
    expect(event).not.toBeNull()
    expect(swift).toMatch(/\bEvents\(SystemAppearanceStore\.changeEvent\)/)
    expect(entry).toContain(`const CHANGE_EVENT = "${event[1]}"`)
    expect(swift).toMatch(/\["colorScheme": /)
    expect(entry).toMatch(/event\?\.colorScheme/)
  })

  // KTD3 rests on this: the override goes on windows, so the window scene
  // still reports the phone's setting. A move to the scene breaks KTD4.
  it("still finds React Native's setColorScheme writing only window overrides", () => {
    const appearance = read(REACT_NATIVE, "React/CoreModules/RCTAppearance.mm")
    const body = appearance.match(
      /RCT_EXPORT_METHOD\(setColorScheme[\s\S]*?\n\}/,
    )
    expect(body).not.toBeNull()
    expect(body[0]).toMatch(/window\.overrideUserInterfaceStyle = /)
    expect(body[0]).not.toMatch(/traitOverrides|scene\.[A-Za-z]+\s*=/)
  })
})
