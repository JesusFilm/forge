/**
 * The clip progress bar in a right-to-left layout (feat-692 R12, KTD7): it
 * keeps its own left-to-right layout, so the thumb and the time pill sit on
 * the x that the drag reads. Its time and seek behavior is in ClipOverlay.test.
 */

import { act } from "react"
import {
  I18nManager,
  StyleSheet,
  type GestureResponderEvent,
} from "react-native"
import type { VideoPlayer } from "expo-video"

import { ClipProgressBar } from "../ClipProgressBar"
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

let renderer: TestInstance | null = null

beforeEach(() => {
  layoutIsRtl()
})

afterEach(() => {
  act(() => {
    renderer?.unmount()
  })
  renderer = null
  jest.restoreAllMocks()
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

describe("ClipProgressBar — in a right-to-left layout (feat-692 R12)", () => {
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
