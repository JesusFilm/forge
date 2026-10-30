/** The mission page's "Become a beta tester" button: a glass capsule with
 *  Apple's press response on iOS 26, today's white button elsewhere. */
import { act } from "react"
import { StyleSheet, type TextStyle, type ViewStyle } from "react-native"

jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }))
// A host stand-in that renders its children, so the label inside is visible.
jest.mock("expo-glass-effect", () => ({
  GlassView: "GlassView",
  isLiquidGlassAvailable: () => false,
  isGlassEffectAPIAvailable: () => false,
}))
// jest-expo reports Liquid Glass as available, so each case pins the branch.
const mockGate = { glass: true }
jest.mock("../../src/lib/liquidGlass", () => ({
  canUseLiquidGlass: () => mockGate.glass,
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}))
const mockRouter = { navigate: () => {}, back: () => {}, canGoBack: () => true }
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
}))
jest.mock("../../src/lib/openExternalUrl", () => ({
  openExternalUrl: () => {},
}))
jest.mock("../../src/lib/push/testIdReveal", () => ({
  revealPushTestId: async () => {},
}))

import MissionScreen from "../mission"
import { BG_COLOR, TEXT_PRIMARY, hexToRgba } from "../../src/lib/color"
import {
  TestRenderer,
  type RenderedNode,
  type TestInstance,
} from "../../src/test-utils/rnTestRenderer"

const LABEL = "Become a beta tester"

async function render(): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<MissionScreen />)
  })
  return renderer
}

function styleOf(node: RenderedNode): TextStyle {
  return StyleSheet.flatten(node.props.style as TextStyle) ?? {}
}

function betaPressable(renderer: TestInstance): RenderedNode {
  const [node] = renderer.root.findAll(
    (candidate) =>
      candidate.props.accessibilityLabel === LABEL &&
      typeof candidate.props.style === "function",
  )
  expect(node).toBeDefined()
  return node!
}

function within(node: RenderedNode, ancestor: RenderedNode): boolean {
  for (let at = node.parent; at != null; at = at.parent) {
    if (at === ancestor) return true
  }
  return false
}

afterEach(() => {
  mockGate.glass = true
})

describe("the beta tester button", () => {
  it("is a glass capsule with Apple's press response on iOS 26", async () => {
    const renderer = await render()
    const target = betaPressable(renderer)
    const glass = renderer.root.findAll(
      (node) => node.type === "GlassView" && within(node, target),
    )
    expect(glass).toHaveLength(1)
    expect(glass[0]!.props.isInteractive).toBe(true)
    expect(styleOf(glass[0]!).borderRadius).toBe(999)
    // A fill on the glass covers it, and a dim on the target stops it.
    expect(styleOf(glass[0]!).backgroundColor).toBeUndefined()
    const style = target.props.style as (state: { pressed: boolean }) => unknown
    expect(style({ pressed: true })).toBeNull()
    const [label] = renderer.root.findAll(
      (node) => typeof node.type === "string" && node.props.children === LABEL,
    )
    // White glass with dark text, as bright as the old white button.
    expect(glass[0]!.props.tintColor).toBe(hexToRgba(TEXT_PRIMARY, 0.9))
    expect(styleOf(label!).color).toBe(BG_COLOR)
    await act(async () => renderer.unmount())
  })

  it("keeps today's white button without Liquid Glass", async () => {
    mockGate.glass = false
    const renderer = await render()
    const target = betaPressable(renderer)
    expect(
      renderer.root.findAll(
        (node) => node.type === "GlassView" && within(node, target),
      ),
    ).toHaveLength(0)
    const style = target.props.style as (state: { pressed: boolean }) => unknown
    expect(
      StyleSheet.flatten(style({ pressed: false }) as ViewStyle),
    ).toMatchObject({ backgroundColor: TEXT_PRIMARY, borderRadius: 8 })
    const [label] = renderer.root.findAll(
      (node) => typeof node.type === "string" && node.props.children === LABEL,
    )
    expect(styleOf(label!).color).toBe(BG_COLOR)
    await act(async () => renderer.unmount())
  })
})
