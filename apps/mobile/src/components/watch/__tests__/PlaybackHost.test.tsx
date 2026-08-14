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
// No expo-blur / expo-image / expo-linear-gradient / vector-icons mocks: the
// host reaches none of them. PlaybackHost.coldLaunch.guard.test.js holds that.
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

import { MINI_PLAYER_WINDOW_SLOT, PlaybackHost } from "../PlaybackHost"
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

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
  resetExpoVideoMock()
  resetPictureInPictureLatch()
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

  it("keeps the same player across an audio-language switch", async () => {
    // R1: playback continues without a pause, a gap or a black frame. The host
    // keys its subtree on the session module, which deliberately leaves
    // language out — a key that included it would release and recreate the
    // player here, and the viewer would hear the gap.
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
    // syncClient sends whatever the recorder was keyed on, and "" is not
    // nullish — so an unnormalized identity posts videoId:"" to admin AND
    // defeats the "one identity key per intent" guard, which only checks
    // presence.
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
