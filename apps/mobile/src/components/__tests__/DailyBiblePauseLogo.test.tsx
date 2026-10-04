import { act } from "react"
import { Animated, StyleSheet, type ViewStyle } from "react-native"

import {
  TestRenderer,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"
import { TEXT_BODY } from "../../lib/color"
import {
  DailyBiblePauseLogo,
  LOGO_DRAW_MS,
  LOGO_DURATION_MS,
  LOGO_MORPH_MS,
  logoStrokes,
  type Stroke,
} from "../DailyBiblePauseLogo"

type Point = { x: number; y: number }

const DRAW_END = LOGO_DRAW_MS / LOGO_DURATION_MS
const strokes = logoStrokes()

/** A pen's segments, in drawing order: `<panel>-<pen>`. */
function pens(): Map<string, Stroke[]> {
  const byPen = new Map<string, Stroke[]>()
  for (const stroke of strokes) {
    const pen = stroke.key.split("-").slice(0, 2).join("-")
    byPen.set(pen, [...(byPen.get(pen) ?? []), stroke])
  }
  return byPen
}

/** Where a segment's two ends sit at morph sample `k`, read from the very
 *  transforms the view renders with. The round cap is ignored (< 0.2 pt). */
function ends(stroke: Stroke, k: number): [Point, Point] {
  const { morph } = stroke
  const start = {
    x: stroke.start.x + morph.translateX[k]!,
    y: stroke.start.y + morph.translateY[k]!,
  }
  const angle = (parseFloat(morph.rotate[k]!) * Math.PI) / 180
  const length = stroke.length * morph.scaleX[k]!
  return [
    start,
    {
      x: start.x + Math.cos(angle) * length,
      y: start.y + Math.sin(angle) * length,
    },
  ]
}

const LAST = strokes[0]!.morph.input.length - 1

/** The vertical extent of a panel side: every path point near column `x`. */
function sideSpan(panel: "left" | "right", x: number, k: number): number {
  const ys = strokes
    .filter((stroke) => stroke.key.startsWith(panel))
    .flatMap((stroke) => ends(stroke, k))
    .filter((point) => Math.abs(point.x - x) < 1)
    .map((point) => point.y)
  return Math.max(...ys) - Math.min(...ys)
}

function columns(panel: "left" | "right"): { outer: number; inner: number } {
  const xs = strokes
    .filter((stroke) => stroke.key.startsWith(panel))
    .map((stroke) => stroke.start.x)
  const [min, max] = [Math.min(...xs), Math.max(...xs)]
  return panel === "left"
    ? { outer: min, inner: max }
    : { outer: max, inner: min }
}

const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 0.3

describe("the logo's timing", () => {
  it("draws for 0.7 s, then morphs for 0.3 s", () => {
    expect(LOGO_DRAW_MS).toBe(700)
    expect(LOGO_MORPH_MS).toBe(300)
    expect(LOGO_DURATION_MS).toBe(1000)
  })
})

describe("the pens", () => {
  it("are four, two per panel, all running at once", () => {
    const all = pens()
    expect([...all.keys()].sort()).toEqual([
      "left-a",
      "left-b",
      "right-a",
      "right-b",
    ])
    for (const segments of all.values()) {
      expect(segments[0]!.penFrom).toBeCloseTo(0, 6)
      expect(segments.at(-1)!.penTo).toBeCloseTo(DRAW_END, 6)
    }
  })

  it("each draw one unbroken line, segment after segment", () => {
    for (const segments of pens().values()) {
      segments.slice(1).forEach((segment, i) => {
        expect(segment.penFrom).toBeCloseTo(segments[i]!.penTo, 3)
        expect(near(segment.start, ends(segments[i]!, 0)[1])).toBe(true)
      })
    }
  })

  it("start together at the top outer corner and meet at the bottom inner one", () => {
    const all = pens()
    for (const panel of ["left", "right"] as const) {
      const a = all.get(`${panel}-a`)!
      const b = all.get(`${panel}-b`)!
      expect(near(a[0]!.start, b[0]!.start)).toBe(true)
      expect(near(ends(a.at(-1)!, 0)[1], ends(b.at(-1)!, 0)[1])).toBe(true)
      const { outer, inner } = columns(panel)
      expect(Math.abs(a[0]!.start.x - outer)).toBeLessThan(
        Math.abs(a[0]!.start.x - inner),
      )
    }
  })
})

describe("the morph", () => {
  it("runs over the last 0.3 s and leaves the drawing untouched before it", () => {
    for (const { morph } of strokes) {
      expect(morph.input[0]).toBeCloseTo(DRAW_END, 6)
      expect(morph.input[LAST]).toBe(1)
      expect(morph.translateX[0]).toBe(0)
      expect(morph.translateY[0]).toBe(0)
      expect(morph.scaleX[0]).toBe(1)
    }
  })

  it("draws two equal pause bars first", () => {
    for (const panel of ["left", "right"] as const) {
      const { outer, inner } = columns(panel)
      expect(
        Math.abs(sideSpan(panel, inner, 0) - sideSpan(panel, outer, 0)),
      ).toBeLessThan(0.5)
    }
  })

  it("shrinks only the inner side, to the artwork's 88 of 104", () => {
    for (const panel of ["left", "right"] as const) {
      const { outer, inner } = columns(panel)
      const outerBefore = sideSpan(panel, outer, 0)
      expect(Math.abs(sideSpan(panel, outer, LAST) - outerBefore)).toBeLessThan(
        0.5,
      )
      expect(sideSpan(panel, inner, LAST) / outerBefore).toBeCloseTo(
        88 / 104,
        1,
      )
    }
  })

  it("keeps every line joined while the shape changes", () => {
    for (const segments of pens().values()) {
      for (let k = 0; k <= LAST; k += 1) {
        segments.slice(1).forEach((segment, i) => {
          expect(near(ends(segments[i]!, k)[1], ends(segment, k)[0])).toBe(true)
        })
      }
    }
  })

  it("never spins a segment the long way round", () => {
    for (const { morph } of strokes) {
      morph.rotate.slice(1).forEach((angle, i) => {
        const step = parseFloat(angle) - parseFloat(morph.rotate[i]!)
        expect(Math.abs(step)).toBeLessThan(90)
      })
    }
  })
})

describe("DailyBiblePauseLogo", () => {
  type Interpolated = { __getValue(): number }
  // The Animated wrapper holds the live interpolation; the View inside it
  // gets plain numbers, so only the wrapper answers `__getValue`.
  const live = (value: unknown): value is Interpolated =>
    typeof (value as Interpolated | undefined)?.__getValue === "function"

  async function render(draw: Animated.Value): Promise<TestInstance> {
    let renderer!: TestInstance
    await act(async () => {
      renderer = TestRenderer.create(<DailyBiblePauseLogo draw={draw} />)
    })
    return renderer
  }

  function flat(node: RenderedNode): ViewStyle {
    return StyleSheet.flatten(node.props.style as ViewStyle) ?? {}
  }

  /** The ink inside each segment's clipping track. */
  function inks(renderer: TestInstance): ViewStyle[] {
    return renderer.root
      .findAll(
        (node) =>
          flat(node).backgroundColor === TEXT_BODY &&
          live(
            (flat(node).transform as Array<{ translateX?: unknown }>)?.[0]
              ?.translateX,
          ),
      )
      .map(flat)
  }

  const inkShift = (style: ViewStyle) =>
    (
      style.transform as unknown as Array<{ translateX: Interpolated }>
    )[0]!.translateX.__getValue()

  /** Each title letter's opacity right now. */
  function letterOpacities(renderer: TestInstance): number[] {
    return renderer.root
      .findAll(
        (node) =>
          typeof node.props.children === "string" &&
          (node.props.children as string).length === 1 &&
          live(flat(node).opacity),
      )
      .map((node) =>
        (flat(node).opacity as unknown as Interpolated).__getValue(),
      )
  }

  it("shows nothing before the pen starts", async () => {
    const draw = new Animated.Value(0)
    const renderer = await render(draw)
    const all = inks(renderer)
    expect(all).toHaveLength(strokes.length)
    // Fully outside its track, so the clip hides even the pen's round tip.
    for (const ink of all) {
      expect(inkShift(ink) + (ink.width as number)).toBeLessThanOrEqual(0)
    }
    expect(letterOpacities(renderer).every((o) => o === 0)).toBe(true)
    await unmount(renderer)
  })

  it("has every line drawn, and no title yet, when the drawing ends", async () => {
    const draw = new Animated.Value(DRAW_END)
    const renderer = await render(draw)
    for (const ink of inks(renderer)) expect(inkShift(ink)).toBe(0)
    const letters = letterOpacities(renderer)
    expect(letters).toHaveLength("DAILYBIBLEPAUSE".length)
    expect(letters.every((o) => o === 0)).toBe(true)
    await unmount(renderer)
  })

  it("fades the title in during the morph, letter by letter", async () => {
    const draw = new Animated.Value((DRAW_END + 1) / 2)
    const renderer = await render(draw)
    const middle = letterOpacities(renderer)
    expect(middle[0]).toBeGreaterThan(0)
    expect(middle.at(-1)).toBeLessThan(1)
    expect(middle[0]).toBeGreaterThan(middle.at(-1)!)
    act(() => draw.setValue(1))
    expect(letterOpacities(renderer).every((o) => o === 1)).toBe(true)
    await unmount(renderer)
  })
})
