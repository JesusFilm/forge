/**
 * Pins the platform fork of the navigator's options. jest-expo defaults to
 * `ios`, so the Android branch must be entered on purpose or it never runs.
 *
 * No re-require after flipping Platform.OS: every platform read in the layout
 * happens during render, so a fresh render is enough.
 */
import { act } from "react"
import { Platform } from "react-native"

import {
  TestRenderer,
  type TestInstance,
} from "../../src/test-utils/rnTestRenderer"
import TabLayout from "../(tabs)/_layout"

// The `mock` prefix is required: babel-plugin-jest-hoist lifts jest.mock above
// this declaration and rejects any other out-of-scope name in the factory.
const mockScreenOptions: { current: Record<string, unknown> | undefined } = {
  current: undefined,
}
jest.mock("expo-router", () => ({
  Tabs: Object.assign(
    (props: { screenOptions?: Record<string, unknown> }) => {
      mockScreenOptions.current = props.screenOptions
      return null
    },
    { Screen: () => null },
  ),
}))
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 59, right: 0, bottom: 34, left: 0 }),
}))
jest.mock("expo-glass-effect", () => ({
  GlassView: () => null,
  isLiquidGlassAvailable: () => true,
  isGlassEffectAPIAvailable: () => true,
}))

const platformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, "OS")!
function setPlatform(os: "ios" | "android") {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true })
}
afterEach(() => {
  Object.defineProperty(Platform, "OS", platformOsDescriptor)
  mockScreenOptions.current = undefined
})

async function renderLayout(): Promise<Record<string, unknown>> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<TabLayout />)
  })
  renderer.unmount()
  return mockScreenOptions.current!
}

describe("iOS", () => {
  it("drops the opaque fill so the material is visible", async () => {
    setPlatform("ios")
    const style = (await renderLayout()).tabBarStyle as Record<string, unknown>
    // tabBarStyle is applied AFTER the bar's own transparent backgroundColor,
    // so a fill here would hide the glass with no warning.
    expect(style.backgroundColor).toBeUndefined()
    expect(style.borderRadius).toBe(28)
    expect(style.position).toBe("absolute")
  })

  it("supplies a material and hides the pill behind the keyboard", async () => {
    setPlatform("ios")
    const options = await renderLayout()
    expect(options.tabBarBackground).toBeDefined()
    expect(options.tabBarHideOnKeyboard).toBe(true)
  })
})

describe("Android", () => {
  it("keeps today's flat opaque bar", async () => {
    setPlatform("android")
    const style = (await renderLayout()).tabBarStyle as Record<string, unknown>
    expect(style).toEqual({
      backgroundColor: "#1c1917",
      borderTopColor: "transparent",
    })
  })

  it("supplies no material, so the bar keeps its own fill", async () => {
    setPlatform("android")
    const options = await renderLayout()
    const material = options.tabBarBackground as () => unknown
    expect(material()).toBeNull()
  })

  it("leaves tabBarHideOnKeyboard unset, exactly as today", async () => {
    setPlatform("android")
    expect((await renderLayout()).tabBarHideOnKeyboard).toBeUndefined()
  })
})
