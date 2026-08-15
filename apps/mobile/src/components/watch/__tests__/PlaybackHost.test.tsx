/**
 * The root-owned playback host (U6). It creates the ONE player for whatever
 * the session store publishes, feeds the adapter's one-second poll back into
 * the store, and keeps the router read in its innermost leaf.
 *
 * The host renders no surface in U6, so every assertion here is about the
 * player's lifetime, the position feed, and which presentation the leaf
 * resolves — not about pixels.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("expo-video", () =>
  require("../../../test-utils/expoVideoMock").expoVideoModuleMock(),
)
// Partial, and `useEvent` subscribes for real so a test can drive the playing
// state the adapter's poll is gated on.
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
// expo-image and the icon set arrive through MiniPlayerWindow (U7). expo-blur
// and expo-linear-gradient stay unmocked on purpose: the host still reaches
// neither, and PlaybackHost.coldLaunch.guard.test.js holds that.
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
jest.mock("../../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
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
jest.mock("../../../lib/watchProgress/recorder", () => ({
  createProgressRecorder: jest.fn(() => ({
    flush: jest.fn(),
    onTick: jest.fn(),
  })),
}))
jest.mock("../../../lib/videoQoe", () => ({
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
// default is a defect in the test, not a fallback.
jest.mock("../../../lib/miniPlayer", () => ({
  getMiniPlayerStore: () => {
    throw new Error("PlaybackHost test reached the singleton store")
  },
  getMiniPlayerSheets: () => {
    throw new Error("PlaybackHost test reached the singleton sheet counter")
  },
  registerSessionEnd: () => () => {},
}))

import { act } from "react"
import { Platform, StyleSheet, View } from "react-native"
import type { VideoPlayer as ExpoVideoPlayer } from "expo-video"

import {
  MINI_PLAYER_KEEPALIVE_SLOT,
  MINI_PLAYER_WINDOW_SLOT,
  PlaybackHost,
} from "../PlaybackHost"
import { useMiniPlayerSheet } from "../../../hooks/useMiniPlayerSheet"
import { applyWatchBufferOptions } from "../../../lib/playerBufferOptions"
import { createSessionEndRegistry } from "../../../lib/miniPlayer/endRegistry"
import {
  createMiniPlayerStore,
  type MiniPlayerSession,
  type MiniPlayerStore,
} from "../../../lib/miniPlayer/store"
import {
  createSheetCounter,
  type SheetCounter,
} from "../../../lib/miniPlayer/suppression"
import {
  claimPlayback,
  createClaimToken,
  getHostPlayer,
  releasePlaybackClaim,
  resetHostPlayerBridge,
  type PlaybackClaim,
} from "../../../lib/miniPlayer/hostPlayer"
import {
  resetPictureInPictureLatch,
  setPictureInPictureActive,
} from "../../../lib/miniPlayer/pipLatch"
import { createProgressRecorder } from "../../../lib/watchProgress/recorder"
import { createVideoQoeSession } from "../../../lib/videoQoe"
import { reportDatadogError } from "../../../lib/datadog"
import {
  createdFakePlayers,
  lastFakePlayer,
  resetExpoVideoMock,
  type FakePlayer,
} from "../../../test-utils/expoVideoMock"
import {
  TestRenderer,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const EPISODE_ONE = "https://stream.test/one.m3u8"
const EPISODE_TWO = "https://stream.test/two.m3u8"
const OFFLINE_ONE = "file:///offline/one.m3u8"

const HOME_SEGMENTS = ["(tabs)", "index"] as const
const WATCH_SEGMENTS = ["watch", "[slug]"] as const

const LIVE_SESSION: MiniPlayerSession = {
  videoId: "video-1",
  languageSlug: "english",
  streamingUrl: EPISODE_ONE,
  positionSeconds: 0,
  durationSeconds: 0,
  subjectId: "account-1",
}

const createRecorderMock = createProgressRecorder as unknown as jest.Mock
const createQoeMock = createVideoQoeSession as unknown as jest.Mock

type RecorderSpy = { flush: jest.Mock; onTick: jest.Mock }
type QoeSpy = { finalize: jest.Mock }

/** Every flush trigger seen this test, in order — the reason vocabulary. */
function flushTriggers(): unknown[] {
  return createRecorderMock.mock.results
    .flatMap((result) => (result.value as RecorderSpy)?.flush.mock.calls ?? [])
    .map((call) => call[0])
}

function qoeSessions(): QoeSpy[] {
  return createQoeMock.mock.results.map((result) => result.value as QoeSpy)
}

/** The identity every recorder built this test was keyed on. */
function recorderIdentities(): unknown[] {
  return createRecorderMock.mock.calls.map((call) => call[0])
}

let live: TestInstance[] = []
let sheets: SheetCounter
let registry: ReturnType<typeof createSessionEndRegistry>

function makeStore(): MiniPlayerStore {
  return createMiniPlayerStore({
    getSubjectId: () => "account-1",
    subscribeToSubject: () => () => {},
    onEnd: (_session, reason) => registry.end(reason),
  })
}

/**
 * A store whose snapshot the test replaces wholesale. `start()` would stamp a
 * fresh position and subject; these cases need to change ONE field of a live
 * session, which is what the app's own update paths do.
 */
function makeSwappableStore(initial: MiniPlayerSession) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const store = {
    ...makeStore(),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
  } as unknown as MiniPlayerStore
  const push = (next: Partial<MiniPlayerSession>) => {
    snapshot = { ...snapshot, ...next }
    for (const listener of [...listeners]) listener()
  }
  return { store, push }
}

/**
 * What the shared buffer leaf writes, read from the leaf itself. Pinning the
 * numbers here instead would go red on a deliberate tuning change, when the
 * claim is only that this call site still passes the setup through.
 */
function leafBufferOptions(): unknown {
  const probe = {} as ExpoVideoPlayer
  applyWatchBufferOptions(probe)
  expect(probe.bufferOptions).toBeDefined()
  return probe.bufferOptions
}

/** A live non-route sheet, exactly as the two real call sites declare one. */
function OpenSheet({ sheets }: { sheets: SheetCounter }) {
  useMiniPlayerSheet(true, sheets)
  return null
}

/** How many times the leaf read the route this test. */
let segmentReads = 0

async function mount(
  store: MiniPlayerStore,
  segments: readonly string[] = HOME_SEGMENTS,
) {
  const readSegments = () => {
    segmentReads += 1
    return segments
  }
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      <PlaybackHost
        store={store}
        sheets={sheets}
        registerEnd={registry.register}
        useRouteSegments={readSegments}
      />,
    )
  })
  live.push(renderer)
  return renderer
}

async function startPlaying(player: FakePlayer) {
  player.playing = true
  await act(async () => {
    player.emit("playingChange", { isPlaying: true })
  })
}

async function tick(ms = 1000) {
  await act(async () => {
    jest.advanceTimersByTime(ms)
  })
}

function hasWindowSlot(renderer: TestInstance): boolean {
  return (
    renderer.root.findAll(
      (node) => node.props.testID === MINI_PLAYER_WINDOW_SLOT,
    ).length > 0
  )
}

function hasKeepAliveSlot(renderer: TestInstance): boolean {
  return (
    renderer.root.findAll(
      (node) => node.props.testID === MINI_PLAYER_KEEPALIVE_SLOT,
    ).length > 0
  )
}

/** Every mounted video surface. The one-decoder invariant is a COUNT here. */
function videoSurfaces(renderer: TestInstance) {
  return renderer.root.findAll(
    (node) => node.props.testID === "expo-video-view",
  )
}

/** The outermost node carrying a slot testID — the container the host styles. */
function slotContainer(renderer: TestInstance, testID: string) {
  const matches = renderer.root.findAll((node) => node.props.testID === testID)
  expect(matches.length).toBeGreaterThan(0)
  return matches[0]
}

/** Stands in for the watch route's token — this suite renders the host alone. */
let routeToken = createClaimToken()

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
  resetExpoVideoMock()
  resetPictureInPictureLatch()
  resetHostPlayerBridge()
  routeToken = createClaimToken()
  sheets = createSheetCounter()
  registry = createSessionEndRegistry()
  segmentReads = 0
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
  jest.useRealTimers()
})

describe("PlaybackHost player lifetime", () => {
  it("creates no player while the store has no session", async () => {
    await mount(makeStore())

    expect(createdFakePlayers()).toHaveLength(0)
  })

  it("creates exactly one player when a session starts", async () => {
    const store = makeStore()
    await mount(store)

    await act(async () => {
      store.start({ videoId: "video-1", streamingUrl: EPISODE_ONE })
    })

    expect(createdFakePlayers()).toHaveLength(1)
  })

  it("applies the shared buffer setup to the player it creates", async () => {
    // The other half of the leaf extraction. The host was the reason the
    // options left VideoPlayer.tsx, and dropping the argument here is silent:
    // it compiles, typechecks, and only costs a slower first frame.
    const store = makeStore()
    await mount(store)

    await act(async () => {
      store.start({ videoId: "video-1", streamingUrl: EPISODE_ONE })
    })

    expect(lastFakePlayer().bufferOptions).toEqual(leafBufferOptions())
  })

  it("keeps the same player across a one-second position write", async () => {
    // The store replaces its snapshot object every tick. Without the memo on
    // the session subtree, each tick would re-render the player owner.
    const store = makeStore()
    await mount(store)
    await act(async () => {
      store.start({ videoId: "video-1", streamingUrl: EPISODE_ONE })
    })
    const player = lastFakePlayer()

    await act(async () => {
      store.updateProgress(30, 100)
    })

    expect(createdFakePlayers()).toHaveLength(1)
    expect(lastFakePlayer()).toBe(player)
  })

  it("does not re-render the player subtree on a position write", async () => {
    // The position feed writes every second for the whole of a film. The
    // player owner is memoized on identity so only the window — which U7
    // subscribes to the store separately — re-renders at that cadence.
    const store = makeStore()
    await mount(store)
    await act(async () => {
      store.start({ videoId: "video-1", streamingUrl: EPISODE_ONE })
    })
    const readsBefore = segmentReads

    await act(async () => {
      store.updateProgress(30, 100)
    })

    expect(segmentReads).toBe(readsBefore)
  })

  it("replaces the player when a different video starts", async () => {
    const store = makeStore()
    await mount(store)
    await act(async () => {
      store.start({ videoId: "video-1", streamingUrl: EPISODE_ONE })
    })

    await act(async () => {
      store.start({ videoId: "video-2", streamingUrl: EPISODE_TWO })
    })

    expect(createdFakePlayers()).toHaveLength(2)
  })

  it("swaps the source in place when only the URL changes", async () => {
    // The downloads manifest hydrates a file:// copy mid-session. Re-keying
    // there would release the player and restart playback from zero.
    const { store, push } = makeSwappableStore(LIVE_SESSION)
    await mount(store)
    expect(createdFakePlayers()).toHaveLength(1)
    const player = lastFakePlayer()

    await act(async () => {
      push({ streamingUrl: OFFLINE_ONE })
    })

    expect(createdFakePlayers()).toHaveLength(1)
    expect(player.replaceAsync).toHaveBeenCalledWith(OFFLINE_ONE)
  })

  it("swaps in place through the REAL store's update verb", async () => {
    // The swappable stand-in above replaces a snapshot the app has no method
    // to produce. This runs the same re-point through the store the app ships.
    const store = makeStore()
    await mount(store)
    await act(async () => {
      store.start({ videoId: "video-1", streamingUrl: EPISODE_ONE })
    })
    const player = lastFakePlayer()

    await act(async () => {
      store.update({ videoId: "video-1", streamingUrl: OFFLINE_ONE })
    })

    expect(createdFakePlayers()).toHaveLength(1)
    expect(player.replaceAsync).toHaveBeenCalledWith(OFFLINE_ONE)
  })

  it("keeps the same player across an audio-language switch", async () => {
    // R1: playback continues with no pause, gap or black frame. The host keys
    // its subtree on the session module, which leaves language out — a key that
    // included it would recreate the player here and the viewer would hear it.
    const { store, push } = makeSwappableStore(LIVE_SESSION)
    await mount(store)
    const player = lastFakePlayer()

    await act(async () => {
      push({ languageSlug: "spanish", streamingUrl: EPISODE_TWO })
    })

    expect(createdFakePlayers()).toHaveLength(1)
    expect(lastFakePlayer()).toBe(player)
    expect(player.replaceAsync).toHaveBeenCalledWith(EPISODE_TWO)
  })

  it("re-keys the progress recorder on that same language switch", async () => {
    // The other half of the split: the SESSION ignores language, the RECORDER
    // does not. Without the re-key the departing position flushes stamped with
    // a language it was never watched in.
    const { store, push } = makeSwappableStore(LIVE_SESSION)
    await mount(store)

    await act(async () => {
      push({ languageSlug: "spanish", streamingUrl: EPISODE_TWO })
    })

    expect(recorderIdentities()).toEqual([
      { videoId: "video-1", videoSlug: undefined, languageSlug: "english" },
      { videoId: "video-1", videoSlug: undefined, languageSlug: "spanish" },
    ])
    expect(flushTriggers()).toEqual(["swap"])
  })
})

describe("PlaybackHost position feed", () => {
  it("writes the adapter's one-second poll into the store", async () => {
    const store = makeStore()
    await mount(store)
    await act(async () => {
      store.start({ videoId: "video-1", streamingUrl: EPISODE_ONE })
    })
    const player = lastFakePlayer()
    await startPlaying(player)

    player.currentTime = 42
    player.duration = 600
    await tick()

    expect(store.getSnapshot()).toMatchObject({
      positionSeconds: 42,
      durationSeconds: 600,
    })
  })

  it("does not overwrite a known duration with a pre-load zero", async () => {
    // expo-video reports duration 0 until the source loads. Passing it through
    // would make the window draw a full bar over a video that just started.
    const store = makeStore()
    await mount(store)
    await act(async () => {
      store.start({
        videoId: "video-1",
        streamingUrl: EPISODE_ONE,
        durationSeconds: 600,
      })
    })
    const player = lastFakePlayer()
    await startPlaying(player)

    player.currentTime = 3
    player.duration = 0
    await tick()

    expect(store.getSnapshot()).toMatchObject({
      positionSeconds: 3,
      durationSeconds: 600,
    })
  })

  it("does not write a position while playback is paused", async () => {
    // The adapter polls only while playing, so a paused session must hold the
    // position it stopped at rather than being re-stamped every second.
    const store = makeStore()
    await mount(store)
    await act(async () => {
      store.start({ videoId: "video-1", streamingUrl: EPISODE_ONE })
    })
    const player = lastFakePlayer()

    player.currentTime = 42
    player.duration = 600
    await tick()

    expect(store.getSnapshot()).toMatchObject({ positionSeconds: 0 })
  })
})

describe("PlaybackHost session end", () => {
  it("reports a store-driven end under its own reason", async () => {
    const store = makeStore()
    await mount(store)
    await act(async () => {
      store.start({ videoId: "video-1", streamingUrl: EPISODE_ONE })
    })

    await act(async () => {
      store.end("dismissed")
    })

    expect(flushTriggers()).toEqual(["dismiss"])
    expect(qoeSessions()[0].finalize).toHaveBeenCalledWith("dismissed")
  })

  it("clears the session so the subtree unmounts", async () => {
    const store = makeStore()
    await mount(store)
    await act(async () => {
      store.start({ videoId: "video-1", streamingUrl: EPISODE_ONE })
    })

    await act(async () => {
      store.end("dismissed")
    })

    // The named end already reported; teardown must not add a second record.
    expect(store.getSnapshot()).toBeNull()
    expect(flushTriggers()).toEqual(["dismiss"])
    expect(qoeSessions()[0].finalize).toHaveBeenCalledTimes(1)
  })

  it("still reports the end after a redundant republish", async () => {
    // A republish of the SAME video from the SAME source changes neither the
    // boundary key nor the memo's props, so the adapter never re-renders. A
    // replace would strand the live player with its session already ended.
    const store = makeStore()
    await mount(store)
    await act(async () => {
      store.start({ videoId: "video-1", streamingUrl: EPISODE_ONE })
    })
    await act(async () => {
      store.start({ videoId: "video-1", streamingUrl: EPISODE_ONE })
    })

    await act(async () => {
      store.end("dismissed")
    })

    expect(createdFakePlayers()).toHaveLength(1)
    expect(flushTriggers()).toEqual(["dismiss"])
    expect(qoeSessions()[0].finalize).toHaveBeenCalledWith("dismissed")
  })

  it("a genuinely different video still replaces and stays reportable", async () => {
    // The anti-vacuous companion: a start() that no-opped on everything would
    // satisfy the case above by never replacing at all.
    const store = makeStore()
    await mount(store)
    await act(async () => {
      store.start({ videoId: "video-1", streamingUrl: EPISODE_ONE })
    })
    await act(async () => {
      store.start({ videoId: "video-2", streamingUrl: EPISODE_TWO })
    })

    await act(async () => {
      store.end("dismissed")
    })

    expect(createdFakePlayers()).toHaveLength(2)
    expect(qoeSessions()[0].finalize).toHaveBeenCalledWith("replaced")
    expect(qoeSessions()[1].finalize).toHaveBeenCalledWith("dismissed")
  })

  it("routes the end to the live player after a session swap", async () => {
    const store = makeStore()
    await mount(store)
    await act(async () => {
      store.start({ videoId: "video-1", streamingUrl: EPISODE_ONE })
    })
    await act(async () => {
      store.start({ videoId: "video-2", streamingUrl: EPISODE_TWO })
    })

    await act(async () => {
      store.end("dismissed")
    })

    // Two sessions: the first was replaced, the second dismissed. A departing
    // registration that cleared its successor would leave the second as an
    // abandonment instead.
    expect(qoeSessions()[1].finalize).toHaveBeenCalledWith("dismissed")
  })
})

describe("PlaybackHost progress identity", () => {
  it("keeps an empty-string videoId off the progress wire", async () => {
    // syncClient sends whatever the recorder was keyed on, and "" is not nullish
    // — so an unnormalized identity posts videoId:"" to admin AND defeats the
    // "one identity key per intent" guard, which only checks presence.
    const store = makeStore()
    await mount(store)

    await act(async () => {
      store.start({
        videoId: "",
        videoSlug: "birth-of-jesus",
        streamingUrl: EPISODE_ONE,
      })
    })

    expect(recorderIdentities()).toEqual([
      { videoId: undefined, videoSlug: "birth-of-jesus", languageSlug: null },
    ])
  })

  it("builds no recorder for a session with no identity at all", async () => {
    // A truthy-but-keyless `progress` object still builds a recorder, and any
    // flush from it fires the "sign in to save your place" prompt for a
    // session that has nothing to save.
    const store = makeStore()
    await mount(store)

    await act(async () => {
      store.start({ streamingUrl: EPISODE_ONE })
    })

    expect(createRecorderMock).not.toHaveBeenCalled()
  })

  it("still keys the recorder on the audio language", async () => {
    // FIX 2 removed languageSlug from the SESSION key, not from the identity:
    // the recorder still re-keys on it, or a departing position is stamped
    // with a language it was never watched in.
    const store = makeStore()
    await mount(store)

    await act(async () => {
      store.start({
        videoId: "video-1",
        languageSlug: "english",
        streamingUrl: EPISODE_ONE,
      })
    })

    expect(recorderIdentities()).toEqual([
      { videoId: "video-1", videoSlug: undefined, languageSlug: "english" },
    ])
  })
})

describe("PlaybackHost presentation", () => {
  async function mountPlaying(segments: readonly string[]) {
    const store = makeStore()
    const renderer = await mount(store, segments)
    await act(async () => {
      store.start({ videoId: "video-1", streamingUrl: EPISODE_ONE })
    })
    return renderer
  }

  it("resolves floating away from the watch group", async () => {
    const renderer = await mountPlaying(HOME_SEGMENTS)

    expect(hasWindowSlot(renderer)).toBe(true)
  })

  it("resolves full inside the watch group", async () => {
    const renderer = await mountPlaying(WATCH_SEGMENTS)

    expect(hasWindowSlot(renderer)).toBe(false)
  })

  it("hides behind a sheet that owns no route", async () => {
    const renderer = await mountPlaying(HOME_SEGMENTS)

    await act(async () => {
      sheets.openSheet()
    })

    expect(hasWindowSlot(renderer)).toBe(false)
  })

  it("hides while the picture-in-picture window is showing", async () => {
    const renderer = await mountPlaying(HOME_SEGMENTS)

    await act(async () => {
      setPictureInPictureActive(true)
    })

    expect(hasWindowSlot(renderer)).toBe(false)
  })

  it("hides on a group sheet route", async () => {
    const renderer = await mountPlaying(["series", "language"])

    expect(hasWindowSlot(renderer)).toBe(false)
  })

  it("keeps a STILL-OPEN non-route sheet suppressing the next session", async () => {
    // The other half of the reset. It cannot tell a stranded count from a live
    // claim, so it zeroes both — and a tab screen stays mounted with its sheet
    // on screen, which is where the next window would float over it.
    const store = makeStore()
    let renderer!: TestInstance
    await act(async () => {
      renderer = TestRenderer.create(
        // A View, not a fragment: the shared node helpers read `props.testID`,
        // and a fragment puts a props-less node in front of them.
        <View>
          <OpenSheet sheets={sheets} />
          <PlaybackHost
            store={store}
            sheets={sheets}
            registerEnd={registry.register}
            useRouteSegments={() => HOME_SEGMENTS}
          />
        </View>,
      )
    })
    live.push(renderer)
    await act(async () => {
      store.start({ videoId: "video-1", streamingUrl: EPISODE_ONE })
    })
    expect(hasWindowSlot(renderer)).toBe(false)

    await act(async () => {
      store.end("dismissed")
    })
    await act(async () => {
      store.start({ videoId: "video-2", streamingUrl: EPISODE_TWO })
    })

    expect(sheets.getCount()).toBe(1)
    expect(hasWindowSlot(renderer)).toBe(false)
  })

  it("an unbalanced sheet open does not wedge the next session hidden", async () => {
    // closeSheet() floors at zero, so it cannot undo a SURPLUS open — one
    // stranded openSheet() would suppress the window for the rest of the app's
    // life, recoverable only by relaunching. Session end is the reset point.
    const store = makeStore()
    const renderer = await mount(store, HOME_SEGMENTS)
    await act(async () => {
      store.start({ videoId: "video-1", streamingUrl: EPISODE_ONE })
      sheets.openSheet()
    })
    expect(hasWindowSlot(renderer)).toBe(false)

    await act(async () => {
      store.end("dismissed")
    })
    await act(async () => {
      store.start({ videoId: "video-2", streamingUrl: EPISODE_TWO })
    })

    expect(sheets.getCount()).toBe(0)
    expect(hasWindowSlot(renderer)).toBe(true)
  })

  it("releases the sheet count even when the named end throws", async () => {
    // The end registry swallows this throw, so without a `finally` the release
    // is skipped in silence and every later window stays hidden until relaunch.
    // Synchronous, not a rejection: the flush buffers an intent before it awaits.
    const store = makeStore()
    const renderer = await mount(store, HOME_SEGMENTS)
    createRecorderMock.mockImplementationOnce(() => ({
      flush: jest.fn(() => {
        throw new Error("flush blew up")
      }),
      onTick: jest.fn(),
    }))
    await act(async () => {
      store.start({ videoId: "video-1", streamingUrl: EPISODE_ONE })
      sheets.openSheet()
    })
    expect(hasWindowSlot(renderer)).toBe(false)

    await act(async () => {
      store.end("dismissed")
    })
    await act(async () => {
      store.start({ videoId: "video-2", streamingUrl: EPISODE_TWO })
    })

    expect(sheets.getCount()).toBe(0)
    expect(hasWindowSlot(renderer)).toBe(true)
  })
})

/**
 * The player must never be surfaceless. Measured on Android: a VideoView that
 * FIRST attaches to a player which has already played with no surface gets a
 * permanently dead one — audio runs, the rectangle stays black, and pause/play,
 * seek, replaceAsync and remount all fail to revive it.
 *
 * So the count is the whole assertion: never zero while a session is live, and
 * never two, because two surfaces on one player is the other failure.
 */
describe("PlaybackHost video surface", () => {
  async function mountPlaying(
    segments: readonly string[] = HOME_SEGMENTS,
    claim: PlaybackClaim | null = null,
  ) {
    const store = makeStore()
    const renderer = await mount(store, segments)
    await act(async () => {
      store.start({ videoId: "video-1", streamingUrl: EPISODE_ONE })
      if (claim != null) claimPlayback(routeToken, claim)
    })
    return { renderer, store }
  }

  it("mounts no surface while there is no session", async () => {
    // `none` is the no-session case, and the host owns no player to strand.
    const renderer = await mount(makeStore())

    expect(videoSurfaces(renderer)).toHaveLength(0)
  })

  it("mounts no surface once the session ends", async () => {
    const { renderer, store } = await mountPlaying()

    await act(async () => {
      store.end("dismissed")
    })

    expect(videoSurfaces(renderer)).toHaveLength(0)
  })

  it("keeps exactly one surface while the window is hidden", async () => {
    const { renderer } = await mountPlaying()

    await act(async () => {
      sheets.openSheet()
    })

    expect(hasWindowSlot(renderer)).toBe(false)
    expect(videoSurfaces(renderer)).toHaveLength(1)
  })

  it("keeps exactly one surface through hidden, floating and hidden", async () => {
    const { renderer } = await mountPlaying()
    expect(videoSurfaces(renderer)).toHaveLength(1)

    await act(async () => {
      sheets.openSheet()
    })
    expect(videoSurfaces(renderer)).toHaveLength(1)

    await act(async () => {
      sheets.closeSheet()
    })
    expect(videoSurfaces(renderer)).toHaveLength(1)

    await act(async () => {
      sheets.openSheet()
    })
    expect(videoSurfaces(renderer)).toHaveLength(1)
    // One player throughout: a surface that came back on a NEW player would
    // satisfy the counts above and still be the bug this guards.
    expect(createdFakePlayers()).toHaveLength(1)
  })

  it("mounts NO surface on the watch route while that route claims it", async () => {
    // The watch route renders the full-screen surface over this same player. A
    // keep-alive surface here would be a SECOND view owning one player, which
    // is what Android asserts against.
    const { renderer } = await mountPlaying(WATCH_SEGMENTS, {
      videoId: "video-1",
      streamingUrl: EPISODE_ONE,
    })

    expect(hasWindowSlot(renderer)).toBe(false)
    expect(hasKeepAliveSlot(renderer)).toBe(false)
    expect(videoSurfaces(renderer)).toHaveLength(0)
  })

  it("keeps a surface on the watch route when no route claims one", async () => {
    // The reachable hazard: segments still say `watch` for the commit after the
    // route released its claim. A player left with NO surface while it plays is
    // permanently video-dead on Android, and only a new player recovers it.
    const { renderer } = await mountPlaying(WATCH_SEGMENTS)

    expect(hasKeepAliveSlot(renderer)).toBe(true)
    expect(videoSurfaces(renderer)).toHaveLength(1)
  })

  it("hands the surface back the instant the route's claim goes", async () => {
    const { renderer } = await mountPlaying(WATCH_SEGMENTS, {
      videoId: "video-1",
      streamingUrl: EPISODE_ONE,
    })
    expect(videoSurfaces(renderer)).toHaveLength(0)

    await act(async () => {
      releasePlaybackClaim(routeToken)
    })

    expect(videoSurfaces(renderer)).toHaveLength(1)
    // Still the same player: a handoff that recreated it would restart the
    // video, which is the audible gap R1 forbids.
    expect(createdFakePlayers()).toHaveLength(1)
  })

  it("hides the suppressed surface and takes no touches", async () => {
    const { renderer } = await mountPlaying()
    await act(async () => {
      sheets.openSheet()
    })

    const container = slotContainer(renderer, MINI_PLAYER_KEEPALIVE_SLOT)
    const style = StyleSheet.flatten(container.props.style) as {
      width: number
      height: number
      opacity: number
    }
    expect(container.props.pointerEvents).toBe("none")
    // Small, and NOT zero. A zero-size view can lay out without ever creating
    // the native surface, which is the state this slot exists to prevent.
    expect(style.width).toBeGreaterThan(0)
    expect(style.width).toBeLessThanOrEqual(1)
    expect(style.height).toBeGreaterThan(0)
    expect(style.height).toBeLessThanOrEqual(1)
    expect(style.opacity).toBe(0)
  })

  it("never puts pointerEvents on the video view itself", async () => {
    // The plan forbids it there: U7's tap-to-expand target lives on this
    // surface, and the container already blocks the suppressed touches.
    const { renderer } = await mountPlaying()

    expect(videoSurfaces(renderer)[0].props.pointerEvents).toBeUndefined()
  })

  it("opts the surface into textureView on Android", async () => {
    // An Android SurfaceView punches through whatever is layered over it, so
    // the window would render behind Home. jest cannot see native compositing;
    // this pins that the prop is still passed.
    const original = Platform.OS
    Object.defineProperty(Platform, "OS", { value: "android", writable: true })
    try {
      const { renderer } = await mountPlaying()

      expect(videoSurfaces(renderer)[0].props.surfaceType).toBe("textureView")
    } finally {
      Object.defineProperty(Platform, "OS", { value: original, writable: true })
    }
  })

  it("passes no surfaceType on iOS", async () => {
    const { renderer } = await mountPlaying()

    expect(videoSurfaces(renderer)[0].props.surfaceType).toBeUndefined()
  })
})

/**
 * R24/AE12: while the operating system's picture-in-picture window is showing,
 * the app performs NO video-view mount, unmount or handoff.
 *
 * The rule exists because expo-video's Android `PictureInPictureManager` does
 * not guard the unregister that follows an unmount, and because the app is
 * backgrounded — the viewer sees a blank interface on return, not the change.
 * Every case here goes green without the hold, which is what makes the hold
 * invisible to the rest of the suite.
 */
describe("PlaybackHost picture-in-picture hold", () => {
  async function mountFloating() {
    const store = makeStore()
    const renderer = await mount(store, HOME_SEGMENTS)
    await act(async () => {
      store.start({ videoId: "video-1", streamingUrl: EPISODE_ONE })
    })
    await act(async () => {
      setPictureInPictureActive(true)
    })
    expect(videoSurfaces(renderer)).toHaveLength(1)
    return { renderer, store }
  }

  it("builds a player for a claim that arrives AFTER the latch armed", async () => {
    // The foreground start. The SDUI routes render native controls, so the
    // viewer can open the operating system's window with the app on screen —
    // at a moment when there is no session and no claim to hold. A hold that
    // pinned that `null` discarded every later claim: no player, no surface,
    // and `/watch/<slug>` on its loading poster for good.
    const store = makeStore()
    await mount(store, WATCH_SEGMENTS)
    await act(async () => {
      setPictureInPictureActive(true)
    })

    await act(async () => {
      claimPlayback(routeToken, {
        videoId: "video-1",
        streamingUrl: EPISODE_ONE,
      })
    })

    expect(createdFakePlayers()).toHaveLength(1)
    expect(getHostPlayer()).not.toBeNull()
  })

  it("keeps the surface when the session is dismissed (AE12)", async () => {
    const { renderer, store } = await mountFloating()

    await act(async () => {
      store.end("dismissed")
    })

    expect(videoSurfaces(renderer)).toHaveLength(1)
  })

  it("still ends the session, so only the VIEW is held", async () => {
    const { store } = await mountFloating()

    await act(async () => {
      store.end("dismissed")
    })

    expect(store.getSnapshot()).toBeNull()
  })

  it("unmounts the moment picture-in-picture stops", async () => {
    const { renderer, store } = await mountFloating()
    await act(async () => {
      store.end("dismissed")
    })

    await act(async () => {
      setPictureInPictureActive(false)
    })

    expect(videoSurfaces(renderer)).toHaveLength(0)
  })

  it("keeps the same player when a DIFFERENT video starts", async () => {
    // The other unmount the host owns: a new identity re-keys the boundary and
    // rebuilds the whole subtree, which releases the player the OS window is
    // showing.
    const { renderer, store } = await mountFloating()

    await act(async () => {
      store.start({ videoId: "video-2", streamingUrl: EPISODE_TWO })
    })

    expect(createdFakePlayers()).toHaveLength(1)
    expect(videoSurfaces(renderer)).toHaveLength(1)
  })

  it("hands nothing over when a route claims the player", async () => {
    // The handoff half. Without the hold the window drops its view and
    // publishes `surfaceFree`, so the claiming route mounts one instead — a
    // move of the native surface underneath a live OS window.
    const { renderer } = await mountFloating()

    await act(async () => {
      claimPlayback(routeToken, {
        videoId: "video-1",
        streamingUrl: EPISODE_ONE,
      })
    })

    expect(videoSurfaces(renderer)).toHaveLength(1)
    expect(getHostPlayer()?.surfaceFree).toBe(false)
  })

  it("completes that handoff once picture-in-picture stops", async () => {
    // The release, and the anti-vacuous companion to the case above: a hold
    // that never released would pass that one and strand the watch route with
    // no player forever.
    const { renderer } = await mountFloating()
    await act(async () => {
      claimPlayback(routeToken, {
        videoId: "video-1",
        streamingUrl: EPISODE_ONE,
      })
    })

    await act(async () => {
      setPictureInPictureActive(false)
    })

    expect(videoSurfaces(renderer)).toHaveLength(0)
    expect(getHostPlayer()?.surfaceFree).toBe(true)
  })

  it("does not take the surface back when a route's claim goes", async () => {
    // The mirror image: the route owns the view, so mounting one here is the
    // second view on one player that Android asserts against.
    const store = makeStore()
    const renderer = await mount(store, WATCH_SEGMENTS)
    await act(async () => {
      store.start({ videoId: "video-1", streamingUrl: EPISODE_ONE })
      claimPlayback(routeToken, {
        videoId: "video-1",
        streamingUrl: EPISODE_ONE,
      })
    })
    expect(videoSurfaces(renderer)).toHaveLength(0)
    await act(async () => {
      setPictureInPictureActive(true)
    })

    await act(async () => {
      releasePlaybackClaim(routeToken)
    })

    expect(videoSurfaces(renderer)).toHaveLength(0)
  })
})

describe("PlaybackHost error boundary", () => {
  it("ends the session instead of taking the app down", async () => {
    // The root ErrorBoundary has no reset path, so an escaping throw costs an
    // app relaunch. Ending the session unmounts this subtree and lets the next
    // start mount a clean one.
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => {})
    try {
      const store = makeStore()
      await mount(store, HOME_SEGMENTS)
      let failing = false
      let renderer!: TestInstance
      await act(async () => {
        renderer = TestRenderer.create(
          <PlaybackHost
            store={store}
            sheets={sheets}
            registerEnd={registry.register}
            useRouteSegments={() => {
              if (failing) throw new Error("segments blew up")
              return HOME_SEGMENTS
            }}
          />,
        )
      })
      live.push(renderer)

      await act(async () => {
        failing = true
        store.start({ videoId: "video-1", streamingUrl: EPISODE_ONE })
      })

      expect(store.getSnapshot()).toBeNull()
      expect(reportDatadogError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "segments blew up" }),
        { origin: "playback_host" },
      )
    } finally {
      consoleError.mockRestore()
    }
  })
})
