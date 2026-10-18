/**
 * The shared glass surface (KTD2): glass, iOS before 26, and Android. Jest
 * cannot draw the material, so these cases prove the branch and its props.
 */
import { act } from "react"
import {
  Animated,
  Platform,
  StyleSheet,
  Text,
  type ViewStyle,
} from "react-native"
import { GlassView } from "expo-glass-effect"
import { BlurView } from "expo-blur"

import {
  TestRenderer,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { feedback } from "../../../styles/shared"
import { GlassSurface, type GlassSurfaceProps } from "../GlassSurface"

// The `mock` prefix lets babel-plugin-jest-hoist accept these names in the
// factories. Each case flips the gate or Reduce Motion through them.
const mockGate = { glass: true }
jest.mock("../../../lib/liquidGlass", () => ({
  canUseLiquidGlass: () => mockGate.glass,
}))
const mockMotion = { reduce: false }
jest.mock("../../../hooks/useReduceMotion", () => ({
  useReduceMotion: () => mockMotion.reduce,
}))
// Host-element stand-ins, so the JSON tree shows where each style lands.
jest.mock("expo-glass-effect", () => ({ GlassView: "GlassView" }))
jest.mock("expo-blur", () => ({ BlurView: "BlurView" }))

const platformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, "OS")!
function setPlatform(os: "ios" | "android") {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true })
}
afterEach(() => {
  Object.defineProperty(Platform, "OS", platformOsDescriptor)
  mockGate.glass = true
  mockMotion.reduce = false
})

type JsonNode = {
  type: string
  props: { style?: unknown; [key: string]: unknown }
  children: (JsonNode | string)[] | null
}

const SHAPE = { width: 44, height: 44, borderRadius: 22 }
const FILL = { backgroundColor: "rgba(0, 0, 0, 0.35)" }
const DIM = "rgba(28, 25, 23, 0.6)"
const TINT = "rgba(0, 0, 0, 0.3)"

function surface(props: Partial<GlassSurfaceProps> = {}) {
  return (
    <GlassSurface
      style={SHAPE}
      fallback={{ kind: "fill", style: FILL }}
      {...props}
    >
      <Text>glyph</Text>
    </GlassSurface>
  )
}

async function render(props: Partial<GlassSurfaceProps> = {}) {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(surface(props))
  })
  return renderer
}

function tree(renderer: TestInstance): JsonNode {
  return renderer.toJSON() as JsonNode
}

function flat(node: JsonNode): ViewStyle {
  return StyleSheet.flatten(node.props.style as ViewStyle) ?? {}
}

/** The host nodes from the root down to the glyph's parent, in order. */
function pathToGlyph(node: JsonNode): JsonNode[] {
  for (const child of node.children ?? []) {
    if (typeof child === "string") continue
    if (child.type === "Text" && child.children?.[0] === "glyph") return [node]
    const below = pathToGlyph(child)
    if (below.length > 0) return [node, ...below]
  }
  return []
}

function count(renderer: TestInstance, type: unknown): number {
  return renderer.root.findAll((n) => n.type === type).length
}

describe("GlassSurface on Liquid Glass", () => {
  beforeEach(() => setPlatform("ios"))

  it("shows regular dark glass in the caller's shape, with no interactive flash", async () => {
    const renderer = await render({ tintColor: TINT })
    const glass = tree(renderer)

    expect(glass.type).toBe(GlassView)
    expect(glass.props.glassEffectStyle).toEqual({
      style: "regular",
      animate: true,
      animationDuration: 0.1,
    })
    // The app is dark while app.json says "automatic".
    expect(glass.props.colorScheme).toBe("dark")
    // A panel or a label takes no press response.
    expect(glass.props.isInteractive).toBeUndefined()
    expect(glass.props.tintColor).toBe(TINT)
    expect(flat(glass)).toMatchObject(SHAPE)
    // The fallback fill would cover the glass.
    expect(flat(glass).backgroundColor).toBeUndefined()
    expect(count(renderer, BlurView)).toBe(0)
    expect(pathToGlyph(glass).length).toBeGreaterThan(0)
  })

  it("dissolves to the 'none' style when not visible", async () => {
    const glass = tree(await render({ visible: false }))
    expect(glass.props.glassEffectStyle).toEqual({
      style: "none",
      animate: true,
      animationDuration: 0.15,
    })
  })

  it("dissolves in and out over the caller's times", async () => {
    const dissolveSeconds = { in: 0.3, out: 0.5 }
    const renderer = await render({ visible: true, dissolveSeconds })
    expect(tree(renderer).props.glassEffectStyle).toEqual({
      style: "regular",
      animate: true,
      animationDuration: 0.3,
    })

    await act(async () => {
      renderer.update(surface({ visible: false, dissolveSeconds }))
    })
    expect(tree(renderer).props.glassEffectStyle).toEqual({
      style: "none",
      animate: true,
      animationDuration: 0.5,
    })
  })

  it("snaps with no animation under Reduce Motion", async () => {
    mockMotion.reduce = true
    const glass = tree(await render({ visible: false }))
    expect(glass.props.glassEffectStyle).toMatchObject({
      style: "none",
      animate: false,
    })
  })

  it("puts the fade on the children only, never on the glass", async () => {
    // An opacity below 1 on the glass or any ancestor stops it drawing.
    const glass = tree(await render({ fade: new Animated.Value(0.4) }))
    expect(glass.type).toBe(GlassView)
    expect(flat(glass).opacity).toBeUndefined()

    const [, wrapper] = pathToGlyph(glass)
    expect(flat(wrapper).opacity).toBe(0.4)
  })

  it("gives a button Apple's press response, with no scale and no dim", async () => {
    const glass = tree(await render({ interactive: true, pressed: true }))
    expect(glass.props.isInteractive).toBe(true)
    const style = flat(glass)
    // An opacity below 1 stops the glass drawing.
    expect(style.opacity).toBeUndefined()
    expect(style.transform).toBeUndefined()
  })
})

describe("GlassSurface fallback", () => {
  beforeEach(() => {
    mockGate.glass = false
  })

  it("renders the caller's blur on iOS before 26", async () => {
    setPlatform("ios")
    const renderer = await render({
      visible: false,
      fallback: { kind: "blur", intensity: 40, androidDim: DIM },
    })
    const blur = tree(renderer)

    expect(count(renderer, GlassView)).toBe(0)
    expect(blur.type).toBe(BlurView)
    expect(blur.props.intensity).toBe(40)
    expect(blur.props.tint).toBe("dark")
    expect(flat(blur)).toMatchObject(SHAPE)
    expect(pathToGlyph(blur).length).toBeGreaterThan(0)
  })

  it("renders the blur's flat dim on Android", async () => {
    setPlatform("android")
    const renderer = await render({
      fallback: { kind: "blur", intensity: 40, androidDim: DIM },
    })
    const root = tree(renderer)

    expect(count(renderer, GlassView)).toBe(0)
    expect(count(renderer, BlurView)).toBe(0)
    expect(flat(root)).toMatchObject({ ...SHAPE, backgroundColor: DIM })
    expect(pathToGlyph(root).length).toBeGreaterThan(0)
  })

  it.each(["ios", "android"] as const)(
    "renders the caller's fill on %s",
    async (os) => {
      setPlatform(os)
      const renderer = await render()
      const root = tree(renderer)

      expect(count(renderer, GlassView)).toBe(0)
      expect(count(renderer, BlurView)).toBe(0)
      expect(flat(root)).toMatchObject({ ...SHAPE, ...FILL })
      expect(pathToGlyph(root)).toHaveLength(1)
    },
  )

  it("puts the fade on the fill surface itself, as today", async () => {
    setPlatform("android")
    const root = tree(await render({ fade: new Animated.Value(0.4) }))

    expect(flat(root)).toMatchObject({ ...FILL, opacity: 0.4 })
    // No inner wrapper: the glyph sits directly in the faded surface.
    expect(pathToGlyph(root)).toHaveLength(1)
  })

  it("puts the fade outside the blur, so the whole blurred plate fades", async () => {
    setPlatform("ios")
    const root = tree(
      await render({
        fade: new Animated.Value(0.4),
        fallback: { kind: "blur", intensity: 40 },
      }),
    )

    expect(flat(root).opacity).toBe(0.4)
    const [, blur] = pathToGlyph(root)
    expect(blur.type).toBe(BlurView)
    expect(flat(blur)).toMatchObject(SHAPE)
    expect(flat(blur).opacity).toBeUndefined()
  })

  it.each([
    ["fill", { kind: "fill", style: FILL }],
    ["blur", { kind: "blur", intensity: 40 }],
  ] as const)(
    "dims a pressed %s surface as today, and does not scale it",
    async (_kind, fallback) => {
      setPlatform("ios")
      const root = tree(await render({ pressed: true, fallback }))
      const style = flat(root)
      expect(style.opacity).toBe(StyleSheet.flatten(feedback.pressed).opacity)
      expect(style.transform).toBeUndefined()
    },
  )
})
