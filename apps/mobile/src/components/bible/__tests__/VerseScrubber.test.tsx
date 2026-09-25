// The verse scrubber (feat-551 U9, R18, KD7), after Still's design: a drag
// that starts on the thumb moves by whole verses, a still press changes
// nothing, and the drag ends on the last verse it showed. Each render is in
// <StrictMode>, and touches drive the REAL PanResponder handlers.

import { StrictMode, act } from "react"
import {
  StyleSheet,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native"

import {
  TestRenderer,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import {
  READER_SCRUBBER_BAND,
  READER_TOUCH_TARGET,
} from "../../../lib/bible/reader/chrome"
import { readerTokens } from "../../../lib/bible/theme/palettes"
import { VerseScrubber, type VerseScrubberProps } from "../VerseScrubber"

const TOKENS = readerTokens("classic", "light")
const TRACK_WIDTH = 360
/** Where the column starts in the window; a touch reports window x. */
const COLUMN_LEFT = 24

let mounted: TestInstance | null = null

afterEach(async () => {
  if (mounted != null) {
    await unmount(mounted)
    mounted = null
  }
})

type Spies = {
  onPreview: jest.Mock<void, [number]>
  onEnd: jest.Mock<void, [number | null]>
}

async function render(
  overrides: Partial<VerseScrubberProps> = {},
): Promise<{ renderer: TestInstance } & Spies> {
  const spies: Spies = { onPreview: jest.fn(), onEnd: jest.fn() }
  const props: VerseScrubberProps = {
    tokens: TOKENS,
    lastVerse: 36,
    progress: 1 / 36,
    labelFor: (verse) => `${verse}`,
    edgeGuardWidth: 0,
    ...spies,
    ...overrides,
  }
  await act(async () => {
    mounted = TestRenderer.create(
      <StrictMode>
        <VerseScrubber {...props} />
      </StrictMode>,
    )
  })
  const renderer = mounted!
  const [band] = byTestId(renderer, "bible-verse-scrubber")
  await act(async () => {
    ;(band!.props.onLayout as (event: unknown) => void)({
      nativeEvent: {
        layout: {
          x: 0,
          y: 0,
          width: TRACK_WIDTH,
          height: READER_SCRUBBER_BAND,
        },
      },
    })
  })
  return { renderer, ...spies }
}

function byTestId(renderer: TestInstance, testID: string) {
  return renderer.root.findAll(
    (node) => typeof node.type === "string" && node.props.testID === testID,
  )
}

function flat(node: RenderedNode): ViewStyle {
  return StyleSheet.flatten(node.props.style as StyleProp<ViewStyle>) ?? {}
}

function textCount(renderer: TestInstance, text: string): number {
  return renderer.root.findAll(
    (node) => node.type === "Text" && node.props.children === text,
  ).length
}

// ── Touches, as the responder system dispatches them ────────────────────────

type ResponderHandlers = {
  onStartShouldSetResponder: (e: GestureResponderEvent) => boolean
  onMoveShouldSetResponder: (e: GestureResponderEvent) => boolean
  onResponderGrant: (e: GestureResponderEvent) => void
  onResponderMove: (e: GestureResponderEvent) => void
  onResponderRelease: (e: GestureResponderEvent) => void
  onResponderTerminate: (e: GestureResponderEvent) => void
  onResponderTerminationRequest: (e: GestureResponderEvent) => boolean
}

let clock = 1000
function touch(x: number, previousX: number): GestureResponderEvent {
  clock += 16
  const native = { pageX: x, pageY: 900 }
  return {
    nativeEvent: { ...native, touches: [native], changedTouches: [native] },
    touchHistory: {
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: clock,
      touchBank: [
        {
          touchActive: true,
          startPageX: previousX,
          startPageY: 900,
          startTimeStamp: clock - 32,
          currentPageX: x,
          currentPageY: 900,
          currentTimeStamp: clock,
          previousPageX: previousX,
          previousPageY: 900,
          previousTimeStamp: clock - 16,
        },
      ],
    },
  } as unknown as GestureResponderEvent
}

function thumb(renderer: TestInstance): RenderedNode {
  const [target] = byTestId(renderer, "bible-scrubber-thumb")
  expect(target).toBeDefined()
  return target!
}

function handlers(renderer: TestInstance): ResponderHandlers {
  return thumb(renderer).props as unknown as ResponderHandlers
}

/** The thumb's center in window x. */
function thumbX(renderer: TestInstance): number {
  const style = flat(thumb(renderer))
  return COLUMN_LEFT + Number(style.left) + Number(style.width) / 2
}

/** Presses the thumb, then moves it through each window x in turn. */
async function drag(renderer: TestInstance, path: number[]) {
  const start = thumbX(renderer)
  let at = start
  expect(handlers(renderer).onStartShouldSetResponder(touch(at, at))).toBe(true)
  await act(async () => handlers(renderer).onResponderGrant(touch(at, at)))
  for (const x of path) {
    const from = at
    at = x
    await act(async () => handlers(renderer).onResponderMove(touch(x, from)))
  }
  return {
    release: async () =>
      act(async () => handlers(renderer).onResponderRelease(touch(at, at))),
    terminate: async () =>
      act(async () => handlers(renderer).onResponderTerminate(touch(at, at))),
  }
}

/** Window x for a fraction of the bar. */
const barX = (fraction: number) => COLUMN_LEFT + fraction * TRACK_WIDTH

describe("VerseScrubber (R18, KD7)", () => {
  it("lands a drag to 50% of a 36-verse chapter on verse 18", async () => {
    const { renderer, onPreview, onEnd } = await render()
    const moving = await drag(renderer, [barX(0.25), barX(0.5)])
    expect(onPreview.mock.calls.map(([verse]) => verse)).toEqual([9, 18])
    expect(onEnd).not.toHaveBeenCalled()
    await moving.release()
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledWith(18)
  })

  it("ends on the last verse it showed, not on where the release lands", async () => {
    const { renderer, onEnd } = await render()
    const handlersNow = handlers(renderer)
    const start = thumbX(renderer)
    await act(async () => handlersNow.onResponderGrant(touch(start, start)))
    await act(async () => handlersNow.onResponderMove(touch(barX(0.5), start)))
    // A release far from the last move: the drag still ends on verse 18.
    await act(async () =>
      handlers(renderer).onResponderRelease(touch(barX(0.9), barX(0.9))),
    )
    expect(onEnd).toHaveBeenCalledWith(18)
  })

  it("moves the thumb from where it is, never to where the press lands", async () => {
    // Verse 18 of 36, pressed 15 points right of the thumb's center.
    const { renderer, onPreview, onEnd } = await render({ progress: 0.5 })
    const pressed = thumbX(renderer) + 15
    await act(async () =>
      handlers(renderer).onResponderGrant(touch(pressed, pressed)),
    )
    await act(async () =>
      handlers(renderer).onResponderMove(touch(pressed + 1, pressed)),
    )
    await act(async () =>
      handlers(renderer).onResponderRelease(touch(pressed + 1, pressed + 1)),
    )
    expect(onPreview).toHaveBeenLastCalledWith(18)
    expect(onEnd).toHaveBeenCalledWith(18)
  })

  it("changes nothing on a still press", async () => {
    const { renderer, onPreview, onEnd } = await render({ progress: 0.5 })
    const moving = await drag(renderer, [])
    await moving.release()
    expect(onPreview).not.toHaveBeenCalled()
    expect(onEnd).toHaveBeenCalledWith(null)
  })

  it("stops at the chapter's first and last verse", async () => {
    const { renderer, onPreview } = await render({ progress: 0.5 })
    const moving = await drag(renderer, [barX(-0.5), barX(1.6)])
    await moving.release()
    expect(onPreview.mock.calls.map(([verse]) => verse)).toEqual([1, 36])
  })

  it("keeps the last verse when the drag is interrupted", async () => {
    const { renderer, onEnd } = await render()
    const moving = await drag(renderer, [barX(0.5)])
    await moving.terminate()
    expect(onEnd).toHaveBeenCalledWith(18)
  })

  it("keeps the last verse when it unmounts during a drag", async () => {
    const { renderer, onEnd } = await render()
    await drag(renderer, [barX(0.5)])
    await unmount(renderer)
    mounted = null
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledWith(18)
  })

  it("says nothing when it unmounts with no drag", async () => {
    const { renderer, onEnd } = await render()
    await unmount(renderer)
    mounted = null
    expect(onEnd).not.toHaveBeenCalled()
  })

  it("keeps its drag when another view asks for the touch", async () => {
    const { renderer } = await render()
    expect(
      handlers(renderer).onResponderTerminationRequest(touch(100, 100)),
    ).toBe(false)
  })

  it("shows the verse above the thumb only during a drag", async () => {
    const { renderer } = await render({ labelFor: (verse) => `v${verse}` })
    expect(byTestId(renderer, "bible-scrubber-label")).toHaveLength(0)
    const moving = await drag(renderer, [barX(0.5)])
    expect(byTestId(renderer, "bible-scrubber-label")).toHaveLength(1)
    expect(textCount(renderer, "v18")).toBe(1)
    await moving.release()
    expect(byTestId(renderer, "bible-scrubber-label")).toHaveLength(0)
  })

  it("declines a touch that starts in the back-swipe strip (iOS pushed reader)", async () => {
    const { renderer } = await render({ edgeGuardWidth: 24 })
    const start = handlers(renderer).onStartShouldSetResponder
    expect(start(touch(20, 20))).toBe(false)
    // Anti-vacuous: the same thumb takes a touch just outside the strip.
    expect(start(touch(30, 30))).toBe(true)
    expect(handlers(renderer).onMoveShouldSetResponder(touch(20, 10))).toBe(
      false,
    )
  })

  it("gives the thumb a 44 x 44 target centered on it (R36)", async () => {
    const { renderer } = await render({ progress: 0.5 })
    const style = flat(thumb(renderer))
    expect(Number(style.width)).toBeGreaterThanOrEqual(READER_TOUCH_TARGET)
    expect(Number(style.height)).toBeGreaterThanOrEqual(READER_TOUCH_TARGET)
    expect(Number(style.left) + Number(style.width) / 2).toBe(0.5 * TRACK_WIDTH)
  })

  it("has no thumb while the chapter text loads", async () => {
    const { renderer } = await render({ lastVerse: null, progress: 0 })
    expect(byTestId(renderer, "bible-scrubber-thumb")).toHaveLength(0)
    expect(byTestId(renderer, "bible-reader-progress-fill")).toHaveLength(1)
  })

  it("stays out of the accessibility tree: the verse is the adjustable control (KTD14)", async () => {
    const { renderer } = await render()
    const [band] = byTestId(renderer, "bible-verse-scrubber")
    expect(band!.props.accessibilityElementsHidden).toBe(true)
    expect(band!.props.importantForAccessibility).toBe("no-hide-descendants")
  })

  it("fills the bar to the shown verse, by verse number (KTD19)", async () => {
    const { renderer } = await render({ progress: 18 / 36 })
    const [fill] = byTestId(renderer, "bible-reader-progress-fill")
    expect(flat(fill!).width).toBe("50%")
  })
})
