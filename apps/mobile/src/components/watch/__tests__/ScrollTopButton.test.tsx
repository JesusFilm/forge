/**
 * The watch page's scroll-to-top button (feat-705 U5, R7). It stays mounted
 * after its first show, so its glass can dissolve. While hidden it takes no
 * touches and screen readers skip it. Jest cannot draw the material, so these
 * cases pin the branch and its props.
 */

jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}))
// A host stand-in, so the glass is findable and its props readable.
jest.mock("expo-glass-effect", () => ({ GlassView: "GlassView" }))
// Each case pins the glass branch and Reduce Motion. The `mock` prefix lets
// jest hoist the names.
const mockGate = { glass: true }
jest.mock("../../../lib/liquidGlass", () => ({
  canUseLiquidGlass: () => mockGate.glass,
}))
const mockMotion = { reduce: false }
jest.mock("../../../hooks/useReduceMotion", () => ({
  useReduceMotion: () => mockMotion.reduce,
}))

import { act } from "react"
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native"

import { ScrollTopButton } from "../ScrollTopButton"
import {
  TestRenderer,
  press,
  pressableByLabel,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const LABEL = "Scroll to top"

let mounted: TestInstance | null = null

async function render(visible: boolean, onPress = jest.fn()) {
  await act(async () => {
    mounted = TestRenderer.create(
      <ScrollTopButton visible={visible} onPress={onPress} />,
    )
  })
  return mounted as TestInstance
}

async function update(visible: boolean, onPress = jest.fn()) {
  await act(async () => {
    mounted!.update(<ScrollTopButton visible={visible} onPress={onPress} />)
  })
}

/** The outer host view, which owns touches and screen-reader access. */
function root(renderer: TestInstance): RenderedNode {
  const [node] = renderer.root.findAll(
    (n) => typeof n.type === "string" && n.props.pointerEvents != null,
  )
  if (node == null) throw new Error("no button root")
  return node
}

function glass(renderer: TestInstance): RenderedNode {
  const [node] = renderer.root.findAll((n) => n.type === "GlassView")
  if (node == null) throw new Error("no glass")
  return node
}

function opacityOf(n: RenderedNode): unknown {
  if (typeof n.type !== "string") return undefined
  return StyleSheet.flatten(n.props.style as StyleProp<ViewStyle>)?.opacity
}

function ancestors(node: RenderedNode): RenderedNode[] {
  const chain: RenderedNode[] = []
  for (let at = node.parent ?? null; at != null; at = at.parent ?? null) {
    chain.push(at)
  }
  return chain
}

/** The chevron, found by its icon name (the icon mock draws nothing). */
function chevron(renderer: TestInstance): RenderedNode {
  const [node] = renderer.root.findAll((n) => n.props.name === "chevron-up")
  if (node == null) throw new Error("no chevron")
  return node
}

afterEach(async () => {
  if (mounted != null) await unmount(mounted)
  mounted = null
  mockGate.glass = true
  mockMotion.reduce = false
})

describe("ScrollTopButton (feat-705 U5, R7)", () => {
  it("is not mounted before the first show", async () => {
    const renderer = await render(false)
    expect(renderer.toJSON()).toBeNull()
  })

  it.each([
    ["glass", true],
    ["fallback", false],
  ])("takes touches and is announced while shown (%s)", async (_name, gate) => {
    mockGate.glass = gate as boolean
    const renderer = await render(true)

    const host = root(renderer)
    expect(host.props.pointerEvents).not.toBe("none")
    expect(host.props.accessibilityElementsHidden).toBe(false)
    expect(host.props.importantForAccessibility).not.toBe("no-hide-descendants")
    const button = pressableByLabel(renderer, LABEL)
    expect(button.props.accessibilityRole).toBe("button")
    expect(button.props["dd-action-name"]).toBe("watch-scroll-top")
  })

  it.each([
    ["glass", true],
    ["fallback", false],
  ])(
    "stays mounted after a hide, with no touches and hidden from screen readers (%s)",
    async (_name, gate) => {
      mockGate.glass = gate as boolean
      const renderer = await render(true)
      await update(false)

      expect(renderer.toJSON()).not.toBeNull()
      const host = root(renderer)
      expect(host.props.pointerEvents).toBe("none")
      expect(host.props.accessibilityElementsHidden).toBe(true)
      expect(host.props.importantForAccessibility).toBe("no-hide-descendants")
    },
  )

  it("calls the scroll-to-top handler on a tap", async () => {
    const onPress = jest.fn()
    const renderer = await render(true, onPress)
    await press(pressableByLabel(renderer, LABEL))
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it("dissolves the glass on a hide and brings it back on a show", async () => {
    const renderer = await render(true)
    // In and out with the chevron's 200 ms fade.
    expect(glass(renderer).props.glassEffectStyle).toEqual({
      style: "regular",
      animate: true,
      animationDuration: 0.2,
    })

    await update(false)
    expect(glass(renderer).props.glassEffectStyle).toEqual({
      style: "none",
      animate: true,
      animationDuration: 0.2,
    })

    await update(true)
    expect(glass(renderer).props.glassEffectStyle).toMatchObject({
      style: "regular",
    })
  })

  it("fades the chevron inside the glass, and nothing at or above the glass", async () => {
    mockMotion.reduce = true
    const renderer = await render(true)

    const chain = ancestors(chevron(renderer))
    const glassAt = chain.findIndex((n) => n.type === "GlassView")
    expect(glassAt).toBeGreaterThan(-1)
    expect(chain.slice(0, glassAt).some((n) => opacityOf(n) === 1)).toBe(true)
    expect(chain.slice(glassAt).every((n) => opacityOf(n) == null)).toBe(true)
  })

  it("keeps today's fill and fades the whole button on the fallback path", async () => {
    mockGate.glass = false
    mockMotion.reduce = true
    const renderer = await render(true)

    expect(renderer.root.findAll((n) => n.type === "GlassView")).toHaveLength(0)
    // SURFACE_COLOR #292524 at 85%, today's fill.
    const [fill] = ancestors(chevron(renderer)).filter(
      (n) =>
        typeof n.type === "string" &&
        StyleSheet.flatten(n.props.style as StyleProp<ViewStyle>)
          ?.backgroundColor === "rgba(41, 37, 36, 0.85)",
    )
    expect(fill).toBeDefined()
    expect(opacityOf(fill!)).toBe(1)

    await update(false)
    expect(opacityOf(fill!)).toBe(0)
  })

  it("snaps the glass and the chevron under Reduce Motion (R24)", async () => {
    mockMotion.reduce = true
    const renderer = await render(true)
    expect(glass(renderer).props.glassEffectStyle).toMatchObject({
      style: "regular",
      animate: false,
    })

    await update(false)
    expect(glass(renderer).props.glassEffectStyle).toMatchObject({
      style: "none",
      animate: false,
    })
    const chain = ancestors(chevron(renderer))
    expect(chain.some((n) => opacityOf(n) === 0)).toBe(true)
  })
})
