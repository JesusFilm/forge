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
import { clipPosterUri } from "../../../hooks/useClipAutostart"
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
    onSeek: jest.fn(),
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

/** The images drawn directly inside a node. */
function imagesIn(node: JsonNode): JsonNode[] {
  return (node.children ?? []).filter(
    (c): c is JsonNode => typeof c !== "string" && c.type === "ExpoImage",
  )
}

/** Every visible string under a node, in tree order. */
function textsIn(node: JsonNode): string[] {
  const out: string[] = []
  const walk = (n: JsonNode | string) => {
    if (typeof n === "string") {
      out.push(n)
      return
    }
    for (const c of n.children ?? []) walk(c)
  }
  walk(node)
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
function touchAt(x: number, previousX = 0, y = 0): GestureResponderEvent {
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
          currentPageY: y,
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
  onResponderTerminationRequest: (e: GestureResponderEvent) => boolean
  onResponderTerminate: (e: GestureResponderEvent) => void
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

  it("makes Keep watching the clip's thumbnail in a circle, with a shadowed play glyph and no visible label", () => {
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
    expect(button.props.accessibilityHint).toBe(EXPLORE_COPY.keepWatchingHint)

    const circleJson = jsonById(renderer, "clip-keep-watching-circle")
    const circle = flatStyle(circleJson.props.style)
    expect(circle.borderRadius).toBe(Number(circle.width) / 2)
    expect(Number(circle.width)).toBeGreaterThanOrEqual(44)
    expect(circle.overflow).toBe("hidden")
    const [thumbnail] = imagesIn(circleJson)
    expect(thumbnail?.props.source).toBe(clipPosterUri(CLIP))
    expect(thumbnail?.props.contentFit).toBe("cover")
    // Not paused, so the only play glyph on screen is this button's.
    const glyphs = renderer.root.findAll((n) => n.props.name === "play")
    expect(glyphs).toHaveLength(1)
    expect(flatStyle(glyphs[0].props.style).textShadowColor).toBeDefined()

    const json = jsonById(renderer, "clip-rail-keep-watching")
    expect(textsIn(json)).toEqual([])
  })

  it("keeps a dark circle behind the glyph for a clip with no thumbnail", () => {
    const clip = { ...CLIP, imageUrl: null, muxPlaybackId: null }
    const renderer = render(props({ clip }))
    const circleJson = jsonById(renderer, "clip-keep-watching-circle")
    expect(imagesIn(circleJson)).toHaveLength(0)
    expect(flatStyle(circleJson.props.style).backgroundColor).toBeDefined()
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

describe("ClipOverlay — captions in the band (R13, KTD18)", () => {
  it("sits on the frame's bottom edge, clear of the rail, never below the title", () => {
    const renderer = render(props({ muted: true }))
    const layout = (
      id: string,
      box: { x?: number; y?: number; width?: number; height?: number },
      index = 0,
    ) => {
      const node = byTestId(renderer, id)[index]
      act(() => {
        ;(node.props.onLayout as (e: unknown) => void)({
          nativeEvent: {
            layout: { x: 0, y: 0, width: 0, height: 0, ...box },
          },
        })
      })
    }
    const caption = () =>
      mockSubtitleOverlay.mock.calls.at(-1)?.[0] as {
        bottomOffset: number
        rightInset?: number
      }

    // The bottom block is 380 tall, and its title starts 180 into it.
    layout("clip-overlay-bottom", { height: 380 })
    layout("clip-overlay-row", { width: 402, height: 300 })
    layout("clip-overlay-info", { y: 180 })
    layout("clip-overlay-rail", { x: 318 })
    // The lower bar: the frame's bottom edge is 324 above the screen's.
    layout("clip-band-bar", { height: 324 }, 1)

    expect(caption().bottomOffset).toBe(324 + 8)
    expect(caption().rightInset).toBe(402 - 318 + 8)

    // A tall frame ends below the title, so the caption stays above the title.
    layout("clip-band-bar", { height: 80 }, 1)
    expect(caption().bottomOffset).toBe(380 - 180 + 8)
  })
})

describe("ClipOverlay — scrim (R39)", () => {
  it("starts at the title, not at the taller rail, and follows an expansion", () => {
    const renderer = render()
    const layout = (id: string, y: number) => {
      const [node] = byTestId(renderer, id)
      act(() => {
        ;(node.props.onLayout as (e: unknown) => void)({
          nativeEvent: { layout: { x: 0, y, width: 300, height: 100 } },
        })
      })
    }
    const scrimTop = () =>
      flatStyle(byTestId(renderer, "clip-overlay-scrim")[0].props.style).top

    layout("clip-overlay-row", 0)
    layout("clip-overlay-info", 150)
    expect(scrimTop()).toBe(150)

    // A longer description moves the title up, and the scrim with it.
    layout("clip-overlay-info", 90)
    expect(scrimTop()).toBe(90)
  })
})

describe("ClipOverlay — progress bar (R12, R35, KTD22)", () => {
  it("maps the player's time onto the clip: 12:10 in 12:04-12:31 is 6 s of 27 s", () => {
    player.currentTime = 730
    const renderer = render()
    expect(barValue(renderer)).toMatchObject({ min: 0, max: 27, now: 6 })
  })

  it("seeks to 12:17.5 on a drag to 50%, through onSeek", () => {
    player.currentTime = 730
    const onSeek = jest.fn()
    const renderer = render(props({ onSeek }))
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
    expect(onSeek).toHaveBeenCalledTimes(1)
    expect(onSeek.mock.calls[0][0]).toBeCloseTo(737.5, 5)
    // The feed players own the seek, so the bar never writes the player.
    expect(player.currentTime).toBe(730)
    expect(barValue(renderer).now).toBe(13)
  })

  it("keeps a sideways drag past the lock, and yields a vertical one to the pager", () => {
    const renderer = render()
    const handlers = progressBar(renderer).props as unknown as Handlers
    act(() => {
      handlers.onLayout({
        nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 44 } },
      })
    })

    act(() => {
      handlers.onResponderGrant(touchAt(0))
      handlers.onResponderMove(touchAt(4))
    })
    expect(handlers.onResponderTerminationRequest(touchAt(4))).toBe(true)
    act(() => {
      handlers.onResponderMove(touchAt(20))
    })
    expect(handlers.onResponderTerminationRequest(touchAt(20))).toBe(false)

    act(() => {
      handlers.onResponderRelease(touchAt(20))
      handlers.onResponderGrant(touchAt(0))
      handlers.onResponderMove(touchAt(12, 0, 60))
    })
    expect(handlers.onResponderTerminationRequest(touchAt(12, 0, 60))).toBe(
      true,
    )
  })

  it("shows the player's time again, and seeks nothing, when the pager takes the drag", () => {
    player.currentTime = 730
    const onSeek = jest.fn()
    const renderer = render(props({ onSeek }))
    const handlers = progressBar(renderer).props as unknown as Handlers
    act(() => {
      handlers.onLayout({
        nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 44 } },
      })
    })

    act(() => {
      handlers.onResponderGrant(touchAt(0))
      handlers.onResponderMove(touchAt(150))
    })
    player.currentTime = 733
    act(() => {
      handlers.onResponderTerminate(touchAt(150))
    })

    expect(barValue(renderer).now).toBe(9)
    expect(onSeek).not.toHaveBeenCalled()
  })

  it("keeps the step actions inside the window", () => {
    const onSeek = jest.fn()
    const renderer = render(props({ onSeek }))
    const step = (at: number, actionName: "increment" | "decrement") => {
      player.currentTime = at
      act(() => {
        ;(
          progressBar(renderer).props as unknown as Handlers
        ).onAccessibilityAction({ nativeEvent: { actionName } })
      })
      expect(player.currentTime).toBe(at)
      return onSeek.mock.calls.at(-1)?.[0] as number
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
