/**
 * The clip progress bar in a right-to-left layout (feat-695 R12, KTD7): it
 * keeps its own left-to-right layout, so the thumb and the time pill sit on
 * the x that the drag reads. Also the time pill's glass (R4). Its time and
 * seek behavior is in ClipOverlay.test.
 */

import { act } from "react"
import {
  I18nManager,
  StyleSheet,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native"
import type { VideoPlayer } from "expo-video"

// The `mock` prefix lets babel-plugin-jest-hoist accept this name. A case
// takes the glass branch unless it turns the gate off.
const mockGlass = { on: true }
jest.mock("../../../lib/liquidGlass", () => ({
  canUseLiquidGlass: () => mockGlass.on,
}))
// A host stand-in, so a case can see where the glass draws.
jest.mock("expo-glass-effect", () => ({ GlassView: "GlassView" }))

import { ClipProgressBar } from "../ClipProgressBar"
import { BLACK, hexToRgba } from "../../../lib/color"
import { makeFakePlayer } from "../../../test-utils/expoVideoMock"
import {
  TestRenderer,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { directionAbove } from "../../../test-utils/layoutDirection"

function layoutIsRtl() {
  jest.spyOn(I18nManager, "getConstants").mockReturnValue({
    ...I18nManager.getConstants(),
    isRTL: true,
  })
  jest.replaceProperty(I18nManager, "isRTL", true)
}

function hostById(renderer: TestInstance, id: string): RenderedNode {
  const [node] = renderer.root.findAll(
    (n) => n.props.testID === id && typeof n.type === "string",
  )
  if (node == null) throw new Error(`no host node with testID ${id}`)
  return node
}

/** One finger at x, with the history PanResponder reads its state from. */
function touchAt(x: number): GestureResponderEvent {
  return {
    nativeEvent: { touches: [], changedTouches: [], locationX: x, pageX: x },
    touchHistory: {
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: 1000,
      touchBank: [
        {
          touchActive: true,
          startPageX: x,
          startPageY: 0,
          startTimeStamp: 984,
          currentPageX: x,
          currentPageY: 0,
          currentTimeStamp: 1000,
          previousPageX: x,
          previousPageY: 0,
          previousTimeStamp: 984,
        },
      ],
    },
  } as unknown as GestureResponderEvent
}

/** The one host node of this type. */
function hostOfType(renderer: TestInstance, type: string): RenderedNode {
  const found = renderer.root.findAll((n) => n.type === type)
  expect(found).toHaveLength(1)
  return found[0]
}

/** The nearest host node above a node. */
function hostAbove(node: RenderedNode): RenderedNode {
  let at = node.parent
  while (at != null && typeof at.type !== "string") at = at.parent
  if (at == null) throw new Error("no host node above")
  return at
}

/** The opacity a node draws at: its own times every host node above it. */
function drawnOpacity(node: RenderedNode): number {
  let opacity = 1
  for (let at: RenderedNode | null | undefined = node; at; at = at.parent) {
    if (typeof at.type !== "string") continue
    const own = StyleSheet.flatten(
      at.props.style as StyleProp<ViewStyle>,
    )?.opacity
    if (typeof own === "number") opacity *= own
  }
  return opacity
}

/** The pill's first layout pass, which gives it a width. */
function layOutPill(bar: TestInstance) {
  const pill = hostById(bar, "clip-scrub-pill")
  act(() => {
    ;(pill.props.onLayout as (e: unknown) => void)({
      nativeEvent: { layout: { x: 0, y: 0, width: 80, height: 24 } },
    })
  })
}

let renderer: TestInstance | null = null

afterEach(() => {
  act(() => {
    renderer?.unmount()
  })
  renderer = null
  jest.restoreAllMocks()
  mockGlass.on = true
})

/** A measured 300-wide bar with a drag held at x 60, so the thumb and the
 *  pill draw. */
function renderDragging(): TestInstance {
  const player = makeFakePlayer()
  player.currentTime = 730
  act(() => {
    renderer = TestRenderer.create(
      <ClipProgressBar
        player={player as unknown as VideoPlayer}
        clipWindow={{ startSeconds: 724, endSeconds: 751 }}
        onSeek={() => {}}
        veiled={false}
      />,
    )
  })
  const bar = hostById(renderer as TestInstance, "clip-progress-bar")
  const handlers = bar.props as unknown as {
    onLayout: (e: unknown) => void
    onResponderGrant: (e: GestureResponderEvent) => void
  }
  act(() => {
    handlers.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 44 } },
    })
  })
  act(() => {
    handlers.onResponderGrant(touchAt(60))
  })
  return renderer as TestInstance
}

describe("ClipProgressBar — in a right-to-left layout (feat-695 R12)", () => {
  beforeEach(() => {
    layoutIsRtl()
  })

  it("places the thumb and the time pill from the left edge, inside a left-to-right container", () => {
    const bar = renderDragging()

    for (const id of ["clip-progress-thumb", "clip-scrub-pill"]) {
      const node = hostById(bar, id)
      expect(directionAbove(node)).toBe("ltr")
      expect(StyleSheet.flatten(node.props.style as never)).toMatchObject({
        left: 0,
      })
    }
  })
})

describe("ClipProgressBar — the time pill's glass (R4)", () => {
  it("keeps the glass dissolved and the time hidden until the pill's width is known", () => {
    const bar = renderDragging()
    const glass = hostOfType(bar, "GlassView")
    const time = hostOfType(bar, "Text")
    expect(glass.props.glassEffectStyle).toMatchObject({ style: "none" })
    expect(drawnOpacity(time)).toBe(0)
    // Only the time hides: an opacity above the glass stops it drawing.
    expect(drawnOpacity(glass)).toBe(1)

    layOutPill(bar)

    expect(hostOfType(bar, "GlassView").props.glassEffectStyle).toMatchObject({
      style: "regular",
    })
    expect(drawnOpacity(hostOfType(bar, "Text"))).toBe(1)
    expect(drawnOpacity(hostOfType(bar, "GlassView"))).toBe(1)
  })

  it("keeps today's dark pill, hidden whole until its width is known, where Liquid Glass is unavailable", () => {
    mockGlass.on = false
    const bar = renderDragging()
    const fill = () => hostAbove(hostOfType(bar, "Text"))
    expect(bar.root.findAll((n) => n.type === "GlassView")).toHaveLength(0)
    expect(StyleSheet.flatten(fill().props.style as never)).toMatchObject({
      backgroundColor: hexToRgba(BLACK, 0.75),
      opacity: 0,
    })

    layOutPill(bar)

    expect(drawnOpacity(fill())).toBe(1)
    expect(drawnOpacity(hostOfType(bar, "Text"))).toBe(1)
  })
})
