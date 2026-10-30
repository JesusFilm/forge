/* global require, test, expect */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs")
const path = require("path")
const read = (name) => fs.readFileSync(path.join(__dirname, name), "utf8")

test("animation exit targets Settings even without usable back history", () => {
  const source = read("AnimationSettingsScreen.tsx")
  expect(source).toContain('router.dismissTo("/settings")')
  expect(source).toContain("onPress={leaveAnimations}")
  expect(source).not.toContain("router.back()")
  expect(source).toMatch(
    /const leaveAnimations[\s\S]*setPreviewing\(false\)[\s\S]*setPreviewRevision\(0\)/,
  )
})

test.each(["AnimationSettingsScreen.tsx", "SettingsScreen.tsx"])(
  "%s owns remote Back only while focused",
  (filename) => {
    const source = read(filename)
    expect(source).toMatch(
      /useFocusEffect\([\s\S]*BackHandler.addEventListener\("hardwareBackPress"/,
    )
    expect(source).toContain("return true")
    expect(source).toContain("back.remove()")
    expect(source).toContain("TVEventControl.enableTVMenuKey()")
    expect(source).toContain("TVEventControl.disableTVMenuKey()")
  },
)

test("Settings supplies an in-app Home exit after a deep-linked animation visit", () => {
  const source = read("SettingsScreen.tsx")
  expect(source).toContain('router.dismissTo("/")')
  expect(source).toContain('testID="settings-back-home"')
  expect(source).toContain("onPress={leaveSettings}")
})
