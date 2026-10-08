// Plain JS: the RN tsconfig has no Node types, and this guard needs fs/path to
// read the Search route source.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

const source = fs.readFileSync(
  path.join(__dirname, "../../../app/search.tsx"),
  "utf8",
)
const nativePatch = fs.readFileSync(
  path.join(__dirname, "../../../../../patches/expo-tvos-search@2.1.1.patch"),
  "utf8",
)

describe("tvOS Search Back wiring", () => {
  it("claims Menu, consumes Back, and restores Menu behavior on cleanup", () => {
    expect(source).toContain('Platform.OS !== "ios"')
    expect(source).toContain("TVEventControl.enableTVMenuKey()")
    expect(source).toMatch(
      /BackHandler\.addEventListener\(\s*"hardwareBackPress",\s*handler,?\s*\)/,
    )
    expect(source).toContain("navigateBackFromSearch(router)")
    expect(source).toContain(
      "onSearchFieldFocused={reclaimMenuKeyAfterNativeFocus}",
    )
    expect(source).toContain("TVEventControl.disableTVMenuKey()")
  })

  it("preserves the Menu recognizer when native search takes keyboard focus", () => {
    expect(nativePatch).toContain("UIPress.PressType.menu.rawValue")
    expect(nativePatch).toContain(
      "tapRecognizer.allowedPressTypes.contains(menuPress)",
    )
  })
})
