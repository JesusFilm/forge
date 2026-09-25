// The reader's glass button (feat-551 KTD12, R8, R36): each of its three
// surfaces takes the READER's scheme and surface token, not the app's dark.

import { act } from "react"
import { Platform, StyleSheet, Text, type ViewStyle } from "react-native"
import { GlassView } from "expo-glass-effect"

import {
  TestRenderer,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { READER_TOUCH_TARGET } from "../../../lib/bible/reader/chrome"
import { readerTokens } from "../../../lib/bible/theme/palettes"
import { PlatformBlur } from "../../ui/PlatformBlur"
import { ReaderGlassButton } from "../ReaderGlassButton"

// The factory owns its state so a case can flip the Liquid Glass branch.
jest.mock("expo-glass-effect", () => {
  const state = { liquid: true, api: true }
  return {
    GlassView: () => null,
    isLiquidGlassAvailable: () => state.liquid,
    isGlassEffectAPIAvailable: () => state.api,
    __state: state,
  }
})
const mockGlass = (
  jest.requireMock("expo-glass-effect") as unknown as {
    __state: { liquid: boolean; api: boolean }
  }
).__state
jest.mock("../../ui/PlatformBlur", () => ({ PlatformBlur: () => null }))

const platformOs = Object.getOwnPropertyDescriptor(Platform, "OS")!
function setPlatform(os: "ios" | "android") {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true })
}

afterEach(() => {
  Object.defineProperty(Platform, "OS", platformOs)
  mockGlass.liquid = true
  mockGlass.api = true
})

// Classic Light: a light scheme, so the app's hard-coded "dark" would fail.
const LIGHT = readerTokens("classic", "light")

async function render(): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      <ReaderGlassButton
        tokens={LIGHT}
        accessibilityLabel="Reader settings"
        onPress={() => {}}
      >
        <Text>icon</Text>
      </ReaderGlassButton>,
    )
  })
  return renderer
}

function flat(node: RenderedNode): ViewStyle {
  return StyleSheet.flatten(node.props.style as ViewStyle) ?? {}
}

describe("ReaderGlassButton", () => {
  it("passes the reader's scheme to Liquid Glass", async () => {
    setPlatform("ios")
    const glass = (await render()).root.findAll(
      (node) => node.type === GlassView,
    )
    expect(glass).toHaveLength(1)
    expect(glass[0]!.props.colorScheme).toBe("light")
    expect(glass[0]!.props.glassEffectStyle).toBe("regular")
    // Inside a Pressable, isInteractive flashes white on remount.
    expect(glass[0]!.props.isInteractive).toBeUndefined()
  })

  it("blurs with the reader's tint and surface where Liquid Glass is absent", async () => {
    setPlatform("ios")
    mockGlass.liquid = false
    const renderer = await render()
    expect(
      renderer.root.findAll((node) => node.type === GlassView),
    ).toHaveLength(0)
    const blur = renderer.root.findAll((node) => node.type === PlatformBlur)
    expect(blur).toHaveLength(1)
    expect(blur[0]!.props.tint).toBe("light")
    expect(flat(blur[0]!).backgroundColor).toBe(LIGHT.buttonSurface)
  })

  it("uses a flat fill in the reader's surface on Android", async () => {
    setPlatform("android")
    const renderer = await render()
    expect(
      renderer.root.findAll((node) => node.type === GlassView),
    ).toHaveLength(0)
    expect(
      renderer.root.findAll((node) => node.type === PlatformBlur),
    ).toHaveLength(0)
    const fills = renderer.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        flat(node).backgroundColor === LIGHT.buttonSurface,
    )
    expect(fills).toHaveLength(1)
  })

  it("keeps a 44 x 44 target with a label and the button role (R36)", async () => {
    setPlatform("ios")
    const [target] = (await render()).root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.accessibilityRole === "button",
    )
    expect(target).toBeDefined()
    expect(target!.props.accessibilityLabel).toBe("Reader settings")
    expect(flat(target!).minWidth).toBeGreaterThanOrEqual(READER_TOUCH_TARGET)
    expect(flat(target!).minHeight).toBeGreaterThanOrEqual(READER_TOUCH_TARGET)
  })
})
