/**
 * The tab bar's material. Three branches, and no other test in the app can see
 * any of them — every render suite mocks the material away.
 */
import { act } from "react"
import { Platform } from "react-native"
import { GlassView } from "expo-glass-effect"

import {
  TestRenderer,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { PlatformBlur } from "../PlatformBlur"
import { TabBarBackground } from "../TabBarBackground"

// The `mock` prefix is required: babel-plugin-jest-hoist lifts jest.mock above
// this declaration and rejects any other out-of-scope name in the factory.
const mockGlass = { liquid: true, api: true }
jest.mock("expo-glass-effect", () => ({
  GlassView: () => null,
  isLiquidGlassAvailable: () => mockGlass.liquid,
  isGlassEffectAPIAvailable: () => mockGlass.api,
}))
jest.mock("../PlatformBlur", () => ({
  PlatformBlur: () => null,
}))

const platformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, "OS")!
function setPlatform(os: "ios" | "android") {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true })
}
afterEach(() => {
  Object.defineProperty(Platform, "OS", platformOsDescriptor)
  mockGlass.liquid = true
  mockGlass.api = true
})

async function renderMaterial(): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<TabBarBackground />)
  })
  return renderer
}

describe("TabBarBackground", () => {
  it("renders NOTHING on Android, so the bar keeps its opaque fill", async () => {
    // A non-null element flips the bar's own backgroundColor to transparent.
    // Off iOS GlassView is a bare transparent View, so that would be invisible.
    setPlatform("android")
    expect((await renderMaterial()).toJSON()).toBeNull()
  })

  it("renders glass when iOS 26 offers it", async () => {
    setPlatform("ios")
    const found = (await renderMaterial()).root.findAll(
      (n) => n.type === GlassView,
    )
    expect(found).toHaveLength(1)
    expect(found[0].props.glassEffectStyle).toBe("regular")
    // The app hard-codes dark while app.json says "automatic".
    expect(found[0].props.colorScheme).toBe("dark")
    // Inside a pressable, isInteractive flashes white on remount.
    expect(found[0].props.isInteractive).toBeUndefined()
  })

  it("falls back to blur when the design is unavailable (iOS below 26)", async () => {
    setPlatform("ios")
    mockGlass.liquid = false
    expect(
      (await renderMaterial()).root.findAll((n) => n.type === PlatformBlur),
    ).toHaveLength(1)
  })

  it("falls back to blur when the API is missing (iOS 26 betas that crash)", async () => {
    setPlatform("ios")
    mockGlass.api = false
    expect(
      (await renderMaterial()).root.findAll((n) => n.type === PlatformBlur),
    ).toHaveLength(1)
  })
})
