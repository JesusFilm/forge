/**
 * KTD6/U5: the hook's `progressFeed` facade. It must stay identity-stable
 * while dereferencing the CURRENT recorder at call time (the recorder is
 * rebuilt on every dub switch), and under `castActive` the local 1s poll
 * must contribute no recorder ticks — QoE keeps observing.
 *
 * Rendered under <StrictMode> per the repo's remount-safety discipline.
 */

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
jest.mock("expo", () => ({
  useEvent: () => ({ isPlaying: mockIsPlaying }),
}))
jest.mock("expo-video", () => ({
  useVideoPlayer: (_source: unknown, setup?: (player: unknown) => void) => {
    setup?.(mockPlayer)
    return mockPlayer
  },
}))
jest.mock("../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
// Switchable: null routes to the REAL recorder (integration through the
// feed); a spy factory isolates which instance received which call.
jest.mock("../../lib/watchProgress/recorder", () => {
  const actual = jest.requireActual<
    typeof import("../../lib/watchProgress/recorder")
  >("../../lib/watchProgress/recorder")
  return {
    ...actual,
    createProgressRecorder: (
      ...args: Parameters<typeof actual.createProgressRecorder>
    ) => (mockRecorderFactory ?? actual.createProgressRecorder)(...args),
  }
})
jest.mock("../../lib/watchProgress/store", () => ({
  applyLocalProgress: jest.fn(),
  bufferProgressIntent: jest.fn(),
}))
jest.mock("../../lib/watchProgress/signInPrompt", () => ({
  noteSignedOutPlaybackStop: jest.fn(),
}))
jest.mock("../../lib/watchProgress/syncClient", () => ({
  getProgressSync: () => ({ drainIntents: mockDrainIntents }),
  getSignedInAccountId: () => mockAccountId,
}))
jest.mock("../../lib/videoQoe", () => ({
  createVideoQoeSession: () => mockQoe,
  shouldCountRebuffer: () => false,
}))
// The hold cases own the session to reach the dismiss flush; the episode
// recorder that ownership also creates is not what they measure.
jest.mock("../../lib/recommendations/playbackRecorderClient", () => ({
  createPlaybackRecorderForMedia: () => null,
}))

import { StrictMode, act, type ReactElement } from "react"
import { AppState, type AppStateStatus } from "react-native"

import {
  useManagedVideoPlayer,
  type ProgressHold,
} from "../useManagedVideoPlayer"
import { getMiniPlayerStore } from "../../lib/miniPlayer/store"
import type {
  createProgressRecorder,
  ProgressIdentity,
} from "../../lib/watchProgress/recorder"
import {
  applyLocalProgress,
  bufferProgressIntent,
} from "../../lib/watchProgress/store"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../../src/test-utils/rnTestRenderer"

let mockIsPlaying = false
let mockAccountId: string | null = null
const mockDrainIntents = jest.fn()
let mockRecorderFactory: typeof createProgressRecorder | null = null
const mockQoe = {
  finalize: jest.fn(() => null),
  onFirstPlaying: jest.fn(),
  onTimeUpdate: jest.fn(),
  onError: jest.fn(),
  onRebuffer: jest.fn(),
}

// Spy recorder factory — each createProgressRecorder call mints a fresh
// instance so tests can tell the rebuilt recorder from the flushed one.
type SpyRecorder = { onTick: jest.Mock; flush: jest.Mock }
const createdRecorders: SpyRecorder[] = []
const spyRecorderFactory = (() => {
  const recorder: SpyRecorder = { onTick: jest.fn(), flush: jest.fn() }
  createdRecorders.push(recorder)
  return recorder
}) as unknown as typeof createProgressRecorder

// Player event registry honoring remove(), so StrictMode's cleaned-up first
// subscription cannot double-fire into the assertions.
const playerListeners = new Map<string, Set<(payload?: unknown) => void>>()
function firePlayerEvent(event: string, payload?: unknown) {
  for (const listener of [...(playerListeners.get(event) ?? [])]) {
    listener(payload)
  }
}
const mockPlayer = {
  playing: false,
  muted: false,
  loop: false,
  currentTime: 7,
  duration: 120,
  status: "readyToPlay",
  play: jest.fn(),
  pause: jest.fn(),
  replace: jest.fn(),
  replaceAsync: jest.fn(() => Promise.resolve()),
  addListener: (event: string, listener: (payload?: unknown) => void) => {
    let set = playerListeners.get(event)
    if (set == null) {
      set = new Set()
      playerListeners.set(event, set)
    }
    set.add(listener)
    return { remove: () => set.delete(listener) }
  },
}

const appStateListeners = new Set<(state: AppStateStatus) => void>()
function fireAppState(state: AppStateStatus) {
  for (const listener of [...appStateListeners]) listener(state)
}

let latest: ReturnType<typeof useManagedVideoPlayer> | null = null

type HarnessProps = {
  castActive: boolean
  identity: ProgressIdentity | null
  sourceUrl?: string
  progressHold?: ProgressHold | null
  ownsSession?: boolean
}

function Harness({
  castActive,
  identity,
  sourceUrl = "https://stream.mux.com/abc123.m3u8",
  progressHold = null,
  ownsSession = false,
}: HarnessProps) {
  latest = useManagedVideoPlayer(sourceUrl, undefined, {
    progress: identity,
    castActive,
    progressHold,
    ownsSession,
  })
  return null
}

type UpdatableRenderer = TestInstance & { update(element: ReactElement): void }

async function render(props: HarnessProps): Promise<UpdatableRenderer> {
  let renderer!: UpdatableRenderer
  await act(async () => {
    renderer = TestRenderer.create(
      <StrictMode>
        <Harness {...props} />
      </StrictMode>,
    ) as UpdatableRenderer
  })
  return renderer
}

async function update(renderer: UpdatableRenderer, props: HarnessProps) {
  await act(async () => {
    renderer.update(
      <StrictMode>
        <Harness {...props} />
      </StrictMode>,
    )
  })
}

const IDENTITY: ProgressIdentity = { videoId: "v1", languageSlug: "en" }
const bufferIntentMock = bufferProgressIntent as jest.Mock
const applyLocalMock = applyLocalProgress as jest.Mock

beforeEach(() => {
  mockIsPlaying = false
  mockAccountId = "user-1"
  mockRecorderFactory = null
  createdRecorders.length = 0
  playerListeners.clear()
  latest = null
  getMiniPlayerStore().setPipHold(false)
  getMiniPlayerStore().end("abandoned")
  jest.clearAllMocks()
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((_type, listener) => {
      appStateListeners.add(listener)
      return {
        remove: () => appStateListeners.delete(listener),
      } as never
    })
})

afterEach(() => {
  appStateListeners.clear()
  jest.restoreAllMocks()
  jest.useRealTimers()
})

describe("progressFeed facade (KTD6)", () => {
  it("is identity-stable across re-renders and recorder rebuilds", async () => {
    const renderer = await render({ castActive: false, identity: IDENTITY })
    const feed = latest!.progressFeed
    expect(feed).toBeDefined()
    await update(renderer, {
      castActive: true,
      identity: { videoId: "v1", languageSlug: "fr" },
    })
    expect(latest!.progressFeed).toBe(feed)
    await act(async () => renderer.unmount())
  })

  it("routes calls to the CURRENT recorder after a dub-switch rebuild", async () => {
    mockRecorderFactory = spyRecorderFactory
    const renderer = await render({ castActive: true, identity: IDENTITY })
    const feed = latest!.progressFeed
    const before = createdRecorders.at(-1)!

    feed.onTick(100, 600)
    expect(before.onTick).toHaveBeenCalledWith(100, 600)

    // Dub switch re-keys the recorder: the old one flushes, a new one lands.
    await update(renderer, {
      castActive: true,
      identity: { videoId: "v1", languageSlug: "fr" },
    })
    const after = createdRecorders.at(-1)!
    expect(after).not.toBe(before)
    expect(before.flush).toHaveBeenCalledWith("unmount")

    feed.onTick(200, 600)
    expect(after.onTick).toHaveBeenCalledWith(200, 600)
    expect(before.onTick).not.toHaveBeenCalledWith(200, 600)
    await act(async () => renderer.unmount())
  })

  it("no-ops with no progress identity (hero-safe)", async () => {
    const renderer = await render({ castActive: true, identity: null })
    const feed = latest!.progressFeed
    expect(() => {
      feed.onTick(100, 600)
      feed.flush("pause")
    }).not.toThrow()
    expect(bufferIntentMock).not.toHaveBeenCalled()
    await act(async () => renderer.unmount())
  })
})

describe("cast ticks through the feed (real recorder)", () => {
  it("AE2: flush('end') after a cast tick records the completed range", async () => {
    const renderer = await render({ castActive: true, identity: IDENTITY })
    const feed = latest!.progressFeed

    feed.onTick(1200, 3600)
    feed.flush("end")

    expect(bufferIntentMock.mock.calls.at(-1)?.[0]).toMatchObject({
      videoId: "v1",
      positionSeconds: 3600,
      durationSeconds: 3600,
    })
    expect(mockDrainIntents).toHaveBeenCalledWith({ forced: true })
    await act(async () => renderer.unmount())
  })

  it("signed-out cast ticks write nothing (R10)", async () => {
    mockAccountId = null
    const renderer = await render({ castActive: true, identity: IDENTITY })

    latest!.progressFeed.onTick(60, 100)

    expect(bufferIntentMock).not.toHaveBeenCalled()
    await act(async () => renderer.unmount())
  })

  it("backgrounding mid-cast flushes at the last remote position", async () => {
    const renderer = await render({ castActive: true, identity: IDENTITY })

    latest!.progressFeed.onTick(500, 600)
    await act(async () => fireAppState("background"))

    expect(bufferIntentMock.mock.calls.at(-1)?.[0]).toMatchObject({
      positionSeconds: 500,
      durationSeconds: 600,
    })
    expect(mockDrainIntents).toHaveBeenCalledWith({ forced: true })
    await act(async () => renderer.unmount())
  })
})

describe("castActive local-tick gating (KTD6)", () => {
  it("skips the local recorder tick while castActive; QoE still observes", async () => {
    jest.useFakeTimers()
    mockIsPlaying = true
    const renderer = await render({ castActive: true, identity: IDENTITY })
    // StrictMode's mount cycle finalizes the first QoE session (pre-existing
    // dev-only artifact); a genuine cross-asset swap re-arms it so the
    // "QoE still observes" half stays assertable under StrictMode.
    await update(renderer, {
      castActive: true,
      identity: IDENTITY,
      sourceUrl: "https://stream.mux.com/xyz789.m3u8",
    })
    bufferIntentMock.mockClear()

    await act(async () => {
      jest.advanceTimersByTime(2100)
    })

    expect(mockQoe.onTimeUpdate).toHaveBeenCalledWith(7)
    // Real recorder in play: the local poll must land zero intents.
    expect(bufferIntentMock).not.toHaveBeenCalled()
    await act(async () => renderer.unmount())
  })

  it("control: feeds the local recorder tick without a session", async () => {
    jest.useFakeTimers()
    mockIsPlaying = true
    const renderer = await render({ castActive: false, identity: IDENTITY })

    await act(async () => {
      jest.advanceTimersByTime(2100)
    })

    expect(bufferIntentMock).toHaveBeenCalledWith(
      expect.objectContaining({ videoId: "v1", positionSeconds: 7 }),
    )
    await act(async () => renderer.unmount())
  })

  it("suppresses local playToEnd's end flush under castActive", async () => {
    mockRecorderFactory = spyRecorderFactory
    const renderer = await render({ castActive: true, identity: IDENTITY })
    const recorder = createdRecorders.at(-1)!

    await act(async () => firePlayerEvent("playToEnd"))

    expect(recorder.flush).not.toHaveBeenCalledWith("end")
    await act(async () => renderer.unmount())
  })

  it("control: local playToEnd still flushes 'end' without a session", async () => {
    mockRecorderFactory = spyRecorderFactory
    const renderer = await render({ castActive: false, identity: IDENTITY })
    const recorder = createdRecorders.at(-1)!

    await act(async () => firePlayerEvent("playToEnd"))

    expect(recorder.flush).toHaveBeenCalledWith("end")
    await act(async () => renderer.unmount())
  })
})

// KTD12 / AE6: the watch page after "Keep watching" plays from the clip's tap
// point, and admin keeps the NEWEST write, so any write during the offer would
// replace the viewer's real saved position. Real recorder throughout.
describe("progress hold (KTD12)", () => {
  const HOLD: ProgressHold = { id: "keep-watching-1", durationMs: 8_000 }
  const NO_WRITES = { buffered: 0, local: 0, drains: 0 }
  // These adapters own the session, so one left mounted by a failed case would
  // flush into the next case's dismiss. A second unmount is a no-op.
  const renderers: UpdatableRenderer[] = []

  afterEach(async () => {
    for (const renderer of renderers.splice(0)) {
      await act(async () => renderer.unmount())
    }
  })

  async function renderHeld(props: HarnessProps) {
    const renderer = await render(props)
    renderers.push(renderer)
    return renderer
  }

  function held(overrides: Partial<HarnessProps> = {}): HarnessProps {
    return {
      castActive: false,
      identity: IDENTITY,
      progressHold: HOLD,
      ownsSession: true,
      ...overrides,
    }
  }

  /** Labelled, so a failure names the write path that leaked. */
  function writesAt(step: string) {
    return {
      step,
      buffered: bufferIntentMock.mock.calls.length,
      local: applyLocalMock.mock.calls.length,
      drains: mockDrainIntents.mock.calls.length,
    }
  }

  function clearWrites() {
    bufferIntentMock.mockClear()
    applyLocalMock.mockClear()
    mockDrainIntents.mockClear()
  }

  function writtenVideoIds(): unknown[] {
    return bufferIntentMock.mock.calls.map(
      ([intent]) => (intent as { videoId?: string }).videoId,
    )
  }

  async function advance(ms: number) {
    await act(async () => {
      jest.advanceTimersByTime(ms)
    })
  }

  function startSession() {
    getMiniPlayerStore().start({
      videoId: "v1",
      videoSlug: "v1-slug",
      title: "Video 1",
    })
  }

  it("holds the batched write, the pause flush and the dismiss flush", async () => {
    jest.useFakeTimers()
    mockIsPlaying = true
    const renderer = await renderHeld(held())
    startSession()

    await advance(3_100)
    expect(writesAt("batched")).toEqual({ step: "batched", ...NO_WRITES })

    mockIsPlaying = false
    await update(renderer, held())
    expect(writesAt("pause")).toEqual({ step: "pause", ...NO_WRITES })

    await act(async () => fireAppState("background"))
    expect(writesAt("background")).toEqual({
      step: "background",
      ...NO_WRITES,
    })

    latest!.progressFeed.onTick(1200, 3600)
    latest!.progressFeed.flush("pause")
    expect(writesAt("cast feed")).toEqual({ step: "cast feed", ...NO_WRITES })

    await act(async () => getMiniPlayerStore().requestDismiss())
    expect(writesAt("dismiss")).toEqual({ step: "dismiss", ...NO_WRITES })

    await act(async () => renderer.unmount())
    expect(writesAt("unmount")).toEqual({ step: "unmount", ...NO_WRITES })
  })

  it("starts its clock at the first frame, so a slow load keeps the whole hold", async () => {
    jest.useFakeTimers()
    const renderer = await renderHeld(held())
    // A load longer than the hold itself: a clock started on arrival would
    // already have run out by the first frame.
    await advance(10_000)

    mockIsPlaying = true
    await update(renderer, held())
    await advance(7_900)
    expect(writesAt("inside the hold")).toEqual({
      step: "inside the hold",
      ...NO_WRITES,
    })

    await advance(1_200)
    expect(writtenVideoIds()).toContain("v1")
    await act(async () => renderer.unmount())
  })

  it("resumes every write at its deadline while the request still carries it", async () => {
    jest.useFakeTimers()
    mockIsPlaying = true
    const renderer = await renderHeld(held())
    startSession()

    await advance(7_900)
    expect(writesAt("inside the hold")).toEqual({
      step: "inside the hold",
      ...NO_WRITES,
    })
    await advance(1_200)
    expect(writtenVideoIds()).toContain("v1")

    // A screen reader keeps the offer up for minutes, so the page republishes
    // the same hold (a fresh object) long after its deadline.
    clearWrites()
    await update(renderer, held({ progressHold: { ...HOLD } }))
    await advance(5 * 60_000)
    expect(writtenVideoIds()).toContain("v1")

    clearWrites()
    mockIsPlaying = false
    await update(renderer, held({ progressHold: { ...HOLD } }))
    expect(writtenVideoIds()).toEqual(["v1"])

    clearWrites()
    await act(async () => getMiniPlayerStore().requestDismiss())
    expect(writtenVideoIds()).toEqual(["v1"])
    await act(async () => renderer.unmount())
  })

  it("ends at once when the request drops it (an offer choice)", async () => {
    jest.useFakeTimers()
    mockIsPlaying = true
    const renderer = await renderHeld(held())
    await advance(3_100)
    expect(writesAt("inside the hold")).toEqual({
      step: "inside the hold",
      ...NO_WRITES,
    })

    await update(renderer, held({ progressHold: null }))
    await advance(2_100)

    expect(writtenVideoIds()).toContain("v1")
    await act(async () => renderer.unmount())
  })

  // The departing recorder flushes in its effect cleanup, which runs BEFORE
  // the commit that no longer carries the hold is applied. That flush is the
  // tap-point position the hold exists to keep out of admin.
  it("keeps the departing video's last flush held when the next request carries none", async () => {
    jest.useFakeTimers()
    mockIsPlaying = true
    const renderer = await renderHeld(held())
    await advance(3_100)

    await update(
      renderer,
      held({
        identity: { videoId: "v2", languageSlug: "en" },
        progressHold: null,
      }),
    )
    await advance(2_100)

    expect(writtenVideoIds()).not.toContain("v1")
    expect(writtenVideoIds()).toContain("v2")
    await act(async () => renderer.unmount())
  })

  it("never restarts the same hold's clock, and arms a new hold afresh", async () => {
    jest.useFakeTimers()
    mockIsPlaying = true
    const renderer = await renderHeld(held())
    await advance(9_100)
    expect(writtenVideoIds()).toContain("v1")

    // The same hold leaving and coming back (a stacked page popping back into
    // ownership) keeps its first, spent clock.
    await update(renderer, held({ progressHold: null }))
    await update(renderer, held())
    clearWrites()
    await advance(2_100)
    expect(writtenVideoIds()).toContain("v1")

    // A new hold is a new offer: its clock starts on the next frame.
    await update(
      renderer,
      held({ progressHold: { id: "keep-watching-2", durationMs: 8_000 } }),
    )
    clearWrites()
    await advance(7_000)
    expect(writesAt("inside the new hold")).toEqual({
      step: "inside the new hold",
      ...NO_WRITES,
    })
    await advance(3_100)
    expect(writtenVideoIds()).toContain("v1")
    await act(async () => renderer.unmount())
  })
})
