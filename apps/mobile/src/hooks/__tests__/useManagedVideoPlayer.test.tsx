/**
 * CHARACTERIZATION net over `useManagedVideoPlayer` (U2). These tests pin the
 * behaviour the adapter has TODAY, before U5 re-keys its session boundaries onto
 * explicit signals. They are deliberately NOT a statement of desired behaviour:
 * scenario 4 pins a pause on an `inactive` AppState transition, which U5 will
 * invert on purpose.
 *
 * The adapter runs for real inside the real `VideoPlayer`, so the two behaviours
 * U5 re-keys are observed where the app produces them:
 *
 * - R16 — the watch-progress flush: which video it lands against, and on what
 *   trigger.
 * - R17 — the playback-quality session: which video a summary attributes to.
 *
 * Only the module boundaries are faked: expo-video (U1's shared stub), the
 * progress recorder, the QoE session, Datadog, and the visual leaves. The
 * recorder and QoE fakes exist so call counts and trigger/reason strings are
 * directly assertable — the real recorder drops a flush whose position it never
 * observed, which would make "did it flush?" untestable without a live poll.
 *
 * One render registers TWO AppState listeners: the adapter's (pause/resume plus
 * the progress flush) and useControlsVisibility's (foreground chrome snap, which
 * acts on "active" only and never pauses). A state change is delivered to both,
 * as the OS does, so the assertions name the adapter's listener by the effects
 * only it produces — the progress flush and the player pause.
 *
 * apps/mobile's tsconfig maps `react` to its .d.ts and jest-expo mirrors
 * tsconfig paths into jest's moduleNameMapper, so the mocks below re-point
 * `react` at the real package (see apps/mobile/CLAUDE.md "Component render
 * tests").
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

// U1's shared expo-video stub — one fake-player contract for every player suite.
jest.mock("expo-video", () =>
  require("../../test-utils/expoVideoMock").createExpoVideoMock(),
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

// Visual leaves — none participate in either behaviour under test.
jest.mock("expo-image", () => ({ Image: () => null }))
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }))
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("../../components/ui/PlatformBlur", () => ({
  PlatformBlur: () => null,
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
jest.mock("../../lib/datadog", () => ({
  datadogLog: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  reportDatadogAction: jest.fn(),
  reportDatadogError: jest.fn(),
}))

// The recorder's collaborators. The recorder itself is faked below, so these are
// import-safety only — nothing in this suite exercises them.
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

// R16 seam: one fake recorder per identity, so a flush is attributable to the
// video whose recorder emitted it.
jest.mock("../../lib/watchProgress/recorder", () => {
  const recorders: RecorderMockEntry[] = []
  const flushCalls: Array<{ index: number; trigger: string }> = []
  const mock: RecorderMock = {
    createProgressRecorder: jest.fn((identity: unknown) => {
      const index = recorders.length
      const entry: RecorderMockEntry = {
        identity,
        flush: jest.fn((trigger: string) => {
          flushCalls.push({ index, trigger })
        }),
        onTick: jest.fn(),
      }
      recorders.push(entry)
      return entry
    }),
    __recorders: recorders,
    __flushCalls: flushCalls,
    __reset: () => {
      recorders.length = 0
      flushCalls.length = 0
      mock.createProgressRecorder.mockClear()
    },
  }
  return mock
})

// R17 seam: one fake QoE session per `createVideoQoeSession` call, carrying the
// content id it was opened for. `finalize` returns null so the adapter's Datadog
// emit short-circuits — the assertions read finalize directly.
jest.mock("../../lib/videoQoe", () => {
  const actual = jest.requireActual("../../lib/videoQoe")
  const sessions: QoeMockEntry[] = []
  const mock: QoeMock = {
    ...actual,
    createVideoQoeSession: jest.fn(({ contentId }: { contentId: unknown }) => {
      const entry: QoeMockEntry = {
        contentId,
        onFirstPlaying: jest.fn(() => null),
        onRebuffer: jest.fn(),
        onError: jest.fn(),
        onTimeUpdate: jest.fn(),
        finalize: jest.fn(() => null),
      }
      sessions.push(entry)
      return entry
    }),
    __sessions: sessions,
    __reset: () => {
      sessions.length = 0
      mock.createVideoQoeSession.mockClear()
    },
  }
  return mock
})

import { act, type ReactElement } from "react"
import { AppState } from "react-native"

import { VideoPlayer } from "../../components/watch/VideoPlayer"
import type { ProgressIdentity } from "../../lib/watchProgress/recorder"
import type { ExpoVideoMock } from "../../test-utils/expoVideoMock"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

type RecorderMockEntry = {
  identity: unknown
  flush: jest.Mock
  onTick: jest.Mock
}
type RecorderMock = {
  createProgressRecorder: jest.Mock
  __recorders: RecorderMockEntry[]
  __flushCalls: Array<{ index: number; trigger: string }>
  __reset: () => void
}

type QoeMockEntry = {
  contentId: unknown
  onFirstPlaying: jest.Mock
  onRebuffer: jest.Mock
  onError: jest.Mock
  onTimeUpdate: jest.Mock
  finalize: jest.Mock
}
type QoeMock = {
  createVideoQoeSession: jest.Mock
  __sessions: QoeMockEntry[]
  __reset: () => void
}

// react-test-renderer can re-render in place; the shared TestInstance type does
// not declare it, so widen locally rather than editing the shared helper.
type UpdatableInstance = TestInstance & { update(element: ReactElement): void }

// The full VideoPlayer + chrome transform is paid on this suite's first render.
jest.setTimeout(20_000)

const video = jest.requireMock("expo-video") as ExpoVideoMock
const recorderMock = jest.requireMock(
  "../../lib/watchProgress/recorder",
) as RecorderMock
const qoeMock = jest.requireMock("../../lib/videoQoe") as QoeMock

// Two distinct Mux assets: the adapter compares sources by playback id, so a
// swap between these is a genuine cross-asset swap.
const URL_A = "https://stream.mux.com/assetAAA111.m3u8"
const URL_B = "https://stream.mux.com/assetBBB222.m3u8"

const IDENTITY_A: ProgressIdentity = {
  videoId: "video-a",
  videoSlug: "video-a-slug",
  languageSlug: "english",
}
const IDENTITY_B: ProgressIdentity = {
  videoId: "video-b",
  videoSlug: "video-b-slug",
  languageSlug: "english",
}

// Every AppState handler the render registers, in registration order. See the
// two-listener note in the file docblock above.
let appStateHandlers: Array<(state: string) => void> = []

// Unmounted by afterEach unless a test already did it. The chrome arms real
// timers (auto-hide, mount fallback), so a render left standing keeps jest alive.
let mounted: UpdatableInstance | null = null

function element(props: {
  streamingUrl: string | null
  progressIdentity: ProgressIdentity | null
}): ReactElement {
  return (
    <VideoPlayer
      streamingUrl={props.streamingUrl}
      posterUrl={null}
      progressIdentity={props.progressIdentity}
    />
  )
}

async function renderPlayer(
  streamingUrl: string | null = URL_A,
  progressIdentity: ProgressIdentity | null = IDENTITY_A,
): Promise<UpdatableInstance> {
  let renderer!: UpdatableInstance
  await act(async () => {
    renderer = TestRenderer.create(
      element({ streamingUrl, progressIdentity }),
    ) as UpdatableInstance
  })
  mounted = renderer
  return renderer
}

async function unmountPlayer(renderer: UpdatableInstance) {
  await act(async () => {
    renderer.unmount()
  })
  mounted = null
}

async function rerender(
  renderer: UpdatableInstance,
  streamingUrl: string | null,
  progressIdentity: ProgressIdentity | null,
) {
  await act(async () => {
    renderer.update(element({ streamingUrl, progressIdentity }))
  })
}

async function emitAppState(state: string) {
  await act(async () => {
    for (const handler of [...appStateHandlers]) handler(state)
  })
}

beforeEach(() => {
  video.__reset()
  recorderMock.__reset()
  qoeMock.__reset()
  appStateHandlers = []
  jest.spyOn(AppState, "addEventListener").mockImplementation(((
    _event: string,
    handler: (s: string) => void,
  ) => {
    appStateHandlers.push(handler)
    return {
      remove: () => {
        appStateHandlers = appStateHandlers.filter((h) => h !== handler)
      },
    }
  }) as never)
})

afterEach(async () => {
  if (mounted != null) await unmountPlayer(mounted)
  jest.restoreAllMocks()
})

describe("useManagedVideoPlayer — current session boundaries (characterization)", () => {
  it("flushes progress once and finalizes the quality session once on unmount", async () => {
    const renderer = await renderPlayer()
    expect(recorderMock.__recorders).toHaveLength(1)
    expect(qoeMock.__sessions).toHaveLength(1)
    // Anti-vacuous: neither has fired while the host is still mounted, so the
    // assertions below cannot be satisfied by a render alone.
    expect(recorderMock.__flushCalls).toEqual([])
    expect(qoeMock.__sessions[0].finalize).not.toHaveBeenCalled()

    await unmountPlayer(renderer)

    // Today the unmount flush and the re-key flush are the SAME code path, so
    // the trigger string cannot distinguish them: both read "unmount".
    expect(recorderMock.__flushCalls).toEqual([
      { index: 0, trigger: "unmount" },
    ])
    expect(qoeMock.__sessions[0].finalize).toHaveBeenCalledTimes(1)
    expect(qoeMock.__sessions[0].finalize).toHaveBeenCalledWith("abandoned")
    // The departing session is attributed to the video that produced it.
    expect(qoeMock.__sessions[0].contentId).toBe("assetAAA111")
  })

  it("flushes progress on the identity re-key, not on the source change, and opens a new quality session", async () => {
    const renderer = await renderPlayer(URL_A, IDENTITY_A)
    expect(qoeMock.createVideoQoeSession).toHaveBeenCalledTimes(1)

    // A cross-asset source change with the identity unchanged re-keys the
    // quality session but NOT the recorder: the flush is keyed on the progress
    // identity, so a source that moves ahead of its identity flushes nothing.
    await rerender(renderer, URL_B, IDENTITY_A)
    await act(async () => {
      video.__settleReplace()
    })

    expect(video.__player.replaceAsync).toHaveBeenCalledWith(URL_B)
    expect(recorderMock.__flushCalls).toEqual([])
    expect(recorderMock.__recorders).toHaveLength(1)
    expect(qoeMock.createVideoQoeSession).toHaveBeenCalledTimes(2)
    expect(qoeMock.__sessions[0].finalize).toHaveBeenCalledWith("abandoned")
    expect(qoeMock.__sessions[1].contentId).toBe("assetBBB222")

    // Now the identity re-keys (the episode swap the screen actually performs):
    // the departing recorder flushes, under the unmount trigger.
    await rerender(renderer, URL_B, IDENTITY_B)

    expect(recorderMock.__flushCalls).toEqual([
      { index: 0, trigger: "unmount" },
    ])
    expect(recorderMock.__recorders).toHaveLength(2)
    expect(recorderMock.__recorders[1].identity).toEqual(IDENTITY_B)
    // The re-key alone does not touch the quality session.
    expect(qoeMock.createVideoQoeSession).toHaveBeenCalledTimes(2)
  })

  it("flushes progress under the background trigger and pauses the player when the app backgrounds", async () => {
    await renderPlayer()
    // Named for the assertions below: the adapter's listener is one of two.
    expect(appStateHandlers).toHaveLength(2)
    expect(video.__player.pause).not.toHaveBeenCalled()
    expect(recorderMock.__flushCalls).toEqual([])

    await emitAppState("background")

    expect(recorderMock.__flushCalls).toEqual([
      { index: 0, trigger: "background" },
    ])
    expect(video.__player.pause).toHaveBeenCalledTimes(1)
  })

  it("treats an inactive transition exactly like a background one — it pauses today", async () => {
    // THE case that separates correct from buggy after U5, and the only one that
    // does. U5 deliberately inverts this, so the pin makes that inversion a
    // visible, intentional change rather than an unnoticed side effect.
    await renderPlayer()
    expect(video.__player.pause).not.toHaveBeenCalled()

    await emitAppState("inactive")

    expect(video.__player.pause).toHaveBeenCalledTimes(1)
    expect(recorderMock.__flushCalls).toEqual([
      { index: 0, trigger: "background" },
    ])
  })

  it("flushes progress under the end trigger when playback reaches the end", async () => {
    await renderPlayer()
    expect(recorderMock.__flushCalls).toEqual([])

    await act(async () => {
      video.__player.__emit("playToEnd")
    })

    expect(recorderMock.__flushCalls).toEqual([{ index: 0, trigger: "end" }])
    // Playback end does not close the quality session — unmount still does.
    expect(qoeMock.__sessions[0].finalize).not.toHaveBeenCalled()
  })
})
