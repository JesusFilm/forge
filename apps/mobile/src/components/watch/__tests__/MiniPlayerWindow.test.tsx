/**
 * The floating window end to end (U7): the shrink, the drag, the controls, the
 * ended and failed states, and the exit.
 *
 * The suite renders the real `PlaybackHostView` rather than the window alone,
 * because half of what U7 promises is about the video SURFACE the host owns —
 * that it survives the shrink, that it outlives the crossfade, that a failure
 * replaces it. Only module boundaries are faked (expo-video via U1's shared
 * stub, the progress recorder's collaborators, Datadog, the visual leaves).
 * Slot rects are seeded through the store because a jest render performs no
 * native layout pass.
 *
 * Two limits of this substrate, both load-bearing for how the assertions are
 * written, and both measured rather than assumed (2026-08-18, RN 0.86.2 under
 * jest-expo 57). A NATIVE-driven animation never reaches the rendered tree and
 * completes one frame after `start()` whatever its duration, because the native
 * animated module is a mock: neither its motion nor its timing is observable
 * here. So the spy below delegates JS-driven animations to the real
 * implementation — the drag's transform IS readable, which is what makes the
 * KTD5 separation directly assertable — and hands every native-driven one back
 * as a handle the test finishes when it chooses. That is what turns "the
 * surface outlives the crossfade" into a falsifiable order rather than a race.
 * The animations' real shape is pinned separately, through the config each one
 * passes to `Animated.timing`.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

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

jest.mock("expo-video", () =>
  require("../../../test-utils/expoVideoMock").createExpoVideoMock(),
)

// Live playingChange subscription so `isPlaying` tracks the fake player the way
// it does on-device. Partial: `expo` carries more than useEvent.
jest.mock("expo", () => {
  const actual = jest.requireActual("expo")
  return {
    ...actual,
    useEvent: (
      player: {
        addListener: (
          n: string,
          f: (p?: unknown) => void,
        ) => { remove: () => void }
      },
      event: string,
      initial: unknown,
    ) => {
      const r = require as unknown as NodeRequireLike
      const react = r("react") as {
        useState: <T>(v: T) => [T, (v: T) => void]
        useEffect: (fn: () => () => void, deps: unknown[]) => void
      }
      const [value, setValue] = react.useState(initial)
      react.useEffect(() => {
        const sub = player.addListener(event, (payload) =>
          setValue(payload as never),
        )
        return () => sub.remove()
      }, [player, event])
      return value
    },
  }
})

jest.mock("expo-image", () => ({ Image: () => null }))
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }))
jest.mock("expo-glass-effect", () => ({ GlassView: () => null }))
// The host renders the screen's back affordance, which is the app's existing
// router-owning component. expo-router is never imported unmocked in this repo.
jest.mock("expo-router", () => ({
  useRouter: () => ({
    back: jest.fn(),
    canGoBack: () => true,
    replace: jest.fn(),
  }),
  useSegments: () => [],
}))
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("../../ui/PlatformBlur", () => ({ PlatformBlur: () => null }))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
jest.mock("../../../lib/datadog", () => ({
  datadogLog: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  reportDatadogAction: jest.fn(),
  reportDatadogError: jest.fn(),
}))
jest.mock("../../../lib/watchProgress/store", () => ({
  applyLocalProgress: jest.fn(),
  bufferProgressIntent: jest.fn(),
}))
jest.mock("../../../lib/watchProgress/signInPrompt", () => ({
  noteSignedOutPlaybackStop: jest.fn(),
}))
jest.mock("../../../lib/watchProgress/syncClient", () => ({
  getProgressSync: () => ({ drainIntents: jest.fn() }),
  getSignedInAccountId: () => "account-1",
}))
jest.mock("../../../lib/authSession", () => {
  const SIGNED_IN = { status: "signedIn", user: { id: "user-1" } }
  return {
    getAuthSession: () => ({
      getSnapshot: () => SIGNED_IN,
      subscribe: () => () => {},
    }),
  }
})

import { act } from "react"
import {
  Animated,
  BackHandler,
  Dimensions,
  StyleSheet,
  type GestureResponderEvent,
} from "react-native"

import {
  EXIT_DURATION_MS,
  PlaybackHostView,
  SHRINK_DURATION_MS,
  TAB_BAR_CONTENT_HEIGHT,
} from "../PlaybackHost"
import {
  ENDED_FADE_DURATION_MS,
  MINI_PLAYER_DISMISS_LABEL,
  MINI_PLAYER_FAILURE_TEXT,
} from "../MiniPlayerWindow"
import {
  ACCESSIBILITY_MIN_TARGET,
  defaultCornerFrame,
  miniPlayerCornerFrame,
  type MiniPlayerLayoutConfig,
} from "../../../lib/miniPlayer/layout"
import {
  getPlaybackRequestStore,
  type PlaybackRequest,
  type PlaybackSessionDescriptor,
} from "../../../lib/miniPlayer/playbackRequest"
import { miniPlayerPresentation } from "../../../lib/miniPlayer/presentation"
import {
  getMiniPlayerStore,
  type MiniPlayerEndEvent,
} from "../../../lib/miniPlayer/store"
import { getNonRouteSheetCounter } from "../../../lib/miniPlayer/suppression"
import type { ExpoVideoMock } from "../../../test-utils/expoVideoMock"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

jest.setTimeout(20_000)

const video = jest.requireMock("expo-video") as ExpoVideoMock
const progressStore = jest.requireMock("../../../lib/watchProgress/store") as {
  bufferProgressIntent: jest.Mock
}
const requestStore = getPlaybackRequestStore()
const sessionStore = getMiniPlayerStore()
const sheetCounter = getNonRouteSheetCounter()

const URL_A = "https://stream.mux.com/assetAAA111.m3u8"
const POSTER = "https://images.example.org/poster.jpg"
const RECT = { x: 0, y: 47, width: 390, height: 219 }

const SESSION_A: PlaybackSessionDescriptor = {
  videoId: "video-a",
  videoSlug: "video-a-slug",
  title: "Video A",
  posterUrl: POSTER,
  languageSlug: "english",
  originPattern: "watch/[slug]",
}

/** The geometry the host builds for the neutral route this suite renders at:
 *  no native header, the mocked zero insets, and the constant bottom
 *  reservation the host applies on every route. */
function layoutConfig(): MiniPlayerLayoutConfig {
  const { width, height } = Dimensions.get("window")
  return {
    screen: { width, height },
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    chrome: { top: 0, bottom: TAB_BAR_CONTENT_HEIGHT },
  }
}

function makeRequest(
  overrides: Partial<PlaybackRequest> = {},
): PlaybackRequest {
  return {
    streamingUrl: URL_A,
    posterUrl: POSTER,
    subtitleVttSrc: null,
    fullscreen: false,
    autostart: true,
    resumeAtSeconds: null,
    progressVideoId: "video-a",
    progressVideoSlug: null,
    progressLanguageSlug: "english",
    onToggleFullscreen: null,
    castActive: false,
    cast: null,
    progressFeedRef: null,
    session: SESSION_A,
    ...overrides,
  }
}

// ── Tree helpers ────────────────────────────────────────────────────────────

type TypedNode = RenderedNode & { type?: unknown }

/** Host (string-typed) nodes only: a props match on a composite double-counts,
 *  because findAll returns the composite AND the host node it renders. */
function hostNodes(
  renderer: TestInstance,
  predicate: (node: RenderedNode) => boolean,
) {
  return renderer.root.findAll(
    (node) => typeof (node as TypedNode).type === "string" && predicate(node),
  )
}

function byTestId(renderer: TestInstance, id: string) {
  return hostNodes(renderer, (node) => node.props.testID === id)
}

/** A Pressable keeps `onPress` on the composite — its host view gets responder
 *  props instead — so press targets are found without the host filter. */
function pressableByTestId(renderer: TestInstance, id: string) {
  const matches = renderer.root.findAll(
    (node) =>
      node.props.testID === id && typeof node.props.onPress === "function",
  )
  expect(matches).toHaveLength(1)
  return matches[0]
}

async function press(node: RenderedNode) {
  await act(async () => {
    ;(node.props.onPress as () => void)()
  })
}

function windowRoots(renderer: TestInstance) {
  return byTestId(renderer, "mini-player-window")
}

/** Mounted video views, by component type — one per DECODER (R10). */
function videoViews(renderer: TestInstance) {
  return renderer.root.findAll(
    (node) => (node as TypedNode).type === video.VideoView,
  )
}

/** Every labelled press target on screen. */
function labelledControls(renderer: TestInstance) {
  return renderer.root.findAll(
    (node) =>
      typeof node.props.accessibilityLabel === "string" &&
      typeof node.props.onPress === "function",
  )
}

function controlByLabel(renderer: TestInstance, label: string) {
  const matches = labelledControls(renderer).filter(
    (node) => node.props.accessibilityLabel === label,
  )
  expect(matches).toHaveLength(1)
  return matches[0]
}

function styleOf(node: RenderedNode): Record<string, unknown> {
  return (StyleSheet.flatten(node.props.style as never) ??
    {}) as unknown as Record<string, unknown>
}

function transformOf(node: RenderedNode): Record<string, number> {
  const transform = styleOf(node).transform as
    | Array<Record<string, number>>
    | undefined
  return Object.assign({}, ...(transform ?? []))
}

function hasText(renderer: TestInstance, needle: string): boolean {
  return (
    renderer.root.findAll(
      (node) =>
        typeof node.props.children === "string" &&
        node.props.children.includes(needle),
    ).length > 0
  )
}

// ── Animation capture ───────────────────────────────────────────────────────

type TimingCall = {
  value: unknown
  config: { toValue: unknown; duration?: number; useNativeDriver: boolean }
  /** Native-driven only: settle it, as the device would at the end of its run. */
  finish?: () => void
}
let timingCalls: TimingCall[] = []
const realTiming = Animated.timing

function nativeTimings() {
  return timingCalls.filter((call) => call.config.useNativeDriver)
}

function nativeTiming(duration: number): TimingCall {
  const matches = nativeTimings().filter(
    (call) => call.config.duration === duration,
  )
  expect(matches).toHaveLength(1)
  return matches[0]
}

async function finishNative(duration: number) {
  const animation = nativeTiming(duration)
  await act(async () => {
    animation.finish?.()
  })
}

// ── Harness ─────────────────────────────────────────────────────────────────

let mounted: TestInstance | null = null
let canGoBackAnswer = true
const onExpand = jest.fn()
const backHandlers: Array<() => boolean> = []

function attachSlot(
  overrides: Partial<PlaybackRequest> = {},
  rect: typeof RECT | null = RECT,
) {
  const id = requestStore.attachSlot(makeRequest(overrides))
  if (rect != null) requestStore.setSlotRect(id, rect)
  return id
}

async function renderHost(): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      <PlaybackHostView
        segments={[]}
        canGoBack={() => canGoBackAnswer}
        onExpand={onExpand}
      />,
    )
  })
  mounted = renderer
  return renderer
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms)
  })
}

/** The shrink reaching its corner, which is what releases the chrome. */
async function settle() {
  await finishNative(SHRINK_DURATION_MS)
}

/** Play, then back out: the state every window scenario starts from. */
async function floatWindow(
  overrides: Partial<PlaybackRequest> = {},
): Promise<TestInstance> {
  const id = attachSlot(overrides)
  const renderer = await renderHost()
  await act(async () => {
    video.__player.play()
  })
  await act(async () => {
    requestStore.detachSlot(id)
  })
  return renderer
}

/**
 * A single-finger touch, carrying the history `PanResponder` derives its own
 * gesture state from. Driving the real handlers rather than a synthesized
 * gesture state is the point: the responder the view receives is the one under
 * test, accumulation and move-guard included.
 */
let touchClock = 1000
function touchAt(
  x: number,
  y: number,
  previous: { x: number; y: number } = { x: 0, y: 0 },
): GestureResponderEvent {
  touchClock += 16
  return {
    nativeEvent: { touches: [], changedTouches: [] },
    touchHistory: {
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: touchClock,
      touchBank: [
        {
          touchActive: true,
          startPageX: previous.x,
          startPageY: previous.y,
          startTimeStamp: touchClock - 32,
          currentPageX: x,
          currentPageY: y,
          currentTimeStamp: touchClock,
          previousPageX: previous.x,
          previousPageY: previous.y,
          previousTimeStamp: touchClock - 16,
        },
      ],
    },
  } as unknown as GestureResponderEvent
}

type PanHandlers = {
  onStartShouldSetResponder: (e: GestureResponderEvent) => boolean
  onMoveShouldSetResponderCapture: (e: GestureResponderEvent) => boolean
  onMoveShouldSetResponder: (e: GestureResponderEvent) => boolean
  onResponderGrant: (e: GestureResponderEvent) => void
  onResponderMove: (e: GestureResponderEvent) => void
  onResponderRelease: (e: GestureResponderEvent) => void
}

/**
 * One move, dispatched the way the responder system dispatches it: capture
 * first, then bubble. Only the capture wrapper folds the touch into
 * `PanResponder`'s own gesture state, so a bubble-only call would ask the
 * window to decide on a gesture that had not moved.
 */
function offerMove(
  handlers: PanHandlers,
  event: GestureResponderEvent,
): boolean {
  handlers.onMoveShouldSetResponderCapture(event)
  return handlers.onMoveShouldSetResponder(event)
}

function panHandlers(renderer: TestInstance): PanHandlers {
  return windowRoots(renderer)[0].props as unknown as PanHandlers
}

beforeEach(() => {
  jest.useFakeTimers()
  timingCalls = []
  jest.spyOn(Animated, "timing").mockImplementation((value, config) => {
    const call: TimingCall = { value, config }
    timingCalls.push(call)
    if (!config.useNativeDriver) return realTiming(value, config)
    return {
      start: (callback?: (result: { finished: boolean }) => void) => {
        call.finish = () => callback?.({ finished: true })
      },
      stop: () => {},
      reset: () => {},
      // `Animated.loop` reaches for these on whatever it is given, and the
      // spinner inside the loading veil is one of the animations held here.
      _isUsingNativeDriver: () => true,
      _startNativeLoop: () => {},
    } as unknown as Animated.CompositeAnimation
  })
  backHandlers.length = 0
  jest
    .spyOn(BackHandler, "addEventListener")
    .mockImplementation((_, handler) => {
      const fn = handler as unknown as () => boolean
      backHandlers.push(fn)
      return {
        remove: () => {
          const at = backHandlers.indexOf(fn)
          if (at !== -1) backHandlers.splice(at, 1)
        },
      }
    })
  video.__reset()
  onExpand.mockClear()
  progressStore.bufferProgressIntent.mockClear()
  canGoBackAnswer = true
  requestStore.reset()
  sheetCounter.close("sduiQuiz")
  sheetCounter.close("libraryDeleteConfirm")
  sessionStore.setPipHold(false)
  sessionStore.end("abandoned")
})

afterEach(async () => {
  if (mounted != null) {
    await act(async () => {
      mounted?.unmount()
    })
    mounted = null
  }
  requestStore.reset()
  sessionStore.end("abandoned")
  jest.restoreAllMocks()
  jest.useRealTimers()
})

describe("shape and accessibility (R5, R8, R26)", () => {
  it("exposes exactly one accessible root carrying a label and a dismiss action", async () => {
    const renderer = await floatWindow()
    await settle()

    const roots = windowRoots(renderer)
    expect(roots).toHaveLength(1)
    expect(roots[0].props.accessible).toBe(true)
    expect(roots[0].props.accessibilityRole).toBe("button")
    expect(roots[0].props.accessibilityLabel).toContain("Video A")
    const actions = roots[0].props.accessibilityActions as Array<{
      name: string
    }>
    expect(actions.map((action) => action.name)).toEqual([
      "activate",
      "playPause",
      "moveToCorner",
      "dismiss",
    ])
    expect(typeof roots[0].props.onAccessibilityAction).toBe("function")
  })

  it("acts on each declared accessibility action as its visible control does", async () => {
    const renderer = await floatWindow()
    await settle()
    const act_ = (name: string) =>
      act(async () => {
        ;(
          windowRoots(renderer)[0].props.onAccessibilityAction as (event: {
            nativeEvent: { actionName: string }
          }) => void
        )({ nativeEvent: { actionName: name } })
      })
    const config = layoutConfig()
    const base = defaultCornerFrame(config)
    const next = miniPlayerCornerFrame(config, "bottomLeft")

    await act_("playPause")
    expect(video.__player.playing).toBe(false)
    await act_("moveToCorner")
    await advance(400)
    expect(transformOf(byTestId(renderer, "playback-frame")[0])).toEqual({
      translateX: next.x - base.x,
      translateY: next.y - base.y,
    })
    await act_("activate")
    expect(onExpand).toHaveBeenCalledTimes(1)
    await act_("dismiss")
    expect(sessionStore.getSnapshot().dismissal).toBe("exiting")
  })

  it("sets nothing of the focus-containment shape, so it cannot trap focus", async () => {
    const renderer = await floatWindow()
    await settle()

    const root = windowRoots(renderer)[0]
    expect(root.props.accessibilityViewIsModal).toBeUndefined()
    expect(root.props["aria-modal"]).toBeUndefined()
    expect(root.props.importantForAccessibility).toBeUndefined()
    expect(root.props.accessibilityElementsHidden).toBeUndefined()
  })

  it("carries exactly play-pause and dismiss as labelled controls", async () => {
    const renderer = await floatWindow()
    await settle()

    // The full-screen chrome and the screen's back affordance are both gone
    // with the surface, so every labelled target on screen is the window's.
    expect(
      labelledControls(renderer)
        .map((node) => node.props.accessibilityLabel)
        .sort(),
    ).toEqual([MINI_PLAYER_DISMISS_LABEL, "Pause"])
  })

  it("puts play-pause top-left and dismiss top-right, shadowed with no backplate", async () => {
    const renderer = await floatWindow()
    await settle()

    // KTD6 sizes the window around two of these, so each has to be worth the
    // width it reserves: the glyph box plus its slop reaches the floor.
    for (const label of ["Pause", MINI_PLAYER_DISMISS_LABEL]) {
      const control = controlByLabel(renderer, label)
      const size = styleOf(control).width as number
      const slop = control.props.hitSlop as number
      expect(size + slop * 2).toBeGreaterThanOrEqual(ACCESSIBILITY_MIN_TARGET)
    }

    const play = styleOf(controlByLabel(renderer, "Pause"))
    const dismiss = styleOf(controlByLabel(renderer, MINI_PLAYER_DISMISS_LABEL))

    expect(play.left).toEqual(expect.any(Number))
    expect(play.right).toBeUndefined()
    expect(dismiss.right).toEqual(expect.any(Number))
    expect(dismiss.left).toBeUndefined()
    for (const control of [play, dismiss]) {
      expect(control.top).toEqual(expect.any(Number))
      expect(control.shadowOpacity as number).toBeGreaterThan(0)
      // KTD8: no scrim, backplate, blur or translucent layer.
      expect(control.backgroundColor).toBeUndefined()
    }
  })

  it("renders no subtitle layer, and the native subtitle track stays null", async () => {
    const renderer = await floatWindow({ subtitleVttSrc: "https://s/en.vtt" })
    await settle()

    expect(windowRoots(renderer)).toHaveLength(1)
    expect(
      renderer.root.findAll(
        (node) => node.props.accessibilityLabel === "Subtitles",
      ),
    ).toHaveLength(0)
    expect(hasText(renderer, "WEBVTT")).toBe(false)

    video.__player.subtitleTrack = { label: "English", language: "en" } as never
    await act(async () => {
      video.__player.__emit("availableSubtitleTracksChange")
    })
    expect(video.__player.subtitleTrack).toBeNull()
  })
})

describe("drag (R2, KTD5)", () => {
  it("claims a drag and rejects a tap", async () => {
    const renderer = await floatWindow()
    await settle()
    const handlers = panHandlers(renderer)

    expect(handlers.onStartShouldSetResponder(touchAt(0, 0))).toBe(false)
    expect(offerMove(handlers, touchAt(1, 1))).toBe(false)
    expect(offerMove(handlers, touchAt(24, 6, { x: 1, y: 1 }))).toBe(true)
  })

  it("leaves a touch that begins on a control to the control", async () => {
    const renderer = await floatWindow()
    await settle()
    const handlers = panHandlers(renderer)
    const dismiss = controlByLabel(renderer, MINI_PLAYER_DISMISS_LABEL)

    await act(async () => {
      ;(dismiss.props.onPressIn as () => void)()
    })
    expect(offerMove(handlers, touchAt(60, 60))).toBe(false)

    await act(async () => {
      ;(dismiss.props.onPressOut as () => void)()
    })
    expect(offerMove(handlers, touchAt(120, 120, { x: 60, y: 60 }))).toBe(true)
  })

  it("settles a release into the corner the layout geometry names", async () => {
    const renderer = await floatWindow()
    await settle()
    const config = layoutConfig()
    const base = defaultCornerFrame(config)
    const target = miniPlayerCornerFrame(config, "topLeft")
    const handlers = panHandlers(renderer)

    // Far enough up and left that the release lands in the top-left quadrant,
    // whatever screen the runner reports.
    const move = { x: target.x - base.x, y: target.y - base.y }
    await act(async () => {
      handlers.onResponderGrant(touchAt(0, 0))
      handlers.onResponderMove(touchAt(move.x, move.y))
    })
    expect(transformOf(byTestId(renderer, "playback-frame")[0])).toEqual({
      translateX: move.x,
      translateY: move.y,
    })

    await act(async () => {
      handlers.onResponderRelease(touchAt(move.x, move.y))
    })
    await advance(400)

    expect(transformOf(byTestId(renderer, "playback-frame")[0])).toEqual({
      translateX: target.x - base.x,
      translateY: target.y - base.y,
    })
  })

  it("runs the shrink natively on a wrapper the drag never writes", async () => {
    const id = attachSlot()
    const renderer = await renderHost()
    await act(async () => {
      video.__player.play()
    })
    await act(async () => {
      requestStore.detachSlot(id)
    })

    // KTD17: the shrink is ANCHORED at the measured rect it departs from, so
    // its first frame is identity — the native driver's late transform attach
    // then has nothing to flash — and the ramp carries it to the corner.
    const motion = transformOf(byTestId(renderer, "playback-motion")[0])
    expect(motion.scale).toBeCloseTo(1, 5)
    expect(motion.translateX).toBeCloseTo(0, 5)
    expect(styleOf(byTestId(renderer, "playback-frame")[0])).toMatchObject({
      left: RECT.x,
      top: RECT.y,
    })
    expect(nativeTiming(SHRINK_DURATION_MS).config.toValue).toBe(1)
    // The drag node holds no offset while the shrink runs.
    expect(transformOf(byTestId(renderer, "playback-frame")[0])).toEqual({
      translateX: 0,
      translateY: 0,
    })

    await settle()
    const handlers = panHandlers(renderer)
    await act(async () => {
      handlers.onResponderGrant(touchAt(0, 0))
      handlers.onResponderMove(touchAt(-20, -20))
      handlers.onResponderRelease(touchAt(-20, -20))
    })

    // Nothing native ever targets the value the PanResponder writes, and the
    // node that carries it is not the node the shrink transforms. The x and y
    // components count: attaching a native animation to either of them is the
    // same silently-frozen window KTD5 forbids.
    const dragTargets: unknown[] = []
    for (const call of timingCalls.filter(
      (call) => !call.config.useNativeDriver,
    )) {
      const xy = call.value as { x?: unknown; y?: unknown }
      dragTargets.push(call.value, xy.x, xy.y)
    }
    expect(dragTargets.filter(Boolean).length).toBeGreaterThan(2)
    expect(nativeTimings().length).toBeGreaterThan(0)
    for (const native of nativeTimings())
      expect(dragTargets).not.toContain(native.value)
    expect(byTestId(renderer, "playback-frame")[0]).not.toBe(
      byTestId(renderer, "playback-motion")[0],
    )
  })

  it("releases the chrome on a timer even if the shrink never settles", async () => {
    const renderer = await floatWindow()
    expect(labelledControls(renderer)).toHaveLength(0)

    // The shrink animation is left unfinished on purpose: a chrome gate with no
    // unconditional release strands the viewer with no controls and no way out.
    await advance(SHRINK_DURATION_MS + 400)

    expect(labelledControls(renderer)).toHaveLength(2)
    expect(pressableByTestId(renderer, "mini-player-expand")).toBeDefined()
  })
})

describe("presentation (R3, R4, R11)", () => {
  it("renders no window while a sheet is presented, and returns to the same corner", async () => {
    const renderer = await floatWindow()
    await settle()
    expect(windowRoots(renderer)).toHaveLength(1)

    // Somewhere other than the corner it opened in, so "returns to the corner
    // it occupied" is a claim this can actually fail.
    const config = layoutConfig()
    const target = miniPlayerCornerFrame(config, "topLeft")
    const base = defaultCornerFrame(config)
    const handlers = panHandlers(renderer)
    await act(async () => {
      handlers.onResponderGrant(touchAt(0, 0))
      handlers.onResponderMove(touchAt(target.x - base.x, target.y - base.y))
      handlers.onResponderRelease(touchAt(target.x - base.x, target.y - base.y))
    })
    await advance(400)
    const corner = transformOf(byTestId(renderer, "playback-frame")[0])

    await act(async () => {
      sheetCounter.open("sduiQuiz")
    })

    expect(miniPlayerPresentation(sessionStore.getSnapshot(), [], 1)).toBe(
      "hidden",
    )
    expect(windowRoots(renderer)).toHaveLength(0)
    // KTD16/KTD10: the view stays mounted and unmoved — only the chrome stops.
    expect(videoViews(renderer)).toHaveLength(1)
    expect(styleOf(byTestId(renderer, "playback-frame")[0]).opacity).toBe(0)
    expect(transformOf(byTestId(renderer, "playback-frame")[0])).toEqual(corner)

    await act(async () => {
      sheetCounter.close("sduiQuiz")
    })

    expect(windowRoots(renderer)).toHaveLength(1)
    expect(transformOf(byTestId(renderer, "playback-frame")[0])).toEqual(corner)
    expect(corner).toEqual({
      translateX: target.x - base.x,
      translateY: target.y - base.y,
    })
  })

  it("picks a drag up from the corner it returned to, not from the base frame", async () => {
    const renderer = await floatWindow()
    await settle()
    const config = layoutConfig()
    const base = defaultCornerFrame(config)
    const target = miniPlayerCornerFrame(config, "topLeft")
    const offset = { x: target.x - base.x, y: target.y - base.y }

    const dragTo = async (to: { x: number; y: number }) => {
      const handlers = panHandlers(renderer)
      await act(async () => {
        handlers.onResponderGrant(touchAt(0, 0))
        handlers.onResponderMove(touchAt(to.x, to.y))
        handlers.onResponderRelease(touchAt(to.x, to.y))
      })
      await advance(400)
    }

    await dragTo(offset)
    await act(async () => {
      sheetCounter.open("sduiQuiz")
    })
    await act(async () => {
      sheetCounter.close("sduiQuiz")
    })

    // The remounted window inherits a drag node the host left at the corner. A
    // grab that reads its own default instead would start this move from zero,
    // throwing the window across the screen on the first finger movement.
    const nudge = { x: 9, y: 7 }
    const handlers = panHandlers(renderer)
    await act(async () => {
      handlers.onResponderGrant(touchAt(0, 0))
      handlers.onResponderMove(touchAt(nudge.x, nudge.y))
    })

    expect(transformOf(byTestId(renderer, "playback-frame")[0])).toEqual({
      translateX: offset.x + nudge.x,
      translateY: offset.y + nudge.y,
    })
  })

  it("renders nothing at all with no session", async () => {
    const id = attachSlot()
    const renderer = await renderHost()

    // Backed out before playback started: no session, so no window is owed.
    await act(async () => {
      requestStore.detachSlot(id)
    })

    expect(miniPlayerPresentation(sessionStore.getSnapshot(), [])).toBe("none")
    expect(windowRoots(renderer)).toHaveLength(0)
    expect(videoViews(renderer)).toHaveLength(0)
  })

  it("hands the current video to the injected navigate callback on a tap", async () => {
    const renderer = await floatWindow()
    await settle()

    await press(pressableByTestId(renderer, "mini-player-expand"))

    expect(onExpand).toHaveBeenCalledTimes(1)
    expect(onExpand.mock.calls[0][0]).toMatchObject({
      videoId: "video-a",
      videoSlug: "video-a-slug",
    })
  })
})

describe("controls (R5)", () => {
  it("flips the play-pause label when it is pressed", async () => {
    const renderer = await floatWindow()
    await settle()

    await press(controlByLabel(renderer, "Pause"))

    expect(video.__player.playing).toBe(false)
    expect(controlByLabel(renderer, "Play")).toBeDefined()
  })

  it("seeds play-pause from the live player on every mount", async () => {
    const renderer = await floatWindow()
    await settle()
    await act(async () => {
      sheetCounter.open("sduiQuiz")
    })
    // Paused while the window was unmounted: a control seeded once at first
    // mount would come back still reading "Pause".
    await act(async () => {
      video.__player.pause()
    })

    await act(async () => {
      sheetCounter.close("sduiQuiz")
    })

    expect(controlByLabel(renderer, "Play")).toBeDefined()
  })

  it("moves the position indicator on the adapter's one-second poll", async () => {
    const renderer = await floatWindow()
    await settle()
    expect(
      styleOf(byTestId(renderer, "mini-player-position-fill")[0]).width,
    ).toBe("0%")

    video.__player.currentTime = 30
    video.__player.duration = 120
    await advance(1000)

    expect(
      styleOf(byTestId(renderer, "mini-player-position-fill")[0]).width,
    ).toBe("25%")
  })
})

describe("end of playback (R21, R27)", () => {
  it("crossfades the thumbnail in over the still-mounted surface, releasing it only on completion", async () => {
    const renderer = await floatWindow()
    await settle()
    const endings: MiniPlayerEndEvent[] = []
    const unsubscribe = sessionStore.onEnd((event) => endings.push(event))

    await act(async () => {
      video.__player.__emit("playToEnd")
    })

    // The thumbnail rises from fully transparent over the live surface, and
    // the surface is still there for the whole of it.
    const fade = nativeTiming(ENDED_FADE_DURATION_MS)
    expect(fade.config.toValue).toBe(1)
    expect(
      styleOf(byTestId(renderer, "mini-player-thumbnail")[0]).opacity,
    ).toBe(0)
    expect(videoViews(renderer)).toHaveLength(1)
    await advance(1000)
    expect(videoViews(renderer)).toHaveLength(1)

    await finishNative(ENDED_FADE_DURATION_MS)

    expect(videoViews(renderer)).toHaveLength(0)
    expect(windowRoots(renderer)).toHaveLength(1)
    expect(sessionStore.getSnapshot().session?.phase).toBe("ended")
    expect(endings.map((event) => event.reason)).toEqual(["ended"])
    unsubscribe()
  })

  it("replays into the window, and keeps dismiss and tap-to-expand alive", async () => {
    const renderer = await floatWindow()
    await settle()
    await act(async () => {
      video.__player.__emit("playToEnd")
    })
    await finishNative(ENDED_FADE_DURATION_MS)
    video.__player.currentTime = 90

    // Still operable in the ended state (R27).
    await press(pressableByTestId(renderer, "mini-player-expand"))
    expect(onExpand).toHaveBeenCalledTimes(1)
    expect(controlByLabel(renderer, MINI_PLAYER_DISMISS_LABEL)).toBeDefined()

    await press(controlByLabel(renderer, "Replay"))

    expect(video.__player.currentTime).toBe(0)
    expect(video.__player.playing).toBe(true)
    expect(sessionStore.getSnapshot().session?.phase).toBe("playing")
    // The surface comes back with it.
    expect(videoViews(renderer)).toHaveLength(1)
    expect(windowRoots(renderer)).toHaveLength(1)
  })
})

describe("stream failure (R22)", () => {
  it("swaps the surface for the poster, labels the failure, and closes as failed", async () => {
    const renderer = await floatWindow()
    await settle()
    const endings: MiniPlayerEndEvent[] = []
    const unsubscribe = sessionStore.onEnd((event) => endings.push(event))

    await act(async () => {
      video.__player.__emit("statusChange", { status: "error" })
    })

    expect(videoViews(renderer)).toHaveLength(0)
    expect(
      styleOf(byTestId(renderer, "mini-player-thumbnail")[0]).opacity,
    ).toBe(1)
    expect(hasText(renderer, MINI_PLAYER_FAILURE_TEXT)).toBe(true)
    expect(endings.map((event) => event.reason)).toEqual(["failed"])

    // Dismiss and tap-to-expand still respond.
    await press(pressableByTestId(renderer, "mini-player-expand"))
    expect(onExpand).toHaveBeenCalledTimes(1)
    await press(controlByLabel(renderer, MINI_PLAYER_DISMISS_LABEL))
    expect(sessionStore.getSnapshot().dismissal).toBe("exiting")
    unsubscribe()
  })
})

describe("dismissal (R6, R23) and bookkeeping (R20)", () => {
  it("keeps the window mounted through the exit and removes it on completion", async () => {
    const renderer = await floatWindow()
    await settle()

    await press(controlByLabel(renderer, MINI_PLAYER_DISMISS_LABEL))

    expect(miniPlayerPresentation(sessionStore.getSnapshot(), [])).toBe(
      "exiting",
    )
    // Downward, off the bottom edge.
    const exit = nativeTiming(EXIT_DURATION_MS)
    expect(exit.config.toValue as number).toBeGreaterThan(
      layoutConfig().screen.height - defaultCornerFrame(layoutConfig()).y,
    )
    // Playback stops with the dismissal, and the window is still on screen for
    // the whole of the exit. Bounded, not arbitrary: the host also releases the
    // session on a timer, so waiting past that would clear it without the
    // animation ever reporting (PlaybackHost's EXIT_RELEASE_SLACK_MS).
    expect(video.__player.playing).toBe(false)
    await advance(EXIT_DURATION_MS - 20)
    expect(windowRoots(renderer)).toHaveLength(1)
    expect(sessionStore.getSnapshot().session).not.toBeNull()

    await finishNative(EXIT_DURATION_MS)

    expect(sessionStore.getSnapshot().session).toBeNull()
    expect(windowRoots(renderer)).toHaveLength(0)
    expect(videoViews(renderer)).toHaveLength(0)
  })

  it("claims a back press at a tab root, and claims nothing without a session", async () => {
    const renderer = await floatWindow()
    await settle()
    expect(backHandlers).toHaveLength(1)

    // Nowhere left to pop: the press dismisses the window instead of leaving.
    canGoBackAnswer = false
    let handled: boolean | undefined
    await act(async () => {
      handled = backHandlers[0]()
    })
    expect(handled).toBe(true)
    expect(miniPlayerPresentation(sessionStore.getSnapshot(), [])).toBe(
      "exiting",
    )
    await finishNative(EXIT_DURATION_MS)

    // Session gone, handler gone: an ordinary press is nobody's business.
    expect(windowRoots(renderer)).toHaveLength(0)
    expect(backHandlers).toHaveLength(0)
  })

  it("declines a back press the navigator can still answer", async () => {
    await floatWindow()
    await settle()

    canGoBackAnswer = true
    let handled: boolean | undefined
    await act(async () => {
      handled = backHandlers[0]()
    })

    expect(handled).toBe(false)
    expect(sessionStore.getSnapshot().dismissal).toBe("none")
  })

  it("plays a local file in the window and records progress on dismissal", async () => {
    const renderer = await floatWindow({
      streamingUrl: "file:///offline/downloaded-slug/video.mp4",
      progressVideoId: null,
      progressVideoSlug: "downloaded-slug",
      progressLanguageSlug: null,
      session: {
        videoId: null,
        videoSlug: "downloaded-slug",
        title: "A downloaded video",
        posterUrl: POSTER,
        languageSlug: null,
        originPattern: "watch/[slug]",
      },
    })
    await settle()
    expect(videoViews(renderer)).toHaveLength(1)
    expect(videoViews(renderer)[0].props.player).toBe(video.__player)

    video.__player.duration = 600
    video.__player.currentTime = 12
    await advance(1000)
    video.__player.currentTime = 30
    await advance(1000)
    const beforeDismiss = progressStore.bufferProgressIntent.mock.calls.length

    await press(controlByLabel(renderer, MINI_PLAYER_DISMISS_LABEL))

    const calls = progressStore.bufferProgressIntent.mock.calls
    expect(calls.length).toBeGreaterThan(beforeDismiss)
    expect(calls[calls.length - 1][0]).toMatchObject({
      videoSlug: "downloaded-slug",
      positionSeconds: 30,
      durationSeconds: 600,
    })
  })
})
