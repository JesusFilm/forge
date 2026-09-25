/**
 * The Explore feed (U18): the REAL reducer, players, pager, and gate over the
 * two-player expo-video double. The test drives a stub queue (its own suite
 * covers the queue) and calls a stub overlay's callbacks.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("expo-video", () =>
  require("../../../test-utils/expoVideoMock").createExpoVideoMock({
    players: 2,
  }),
)
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)
jest.mock("expo-image", () => {
  const { createElement } = jest.requireActual(
    "react",
  ) as typeof import("react")
  return {
    __esModule: true,
    Image: (props: object) => createElement("ExpoImage", props),
  }
})
jest.mock("../ClipOverlay", () => {
  const { createElement } = jest.requireActual(
    "react",
  ) as typeof import("react")
  return {
    ClipOverlay: (props: object) => createElement("ClipOverlay", props),
  }
})
// Reduced motion commits a move at once, so no spring needs landing here.
jest.mock("../../../hooks/useReduceMotion", () => ({
  useReduceMotion: () => true,
}))
// Its native-driver loop logs a findNodeHandle error under StrictMode. The
// cases find the veil by its own test ID.
jest.mock("../../ui/CircularSpinner", () => ({ CircularSpinner: () => null }))

type Listener = () => void

// The `mock` prefix is required: babel-plugin-jest-hoist lifts jest.mock above
// these declarations and rejects any other out-of-scope name in the factory.
const mockRouter = { navigate: jest.fn() }
const mockNavigation = {
  focused: false,
  listeners: new Map<string, Set<Listener>>(),
  isFocused(): boolean {
    return this.focused
  },
  addListener(event: string, listener: Listener): () => void {
    const set = this.listeners.get(event) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(event, set)
    return () => set.delete(listener)
  },
}
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useNavigation: () => mockNavigation,
}))
jest.mock("../../../lib/explore/availability", () => ({
  isExploreAvailable: () => true,
}))
const mockPreferences = { exploreMuted: false, setExploreMuted: jest.fn() }
jest.mock("../../../contexts/WatchPreferencesProvider", () => ({
  useWatchPreferences: () => mockPreferences,
}))
jest.mock("../../../lib/explore/deviceTier", () => ({
  readDeviceTier: () => ({ totalMemoryBytes: null }),
}))
jest.mock("../../../lib/explore/appVersion", () => ({
  readAppVersion: () => "1.4.0",
}))
const mockRecord = { add: jest.fn() }
jest.mock("../../../lib/explore/clipRecord", () => ({
  getClipRecordStore: () => mockRecord,
}))
const mockQueue = {
  inputs: [] as UseExploreClipQueueInput[],
  result: null as unknown as ExploreClipQueue,
}
jest.mock("../../../hooks/useExploreClipQueue", () => ({
  useExploreClipQueue: (input: UseExploreClipQueueInput) => {
    mockQueue.inputs.push(input)
    return mockQueue.result
  },
}))

import {
  StrictMode,
  act,
  createElement,
  useEffect,
  useRef,
  type ReactElement,
} from "react"
import {
  AccessibilityInfo,
  AppState,
  type AccessibilityActionEvent,
} from "react-native"
import AsyncStorage from "@react-native-async-storage/async-storage"

import ExploreTab from "../../../../app/(tabs)/explore"
import { ExploreFeed } from "../ExploreFeed"
import { EXPLORE_PAGER_REST_DWELL_MS } from "../ExplorePager"
import type {
  ExploreClipQueue,
  UseExploreClipQueueInput,
} from "../../../hooks/useExploreClipQueue"
import {
  EXPLORE_QUALITY_TIER,
  STANDBY_LOAD_AFTER_BUFFERED_SECONDS,
} from "../../../hooks/useFeedPlayers"
import { EXPLORE_COPY } from "../../../lib/explore/copy"
import {
  DEMOTION_STORAGE_KEY,
  parseStoredDemotion,
  serializeDemotion,
} from "../../../lib/explore/demotionStore"
import { BLUR_RELEASE_GRACE_MS } from "../../../lib/explore/feedState"
import type { ReadyClip } from "../../../lib/explore/types"
import { getWatchIntentStore } from "../../../lib/explore/watchIntent"
import { muxClipStillUrl } from "../../../lib/muxThumbnail"
import { applyQualityConstraint } from "../../../lib/streamQuality"
import type {
  ExpoVideoMock,
  FakePlayer,
} from "../../../test-utils/expoVideoMock"
import {
  TestRenderer,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const video = jest.requireMock("expo-video") as ExpoVideoMock
const [A, B] = video.__players

const T0 = Date.UTC(2026, 8, 25, 10, 0, 0)
const START = 60
const END = 90
const REST = EXPLORE_PAGER_REST_DWELL_MS

// ── Fixtures ────────────────────────────────────────────────────────

function clip(n: number): ReadyClip {
  return {
    videoId: `video-${n}`,
    coreId: `core-${n}`,
    slug: `slug-${n}`,
    label: "featureFilm",
    availability: "AUDIO",
    durationSeconds: 3600,
    muxPlaybackId: `mux${n}`,
    watchLanguageSlug: "english",
    title: `Clip ${n}`,
    description: null,
    imageUrl: `https://images.example/${n}.jpg`,
    feedLanguageSlug: "english",
    streamUrl: `https://stream.mux.com/clip${n}.m3u8`,
    audioLanguageSlug: "english",
    subtitleLanguageSlug: null,
    subtitleVttSrc: null,
    subtitleOnly: false,
    window: { startSeconds: START, endSeconds: END },
    cut: "sentence",
  }
}

const feedUrl = (n: number) =>
  applyQualityConstraint(
    `https://stream.mux.com/clip${n}.m3u8`,
    EXPLORE_QUALITY_TIER,
  )

const recordEntry = (n: number) => ({
  videoId: `video-${n}`,
  languageSlug: "english",
  startSeconds: START,
  endSeconds: END,
})

function queueResult(): ExploreClipQueue {
  return {
    feedLanguageSlug: "english",
    signal: null,
    retry: jest.fn(),
    poolState: null,
    stillUri: null,
    stillLoaded: false,
  }
}

// ── The feed views: each mount and unmount is counted ───────────────

const viewLife = { mounts: 0, unmounts: 0, rebinds: 0 }

function CountingVideoView(props: Record<string, unknown>) {
  // A view that is handed the other player rebinds its surface: a black flash.
  const bound = useRef(props.player)
  if (bound.current !== props.player) viewLife.rebinds += 1
  useEffect(() => {
    viewLife.mounts += 1
    return () => {
      viewLife.unmounts += 1
    }
  }, [])
  return createElement("VideoView", props)
}

const liveViews = () => viewLife.mounts - viewLife.unmounts

// ── Harness ─────────────────────────────────────────────────────────

type Node = RenderedNode & {
  findAll: (predicate: (node: Node) => boolean) => Node[]
}

let renderer: TestInstance | null = null

function hosts(predicate: (node: Node) => boolean, root?: Node): Node[] {
  const scope = (root ?? renderer!.root) as Node
  return scope.findAll(
    (node) => typeof node.type === "string" && predicate(node),
  )
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve()
  })
}

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms)
  })
}

async function mountFeed(
  options: { focused?: boolean; strict?: boolean } = {},
) {
  let focused = options.focused ?? true
  const element = (): ReactElement => {
    const feed = <ExploreFeed focused={focused} />
    return options.strict === true ? <StrictMode>{feed}</StrictMode> : feed
  }
  await act(async () => {
    renderer = TestRenderer.create(element())
  })
  // The first focus reads the stored demotion before it resolves the mode.
  await flush()
  return {
    async setFocused(next: boolean) {
      focused = next
      await act(async () => {
        renderer!.update(element())
      })
    },
    async unmount() {
      await act(async () => {
        renderer!.unmount()
      })
      renderer = null
    },
  }
}

const latestInput = () => mockQueue.inputs[mockQueue.inputs.length - 1]

/** The queue hands the feed one clip, as `onClip` does. */
async function hand(n: number) {
  await act(async () => {
    latestInput().onClip(clip(n))
  })
}

/** Settles every swap in flight, oldest first; a reason rejects the last. */
async function settleAll(player: FakePlayer, reason?: unknown) {
  while (player.__pendingReplaceCount() > 0) {
    const last = player.__pendingReplaceCount() === 1
    await act(async () => {
      player.__settleReplace(last ? reason : undefined)
    })
  }
}

async function tick(player: FakePlayer, currentTime: number) {
  await act(async () => {
    player.__tick({
      currentTime,
      bufferedPosition: currentTime + STANDBY_LOAD_AFTER_BUFFERED_SECONDS,
    })
  })
}

function sourceUri(source: unknown): string | null {
  if (source == null) return null
  if (typeof source === "string") return source
  const uri = (source as { uri?: unknown }).uri
  return typeof uri === "string" ? uri : null
}

/** Every source handed to the player, null for a clear. */
function sources(player: FakePlayer): (string | null)[] {
  return player.replaceAsync.mock.calls.map(([source]) => sourceUri(source))
}

function loads(player: FakePlayer): string[] {
  return sources(player).filter((source): source is string => source != null)
}

function translateY(node: Node): number {
  const style = ([] as unknown[])
    .concat(node.props.style)
    .flat(Infinity)
    .filter(Boolean)
    .reduce<Record<string, unknown>>(
      (acc, part) => ({ ...acc, ...(part as Record<string, unknown>) }),
      {},
    )
  const transform = (style.transform ?? []) as Array<{ translateY?: number }>
  return transform.reduce((sum, part) => sum + (part.translateY ?? 0), 0)
}

function pageHeight(node: Node): number {
  const parts = ([] as unknown[]).concat(node.props.style).flat(Infinity)
  const sized = parts.find(
    (part) =>
      part != null && typeof (part as { height?: unknown }).height === "number",
  ) as { height: number }
  return sized.height
}

function slots(): Node[] {
  return hosts(
    (node) =>
      node.props.importantForAccessibility != null &&
      node.props.testID !== "explore-pager-underlay",
  )
}

function currentSlot(): Node {
  const current = slots().filter(
    (node) => node.props.importantForAccessibility === "auto",
  )
  expect(current).toHaveLength(1)
  return current[0]
}

function slotAt(offset: number): Node {
  const found = slots().filter((node) => translateY(node) === offset)
  expect(found).toHaveLength(1)
  return found[0]
}

function nextSlot(): Node {
  const current = currentSlot()
  return slotAt(translateY(current) + pageHeight(current))
}

function viewWrapper(id: "a" | "b"): Node {
  const [wrapper] = hosts(
    (node) => node.props.testID === `explore-feed-view-${id}`,
  )
  expect(wrapper).toBeDefined()
  return wrapper
}

function veilShown(): boolean {
  return (
    hosts((node) => node.props.testID === "explore-clip-veil", currentSlot())
      .length > 0
  )
}

function veilImage(): unknown {
  const [veil] = hosts(
    (node) => node.props.testID === "explore-clip-veil",
    currentSlot(),
  )
  const [image] = hosts((node) => node.type === "ExpoImage", veil)
  return image?.props.source
}

function covered(slot: Node): boolean {
  return (
    hosts((node) => node.props.testID === "explore-page-cover", slot).length > 0
  )
}

function overlays(): Node[] {
  return hosts((node) => node.type === "ClipOverlay")
}

function overlay(): Node {
  const found = overlays()
  expect(found).toHaveLength(1)
  return found[0]
}

function surface(): Node {
  const [found] = (renderer!.root as Node).findAll(
    (node) =>
      node.props.testID === "explore-clip-surface" &&
      typeof node.props.onPress === "function",
  )
  expect(found).toBeDefined()
  return found
}

async function tap() {
  await act(async () => {
    ;(surface().props.onPress as () => void)()
  })
}

/** R35's action on the tap surface: the same move as a swipe up. */
async function swipeNext() {
  const [element] = hosts(
    (node) => typeof node.props.onAccessibilityAction === "function",
  )
  await act(async () => {
    ;(
      element.props.onAccessibilityAction as (
        event: AccessibilityActionEvent,
      ) => void
    )({ nativeEvent: { actionName: "next" } } as AccessibilityActionEvent)
  })
}

async function callOverlay(name: string, ...args: unknown[]) {
  await act(async () => {
    ;(overlay().props[name] as (...values: unknown[]) => void)(...args)
  })
}

/** Clip 1 plays on player A. */
async function startFirstClip(options: { strict?: boolean } = {}) {
  const feed = await mountFeed(options)
  await hand(1)
  await settleAll(A)
  expect(A.playing).toBe(true)
  return feed
}

/** Clip 1 plays on A, and clip 2 waits loaded on B. */
async function startWithStandby(options: { strict?: boolean } = {}) {
  const feed = await startFirstClip(options)
  await hand(2)
  await tick(A, START + 0.5)
  await settleAll(B)
  expect(loads(B)).toEqual([feedUrl(2)])
  return feed
}

// jest-expo's AppState.addEventListener is already a mock, so it is never
// restored; each case installs its own handler list.
const appStateHandlers: ((state: string) => void)[] = []
const appStateSpy = jest.spyOn(AppState, "addEventListener")

async function sendAppState(state: string) {
  await act(async () => {
    appStateHandlers.slice().forEach((handler) => handler(state))
  })
}

beforeEach(() => {
  jest.useFakeTimers({ now: T0 })
  video.VideoView.mockImplementation(CountingVideoView)
  // The storage double's own jest.fn keeps its calls across cases.
  ;(AsyncStorage.setItem as jest.Mock).mockClear()
  mockQueue.result = queueResult()
  appStateHandlers.length = 0
  appStateSpy.mockImplementation(((
    _type: string,
    handler: (state: string) => void,
  ) => {
    appStateHandlers.push(handler)
    return {
      remove: () => {
        const at = appStateHandlers.indexOf(handler)
        if (at >= 0) appStateHandlers.splice(at, 1)
      },
    }
  }) as unknown as typeof AppState.addEventListener)
})

afterEach(async () => {
  if (renderer != null) {
    const mounted = renderer
    await act(async () => {
      mounted.unmount()
    })
    renderer = null
  }
  video.__reset()
  viewLife.mounts = 0
  viewLife.unmounts = 0
  mockQueue.inputs = []
  viewLife.rebinds = 0
  mockRecord.add.mockClear()
  mockRouter.navigate.mockClear()
  mockPreferences.exploreMuted = false
  mockNavigation.focused = false
  mockNavigation.listeners.clear()
  getWatchIntentStore().clear()
  await AsyncStorage.clear()
  jest.useRealTimers()
})

// ── R46, KTD13: the first focus ─────────────────────────────────────

describe("the first focus (R46, KTD13)", () => {
  it("starts no player, timer, or request before it, and queues the first clip after it", async () => {
    // Sync act: an async act schedules a timer of its own.
    act(() => {
      renderer = TestRenderer.create(<ExploreTab />)
    })
    expect(video.useVideoPlayer).not.toHaveBeenCalled()
    expect(mockQueue.inputs).toHaveLength(0)
    expect(jest.getTimerCount()).toBe(0)
    expect(hosts((node) => node.type === "VideoView")).toHaveLength(0)

    mockNavigation.focused = true
    await act(async () => {
      mockNavigation.listeners.get("focus")?.forEach((listener) => listener())
    })
    await flush()
    expect(video.useVideoPlayer).toHaveBeenCalled()
    expect(latestInput()).toMatchObject({ hasFocused: true, focused: true })
    expect(latestInput().wantsClip).toBe(true)

    await hand(1)
    expect(loads(A)).toEqual([feedUrl(1)])
    expect(veilShown()).toBe(true)
    expect(veilImage()).toBe("https://images.example/1.jpg")
  })
})

// ── KTD1, KTD3, R3: the feed views ──────────────────────────────────

describe("the feed views (KTD1, KTD3, R3)", () => {
  it("mounts two views once and keeps them across ten swipes, each on its clip's page", async () => {
    await startFirstClip()
    expect(liveViews()).toBe(2)

    for (let n = 2; n <= 11; n += 1) {
      if (latestInput().wantsClip) await hand(n)
      await swipeNext()
      await advance(REST)
      expect(overlay().props.clip).toMatchObject({ videoId: `video-${n}` })

      // The view on the current page draws the player that holds this clip.
      const current = translateY(currentSlot())
      const onCurrent = (["a", "b"] as const).filter(
        (id) => translateY(viewWrapper(id)) === current,
      )
      expect(onCurrent).toHaveLength(1)
      const player = onCurrent[0] === "a" ? A : B
      expect(loads(player).at(-1)).toBe(feedUrl(n))
      const other = onCurrent[0] === "a" ? "b" : "a"
      expect(translateY(viewWrapper(other))).toBe(translateY(nextSlot()))
    }

    expect(viewLife).toEqual({ mounts: 2, unmounts: 0, rebinds: 0 })
    const bound = hosts((node) => node.type === "VideoView").map(
      (node) => node.props.player,
    )
    expect(new Set(bound)).toEqual(new Set([A, B]))
  })

  it("mounts one view in one-player mode", async () => {
    await AsyncStorage.setItem(
      DEMOTION_STORAGE_KEY,
      serializeDemotion({ demotedAtMs: T0 - 60_000, appVersion: "1.4.0" }),
    )
    await startFirstClip()
    expect(liveViews()).toBe(1)
    expect(hosts((node) => node.type === "VideoView")[0].props.player).toBe(A)
  })

  it("spells no picture-in-picture prop on any feed view", async () => {
    await startWithStandby()
    const views = hosts((node) => node.type === "VideoView")
    expect(views).toHaveLength(2)
    for (const view of views) {
      const pictureInPicture = Object.keys(view.props).filter((key) =>
        /pictureinpicture/i.test(key),
      )
      expect(pictureInPicture).toEqual([])
    }
  })
})

// ── AE8: the swipe ──────────────────────────────────────────────────

describe("a swipe (AE8, R6, R7)", () => {
  it("with two players, starts a loaded clip with no veil and no second load", async () => {
    await startWithStandby()
    // The loaded standby shows its own first frame on the next page.
    expect(covered(nextSlot())).toBe(false)

    await swipeNext()
    expect(veilShown()).toBe(false)
    expect(B.playing).toBe(true)
    expect(A.playing).toBe(false)
    expect(loads(B)).toEqual([feedUrl(2)])
  })

  it("in one-player mode, shows the clip's still, then motion over it", async () => {
    await AsyncStorage.setItem(
      DEMOTION_STORAGE_KEY,
      serializeDemotion({ demotedAtMs: T0 - 60_000, appVersion: "1.4.0" }),
    )
    await startFirstClip()
    await hand(2)
    expect(covered(nextSlot())).toBe(true)
    const still = muxClipStillUrl("mux2", START)
    mockQueue.result = { ...queueResult(), stillUri: still, stillLoaded: true }

    await swipeNext()
    expect(veilShown()).toBe(true)
    expect(veilImage()).toBe(still)

    // The load waits for the pager's rest, then motion lifts the veil.
    await advance(REST)
    expect(loads(A)).toEqual([feedUrl(1), feedUrl(2)])
    await settleAll(A)
    expect(veilShown()).toBe(false)
    expect(A.playing).toBe(true)
    expect(B.replaceAsync).not.toHaveBeenCalled()
  })
})

// ── KTD13, R45: blur and return ─────────────────────────────────────

describe("a blur and a return (KTD13, R45)", () => {
  it("mutes and pauses the active clip, clears the standby at once, and releases the active after the grace", async () => {
    const feed = await startWithStandby()
    await feed.setFocused(false)

    expect(A.playing).toBe(false)
    expect(A.muted).toBe(true)
    expect(sources(B).at(-1)).toBeNull()
    expect(sources(A).at(-1)).toBe(feedUrl(1))

    await advance(BLUR_RELEASE_GRACE_MS - 1)
    expect(sources(A).at(-1)).toBe(feedUrl(1))
    await advance(1)
    expect(sources(A).at(-1)).toBeNull()
  })

  it("resumes a playing clip on a return within the grace, with no reload", async () => {
    const feed = await startWithStandby()
    await feed.setFocused(false)
    await advance(BLUR_RELEASE_GRACE_MS / 2)
    await feed.setFocused(true)

    expect(A.playing).toBe(true)
    expect(loads(A)).toEqual([feedUrl(1)])
    await advance(BLUR_RELEASE_GRACE_MS)
    expect(sources(A).at(-1)).toBe(feedUrl(1))
  })

  it("keeps a clip the viewer paused paused on a return (AE13)", async () => {
    const feed = await startWithStandby()
    await tap()
    expect(A.playing).toBe(false)
    await feed.setFocused(false)
    await feed.setFocused(true)

    expect(A.playing).toBe(false)
    expect(overlay().props.paused).toBe(true)
  })

  it("reloads the clip behind the veil at the saved position after a release", async () => {
    const feed = await startWithStandby()
    A.currentTime = 75
    await feed.setFocused(false)
    await advance(BLUR_RELEASE_GRACE_MS)
    expect(sources(A).at(-1)).toBeNull()

    await feed.setFocused(true)
    expect(veilShown()).toBe(true)
    expect(loads(A)).toEqual([feedUrl(1), feedUrl(1)])
    await settleAll(A)
    expect(A.currentTime).toBe(75)
    expect(A.playing).toBe(true)
    expect(veilShown()).toBe(false)
  })
})

// ── R3, R45: the background ─────────────────────────────────────────

describe("the background (R3, R45)", () => {
  it("pauses the clip, and a return plays a clip the system paused", async () => {
    await startWithStandby()
    await sendAppState("background")
    expect(A.playing).toBe(false)
    expect(sources(B).at(-1)).toBeNull()

    await sendAppState("active")
    expect(A.playing).toBe(true)
  })

  it("keeps a clip the viewer paused paused on a return", async () => {
    await startWithStandby()
    await tap()
    await sendAppState("background")
    await sendAppState("active")
    expect(A.playing).toBe(false)
    expect(overlay().props.paused).toBe(true)
  })

  it("does not resume a clip on a return while another tab is on screen", async () => {
    const feed = await startWithStandby()
    await feed.setFocused(false)
    await sendAppState("background")
    await sendAppState("active")
    expect(A.playing).toBe(false)
  })
})

// ── KTD22: the gesture latch ────────────────────────────────────────

describe("the gesture latch (KTD22)", () => {
  it("records a clip at play, not at preload", async () => {
    await startWithStandby()
    expect(mockRecord.add.mock.calls).toEqual([[recordEntry(1)]])
  })

  it("holds the queue and the record write until the pager rests", async () => {
    await startWithStandby()
    await swipeNext()
    // The queue's own suite proves that no step runs while this is set.
    expect(latestInput().gestureActive).toBe(true)
    expect(B.playing).toBe(true)
    expect(mockRecord.add).toHaveBeenCalledTimes(1)

    await advance(REST)
    expect(latestInput().gestureActive).toBe(false)
    expect(mockRecord.add.mock.calls.at(-1)).toEqual([recordEntry(2)])
  })
})

// ── R10, R44: the overlay and the tap ───────────────────────────────

describe("the screen reader (R35)", () => {
  it("offers next and previous on the tap surface, and moves focus to the new clip after a move", async () => {
    const sendEvent = AccessibilityInfo.sendAccessibilityEvent as jest.Mock
    await startWithStandby()
    expect(surface().props.accessibilityActions).toEqual([
      { name: "next", label: "Next clip" },
    ])
    expect(surface().props.accessibilityLabel).toBe("Clip 1")
    sendEvent.mockClear()

    await swipeNext()
    expect(surface().props.accessibilityLabel).toBe("Clip 2")
    expect(sendEvent).toHaveBeenCalledTimes(1)
    expect(sendEvent.mock.calls[0][1]).toBe("focus")
    expect(sendEvent.mock.calls[0][0]).not.toBeNull()
  })
})

describe("the overlay (R10, R44)", () => {
  it("mounts in the current slot only, and follows a swipe", async () => {
    await startWithStandby()
    expect(overlays()).toHaveLength(1)
    expect(
      hosts((node) => node.type === "ClipOverlay", currentSlot()),
    ).toHaveLength(1)
    expect(overlay().props).toMatchObject({
      isCurrent: true,
      player: A,
      muted: false,
    })

    await swipeNext()
    expect(overlays()).toHaveLength(1)
    expect(
      hosts((node) => node.type === "ClipOverlay", currentSlot()),
    ).toHaveLength(1)
    expect(overlay().props.clip).toMatchObject({ videoId: "video-2" })
    expect(overlay().props.player).toBe(B)
  })

  it("pauses and plays on a tap, with the play glyph while paused", async () => {
    await startWithStandby()
    await tap()
    expect(A.playing).toBe(false)
    expect(overlay().props.paused).toBe(true)
    await tap()
    expect(A.playing).toBe(true)
    expect(overlay().props.paused).toBe(false)
  })

  it("pauses for share or more, and resumes only a clip that was playing", async () => {
    await startWithStandby()
    await callOverlay("onOverlayOpen")
    expect(A.playing).toBe(false)
    await callOverlay("onOverlayClose")
    expect(A.playing).toBe(true)

    await tap()
    await callOverlay("onOverlayOpen")
    await callOverlay("onOverlayClose")
    expect(A.playing).toBe(false)
  })

  it("saves the mute choice through the preferences", async () => {
    await startWithStandby()
    await callOverlay("onToggleMute")
    expect(mockPreferences.setExploreMuted).toHaveBeenCalledWith(true)
  })
})

// ── R16, KTD13: "Keep watching" ─────────────────────────────────────

describe('"Keep watching" (R16, KTD13)', () => {
  it("writes the intent, opens the watch page with the seed, and releases both players at once", async () => {
    const feed = await startWithStandby()
    await callOverlay("onKeepWatching", 75)

    expect(mockRouter.navigate).toHaveBeenCalledTimes(1)
    expect(mockRouter.navigate.mock.calls[0][0]).toMatch(
      /^\/watch\/slug-1\?seed=/,
    )
    expect(getWatchIntentStore().peek("slug-1")).toMatchObject({
      startSeconds: 75,
      audioLanguageSlug: "english",
      origin: "explore",
    })
    expect(sources(A).at(-1)).toBeNull()
    expect(sources(B).at(-1)).toBeNull()
    expect(liveViews()).toBe(0)

    // The watch page blurs the tab; the next focus brings both views back.
    await feed.setFocused(false)
    expect(liveViews()).toBe(0)
    await feed.setFocused(true)
    expect(liveViews()).toBe(2)
    expect(veilShown()).toBe(true)
    await settleAll(A)
    expect(A.currentTime).toBe(75)
  })

  it("starts the watch page at the clip start while the clip is under its veil", async () => {
    await mountFeed()
    await hand(1)
    expect(veilShown()).toBe(true)
    await callOverlay("onKeepWatching", 75)
    expect(getWatchIntentStore().peek("slug-1")?.startSeconds).toBe(START)
  })
})

// ── KTD6: the first motion ──────────────────────────────────────────

describe("the look-ahead hold (KTD6)", () => {
  it("holds the queue's look-ahead until the first clip moves", async () => {
    await mountFeed()
    expect(latestInput().holdLookahead).toBe(true)
    await hand(1)
    // Loaded is not motion: the play is asked for, but no frame moves yet.
    A.play.mockImplementation(() => {})
    await settleAll(A)
    expect(latestInput().holdLookahead).toBe(true)

    await act(async () => {
      A.playing = true
      A.__emit("playingChange", { isPlaying: true })
    })
    expect(latestInput().holdLookahead).toBe(false)
    expect(mockQueue.inputs.at(-1)?.holdLookahead).toBe(false)
  })

  it("lifts the hold when the first clip fails, so the feed can move on", async () => {
    await mountFeed()
    await hand(1)
    await settleAll(A, new Error("403"))
    expect(hosts((node) => node.props.testID === "clip-failed")).toHaveLength(1)
    expect(latestInput().holdLookahead).toBe(false)
  })
})

// ── KTD3: the demotion ──────────────────────────────────────────────

describe("a demotion (KTD3)", () => {
  it("writes the stored demotion once, and the next launch reads it as one player", async () => {
    const setItem = jest.spyOn(AsyncStorage, "setItem")
    const feed = await startFirstClip()
    await hand(2)
    await tick(A, START + 0.5)
    // The first fast standby error, beside a healthy active clip.
    await settleAll(B, new Error("decoder"))

    await swipeNext()
    await advance(REST)
    await settleAll(B)
    expect(B.playing).toBe(true)
    await hand(3)
    await tick(B, START + 0.5)
    // The second one demotes the launch.
    const demotedAt = Date.now()
    await settleAll(A, new Error("decoder"))
    await flush()

    expect(liveViews()).toBe(1)
    const writes = setItem.mock.calls.filter(
      ([key]) => key === DEMOTION_STORAGE_KEY,
    )
    expect(writes).toHaveLength(1)
    expect(
      parseStoredDemotion(await AsyncStorage.getItem(DEMOTION_STORAGE_KEY)),
    ).toEqual({ demotedAtMs: demotedAt, appVersion: "1.4.0" })

    await feed.unmount()
    video.__reset()
    viewLife.mounts = 0
    viewLife.unmounts = 0
    viewLife.rebinds = 0
    await startFirstClip()
    expect(liveViews()).toBe(1)
    setItem.mockRestore()
  })
})

// ── R36, R47: the offline state ─────────────────────────────────────

describe("the offline state (R36)", () => {
  it("shows the offline message, and its retry asks the queue again", async () => {
    const feed = await mountFeed()
    mockQueue.result = { ...queueResult(), signal: "offline" }
    await feed.setFocused(true)
    const retry = (renderer!.root as Node).findAll(
      (node) =>
        node.props.accessibilityLabel === EXPLORE_COPY.retry &&
        typeof node.props.onPress === "function",
    )[0]
    expect(retry).toBeDefined()

    mockQueue.result = { ...mockQueue.result, signal: null }
    await act(async () => {
      ;(retry.props.onPress as () => void)()
    })
    expect(mockQueue.result.retry).toHaveBeenCalledTimes(1)
    expect(
      (renderer!.root as Node).findAll(
        (node) => node.props.accessibilityLabel === EXPLORE_COPY.retry,
      ),
    ).toHaveLength(0)
  })
})

// ── StrictMode ──────────────────────────────────────────────────────

describe("under StrictMode's mount, unmount, and remount", () => {
  it("loads once, keeps both views live, swipes with no veil, and resumes after a blur", async () => {
    const feed = await startWithStandby({ strict: true })
    expect(loads(A)).toEqual([feedUrl(1)])
    expect(liveViews()).toBe(2)
    expect(mockRecord.add.mock.calls).toEqual([[recordEntry(1)]])

    await swipeNext()
    expect(veilShown()).toBe(false)
    expect(B.playing).toBe(true)
    await advance(REST)

    await feed.setFocused(false)
    expect(B.playing).toBe(false)
    await feed.setFocused(true)
    expect(B.playing).toBe(true)
  })
})
