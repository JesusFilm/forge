/** The Explore play glyph: it fades in on a pause and out on a resume, and a
 *  tap on it resumes the clip with Apple's press response (owner, 2026-10-19). */

// apps/mobile's tsconfig maps `react` to its .d.ts. These mocks re-point
// `react` at the real package (see apps/mobile/CLAUDE.md "Component render tests").
jest.mock("react", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(path.dirname(r.resolve("react/package.json")))
})
jest.mock("react/jsx-runtime", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(
    path.join(path.dirname(r.resolve("react/package.json")), "jsx-runtime.js"),
  )
})
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
// jest-expo reports Liquid Glass as available, so each case pins the branch.
const mockGate = { glass: true }
jest.mock("../../../lib/liquidGlass", () => ({
  canUseLiquidGlass: () => mockGate.glass,
}))
// Records each glass style it draws, so a test can see the dissolve-in order.
const mockGlassStyles: string[] = []
jest.mock("expo-glass-effect", () => {
  const { createElement } = jest.requireActual("react") as {
    createElement: (type: string, props: object) => unknown
  }
  return {
    GlassView: (props: { glassEffectStyle?: { style: string } }) => {
      mockGlassStyles.push(props.glassEffectStyle?.style ?? "")
      return createElement("GlassView", props)
    },
  }
})
const mockMotion = { reduce: false }
jest.mock("../../../hooks/useReduceMotion", () => ({
  useReduceMotion: () => mockMotion.reduce,
}))

import { act } from "react"
import { Animated } from "react-native"

import {
  PAUSED_GLYPH_FADE_IN_MS,
  PAUSED_GLYPH_FADE_OUT_MS,
  PausedGlyph,
} from "../PausedGlyph"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

let renderer: TestInstance
let timing: jest.SpyInstance
const onPress = jest.fn()

function mount(paused: boolean) {
  act(() => {
    renderer = TestRenderer.create(
      <PausedGlyph paused={paused} onPress={onPress} />,
    )
  })
}

function update(paused: boolean) {
  act(() => {
    renderer.update(<PausedGlyph paused={paused} onPress={onPress} />)
  })
}

function layer(): RenderedNode | undefined {
  return renderer.root.findAll(
    (n) => n.props.testID === "clip-paused-glyph" && typeof n.type === "string",
  )[0]
}

function glass(): RenderedNode {
  const [node] = renderer.root.findAll(
    (n) => n.type === "GlassView" && typeof n.type === "string",
  )
  if (node == null) throw new Error("no glass")
  return node
}

type SearchableNode = RenderedNode & {
  findAll(predicate: (node: RenderedNode) => boolean): RenderedNode[]
}

/** The glyph's fade, on the view the glass puts around it. */
function fadeOpacity(): number {
  const view = glass() as SearchableNode
  const [node] = view.findAll(
    (n: RenderedNode) => typeof n.type === "string" && n !== view,
  )
  const style = node!.props.style as { opacity?: number } | undefined
  return Number(style?.opacity)
}

function glassStyle(): string {
  return (glass().props.glassEffectStyle as { style: string }).style
}

beforeEach(() => {
  jest.useFakeTimers()
  mockGate.glass = true
  mockMotion.reduce = false
  onPress.mockClear()
  mockGlassStyles.length = 0
  timing = jest.spyOn(Animated, "timing")
})

afterEach(() => {
  act(() => renderer.unmount())
  timing.mockRestore()
  jest.useRealTimers()
})

/** The fades started so far, as [value, target opacity, duration]. */
function fades(): [unknown, number, number][] {
  return timing.mock.calls.map(([value, config]) => [
    value,
    (config as { toValue: number }).toValue,
    (config as { duration: number }).duration,
  ])
}

describe("PausedGlyph", () => {
  it("dissolves the glass in on a pause and resumes on a tap, with Apple's press response", () => {
    mount(false)
    expect(layer()).toBeUndefined()

    update(true)
    // One render at 'none', then 'regular': the glass dissolves in.
    expect(mockGlassStyles.slice(0, 2)).toEqual(["none", "regular"])
    expect(glassStyle()).toBe("regular")
    // The glyph draws at 0 and fades in with the glass. Jest has no native
    // driver, so the fade is checked as the timing it starts.
    expect(fadeOpacity()).toBe(0)
    expect(fades().map(([, to, ms]) => [to, ms])).toEqual([
      [1, PAUSED_GLYPH_FADE_IN_MS],
    ])
    expect(glass().props.isInteractive).toBe(true)
    expect(layer()!.props.pointerEvents).toBe("box-none")

    const [button] = renderer.root.findAll(
      (n) =>
        n.props.testID === "clip-paused-glyph-button" &&
        typeof n.props.onPress === "function",
    )
    act(() => button!.props.onPress!())
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it("fades out on a resume, takes no touch while it fades, then unmounts", () => {
    mount(true)
    update(false)
    expect(layer()).toBeDefined()
    expect(layer()!.props.pointerEvents).toBe("none")
    expect(glassStyle()).toBe("none")
    // The same value fades back to 0 over the leave time.
    const [fadeIn, fadeOut] = fades()
    expect(fadeOut!.slice(1)).toEqual([0, PAUSED_GLYPH_FADE_OUT_MS])
    expect(fadeOut![0]).toBe(fadeIn![0])

    act(() => jest.advanceTimersByTime(PAUSED_GLYPH_FADE_OUT_MS + 100))
    expect(layer()).toBeUndefined()
  })

  it("keeps a glyph from a pause during the fade-out", () => {
    mount(true)
    update(false)
    const leaving = layer()
    update(true)
    // A new view: Fabric iOS ignores React opacity on a view a fade drove.
    expect(layer()).not.toBe(leaving)

    act(() => jest.advanceTimersByTime(PAUSED_GLYPH_FADE_OUT_MS + 100))
    expect(layer()).toBeDefined()
    expect(glassStyle()).toBe("regular")
  })

  it("appears and leaves at once under Reduce Motion", () => {
    mockMotion.reduce = true
    mount(false)
    update(true)
    expect(layer()).toBeDefined()
    expect(fadeOpacity()).toBe(1)
    expect(fades()).toHaveLength(0)
    update(false)
    expect(layer()).toBeUndefined()
  })
})
