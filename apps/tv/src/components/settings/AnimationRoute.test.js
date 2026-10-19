/* global require, jest, test, expect, afterEach */
/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock("expo-router", () => ({ Redirect: "Redirect" }))
jest.mock("./AnimationSettingsScreen", () => ({
  AnimationSettingsScreen: "AnimationSettingsScreen",
}))
jest.mock("../../lib/logoAnimations", () => ({
  ANIMATION_SETTINGS_ENABLED: false,
}))

const flags = require("../../lib/logoAnimations")
const { default: AnimationsRoute } = require("../../../app/settings/animations")

afterEach(() => {
  flags.ANIMATION_SETTINGS_ENABLED = false
})

test("disabled animation settings redirect direct links to Settings", () => {
  const route = AnimationsRoute()
  expect(route.type).toBe("Redirect")
  expect(route.props.href).toBe("/settings")
})

test("enabling the code switch restores the animation settings screen", () => {
  flags.ANIMATION_SETTINGS_ENABLED = true
  expect(AnimationsRoute().type).toBe("AnimationSettingsScreen")
})
