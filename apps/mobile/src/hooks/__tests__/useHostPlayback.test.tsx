/**
 * The watch route's borrow-and-publish loop (U6, part 4).
 *
 * Both halves run for real here — the root host and a stand-in for the route —
 * because the defect this closes is a RELATIONSHIP: the route used to create
 * its own player while the host held another one for the same video. A suite
 * over either half alone counts one player and calls it correct.
 *
 * The stand-in is the route's player block and nothing else. The rest of that
 * screen reaches Apollo, the downloads provider and expo-router, none of which
 * says anything about who owns the decoder.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("expo-video", () =>
  require("../../test-utils/expoVideoMock").expoVideoModuleMock(),
)
// Partial, and `useEvent` subscribes for real so a test can drive the playing
// state the adapter's one-second poll is gated on.
jest.mock("expo", () => {
  const actual = jest.requireActual("expo")
  const { useEffect, useState } = require("react")
  return {
    ...actual,
    useEvent: (
      player: {
        addListener: (
          n: string,
          cb: (p: unknown) => void,
        ) => { remove: () => void }
      },
      name: string,
      initial: unknown,
    ) => {
      const [value, setValue] = useState(initial)
      useEffect(() => {
        const sub = player.addListener(name, (payload: unknown) => {
          setValue(payload)
        })
        return () => sub.remove()
      }, [player, name])
      return value
    },
  }
})
jest.mock("expo-image", () => {
  const { View } = require("react-native")
  return { Image: View }
})
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}))
jest.mock("../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  reportDatadogAction: jest.fn(),
  reportDatadogError: jest.fn(),
}))
jest.mock("../../lib/watchProgress/store", () => ({
  applyLocalProgress: jest.fn(),
  bufferProgressIntent: jest.fn(),
}))
jest.mock("../../lib/watchProgress/signInPrompt", () => ({
  noteSignedOutPlaybackStop: jest.fn(),
}))
jest.mock("../../lib/watchProgress/syncClient", () => ({
  getProgressSync: () => ({ drainIntents: jest.fn() }),
  getSignedInAccountId: () => "account-1",
}))
jest.mock("../../lib/watchProgress/recorder", () => ({
  createProgressRecorder: jest.fn(() => ({
    flush: jest.fn(),
    onTick: jest.fn(),
  })),
}))
jest.mock("../../lib/videoQoe", () => ({
  createVideoQoeSession: jest.fn(() => ({
    onFirstPlaying: jest.fn(() => null),
    onRebuffer: jest.fn(),
    onError: jest.fn(),
    onTimeUpdate: jest.fn(),
    finalize: jest.fn(() => null),
  })),
  shouldCountRebuffer: jest.fn(() => false),
}))
// Loud, not inert: every test injects its own store, so reaching a singleton
// default is a defect in the test rather than a fallback.
jest.mock("../../lib/miniPlayer", () => ({
  getMiniPlayerStore: () => {
    throw new Error("useHostPlayback test reached the singleton store")
  },
  getMiniPlayerSheets: () => {
    throw new Error("useHostPlayback test reached the singleton sheet counter")
  },
  registerSessionEnd: () => () => {},
}))

import { act, useMemo } from "react"
import { VideoView } from "expo-video"

import { useHostPlayback } from "../useHostPlayback"
import { PlaybackHost } from "../../components/watch/PlaybackHost"
import { createSessionEndRegistry } from "../../lib/miniPlayer/endRegistry"
import {
  getPlaybackClaim,
  resetHostPlayerBridge,
  type PlaybackClaim,
} from "../../lib/miniPlayer/hostPlayer"
import {
  createMiniPlayerStore,
  type MiniPlayerStore,
} from "../../lib/miniPlayer/store"
import { createSheetCounter } from "../../lib/miniPlayer/suppression"
import { reportDatadogError } from "../../lib/datadog"
import { createProgressRecorder } from "../../lib/watchProgress/recorder"
import { createVideoQoeSession } from "../../lib/videoQoe"
import {
  createdFakePlayers,
  lastFakePlayer,
  peakMountedSurfaces,
  peakSurfacesPerPlayer,
  resetExpoVideoMock,
  type FakePlayer,
} from "../../test-utils/expoVideoMock"
import {
  TestRenderer,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

const SLUG = "birth-of-jesus"
const OTHER_SLUG = "the-last-supper"
const SEED_URL = "https://stream.test/seed.m3u8"
const CANONICAL_URL = "https://stream.test/canonical.m3u8"
const OTHER_URL = "https://stream.test/other.m3u8"
const LOCAL_FILE = "file:///offline/birth-of-jesus.m3u8"

const WATCH_SEGMENTS = ["watch", "[slug]"] as const
const HOME_SEGMENTS = ["(tabs)", "index"] as const

const createRecorderMock = createProgressRecorder as unknown as jest.Mock
const createQoeMock = createVideoQoeSession as unknown as jest.Mock

type QoeSpy = { finalize: jest.Mock }

function qoeReasons(): unknown[] {
  return createQoeMock.mock.results.flatMap((result) =>
    (result.value as QoeSpy).finalize.mock.calls.map((c) => c[0]),
  )
}

/**
 * Why the STORE ended a session, which is a different question from why the
 * adapter closed a quality session: the adapter files its own `replaced` for
 * any cross-asset URL change, including the seed → canonical re-point.
 */
let storeEndReasons: string[] = []

/** The identity every recorder built this test was keyed on. */
function recorderIdentities(): unknown[] {
  return createRecorderMock.mock.calls.map((call) => call[0])
}

type RouteProps = {
  store: MiniPlayerStore
  streamingUrl: string | null
  videoId?: string
  videoSlug?: string
  poster?: string | null
}

/**
 * The watch route's player block. It builds the claim the same way the route
 * does — memoized, slug from the route param — and mounts a surface only when
 * the hook hands it a player.
 */
function FakeWatchRoute({
  store,
  streamingUrl,
  videoId,
  videoSlug,
  poster,
}: RouteProps) {
  const claim = useMemo<PlaybackClaim | null>(
    () =>
      streamingUrl == null
        ? null
        : { videoId, videoSlug, languageSlug: null, streamingUrl },
    [streamingUrl, videoId, videoSlug],
  )
  const { player, onPlayingChange } = useHostPlayback({
    claim,
    posterUrl: poster,
    store,
  })
  routeOnPlayingChange = onPlayingChange
  routeHandles.push(onPlayingChange)
  if (player == null) return null
  return <VideoView player={player.player} />
}

/** The latest `onPlayingChange` the hook handed the route. */
let routeOnPlayingChange: (isPlaying: boolean) => void
/** Every one it handed out, so a test can prove the handle is stable. */
let routeHandles: ((isPlaying: boolean) => void)[] = []

type HarnessProps = {
  store: MiniPlayerStore
  route: RouteProps | null
  /** A second watch route pushed OVER `route`, which a native stack keeps
   *  mounted underneath. Rendered later, so it is the foreground one. */
  pushed?: RouteProps | null
  segments: readonly string[]
}

/**
 * Route first, host second — the real tree's order (the host mounts after
 * `</ExperienceShell>`), and effect order is what sequences the handoff.
 */
function Harness({ store, route, pushed, segments }: HarnessProps) {
  return (
    <>
      {route != null && <FakeWatchRoute key="under" {...route} />}
      {pushed != null && <FakeWatchRoute key="over" {...pushed} />}
      <PlaybackHost
        store={store}
        sheets={sheets}
        registerEnd={registry.register}
        useRouteSegments={() => readSegments(segments)}
        canGoBack={() => true}
        navigateToVideo={() => {}}
      />
    </>
  )
}

let live: TestInstance[] = []
let sheets: ReturnType<typeof createSheetCounter>
let registry: ReturnType<typeof createSessionEndRegistry>

/** How many times the host's boundary should still be made to catch. */
let crashesWanted = 0

/** Every catch runs `handleError`, whose first act is this report. */
function crashesCaught(): number {
  return (reportDatadogError as jest.Mock).mock.calls.length
}

/**
 * The segments read runs during `MiniPlayerWindowSlot`'s render, the deepest
 * point inside `PlaybackHostBoundary`, and a RENDER throw is the only path that
 * reaches `handleError`: `useSyncExternalStore` swallows a throwing snapshot
 * read and just forces a re-render.
 *
 * Keyed on catches rather than on a throw count because React retries a failed
 * render once and SWALLOWS the error if the retry succeeds — a one-shot rig
 * arms nothing at all.
 */
function readSegments(segments: readonly string[]): readonly string[] {
  if (crashesCaught() < crashesWanted)
    throw new Error("playback host subtree failed")
  return segments
}

/** Arms `crashes` failures, then re-renders the leaf that reads the segments. */
async function crashHost(crashes = 1) {
  crashesWanted = crashes
  await act(async () => {
    sheets.openSheet()
  })
}

function makeStore(): MiniPlayerStore {
  return createMiniPlayerStore({
    getSubjectId: () => "account-1",
    subscribeToSubject: () => () => {},
    onEnd: (_session, reason) => {
      storeEndReasons.push(reason)
      registry.end(reason)
    },
  })
}

async function render(props: HarnessProps) {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<Harness {...props} />)
  })
  live.push(renderer)
  return renderer
}

async function update(renderer: TestInstance, props: HarnessProps) {
  await act(async () => {
    renderer.update(<Harness {...props} />)
  })
}

/** Every mounted video surface, host's and route's alike. */
function videoSurfaces(renderer: TestInstance) {
  return renderer.root.findAll(
    (node) => node.props.testID === "expo-video-view",
  )
}

async function startPlaying(player: FakePlayer) {
  player.playing = true
  await act(async () => {
    player.emit("playingChange", { isPlaying: true })
  })
  // The surface reports the first true; that is the admission latch.
  await act(async () => {
    routeOnPlayingChange(true)
  })
}

async function tick(ms = 1000) {
  await act(async () => {
    jest.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
  resetExpoVideoMock()
  resetHostPlayerBridge()
  sheets = createSheetCounter()
  crashesWanted = 0
  registry = createSessionEndRegistry()
  storeEndReasons = []
  routeHandles = []
  live = []
})

afterEach(async () => {
  for (const renderer of live) {
    await act(async () => {
      try {
        renderer.unmount()
      } catch {
        // Already unmounted by the test itself.
      }
    })
  }
  live = []
  resetHostPlayerBridge()
  jest.useRealTimers()
})

describe("the watch route borrows the host's player", () => {
  it("creates exactly one player for the route's video", async () => {
    // THE regression: the route used to call the adapter itself, so a live
    // session meant two players prebuffering the same HLS URL.
    const store = makeStore()
    const renderer = await render({
      store,
      segments: WATCH_SEGMENTS,
      route: { store, streamingUrl: SEED_URL, videoId: "v1", videoSlug: SLUG },
    })

    expect(createdFakePlayers()).toHaveLength(1)
    expect(videoSurfaces(renderer)).toHaveLength(1)
  })

  it("creates no player at all while the route has no source", async () => {
    const store = makeStore()
    const renderer = await render({
      store,
      segments: WATCH_SEGMENTS,
      route: { store, streamingUrl: null, videoSlug: SLUG },
    })

    expect(createdFakePlayers()).toHaveLength(0)
    expect(videoSurfaces(renderer)).toHaveLength(0)
  })

  it("hands the route a player it can mount a surface on", async () => {
    const store = makeStore()
    const renderer = await render({
      store,
      segments: WATCH_SEGMENTS,
      route: { store, streamingUrl: SEED_URL, videoId: "v1", videoSlug: SLUG },
    })

    const surface = videoSurfaces(renderer)[0]
    expect(surface.props.player).toBe(lastFakePlayer())
  })

  it("keeps the onPlayingChange handle referentially stable", async () => {
    // It sits in the surface's dep array, and the route re-renders about every
    // two seconds while playing because the progress store writes back into it.
    const store = makeStore()
    const renderer = await render({
      store,
      segments: WATCH_SEGMENTS,
      route: { store, streamingUrl: SEED_URL, videoSlug: SLUG },
    })
    await update(renderer, {
      store,
      segments: WATCH_SEGMENTS,
      route: {
        store,
        streamingUrl: SEED_URL,
        videoSlug: SLUG,
        poster: "https://images.test/a.jpg",
      },
    })

    expect(routeHandles.length).toBeGreaterThan(1)
    expect(new Set(routeHandles).size).toBe(1)
  })
})

describe("publishing the session", () => {
  it("publishes NOTHING before playback starts, even on the way out", async () => {
    // AE10. Five pre-playback states accept a back press, and three look
    // exactly like a healthy player: chrome up, scrubber at 0:00.
    const store = makeStore()
    const renderer = await render({
      store,
      segments: WATCH_SEGMENTS,
      route: { store, streamingUrl: SEED_URL, videoId: "v1", videoSlug: SLUG },
    })
    expect(store.getSnapshot()).toBeNull()

    await update(renderer, { store, segments: HOME_SEGMENTS, route: null })

    expect(store.getSnapshot()).toBeNull()
  })

  it("publishes the identity once playback starts", async () => {
    const store = makeStore()
    await render({
      store,
      segments: WATCH_SEGMENTS,
      route: {
        store,
        streamingUrl: SEED_URL,
        videoId: "v1",
        videoSlug: SLUG,
        poster: "https://images.test/a.jpg",
      },
    })

    await startPlaying(lastFakePlayer())

    expect(store.getSnapshot()).toMatchObject({
      videoId: "v1",
      videoSlug: SLUG,
      streamingUrl: SEED_URL,
      posterUrl: "https://images.test/a.jpg",
    })
  })

  it("publishes a position the window can draw", async () => {
    const store = makeStore()
    await render({
      store,
      segments: WATCH_SEGMENTS,
      route: { store, streamingUrl: SEED_URL, videoId: "v1", videoSlug: SLUG },
    })
    const player = lastFakePlayer()
    await startPlaying(player)

    player.currentTime = 42
    player.duration = 120
    await tick()

    expect(store.getSnapshot()).toMatchObject({
      positionSeconds: 42,
      durationSeconds: 120,
    })
  })

  it("keeps the session and the player alive when the route goes", async () => {
    // R1: the whole point. The player must not be released by the pop.
    const store = makeStore()
    const renderer = await render({
      store,
      segments: WATCH_SEGMENTS,
      route: { store, streamingUrl: SEED_URL, videoId: "v1", videoSlug: SLUG },
    })
    await startPlaying(lastFakePlayer())

    await update(renderer, { store, segments: HOME_SEGMENTS, route: null })

    expect(store.getSnapshot()).toMatchObject({ videoSlug: SLUG })
    expect(createdFakePlayers()).toHaveLength(1)
    expect(videoSurfaces(renderer)).toHaveLength(1)
  })

  it("updates in place when the source re-points mid-session", async () => {
    // The seed URL resolving to the canonical one. `start` here would reset the
    // position to zero and file a `replaced` that never happened.
    const store = makeStore()
    const renderer = await render({
      store,
      segments: WATCH_SEGMENTS,
      route: { store, streamingUrl: SEED_URL, videoId: "v1", videoSlug: SLUG },
    })
    const player = lastFakePlayer()
    await startPlaying(player)
    player.currentTime = 30
    player.duration = 120
    await tick()

    await update(renderer, {
      store,
      segments: WATCH_SEGMENTS,
      route: {
        store,
        streamingUrl: CANONICAL_URL,
        videoId: "v1",
        videoSlug: SLUG,
      },
    })

    expect(store.getSnapshot()).toMatchObject({
      streamingUrl: CANONICAL_URL,
      positionSeconds: 30,
    })
    expect(storeEndReasons).toEqual([])
    expect(createdFakePlayers()).toHaveLength(1)
  })

  it("updates in place when the record resolves a videoId late", async () => {
    // The claim starts slug-only because the route param resolves before the
    // query does. A key naming both fields would re-key the host's player here.
    const store = makeStore()
    const renderer = await render({
      store,
      segments: WATCH_SEGMENTS,
      route: { store, streamingUrl: SEED_URL, videoSlug: SLUG },
    })
    await startPlaying(lastFakePlayer())

    await update(renderer, {
      store,
      segments: WATCH_SEGMENTS,
      route: { store, streamingUrl: SEED_URL, videoId: "v1", videoSlug: SLUG },
    })

    expect(store.getSnapshot()).toMatchObject({
      videoId: "v1",
      videoSlug: SLUG,
    })
    expect(storeEndReasons).toEqual([])
    expect(createdFakePlayers()).toHaveLength(1)
    // And the late id reaches the recorder, which is what the local progress
    // bars are keyed on.
    expect(recorderIdentities()).toContainEqual(
      expect.objectContaining({ videoId: "v1" }),
    )
  })

  it("replaces the published session when a second video opens", async () => {
    // AE3. Video A stops, its progress is recorded, and its quality session
    // closes as `replaced` rather than as an abandonment.
    const store = makeStore()
    const renderer = await render({
      store,
      segments: WATCH_SEGMENTS,
      route: { store, streamingUrl: SEED_URL, videoId: "v1", videoSlug: SLUG },
    })
    await startPlaying(lastFakePlayer())

    await update(renderer, {
      store,
      segments: WATCH_SEGMENTS,
      route: {
        store,
        streamingUrl: OTHER_URL,
        videoId: "v2",
        videoSlug: OTHER_SLUG,
      },
    })

    expect(storeEndReasons).toEqual(["replaced"])
    expect(qoeReasons()).toContain("replaced")
    expect(store.getSnapshot()).toBeNull()
    await startPlaying(lastFakePlayer())
    expect(store.getSnapshot()).toMatchObject({ videoSlug: OTHER_SLUG })
  })

  it("does not inherit the previous video's admission latch", async () => {
    // The latch is keyed by video. A bare boolean would publish video B the
    // instant its claim landed, before a frame of it played.
    const store = makeStore()
    const renderer = await render({
      store,
      segments: WATCH_SEGMENTS,
      route: { store, streamingUrl: SEED_URL, videoId: "v1", videoSlug: SLUG },
    })
    await startPlaying(lastFakePlayer())

    await update(renderer, {
      store,
      segments: WATCH_SEGMENTS,
      route: {
        store,
        streamingUrl: OTHER_URL,
        videoId: "v2",
        videoSlug: OTHER_SLUG,
      },
    })

    expect(store.getSnapshot()).toBeNull()
  })

  it("re-points a session it expanded onto, with no new playingChange", async () => {
    // Expanding mounts this screen over an ALREADY admitted session, and a
    // paused player emits no playingChange for the latch to catch. Without the
    // second admission door, a language switch there never reaches the store.
    const store = makeStore()
    const renderer = await render({
      store,
      segments: WATCH_SEGMENTS,
      route: { store, streamingUrl: SEED_URL, videoId: "v1", videoSlug: SLUG },
    })
    await startPlaying(lastFakePlayer())
    await update(renderer, { store, segments: HOME_SEGMENTS, route: null })

    await update(renderer, {
      store,
      segments: WATCH_SEGMENTS,
      route: {
        store,
        streamingUrl: CANONICAL_URL,
        videoId: "v1",
        videoSlug: SLUG,
      },
    })

    expect(store.getSnapshot()).toMatchObject({ streamingUrl: CANONICAL_URL })
    expect(storeEndReasons).toEqual([])
  })

  it("publishes a slug-keyed local file the same way as a stream", async () => {
    // AE8/R20. Downloaded playback has no documentId on device, so the slug is
    // the only key — and the shape the window reads must not differ.
    const store = makeStore()
    await render({
      store,
      segments: WATCH_SEGMENTS,
      route: { store, streamingUrl: LOCAL_FILE, videoSlug: SLUG },
    })
    const player = lastFakePlayer()
    await startPlaying(player)
    player.currentTime = 12
    player.duration = 60
    await tick()

    expect(store.getSnapshot()).toMatchObject({
      videoId: undefined,
      videoSlug: SLUG,
      streamingUrl: LOCAL_FILE,
      positionSeconds: 12,
      durationSeconds: 60,
    })
  })
})

describe("the surface handoff", () => {
  it("never mounts two surfaces on one player", async () => {
    // Android asserts on two views owning one player, so this is a count at
    // every step of the pop, not just at the ends.
    const store = makeStore()
    const renderer = await render({
      store,
      segments: WATCH_SEGMENTS,
      route: { store, streamingUrl: SEED_URL, videoId: "v1", videoSlug: SLUG },
    })
    await startPlaying(lastFakePlayer())
    expect(videoSurfaces(renderer)).toHaveLength(1)

    // The route's views go first; segments follow in the next commit.
    await update(renderer, { store, segments: WATCH_SEGMENTS, route: null })
    expect(videoSurfaces(renderer)).toHaveLength(1)

    await update(renderer, { store, segments: HOME_SEGMENTS, route: null })
    expect(videoSurfaces(renderer)).toHaveLength(1)
  })

  it("never leaves a playing player with no surface", async () => {
    // Measured on Android: a view that FIRST attaches to a player that has been
    // playing with no surface gets a permanently dead one, and only a new
    // player recovers it. The count may not dip to zero mid-handoff.
    const store = makeStore()
    const renderer = await render({
      store,
      segments: WATCH_SEGMENTS,
      route: { store, streamingUrl: SEED_URL, videoId: "v1", videoSlug: SLUG },
    })
    await startPlaying(lastFakePlayer())

    await update(renderer, { store, segments: WATCH_SEGMENTS, route: null })

    expect(videoSurfaces(renderer)).toHaveLength(1)
    expect(createdFakePlayers()).toHaveLength(1)
  })

  it("hands the surface back to the route on expand", async () => {
    // R4: the window is floating, the viewer taps it, the full view takes the
    // SAME player. A new player here is the audible gap R1 forbids.
    const store = makeStore()
    const renderer = await render({
      store,
      segments: WATCH_SEGMENTS,
      route: { store, streamingUrl: SEED_URL, videoId: "v1", videoSlug: SLUG },
    })
    await startPlaying(lastFakePlayer())
    await update(renderer, { store, segments: HOME_SEGMENTS, route: null })

    await update(renderer, {
      store,
      segments: WATCH_SEGMENTS,
      route: { store, streamingUrl: SEED_URL, videoId: "v1", videoSlug: SLUG },
    })

    expect(createdFakePlayers()).toHaveLength(1)
    const surface = videoSurfaces(renderer)
    expect(surface).toHaveLength(1)
    expect(surface[0].props.player).toBe(lastFakePlayer())
  })

  it("never attaches two views to one player, in ANY commit of the expand", async () => {
    // The peak across commits, not the tree after `act`. The route claims and
    // the window drops its view in the SAME commit, so a count taken at the
    // end cannot see a route that borrowed before the host published the
    // release — which is the whole job of `surfaceFree`.
    const store = makeStore()
    const renderer = await render({
      store,
      segments: WATCH_SEGMENTS,
      route: { store, streamingUrl: SEED_URL, videoId: "v1", videoSlug: SLUG },
    })
    await startPlaying(lastFakePlayer())
    await update(renderer, { store, segments: HOME_SEGMENTS, route: null })

    await update(renderer, {
      store,
      segments: WATCH_SEGMENTS,
      route: { store, streamingUrl: SEED_URL, videoId: "v1", videoSlug: SLUG },
    })

    expect(peakSurfacesPerPlayer()).toBe(1)
    expect(peakMountedSurfaces()).toBe(1)
  })
})

/**
 * The host's error boundary exists because a throw in the player subtree would
 * otherwise cost an app relaunch. Its recovery revokes every claim, so the route
 * that was watching is the one thing left holding nothing.
 */
describe("recovering from a host crash", () => {
  let consoleError: jest.SpyInstance

  beforeEach(() => {
    // React prints the caught error and its component stack. The throw is the
    // point of these tests, so the noise is not a signal.
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it("puts the route's claim back after the host drops it", async () => {
    // `claim` is unchanged by the revoke, so the effect that first set it can
    // never re-run. Without a re-assertion the screen sits there for the rest
    // of the session with no player and no surface.
    const store = makeStore()
    const renderer = await render({
      store,
      segments: WATCH_SEGMENTS,
      route: { store, streamingUrl: SEED_URL, videoId: "v1", videoSlug: SLUG },
    })
    expect(videoSurfaces(renderer)).toHaveLength(1)

    await crashHost()

    // Anti-vacuous: a rig that armed nothing would leave the tree untouched
    // and every assertion below would pass for the wrong reason.
    expect(crashesCaught()).toBe(1)
    const surface = videoSurfaces(renderer)
    expect(surface).toHaveLength(1)
    expect(surface[0].props.player).toBe(lastFakePlayer())
  })

  it("stops re-asserting instead of looping the crash", async () => {
    // A deterministic throw plus an unbounded re-assert is mount, throw,
    // revoke, re-claim, for as long as the screen is open.
    const store = makeStore()
    await render({
      store,
      segments: WATCH_SEGMENTS,
      route: { store, streamingUrl: SEED_URL, videoId: "v1", videoSlug: SLUG },
    })

    await crashHost(5)

    // The first failure, plus exactly one recovery attempt that failed too.
    // Unbounded, this reaches React's maximum update depth instead.
    expect(crashesCaught()).toBe(2)
  })

  it("does NOT re-claim for a route that has already gone", async () => {
    // Anti-vacuous companion. The re-assertion belongs to a mounted route, not
    // to a remembered claim: a departed screen taking the player back would
    // put the viewer's video behind a screen nobody is looking at.
    const store = makeStore()
    const renderer = await render({
      store,
      segments: WATCH_SEGMENTS,
      route: { store, streamingUrl: SEED_URL, videoId: "v1", videoSlug: SLUG },
    })
    await startPlaying(lastFakePlayer())
    await update(renderer, { store, segments: HOME_SEGMENTS, route: null })

    await crashHost()

    expect(crashesCaught()).toBe(1)
    expect(getPlaybackClaim()).toBeNull()
    expect(videoSurfaces(renderer)).toHaveLength(0)
  })
})

/**
 * A native stack keeps `/watch/A` mounted under `/watch/B`. Both routes run
 * `useHostPlayback`, so the claim is not one anonymous slot.
 */
describe("two watch routes on the stack", () => {
  function under(store: MiniPlayerStore): RouteProps {
    return { store, streamingUrl: SEED_URL, videoId: "v1", videoSlug: SLUG }
  }

  function over(store: MiniPlayerStore): RouteProps {
    return {
      store,
      streamingUrl: OTHER_URL,
      videoId: "v2",
      videoSlug: OTHER_SLUG,
    }
  }

  it("gives the pushed route the player and the one below none", async () => {
    const store = makeStore()
    const renderer = await render({
      store,
      segments: WATCH_SEGMENTS,
      route: under(store),
    })

    await update(renderer, {
      store,
      segments: WATCH_SEGMENTS,
      route: under(store),
      pushed: over(store),
    })

    expect(getPlaybackClaim()?.videoSlug).toBe(OTHER_SLUG)
    expect(videoSurfaces(renderer)).toHaveLength(1)
    expect(peakSurfacesPerPlayer()).toBe(1)
  })

  it("hands the player back to the route underneath when the pushed one pops", async () => {
    const store = makeStore()
    const renderer = await render({
      store,
      segments: WATCH_SEGMENTS,
      route: under(store),
      pushed: over(store),
    })

    await update(renderer, {
      store,
      segments: WATCH_SEGMENTS,
      route: under(store),
      pushed: null,
    })

    expect(getPlaybackClaim()?.videoSlug).toBe(SLUG)
    const surface = videoSurfaces(renderer)
    expect(surface).toHaveLength(1)
    expect(surface[0].props.player).toBe(lastFakePlayer())
  })

  it("keeps handing it back over repeated pushes and pops", async () => {
    // The discriminating case. A bounded re-assertion recovers the FIRST pop
    // and then has nothing left, so the screen underneath goes dead on the
    // second — open an episode, back out, open another, back out.
    const store = makeStore()
    const renderer = await render({
      store,
      segments: WATCH_SEGMENTS,
      route: under(store),
    })

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await update(renderer, {
        store,
        segments: WATCH_SEGMENTS,
        route: under(store),
        pushed: over(store),
      })
      await update(renderer, {
        store,
        segments: WATCH_SEGMENTS,
        route: under(store),
        pushed: null,
      })
      expect(getPlaybackClaim()?.videoSlug).toBe(SLUG)
      expect(videoSurfaces(renderer)).toHaveLength(1)
    }

    expect(peakSurfacesPerPlayer()).toBe(1)
  })
})
