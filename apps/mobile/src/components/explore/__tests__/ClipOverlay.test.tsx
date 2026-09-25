/**
 * The clip overlay: information, side rail, captions (R13, AE4), the clip-only
 * progress bar (R12, R35), share (R44), and "Keep watching" (R16). No feed runs.
 */

import { act } from "react"
import type React from "react"
import { Share, type GestureResponderEvent } from "react-native"
import type { VideoPlayer } from "expo-video"

const mockInsets = { top: 59, right: 0, bottom: 83, left: 0 }
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mockInsets,
}))
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("expo-linear-gradient", () => {
  const { createElement } = jest.requireActual(
    "react",
  ) as typeof import("react")
  return {
    __esModule: true,
    LinearGradient: (props: object) => createElement("LinearGradient", props),
  }
})
jest.mock("expo-image", () => {
  const { createElement } = jest.requireActual(
    "react",
  ) as typeof import("react")
  return {
    __esModule: true,
    Image: (props: object) => createElement("ExpoImage", props),
  }
})
// The real overlay reads the shared cue cache. Here only its mount and its
// source matter, which is what the captions rule decides.
const mockSubtitleOverlay = jest.fn((_props: Record<string, unknown>) => null)
jest.mock("../../watch/SubtitleOverlay", () => ({
  SubtitleOverlay: (props: Record<string, unknown>) =>
    mockSubtitleOverlay(props),
}))
// Counts the overlay's own renders: the description re-renders exactly when
// the overlay does, because it is not memoized.
const mockDescriptionRenders = jest.fn()
jest.mock("../ClipDescription", () => {
  const actual = jest.requireActual("../ClipDescription") as {
    ClipDescription: React.ComponentType<object>
  }
  const { createElement } = jest.requireActual(
    "react",
  ) as typeof import("react")
  return {
    ...actual,
    ClipDescription: (props: object) => {
      mockDescriptionRenders()
      return createElement(actual.ClipDescription, props)
    },
  }
})

import { ClipOverlay, type ClipOverlayProps } from "../ClipOverlay"
import { ACCENT } from "../../../lib/color"
import { EXPLORE_COPY } from "../../../lib/explore/copy"
import {
  INITIAL_FEED_STATE,
  feedReducer,
  type FeedState,
} from "../../../lib/explore/feedState"
import type { FeedClip } from "../../../lib/explore/types"
import { TAB_BAR_CLEARANCE_GAP } from "../../../lib/tabBar"
import { buildWatchShareUrl } from "../../../lib/watchShareUrl"
import {
  makeFakePlayer,
  type FakePlayer,
} from "../../../test-utils/expoVideoMock"
import {
  TestRenderer,
  hasText,
  pressableByLabel,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

// 12:04 to 12:31: a 27 s window inside the full asset.
const CLIP: FeedClip = {
  videoId: "video-1",
  coreId: "1_jf-0-0",
  slug: "the-birth-of-jesus",
  title: "The Birth of Jesus",
  description: "Mary and Joseph travel to Bethlehem.",
  imageUrl: "https://images.example/1.jpg",
  muxPlaybackId: "mux-1",
  streamUrl: "https://stream.mux.com/mux-1.m3u8",
  feedLanguageSlug: "swahili",
  audioLanguageSlug: "swahili",
  subtitleLanguageSlug: "swahili",
  subtitleVttSrc: "https://subtitles.example/1.vtt",
  subtitleOnly: false,
  window: { startSeconds: 724, endSeconds: 751 },
  cut: "sentence",
}

let player: FakePlayer
const mounted: TestInstance[] = []

function props(overrides: Partial<ClipOverlayProps> = {}): ClipOverlayProps {
  return {
    clip: CLIP,
    player: player as unknown as VideoPlayer,
    muted: false,
    paused: false,
    onToggleMute: jest.fn(),
    onKeepWatching: jest.fn(),
    onOverlayOpen: jest.fn(),
    onOverlayClose: jest.fn(),
    ...overrides,
  }
}

function render(p: ClipOverlayProps = props()): TestInstance {
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(<ClipOverlay {...p} />)
  })
  mounted.push(renderer)
  return renderer
}

function byTestId(renderer: TestInstance, id: string): RenderedNode[] {
  return renderer.root.findAll(
    (n) => n.props.testID === id && typeof n.type === "string",
  )
}

function flatStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatStyle))
  return style != null && typeof style === "object"
    ? (style as Record<string, unknown>)
    : {}
}

/** The host nodes that carry an accessibility label, in tree order. */
function labelsIn(node: RenderedNode | JsonNode): string[] {
  const out: string[] = []
  const walk = (n: JsonNode | string) => {
    if (typeof n === "string") return
    if (typeof n.props.accessibilityLabel === "string") {
      out.push(n.props.accessibilityLabel)
    }
    for (const c of n.children ?? []) walk(c)
  }
  walk(node as JsonNode)
  return out
}

type JsonNode = {
  type: string
  props: Record<string, unknown>
  children: (JsonNode | string)[] | null
}

function jsonById(renderer: TestInstance, id: string): JsonNode {
  const find = (n: JsonNode | string): JsonNode | null => {
    if (typeof n === "string") return null
    if (n.props.testID === id) return n
    for (const c of n.children ?? []) {
      const hit = find(c)
      if (hit) return hit
    }
    return null
  }
  const hit = find(renderer.toJSON() as JsonNode)
  if (hit == null) throw new Error(`no node with testID ${id}`)
  return hit
}

function childIds(node: JsonNode): unknown[] {
  return (node.children ?? [])
    .filter((c): c is JsonNode => typeof c !== "string")
    .map((c) => c.props.testID)
}

function progressBar(renderer: TestInstance): RenderedNode {
  const [bar] = renderer.root.findAll(
    (n) =>
      n.props.accessibilityRole === "adjustable" && typeof n.type === "string",
  )
  expect(bar).toBeDefined()
  return bar
}

function barValue(renderer: TestInstance) {
  return progressBar(renderer).props.accessibilityValue as {
    min: number
    max: number
    now: number
  }
}

let touchClock = 1000
/** One finger, with the history PanResponder derives its gesture state from. */
function touchAt(x: number, previousX = 0): GestureResponderEvent {
  touchClock += 16
  return {
    nativeEvent: { touches: [], changedTouches: [], locationX: x, pageX: x },
    touchHistory: {
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: touchClock,
      touchBank: [
        {
          touchActive: true,
          startPageX: previousX,
          startPageY: 0,
          startTimeStamp: touchClock - 32,
          currentPageX: x,
          currentPageY: 0,
          currentTimeStamp: touchClock,
          previousPageX: previousX,
          previousPageY: 0,
          previousTimeStamp: touchClock - 16,
        },
      ],
    },
  } as unknown as GestureResponderEvent
}

type Handlers = {
  onLayout: (e: unknown) => void
  onResponderGrant: (e: GestureResponderEvent) => void
  onResponderMove: (e: GestureResponderEvent) => void
  onResponderRelease: (e: GestureResponderEvent) => void
  onAccessibilityAction: (e: unknown) => void
}

beforeEach(() => {
  player = makeFakePlayer()
  mockSubtitleOverlay.mockClear()
  mockDescriptionRenders.mockClear()
})

afterEach(() => {
  act(() => {
    mounted.splice(0).forEach((renderer) => renderer.unmount())
  })
  jest.restoreAllMocks()
})

describe("ClipOverlay — clip information", () => {
  it("caps the title at two lines", () => {
    const long = "A title that runs long ".repeat(8)
    const renderer = render(props({ clip: { ...CLIP, title: long } }))
    const [title] = renderer.root.findAll((n) => n.props.children === long)
    expect(title?.props.numberOfLines).toBe(2)
    expect(title?.props.accessibilityRole).toBe("header")
  })

  it("puts no control row between the description and the progress bar", () => {
    const renderer = render()
    const bottom = jsonById(renderer, "clip-overlay-bottom")
    // The scrim, then the information row, then the bar. Nothing between.
    expect(childIds(bottom)).toEqual([
      "clip-overlay-scrim",
      "clip-overlay-row",
      "clip-progress-bar",
    ])
    const info = jsonById(renderer, "clip-overlay-info")
    expect(labelsIn(info)).toEqual([])
    expect(hasText(renderer, CLIP.title)).toBe(true)
    expect(hasText(renderer, CLIP.description ?? "")).toBe(true)
  })

  it("clears the tab bar", () => {
    const renderer = render()
    const bottom = jsonById(renderer, "clip-overlay-bottom")
    expect(flatStyle(bottom.props.style).paddingBottom).toBe(
      mockInsets.bottom + TAB_BAR_CLEARANCE_GAP,
    )
  })

  it("shows the play glyph only while paused, hidden from screen readers", () => {
    expect(byTestId(render(), "clip-paused-glyph")).toHaveLength(0)
    const [glyph] = byTestId(
      render(props({ paused: true })),
      "clip-paused-glyph",
    )
    expect(glyph).toBeDefined()
    expect(glyph.props.pointerEvents).toBe("none")
    expect(glyph.props.importantForAccessibility).toBe("no-hide-descendants")
  })
})

describe("ClipOverlay — side rail (R11, R16, R18)", () => {
  it("stacks Mute, Share, and Keep watching, with Keep watching lowest", () => {
    const rail = jsonById(render(), "clip-overlay-rail")
    expect(labelsIn(rail)).toEqual([
      EXPLORE_COPY.mute,
      EXPLORE_COPY.share,
      EXPLORE_COPY.keepWatching,
    ])
  })

  it("makes Keep watching a round brand-red button with a 44 pt hit area and a label under it", () => {
    const renderer = render()
    // The host view: the composite Pressable holds a style FUNCTION.
    const [button] = renderer.root.findAll(
      (n) =>
        n.props.accessibilityLabel === EXPLORE_COPY.keepWatching &&
        typeof n.type === "string",
    )
    const style = flatStyle(button?.props.style)
    expect(style.minWidth).toBeGreaterThanOrEqual(44)
    expect(style.minHeight).toBeGreaterThanOrEqual(44)
    expect(button.props.accessibilityRole).toBe("button")

    const json = jsonById(renderer, "clip-rail-keep-watching")
    const kids = (json.children ?? []).filter(
      (c): c is JsonNode => typeof c !== "string",
    )
    const circle = flatStyle(kids[0]?.props.style)
    expect(circle.backgroundColor).toBe(ACCENT)
    expect(circle.borderRadius).toBe(Number(circle.width) / 2)
    expect(Number(circle.width)).toBeGreaterThanOrEqual(44)
    // The label sits UNDER the circle.
    expect(kids[1]?.type).toBe("Text")
    expect(kids[1]?.children).toEqual([EXPLORE_COPY.keepWatching])
  })

  it("names the mute action from the current state and raises the toggle", () => {
    const onToggleMute = jest.fn()
    const renderer = render(props({ onToggleMute }))
    act(() => {
      pressableByLabel(renderer, EXPLORE_COPY.mute).props.onPress?.()
    })
    expect(onToggleMute).toHaveBeenCalledTimes(1)
    expect(
      labelsIn(
        jsonById(render(props({ muted: true })), "clip-overlay-rail"),
      )[0],
    ).toBe(EXPLORE_COPY.unmute)
  })

  it("passes the reached position to Keep watching", () => {
    player.currentTime = 730
    const onKeepWatching = jest.fn()
    const renderer = render(props({ onKeepWatching }))
    act(() => {
      pressableByLabel(renderer, EXPLORE_COPY.keepWatching).props.onPress?.()
    })
    expect(onKeepWatching).toHaveBeenCalledWith(730)
  })

  it("keeps the Keep watching position inside the clip", () => {
    // Before the start seek lands, the player still reports 0.
    player.currentTime = 0
    const onKeepWatching = jest.fn()
    const renderer = render(props({ onKeepWatching }))
    act(() => {
      pressableByLabel(renderer, EXPLORE_COPY.keepWatching).props.onPress?.()
    })
    expect(onKeepWatching).toHaveBeenCalledWith(CLIP.window.startSeconds)
  })
})

describe("ClipOverlay — captions (R13, AE4, KTD20)", () => {
  function captionSource(p: ClipOverlayProps): unknown {
    mockSubtitleOverlay.mockClear()
    render(p)
    const calls = mockSubtitleOverlay.mock.calls
    return calls.length === 0 ? null : calls[calls.length - 1]?.[0].vttSrc
  }

  it("shows a dubbed clip's captions while muted and hides them with sound on", () => {
    expect(captionSource(props({ muted: true }))).toBe(CLIP.subtitleVttSrc)
    expect(captionSource(props({ muted: false }))).toBeNull()
  })

  it("shows a subtitle-only clip's captions muted and unmuted", () => {
    const clip = { ...CLIP, subtitleOnly: true }
    expect(captionSource(props({ clip, muted: true }))).toBe(
      CLIP.subtitleVttSrc,
    )
    expect(captionSource(props({ clip, muted: false }))).toBe(
      CLIP.subtitleVttSrc,
    )
  })

  it("shows none for a dubbed clip with no track in the feed language", () => {
    const clip = { ...CLIP, subtitleVttSrc: null, subtitleLanguageSlug: null }
    expect(captionSource(props({ clip, muted: true }))).toBeNull()
  })
})

describe("ClipOverlay — progress bar (R12, R35, KTD22)", () => {
  it("maps the player's time onto the clip: 12:10 in 12:04-12:31 is 6 s of 27 s", () => {
    player.currentTime = 730
    const renderer = render()
    expect(barValue(renderer)).toMatchObject({ min: 0, max: 27, now: 6 })
  })

  it("seeks to 12:17.5 on a drag to 50%", () => {
    player.currentTime = 730
    const renderer = render()
    const handlers = progressBar(renderer).props as unknown as Handlers
    act(() => {
      handlers.onLayout({
        nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 44 } },
      })
    })
    act(() => {
      handlers.onResponderGrant(touchAt(0))
      handlers.onResponderMove(touchAt(150))
      handlers.onResponderRelease(touchAt(150))
    })
    expect(player.currentTime).toBeCloseTo(737.5, 5)
  })

  it("keeps the step actions inside the window", () => {
    const renderer = render()
    const step = (at: number, actionName: "increment" | "decrement") => {
      player.currentTime = at
      act(() => {
        ;(
          progressBar(renderer).props as unknown as Handlers
        ).onAccessibilityAction({ nativeEvent: { actionName } })
      })
      return player.currentTime
    }
    expect(progressBar(renderer).props.accessibilityActions).toEqual([
      { name: "increment" },
      { name: "decrement" },
    ])
    expect(step(730, "increment")).toBeGreaterThan(730)
    expect(step(750, "increment")).toBe(CLIP.window.endSeconds)
    expect(step(726, "decrement")).toBe(CLIP.window.startSeconds)
  })

  it("re-renders only the bar on a player time update", () => {
    player.currentTime = 730
    const renderer = render()
    const before = mockDescriptionRenders.mock.calls.length
    expect(before).toBeGreaterThan(0)

    act(() => {
      player.currentTime = 733
      player.__emit("timeUpdate", { currentTime: 733 })
    })
    expect(barValue(renderer).now).toBe(9)
    expect(mockDescriptionRenders.mock.calls.length).toBe(before)

    // Anti-vacuous: an overlay render DOES reach the counter.
    act(() => {
      renderer.update(<ClipOverlay {...props({ muted: true })} />)
    })
    expect(mockDescriptionRenders.mock.calls.length).toBeGreaterThan(before)
  })
})

describe("ClipOverlay — description pause (R15, R44)", () => {
  function measureDescription(renderer: TestInstance, lineCount: number) {
    const [copy] = renderer.root.findAll(
      (n) => typeof n.props.onTextLayout === "function",
    )
    const lines = Array.from({ length: lineCount }, (_, i) => ({
      text: `${i}`,
    }))
    act(() => {
      ;(copy?.props.onTextLayout as (e: unknown) => void)({
        nativeEvent: { lines },
      })
    })
  }

  it("pauses on 'more', and 'less' resumes only a clip that was playing", () => {
    // Wired to the real reducer, as the feed wires it.
    for (const [start, expected] of [
      [{ phase: "playing" }, "playing"],
      [{ phase: "paused", viewerPaused: true }, "paused"],
    ] as const) {
      let state: FeedState = { ...INITIAL_FEED_STATE, ...start }
      const renderer = render(
        props({
          onOverlayOpen: () => {
            state = feedReducer(state, { type: "overlayOpen" })
          },
          onOverlayClose: () => {
            state = feedReducer(state, { type: "overlayClose" })
          },
        }),
      )
      measureDescription(renderer, 3)
      act(() => {
        pressableByLabel(
          renderer,
          EXPLORE_COPY.descriptionMoreLabel,
        ).props.onPress?.()
      })
      expect(state.phase).toBe("paused")
      expect(state.overlay).not.toBeNull()
      act(() => {
        pressableByLabel(
          renderer,
          EXPLORE_COPY.descriptionLessLabel,
        ).props.onPress?.()
      })
      expect(state.phase).toBe(expected)
      expect(state.overlay).toBeNull()
    }
  })
})

describe("ClipOverlay — share (R18, R44)", () => {
  function deferredShare() {
    let settle!: (ok: boolean) => void
    const spy = jest.spyOn(Share, "share").mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          settle = (ok) =>
            ok
              ? resolve({ action: Share.sharedAction })
              : reject(new Error("dismissed"))
        }),
    )
    return { spy, settle: (ok: boolean) => settle(ok) }
  }

  it("shares the full-video URL in the clip's dub", async () => {
    const { spy, settle } = deferredShare()
    const renderer = render()
    act(() => {
      pressableByLabel(renderer, EXPLORE_COPY.share).props.onPress?.()
    })
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: buildWatchShareUrl(CLIP.slug, CLIP.audioLanguageSlug),
      }),
    )
    expect(spy.mock.calls[0]?.[0].message).toContain("/swahili.html")
    await act(async () => {
      settle(true)
    })
  })

  it("holds the pause while the sheet is open, and releases it on close or dismiss", async () => {
    for (const ok of [true, false]) {
      const { settle } = deferredShare()
      const onOverlayOpen = jest.fn()
      const onOverlayClose = jest.fn()
      const renderer = render(props({ onOverlayOpen, onOverlayClose }))
      act(() => {
        pressableByLabel(renderer, EXPLORE_COPY.share).props.onPress?.()
      })
      expect(onOverlayOpen).toHaveBeenCalledTimes(1)
      expect(onOverlayClose).not.toHaveBeenCalled()
      await act(async () => {
        settle(ok)
      })
      expect(onOverlayClose).toHaveBeenCalledTimes(1)
      jest.restoreAllMocks()
    }
  })

  it("resumes a playing clip after the sheet, and leaves a viewer pause alone", async () => {
    // Wired to the real reducer, as the feed wires it.
    for (const [start, expected] of [
      [{ phase: "playing" }, "playing"],
      [{ phase: "paused", viewerPaused: true }, "paused"],
    ] as const) {
      let state: FeedState = { ...INITIAL_FEED_STATE, ...start }
      const { settle } = deferredShare()
      const renderer = render(
        props({
          onOverlayOpen: () => {
            state = feedReducer(state, { type: "overlayOpen" })
          },
          onOverlayClose: () => {
            state = feedReducer(state, { type: "overlayClose" })
          },
        }),
      )
      act(() => {
        pressableByLabel(renderer, EXPLORE_COPY.share).props.onPress?.()
      })
      expect(state.phase).toBe("paused")
      await act(async () => {
        settle(true)
      })
      expect(state.phase).toBe(expected)
      jest.restoreAllMocks()
    }
  })
})
