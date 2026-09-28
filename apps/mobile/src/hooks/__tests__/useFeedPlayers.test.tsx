/**
 * U8's feed players against the REAL feed reducer; only expo-video is faked.
 * The double settles replaceAsync before the load lands and sends `timeUpdate`
 * only on a set interval, as a device does.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("expo-video", () =>
  require("../../test-utils/expoVideoMock").createExpoVideoMock({ players: 2 }),
)

import { StrictMode, act, useReducer, type ReactElement } from "react"
import { AppState } from "react-native"

import {
  INITIAL_FEED_STATE,
  feedReducer,
  type FeedEvent,
  type FeedState,
  type PlayerId,
} from "../../lib/explore/feedState"
import type { ReadyClip } from "../../lib/explore/types"
import { applyQualityConstraint } from "../../lib/streamQuality"
import type { ExpoVideoMock, FakePlayer } from "../../test-utils/expoVideoMock"
import {
  TestRenderer,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"
import {
  ACTIVE_TIME_UPDATE_INTERVAL_SECONDS,
  EXPLORE_QUALITY_TIER,
  SEEK_LOADING_GRACE_MS,
  START_RESEEK_GRACE_MS,
  STANDBY_FORWARD_BUFFER_SECONDS,
  STANDBY_LOAD_AFTER_BUFFERED_SECONDS,
  useFeedPlayers,
  type FeedPlayers,
  type FeedPlayersInput,
} from "../useFeedPlayers"

const video = jest.requireMock("expo-video") as ExpoVideoMock
const [A, B] = video.__players

const START = 60
const END = 90

function clip(n: number, streamUrl?: string): ReadyClip {
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
    imageUrl: null,
    feedLanguageSlug: "english",
    streamUrl: streamUrl ?? `https://stream.mux.com/clip${n}.m3u8`,
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

const focus = (playerMode: "two" | "one" = "two"): FeedEvent => ({
  type: "focus",
  playerMode,
})
const queued = (n: number, streamUrl?: string): FeedEvent => ({
  type: "clipQueued",
  clip: clip(n, streamUrl),
})
const SWIPE: FeedEvent = { type: "swipeNext" }
const REST: FeedEvent = { type: "rest" }

// ── Sound watch (KTD2) ──────────────────────────────────────────────

// Records each write that leaves both players unmuted. `afterEach` fails any
// case that has an entry.
const soundOverlaps: string[] = []

function watchSound(player: FakePlayer, name: string) {
  let muted = player.muted
  Object.defineProperty(player, "muted", {
    configurable: true,
    enumerable: true,
    get: () => muted,
    set: (value: boolean) => {
      muted = value
      if (!A.muted && !B.muted) soundOverlaps.push(`${name} unmuted`)
    },
  })
}
watchSound(A, "A")
watchSound(B, "B")

// ── Harness ─────────────────────────────────────────────────────────

type Box = {
  state: FeedState
  dispatch: (event: FeedEvent) => void
  result: FeedPlayers
  /** Every event the hook sent the reducer. */
  sent: FeedEvent[]
}

type ProbeProps = Pick<
  FeedPlayersInput,
  "onLoop" | "onSourceSet" | "onSourceLoaded" | "onRebuffer" | "onClipFailed"
> & {
  muted?: boolean
  yieldsToRoot?: boolean
}

function Probe({
  box,
  initial,
  muted = false,
  yieldsToRoot = false,
  ...callbacks
}: ProbeProps & { box: Box; initial: FeedState }) {
  const [state, dispatch] = useReducer(feedReducer, initial)
  box.state = state
  box.dispatch = dispatch
  box.result = useFeedPlayers({
    state,
    dispatch: (event) => {
      box.sent.push(event)
      dispatch(event)
    },
    muted,
    yieldsToRoot,
    ...callbacks,
  })
  return null
}

let renderer: TestInstance | null = null

async function mount(
  props: ProbeProps = {},
  options: { strict?: boolean; initial?: FeedState } = {},
) {
  const box = { sent: [] as FeedEvent[] } as Box
  const initial = options.initial ?? INITIAL_FEED_STATE
  const element = (next: ProbeProps): ReactElement => {
    const probe = <Probe box={box} initial={initial} {...next} />
    return options.strict === true ? <StrictMode>{probe}</StrictMode> : probe
  }
  await act(async () => {
    renderer = TestRenderer.create(element(props))
  })
  return {
    box,
    async send(...events: FeedEvent[]) {
      for (const event of events) {
        await act(async () => {
          box.dispatch(event)
        })
      }
    },
    async rerender(next: ProbeProps) {
      await act(async () => {
        renderer?.update(element(next))
      })
    },
    token(player: PlayerId): number {
      const slot = box.state.slots[player]
      if (slot == null) throw new Error(`no slot on player ${player}`)
      return slot.token
    },
    sentOf<T extends FeedEvent["type"]>(type: T) {
      return box.sent.filter((event) => event.type === type)
    },
  }
}

type Harness = Awaited<ReturnType<typeof mount>>

async function settle(
  player: FakePlayer,
  options?: { withholdLoad?: boolean },
) {
  await act(async () => {
    player.__settleReplace(undefined, options)
  })
}

async function tick(
  player: FakePlayer,
  position: { currentTime: number; bufferedPosition?: number },
) {
  let emitted = false
  await act(async () => {
    emitted = player.__tick(position)
  })
  return emitted
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

/** Only the loads: the sources that start a request. */
function loads(player: FakePlayer): string[] {
  return sources(player).filter((source): source is string => source != null)
}

/** Focus, queue clip 1, and let player A load and play it with sound. */
async function startFirstClip(h: Harness) {
  await h.send(focus(), queued(1))
  await settle(A)
  expect(h.box.state.phase).toBe("playing")
}

/** Queue clip 2 and let the active player's buffer open the standby's load. */
async function preloadSecondClip(h: Harness) {
  await h.send(queued(2))
  await tick(A, {
    currentTime: START + 0.5,
    bufferedPosition: START + 0.5 + STANDBY_LOAD_AFTER_BUFFERED_SECONDS,
  })
  await settle(B)
}

// Installed once: jest 29's restoreAllMocks would also wipe the double's own
// jest.fn implementations, so this spy is never restored.
let now = 1_000_000
jest.spyOn(Date, "now").mockImplementation(() => now)

const restoreCurrentTime: Array<() => void> = []

/**
 * A device that drops the first `drops` playhead writes (the tvOS
 * dropped-seek shape). Every write is recorded.
 */
function dropSeeks(player: FakePlayer, drops = Number.POSITIVE_INFINITY) {
  let position = 0
  let dropped = 0
  const writes: number[] = []
  Object.defineProperty(player, "currentTime", {
    configurable: true,
    enumerable: true,
    get: () => position,
    set: (value: number) => {
      writes.push(value)
      if (dropped < drops) dropped += 1
      else position = value
    },
  })
  restoreCurrentTime.push(() => {
    Object.defineProperty(player, "currentTime", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: 0,
    })
  })
  return writes
}

beforeEach(() => {
  video.__reset()
  soundOverlaps.length = 0
  now = 1_000_000
})

afterEach(async () => {
  if (renderer != null) {
    const current = renderer
    renderer = null
    await act(async () => {
      current.unmount()
    })
  }
  for (const restore of restoreCurrentTime.splice(0)) restore()
  expect(soundOverlaps).toEqual([])
})

// ── Cases ───────────────────────────────────────────────────────────

describe("useFeedPlayers — the two players", () => {
  it("creates two distinct players with a frozen null source, and requests nothing before a slot", async () => {
    const h = await mount()

    expect(h.box.result.players.a).toBe(A)
    expect(h.box.result.players.b).toBe(B)
    expect(A).not.toBe(B)
    for (const player of [A, B]) {
      expect(player).toMatchObject({
        muted: true,
        loop: false,
        preservesPitch: true,
        allowsExternalPlayback: false,
        timeUpdateEventInterval: 0,
      })
      expect(player.replaceAsync).not.toHaveBeenCalled()
    }
  })

  it("keeps the same two players across ten swipes", async () => {
    const h = await startedHarness()
    for (let n = 2; n <= 11; n++) await h.send(queued(n), SWIPE, REST)

    expect(h.box.result.players.a).toBe(A)
    expect(h.box.result.players.b).toBe(B)
    // The real hook re-creates a player only when its source argument changes.
    expect(
      video.useVideoPlayer.mock.calls.every(([source]) => source === null),
    ).toBe(true)
    expect(A.loop).toBe(false)
    expect(B.loop).toBe(false)
  })
})

async function startedHarness(props: ProbeProps = {}) {
  const h = await mount(props)
  await startFirstClip(h)
  return h
}

describe("useFeedPlayers — sound (KTD2, R11)", () => {
  it("plays the first clip muted until motion is confirmed, then follows the saved choice", async () => {
    const h = await mount({ muted: false })
    const mutedAtPlay: boolean[] = []
    const play = A.play.getMockImplementation()
    A.play.mockImplementation(() => {
      mutedAtPlay.push(A.muted)
      play?.()
    })

    await startFirstClip(h)
    expect(mutedAtPlay).toEqual([true])
    expect(A.playing).toBe(true)
    expect(A.muted).toBe(false)
    expect(B.muted).toBe(true)

    await h.rerender({ muted: true })
    expect(A.muted).toBe(true)
    await h.rerender({ muted: false })
    expect(A.muted).toBe(false)
  })

  /** What the outgoing and incoming players held when the incoming one played. */
  function recordAtPlay(incoming: FakePlayer, outgoing: FakePlayer) {
    const seen: Array<Record<string, boolean>> = []
    const play = incoming.play.getMockImplementation()
    incoming.play.mockImplementation(() => {
      seen.push({
        outgoingMuted: outgoing.muted,
        outgoingPlaying: outgoing.playing,
        incomingMuted: incoming.muted,
      })
      play?.()
    })
    return seen
  }

  const SILENT_HANDOVER = {
    outgoingMuted: true,
    outgoingPlaying: false,
    incomingMuted: true,
  }

  // Both directions: the pass visits player A first, so an A-to-B swipe alone
  // cannot tell "silence first" from "play first".
  it("mutes and pauses the outgoing player before the incoming one plays, in both directions", async () => {
    const h = await startedHarness()
    await preloadSecondClip(h)
    expect(B.playing).toBe(false)
    expect(B.muted).toBe(true)

    const intoB = recordAtPlay(B, A)
    await h.send(SWIPE)
    // A ready standby swaps with no veil (AE8).
    expect(h.box.state.phase).toBe("playing")
    expect(intoB).toEqual([SILENT_HANDOVER])
    expect(B.playing).toBe(true)
    expect(B.muted).toBe(false)
    expect(A.muted).toBe(true)

    await h.send(REST, queued(3))
    await tick(B, { currentTime: START + 0.5, bufferedPosition: END })
    const clip3 = h.token("a")
    // The first swipe cleared A. That clear settles first, and its null
    // source's load is not clip 3's load.
    expect(sources(A).slice(-2)).toEqual([null, feedUrl(3)])
    await settle(A)
    expect(h.sentOf("loaded")).not.toContainEqual({
      type: "loaded",
      token: clip3,
    })
    await settle(A)
    expect(h.sentOf("loaded")).toContainEqual({ type: "loaded", token: clip3 })

    const intoA = recordAtPlay(A, B)
    await h.send(SWIPE)
    expect(intoA).toEqual([SILENT_HANDOVER])
    expect(A.playing).toBe(true)
    expect(A.muted).toBe(false)
    expect(B.muted).toBe(true)
  })

  it("pauses a player whose play is still pending, not only one that reports playing", async () => {
    // A device reports `playing` false while a requested play waits on data.
    A.play.mockImplementation(() => {})
    const h = await mount()
    await h.send(focus(), queued(1))
    await settle(A)
    expect(A.play).toHaveBeenCalled()
    expect(A.pause).not.toHaveBeenCalled()

    await h.send({ type: "blur", positionSeconds: START })
    expect(A.pause).toHaveBeenCalled()
  })

  it("never starts a clip while the app is in the background", async () => {
    const appState = AppState as { currentState: string }
    const real = appState.currentState
    appState.currentState = "background"
    try {
      const h = await mount()
      await h.send(focus(), queued(1))
      await settle(A)
      expect(A.play).not.toHaveBeenCalled()
    } finally {
      appState.currentState = real
    }
  })

  it("sends playing on every rise of the playing edge", async () => {
    const h = await startedHarness()
    const token = h.token("a")

    await h.send({ type: "tap" })
    expect(A.playing).toBe(false)
    await h.send({ type: "tap" })
    expect(A.playing).toBe(true)
    expect(h.sentOf("playing")).toEqual([
      { type: "playing", token },
      { type: "playing", token },
    ])
  })

  it("holds the clip still and silent while it yields to the root player", async () => {
    const h = await mount({ yieldsToRoot: true })
    await h.send(focus(), queued(1))
    await settle(A)
    expect(A.playing).toBe(false)

    await h.rerender({ yieldsToRoot: false })
    expect(A.playing).toBe(true)
    expect(A.muted).toBe(false)

    await h.rerender({ yieldsToRoot: true })
    expect(A.playing).toBe(false)
    expect(A.muted).toBe(true)
  })
})

describe("useFeedPlayers — clip bounds (KTD4, R8, R12)", () => {
  it("runs the start seek on sourceLoad, never in the replaceAsync promise", async () => {
    const h = await mount()
    await h.send(focus(), queued(1))

    // The swap settles with no load: the source is set but nothing landed.
    await settle(A, { withholdLoad: true })
    expect(A.currentTime).toBe(0)
    expect(h.sentOf("loaded")).toEqual([])
    expect(A.playing).toBe(false)

    await act(async () => {
      A.__emit("sourceLoad", { videoSource: { uri: feedUrl(1) } })
    })
    expect(A.currentTime).toBe(START)
    expect(h.sentOf("loaded")).toEqual([
      { type: "loaded", token: h.token("a") },
    ])
    expect(A.playing).toBe(true)
  })

  it("loops at the window end with a seek back to the clip start, never the native loop", async () => {
    const onLoop = jest.fn()
    const h = await startedHarness({ onLoop })
    const token = h.token("a")
    expect(A.timeUpdateEventInterval).toBe(ACTIVE_TIME_UPDATE_INTERVAL_SECONDS)

    expect(await tick(A, { currentTime: END - 1 })).toBe(true)
    expect(onLoop).not.toHaveBeenCalled()

    await tick(A, { currentTime: END + 0.1 })
    expect(A.currentTime).toBe(START)
    expect(onLoop).toHaveBeenCalledWith(token)
    // A tick that still shows the old position does not loop twice.
    await tick(A, { currentTime: END + 0.2 })
    expect(onLoop).toHaveBeenCalledTimes(1)
    expect(A.loop).toBe(false)
    expect(A.playing).toBe(true)
  })

  it("buffers the active clip up to its window end, and no further (KTD23)", async () => {
    await startedHarness()
    expect(A.bufferOptions).toEqual({
      preferredForwardBufferDuration: END - START,
    })

    await tick(A, { currentTime: END - 10 })
    expect(A.bufferOptions).toEqual({ preferredForwardBufferDuration: 10 })
  })

  it("loops when the asset itself ends inside the window", async () => {
    const onLoop = jest.fn()
    const h = await startedHarness({ onLoop })
    await act(async () => {
      A.pause()
      A.__emit("playToEnd")
    })
    expect(A.currentTime).toBe(START)
    expect(A.playing).toBe(true)
    expect(onLoop).toHaveBeenCalledWith(h.token("a"))
  })

  it("re-seeks once when the first playing tick misses the start, and fails the clip on a second miss", async () => {
    const writes = dropSeeks(A)
    const h = await mount()
    await h.send(focus(), queued(1))
    await settle(A)
    const token = h.token("a")

    // The load's seek and the one re-seek at the first playing tick.
    expect(writes.filter((value) => value === START)).toHaveLength(2)
    expect(h.sentOf("error")).toEqual([])

    now += START_RESEEK_GRACE_MS
    await tick(A, { currentTime: 0.5 })
    expect(h.sentOf("error")).toEqual([
      { type: "error", token, msSinceSourceSet: START_RESEEK_GRACE_MS },
    ])
    expect(h.box.state.phase).toBe("clipFailed")
    expect(A.playing).toBe(false)
    expect(writes.filter((value) => value === START)).toHaveLength(2)
  })

  it("keeps the clip when the re-seek lands", async () => {
    // The load's zero and its start seek are dropped; the re-seek lands.
    const writes = dropSeeks(A, 2)
    const h = await mount()
    await h.send(focus(), queued(1))
    await settle(A)
    expect(writes.filter((value) => value === START)).toHaveLength(2)
    expect(A.currentTime).toBe(START)

    await tick(A, { currentTime: START + 0.3 })
    now += START_RESEEK_GRACE_MS
    await tick(A, { currentTime: START + 1.3 })
    expect(h.sentOf("error")).toEqual([])
    expect(h.box.state.phase).toBe("playing")
  })

  it("seeks the active clip only inside its window", async () => {
    const h = await startedHarness()
    h.box.result.seekActive(10)
    expect(A.currentTime).toBe(START)
    h.box.result.seekActive(75)
    expect(A.currentTime).toBe(75)
    h.box.result.seekActive(500)
    expect(A.currentTime).toBe(END)
    expect(h.box.result.activePlayer).toBe(A)
  })
})

describe("useFeedPlayers — tokens and loads (KTD25)", () => {
  it("drops a stale load: no seek on it, and its error does not fail the current clip", async () => {
    const h = await mount()
    await h.send(focus("one"), queued(1))
    await h.send(queued(2), SWIPE, REST)
    const current = h.token("a")
    expect(loads(A)).toEqual([feedUrl(1), feedUrl(2)])

    // Clip 1's swap settles now, so its load lands after clip 2 was set.
    await settle(A)
    expect(A.currentTime).toBe(0)
    expect(h.sentOf("loaded")).toEqual([])
    await act(async () => {
      A.__emit("statusChange", { status: "error", error: { message: "x" } })
    })
    expect(h.sentOf("error")).toEqual([])

    await settle(A)
    expect(A.currentTime).toBe(START)
    expect(h.sentOf("loaded")).toEqual([{ type: "loaded", token: current }])

    // Anti-vacuous: once clip 2 is set, the same error does fail it.
    await act(async () => {
      A.__emit("statusChange", { status: "error", error: { message: "x" } })
    })
    expect(h.sentOf("error")).toEqual([
      { type: "error", token: current, msSinceSourceSet: 0 },
    ])
    // One-player mode never loads the second player.
    expect(B.replaceAsync).not.toHaveBeenCalled()
  })

  it("loads nothing during a 20-swipe streak, then one source when the pager rests", async () => {
    const h = await startedHarness()
    const before = { a: loads(A).length, b: loads(B).length }

    for (let n = 2; n <= 21; n++) await h.send(queued(n), SWIPE)
    expect(loads(A).slice(before.a)).toEqual([])
    expect(loads(B).slice(before.b)).toEqual([])

    await h.send(REST)
    expect([...loads(A).slice(before.a), ...loads(B).slice(before.b)]).toEqual([
      feedUrl(21),
    ])
  })

  it("sets the standby's source only after the active clip plays with 4 s buffered", async () => {
    const h = await startedHarness()
    await h.send(queued(2))
    expect(loads(B)).toEqual([])

    await tick(A, {
      currentTime: START + 0.5,
      bufferedPosition: START + 0.5 + STANDBY_LOAD_AFTER_BUFFERED_SECONDS - 1,
    })
    expect(loads(B)).toEqual([])

    await tick(A, {
      currentTime: START + 1,
      bufferedPosition: START + 1 + STANDBY_LOAD_AFTER_BUFFERED_SECONDS,
    })
    expect(loads(B)).toEqual([feedUrl(2)])
    expect(B.bufferOptions).toEqual({
      preferredForwardBufferDuration: STANDBY_FORWARD_BUFFER_SECONDS,
    })

    await settle(B)
    expect(B.currentTime).toBe(START)
    expect(B.playing).toBe(false)
    expect(B.timeUpdateEventInterval).toBe(0)
    expect(B.__tick({ currentTime: START })).toBe(false)

    await h.send(SWIPE)
    expect(B.timeUpdateEventInterval).toBe(ACTIVE_TIME_UPDATE_INTERVAL_SECONDS)
    expect(A.timeUpdateEventInterval).toBe(0)
  })

  it("replays a clip the player still holds from its own start, with no new request (R41)", async () => {
    const h = await startedHarness()
    await preloadSecondClip(h)
    await h.send(SWIPE, REST)
    B.currentTime = START + 12

    // Back to clip 1 on A. Moving backward with no earlier clip, B's standby
    // slot is clip 2 again, which B still holds.
    await h.send({ type: "swipePrevious" }, REST)
    while (A.__pendingReplaceCount() > 0) await settle(A)
    const replay = h.token("b")
    const requestsBefore = B.replaceAsync.mock.calls.length

    await tick(A, { currentTime: START + 0.5, bufferedPosition: END })
    expect(B.replaceAsync.mock.calls.length).toBe(requestsBefore)
    expect(B.currentTime).toBe(START)
    expect(h.sentOf("loaded")).toContainEqual({
      type: "loaded",
      token: replay,
    })
    expect(h.box.state.slots.b?.status).toBe("ready")
  })

  it("passes every source through the Explore rendition tier", async () => {
    expect(feedUrl(1)).toBe(
      "https://stream.mux.com/clip1.m3u8?max_resolution=480p",
    )
    const h = await startedHarness()
    await preloadSecondClip(h)
    await h.send(SWIPE, REST, queued(3))
    await tick(B, {
      currentTime: START + 0.5,
      bufferedPosition: END,
    })

    expect([...loads(A), ...loads(B)].sort()).toEqual(
      [feedUrl(1), feedUrl(2), feedUrl(3)].sort(),
    )
  })

  it("fails a clip whose stream the app does not play, with no request", async () => {
    const h = await mount()
    await h.send(focus(), queued(1, "https://example.test/clip1.m3u8"))

    expect(A.replaceAsync).not.toHaveBeenCalled()
    expect(h.sentOf("error")).toEqual([
      {
        type: "error",
        token: h.token("a"),
        msSinceSourceSet: Number.POSITIVE_INFINITY,
      },
    ])
    expect(h.box.state.phase).toBe("clipFailed")
  })
})

describe("useFeedPlayers — release (KTD13)", () => {
  it("clears the standby at once on blur, and the active source when the grace ends", async () => {
    const h = await startedHarness()
    await preloadSecondClip(h)
    A.replaceAsync.mockClear()
    B.replaceAsync.mockClear()

    await h.send({ type: "blur", positionSeconds: START + 2 })
    expect(sources(B)).toEqual([null])
    expect(sources(A)).toEqual([])
    expect({
      aPlaying: A.playing,
      aMuted: A.muted,
      bPlaying: B.playing,
      bMuted: B.muted,
    }).toEqual({ aPlaying: false, aMuted: true, bPlaying: false, bMuted: true })

    await h.send({ type: "graceExpired" })
    expect(sources(A)).toEqual([null])
  })

  it("clears both sources at once on Keep watching, and a return reloads at the saved position", async () => {
    const h = await startedHarness()
    await preloadSecondClip(h)
    A.replaceAsync.mockClear()
    B.replaceAsync.mockClear()

    await h.send({ type: "keepWatching", positionSeconds: START + 7 })
    expect(sources(A)).toEqual([null])
    expect(sources(B)).toEqual([null])

    await settle(A)
    await h.send(focus())
    expect(loads(A)).toEqual([feedUrl(1)])
    await settle(A)
    expect(A.currentTime).toBe(START + 7)
    expect(A.playing).toBe(true)
  })
})

describe("useFeedPlayers — StrictMode (setup, cleanup, setup)", () => {
  it("leaves both players usable after the remount cycle", async () => {
    const initial = [focus(), queued(1)].reduce(feedReducer, INITIAL_FEED_STATE)
    const h = await mount({}, { strict: true, initial })

    // The cleanup must not forget the load, or the second setup loads again.
    expect(loads(A)).toEqual([feedUrl(1)])
    await settle(A)
    expect(h.sentOf("loaded")).toHaveLength(1)
    expect(h.sentOf("playing")).toHaveLength(1)
    expect(A.playing).toBe(true)

    await preloadSecondClip(h)
    await h.send(SWIPE)
    expect(B.playing).toBe(true)
    expect(A.playing).toBe(false)

    await act(async () => {
      renderer?.unmount()
    })
    renderer = null
    expect(B.playing).toBe(false)
  })
})

describe("useFeedPlayers — telemetry stages (KTD17)", () => {
  function stageSpies() {
    return {
      onSourceSet: jest.fn(),
      onSourceLoaded: jest.fn(),
      onRebuffer: jest.fn(),
      onClipFailed: jest.fn(),
    }
  }

  async function loading(player: FakePlayer) {
    await act(async () => {
      player.__emit("statusChange", { status: "loading" })
    })
  }

  it("reports each source set and each load, for the active clip and the standby", async () => {
    const spies = stageSpies()
    const h = await mount(spies)
    await h.send(focus(), queued(1))
    const first = h.token("a")
    expect(spies.onSourceSet.mock.calls).toEqual([[first, "a"]])
    expect(spies.onSourceLoaded).not.toHaveBeenCalled()

    await settle(A)
    expect(spies.onSourceLoaded.mock.calls).toEqual([[first]])

    await preloadSecondClip(h)
    const second = h.token("b")
    expect(spies.onSourceSet.mock.calls).toEqual([
      [first, "a"],
      [second, "b"],
    ])
    expect(spies.onSourceLoaded.mock.calls).toEqual([[first], [second]])
    expect(spies.onClipFailed).not.toHaveBeenCalled()
  })

  it("reports a rebuffer only when the playing active clip drops into loading mid-clip", async () => {
    const spies = stageSpies()
    const h = await mount(spies)
    await h.send(focus(), queued(1))
    // The first load's own loading, and the loading right after its start seek.
    await loading(A)
    await settle(A)
    await loading(A)
    expect(spies.onRebuffer).not.toHaveBeenCalled()

    now += SEEK_LOADING_GRACE_MS
    await tick(A, { currentTime: START + 2 })
    await loading(A)
    expect(spies.onRebuffer.mock.calls).toEqual([[h.token("a")]])

    // A loop is a seek, and so is the viewer's scrub.
    now += SEEK_LOADING_GRACE_MS
    await tick(A, { currentTime: END + 0.1 })
    await loading(A)
    now += SEEK_LOADING_GRACE_MS
    h.box.result.seekActive(75)
    await loading(A)
    expect(spies.onRebuffer).toHaveBeenCalledTimes(1)

    // The standby, and a clip the viewer paused, never rebuffer.
    now += SEEK_LOADING_GRACE_MS
    await preloadSecondClip(h)
    now += SEEK_LOADING_GRACE_MS
    await loading(B)
    await h.send({ type: "tap" })
    await loading(A)
    expect(spies.onRebuffer).toHaveBeenCalledTimes(1)

    await h.send({ type: "tap" })
    await loading(A)
    expect(spies.onRebuffer).toHaveBeenCalledTimes(2)
  })

  it("reports no rebuffer while the first frame is still loading", async () => {
    const spies = stageSpies()
    // The play is asked for, but no frame moves yet.
    A.play.mockImplementation(() => {})
    const h = await mount(spies)
    await h.send(focus(), queued(1))
    await settle(A)
    expect(A.play).toHaveBeenCalled()

    now += SEEK_LOADING_GRACE_MS
    await loading(A)
    expect(spies.onRebuffer).not.toHaveBeenCalled()
  })

  it("reports a source error with its slot and the native message", async () => {
    const spies = stageSpies()
    const h = await startedHarness(spies)
    const first = h.token("a")
    await h.send(queued(2))
    await tick(A, { currentTime: START + 0.5, bufferedPosition: END })
    const second = h.token("b")
    await act(async () => {
      B.__settleReplace(new Error("decoder"))
    })
    expect(spies.onClipFailed.mock.calls).toEqual([
      [
        {
          token: second,
          clip: expect.objectContaining({ videoId: "video-2" }),
          kind: "sourceError",
          active: false,
          errorMessage: "decoder",
        },
      ],
    ])

    await act(async () => {
      A.__emit("statusChange", {
        status: "error",
        error: { message: "HTTP 403" },
      })
    })
    expect(spies.onClipFailed.mock.calls[1]).toEqual([
      {
        token: first,
        clip: expect.objectContaining({ videoId: "video-1" }),
        kind: "sourceError",
        active: true,
        errorMessage: "HTTP 403",
      },
    ])
    expect(h.sentOf("error")).toHaveLength(2)
  })

  it("reports no failure for a source its slot no longer holds", async () => {
    const spies = stageSpies()
    const h = await mount(spies)
    await h.send(focus("one"), queued(1))
    await settle(A)
    // A serves clip 2 now, but still holds clip 1 until the pager rests.
    await h.send(queued(2), SWIPE)
    await act(async () => {
      A.__emit("statusChange", { status: "error", error: { message: "x" } })
    })
    expect(spies.onClipFailed).not.toHaveBeenCalled()
    expect(h.box.state.phase).toBe("veiled")
  })

  it("reports a second missed start seek as a missed seek", async () => {
    dropSeeks(A)
    const spies = stageSpies()
    const h = await mount(spies)
    await h.send(focus(), queued(1))
    await settle(A)
    now += START_RESEEK_GRACE_MS
    await tick(A, { currentTime: 0.5 })

    expect(spies.onClipFailed.mock.calls).toEqual([
      [
        {
          token: h.token("a"),
          clip: expect.objectContaining({ videoId: "video-1" }),
          kind: "missedSeek",
          active: true,
          errorMessage: null,
        },
      ],
    ])
  })
})

describe("useFeedPlayers — Mux in-manifest subtitles", () => {
  it("keeps the manifest's subtitle track off (captions come from the VTT)", async () => {
    const h = await mount()
    await h.send(focus(), queued(1))
    A.subtitleTrack = { id: "en", language: "en", label: "English" }
    await settle(A)
    expect(A.subtitleTrack).toBeNull()

    A.subtitleTrack = { id: "en", language: "en", label: "English" }
    await act(async () => {
      A.__emit("subtitleTrackChange", {})
    })
    expect(A.subtitleTrack).toBeNull()
  })
})
