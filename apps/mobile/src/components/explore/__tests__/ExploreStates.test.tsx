/**
 * Explore's non-clip states (R36, R37, R40, R47). The reducer owns the phase;
 * these views only show it. An unreachable admin reaches the reducer as the
 * `offline` event, so it must render the offline view and never the empty one.
 */

import { act } from "react"

jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))

import { ExploreStates } from "../ExploreStates"
import { EXPLORE_COPY } from "../../../lib/explore/copy"
import {
  INITIAL_FEED_STATE,
  canSwipeNext,
  feedReducer,
  type FeedPhase,
  type FeedState,
} from "../../../lib/explore/feedState"
import type { FeedClip } from "../../../lib/explore/types"
import {
  TestRenderer,
  hasText,
  pressableByLabel,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const mounted: TestInstance[] = []

afterEach(() => {
  act(() => {
    mounted.splice(0).forEach((renderer) => renderer.unmount())
  })
  jest.useRealTimers()
})

function render(phase: FeedPhase, onRetry = jest.fn()): TestInstance {
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(
      <ExploreStates phase={phase} languageName="Swahili" onRetry={onRetry} />,
    )
  })
  mounted.push(renderer)
  return renderer
}

const CLIP: FeedClip = {
  videoId: "video-1",
  coreId: "1_jf-0-0",
  slug: "the-birth-of-jesus",
  title: "The Birth of Jesus",
  description: null,
  imageUrl: null,
  muxPlaybackId: "mux-1",
  streamUrl: "https://stream.mux.com/mux-1.m3u8",
  feedLanguageSlug: "swahili",
  audioLanguageSlug: "swahili",
  subtitleLanguageSlug: null,
  subtitleVttSrc: null,
  subtitleOnly: false,
  window: { startSeconds: 10, endSeconds: 40 },
  cut: "sentence",
}

describe("ExploreStates", () => {
  it("shows the offline message with a retry", () => {
    const onRetry = jest.fn()
    const renderer = render("offline", onRetry)
    expect(hasText(renderer, EXPLORE_COPY.offlineTitle)).toBe(true)
    expect(hasText(renderer, EXPLORE_COPY.offlineBody)).toBe(true)
    const retry = pressableByLabel(renderer, EXPLORE_COPY.retry)
    expect(retry.props.accessibilityRole).toBe("button")
    act(() => {
      retry.props.onPress?.()
    })
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("names the feed language in the empty state, with no retry", () => {
    const renderer = render("empty")
    expect(hasText(renderer, EXPLORE_COPY.emptyTitle("Swahili"))).toBe(true)
    expect(hasText(renderer, "Swahili")).toBe(true)
    expect(
      renderer.root.findAll(
        (n) => n.props.accessibilityLabel === EXPLORE_COPY.retry,
      ),
    ).toHaveLength(0)
  })

  it("shows the offline message, not the empty state, when admin cannot be reached", () => {
    // The queue reports an unreachable admin as `offline` (R47).
    const state = feedReducer(
      feedReducer(INITIAL_FEED_STATE, { type: "focus", playerMode: "two" }),
      { type: "offline" },
    )
    expect(state.phase).toBe("offline")
    const renderer = render(state.phase)
    expect(hasText(renderer, EXPLORE_COPY.offlineTitle)).toBe(true)
    expect(hasText(renderer, EXPLORE_COPY.emptyTitle("Swahili"))).toBe(false)
  })

  it("shows a failed clip's message without taking the swipe or advancing", () => {
    jest.useFakeTimers()
    const renderer = render("clipFailed")
    expect(hasText(renderer, EXPLORE_COPY.clipFailed)).toBe(true)

    // Swipeable: nothing in the view claims a touch or offers an action.
    const [root] = renderer.root.findAll(
      (n) => n.props.testID === "clip-failed" && typeof n.type === "string",
    )
    expect(root?.props.pointerEvents).toBe("none")
    expect(
      renderer.root.findAll(
        (n) =>
          typeof n.props.onPress === "function" ||
          typeof n.props.onStartShouldSetResponder === "function",
      ),
    ).toHaveLength(0)

    // And the reducer keeps the pager's swipe for this phase.
    const failed: FeedState = {
      ...INITIAL_FEED_STATE,
      phase: "clipFailed",
      history: [CLIP],
      cursor: 0,
      queued: { ...CLIP, videoId: "video-2" },
    }
    expect(canSwipeNext(failed)).toBe(true)

    // No auto-advance: time passes and the message stays.
    act(() => {
      jest.advanceTimersByTime(60_000)
    })
    expect(hasText(renderer, EXPLORE_COPY.clipFailed)).toBe(true)
  })

  it("renders nothing for a clip phase", () => {
    for (const phase of ["playing", "paused", "veiled"] as const) {
      expect(render(phase).toJSON()).toBeNull()
    }
  })
})
