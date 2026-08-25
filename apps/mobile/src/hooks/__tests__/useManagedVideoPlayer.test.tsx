/**
 * CHARACTERIZATION net over `useManagedVideoPlayer` (U2), plus the explicit
 * session boundaries U5 re-keyed onto (second describe block). The U2 block
 * still pins the behaviour the adapter had before that re-key, unchanged except
 * for the `inactive` transition, which U5 inverted on purpose — see the comment
 * on that case.
 *
 * The adapter runs for real inside the real `PlaybackHost` — U6 moved the one
 * adapter instance there from `VideoPlayer` — so the two behaviours U5 re-keys
 * are observed where the app produces them:
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
// The transport reads connectivity to tell a paused video from a broken one.
jest.mock("expo-network", () => ({
  useNetworkState: () => ({ isInternetReachable: true }),
}))
jest.mock("expo-image", () => ({ Image: () => null }))
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }))
jest.mock("expo-glass-effect", () => ({ GlassView: () => null }))
// U6 moved the screen's back affordance into the host's layer; it owns the
// router, which is never imported unmocked in this repo.
jest.mock("expo-router", () => ({
  useRouter: () => ({
    back: jest.fn(),
    canGoBack: () => true,
    replace: jest.fn(),
    push: jest.fn(),
  }),
  // The host derives the mini player's presentation from route state (U7). No
  // pattern here, so a published session floats, which is what the adapter's
  // session boundaries are characterized against.
  useSegments: () => [],
}))
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

import { act } from "react"
import { AppState } from "react-native"

import { PlaybackHost } from "../../components/watch/PlaybackHost"
import { datadogLog } from "../../lib/datadog"
import { resetPlayerSettings } from "../../test-utils/resetPlayerSettings"
import { getMiniPlayerStore } from "../../lib/miniPlayer/store"
import { PIP_EXPAND_GRACE_MS } from "../../lib/pipPolicy"
import { useManagedVideoPlayer } from "../useManagedVideoPlayer"
import {
  getPlaybackRequestStore,
  type PlaybackRequest,
} from "../../lib/miniPlayer/playbackRequest"
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

// The full VideoPlayer + chrome transform is paid on this suite's first render.
jest.setTimeout(20_000)

const video = jest.requireMock("expo-video") as ExpoVideoMock
const requestStore = getPlaybackRequestStore()
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
// The adapter's playhead/progress poll interval (STALL_POLL_MS), which is not
// exported. A drift makes the position-feed case fire zero ticks, not a false
// pass.
const POLL_MS = 1000

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
let mounted: TestInstance | null = null
// The slot the host draws into. The screen-side component measures this rect
// from a real layout pass; here it is seeded so the chrome mounts.
let slotId: number | null = null
const SLOT_RECT = { x: 0, y: 0, width: 390, height: 219 }

function request(
  streamingUrl: string | null,
  progressIdentity: ProgressIdentity | null,
): PlaybackRequest {
  return {
    streamingUrl,
    posterUrl: null,
    subtitleVttSrc: null,
    fullscreen: false,
    autostart: false,
    resumeAtSeconds: null,
    progressVideoId: progressIdentity?.videoId ?? null,
    progressVideoSlug: progressIdentity?.videoSlug ?? null,
    progressLanguageSlug: progressIdentity?.languageSlug ?? null,
    onToggleFullscreen: null,
    castActive: false,
    cast: null,
    progressFeedRef: null,
    session:
      progressIdentity == null
        ? null
        : {
            videoId: progressIdentity.videoId ?? null,
            videoSlug: progressIdentity.videoSlug ?? "video-a-slug",
            title: "A video",
            posterUrl: null,
            languageSlug: progressIdentity.languageSlug ?? null,
            originPattern: "watch/[slug]",
          },
  }
}

async function renderPlayer(
  streamingUrl: string | null = URL_A,
  progressIdentity: ProgressIdentity | null = IDENTITY_A,
): Promise<TestInstance> {
  slotId = requestStore.attachSlot(request(streamingUrl, progressIdentity))
  requestStore.setSlotRect(slotId, SLOT_RECT)
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<PlaybackHost />)
  })
  mounted = renderer
  return renderer
}

async function unmountPlayer(renderer: TestInstance) {
  await act(async () => {
    renderer.unmount()
  })
  mounted = null
}

async function rerender(
  _renderer: TestInstance,
  streamingUrl: string | null,
  progressIdentity: ProgressIdentity | null,
) {
  await act(async () => {
    if (slotId != null)
      requestStore.updateSlot(slotId, request(streamingUrl, progressIdentity))
  })
}

async function emitAppState(state: string) {
  await act(async () => {
    for (const handler of [...appStateHandlers]) handler(state)
  })
}

// Both mini-player stores are module singletons, so a session, a latch or a
// mounted slot left by one case would leak into the next.
function resetMiniPlayerStore() {
  requestStore.reset()
  slotId = null
  const store = getMiniPlayerStore()
  store.setPipHold(false)
  store.end("abandoned")
}

beforeEach(() => {
  video.__reset()
  recorderMock.__reset()
  qoeMock.__reset()
  resetMiniPlayerStore()
  resetPlayerSettings()
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
  jest.useRealTimers()
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
    // Id-keyed OR slug-keyed, never both: the host projects the identity the
    // recorder itself contracts for (the slug is offline playback's only key).
    expect(recorderMock.__recorders[1].identity).toEqual({
      videoId: IDENTITY_B.videoId,
      languageSlug: IDENTITY_B.languageSlug,
    })
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

  it("neither pauses nor flushes on an inactive transition", async () => {
    // THE one U2 pin U5 inverts, and the only one it touches. Under U4's
    // decision table `inactive` is a call, the notification shade or the app
    // switcher — the app has not left, and a real departure always follows with
    // `background`, which owns the checkpoint. Flushing here too would spend
    // admin's 30-mutations-per-minute budget on a transient.
    await renderPlayer()
    expect(video.__player.pause).not.toHaveBeenCalled()

    await emitAppState("inactive")

    expect(video.__player.pause).not.toHaveBeenCalled()
    expect(recorderMock.__flushCalls).toEqual([])
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

// One session in the store, matching IDENTITY_A. The adapter reacts to the
// store's endings, so a case that needs one has to open it first.
function startStoreSession(videoId = "video-a", videoSlug = "video-a-slug") {
  getMiniPlayerStore().start({ videoId, videoSlug, title: "A video" })
}

describe("useManagedVideoPlayer — explicit session boundaries (U5)", () => {
  it.each([false, true])(
    "does not pause on an inactive transition (picture-in-picture active: %s)",
    async (pipHold) => {
      await renderPlayer()
      getMiniPlayerStore().setPipHold(pipHold)
      await act(async () => {
        video.__player.play()
      })

      await emitAppState("inactive")

      expect(video.__player.pause).not.toHaveBeenCalled()
      expect(video.__player.playing).toBe(true)
    },
  )

  it("does not pause on background while picture-in-picture is active, and pauses when it is not", async () => {
    await renderPlayer()
    const store = getMiniPlayerStore()
    await act(async () => {
      video.__player.play()
    })

    store.setPipHold(true)
    await emitAppState("background")

    expect(video.__player.pause).not.toHaveBeenCalled()
    // R13 suspends the pause, not the checkpoint: progress still writes.
    expect(recorderMock.__flushCalls).toEqual([
      { index: 0, trigger: "background" },
    ])

    // Releasing the latch now runs the pause it suspended, on the release
    // itself — no second AppState event arrives to carry it.
    await act(async () => {
      store.setPipHold(false)
    })
    expect(video.__player.pause).toHaveBeenCalledTimes(1)

    // An ordinary background with no latch held still pauses.
    await emitAppState("active")
    await act(async () => {
      video.__player.play()
    })
    await emitAppState("background")

    expect(video.__player.pause).toHaveBeenCalledTimes(2)
  })

  // Reported 2026-08-24: pressing Home during playback dismissed the app with
  // no window at all. On the device the background event lands about half a
  // second BEFORE the window starts, so the latch is still clear and the
  // ordinary background pause stops the video the window was about to carry.
  it("resumes playback when the OS window starts after the background pause", async () => {
    const renderer = await renderPlayer()
    const store = getMiniPlayerStore()
    await act(async () => {
      video.__player.play()
    })

    // No setPipHold(true) yet: on the device the background event lands first,
    // so the ordinary pause runs and stops the video the window will carry.
    await emitAppState("background")
    expect(video.__player.playing).toBe(false)

    // The window starts and reports itself.
    await act(async () => {
      store.setPipHold(true)
    })

    expect(video.__player.playing).toBe(true)
    await unmountPlayer(renderer)
  })

  // The undo is gated on the video having been playing, so a video the viewer
  // had already paused does not start itself inside the window.
  it("does not start a paused video when the OS window opens", async () => {
    const renderer = await renderPlayer()
    const store = getMiniPlayerStore()

    await emitAppState("background")
    const playsBefore = video.__player.play.mock.calls.length

    await act(async () => {
      store.setPipHold(true)
    })

    expect(video.__player.play.mock.calls.length).toBe(playsBefore)
    expect(video.__player.playing).toBe(false)
    await unmountPlayer(renderer)
  })

  // Reported 2026-08-24: closing the OS window while the app was away left
  // audio playing faintly, and reopening the app showed the video still
  // running. R13 suspends the background pause while the latch is held, but
  // releasing it fires no AppState event, so nothing ever ran the pause it
  // suspended.
  it("pauses when the viewer closes the OS window while the app is away", async () => {
    const renderer = await renderPlayer()
    const store = getMiniPlayerStore()
    await act(async () => {
      video.__player.play()
    })

    store.setPipHold(true)
    await emitAppState("background")
    expect(video.__player.pause).not.toHaveBeenCalled()

    // The viewer taps the window's close button. No AppState change follows —
    // the app was already in the background. The pause must land on this event
    // and NOT behind a timer: once the activity is stopped a scheduled callback
    // does not run for many seconds, which is what the viewer heard.
    await act(async () => {
      store.setPipHold(false)
    })

    expect(video.__player.pause).toHaveBeenCalledTimes(1)
    expect(video.__player.playing).toBe(false)
    await unmountPlayer(renderer)
  })

  // The same stop event fires when the viewer taps the window to expand it, and
  // that must keep playing. Without the settle delay this case is what a naive
  // pause-on-release breaks.
  it("keeps playing when the viewer expands the OS window back into the app", async () => {
    const renderer = await renderPlayer()
    const store = getMiniPlayerStore()
    await act(async () => {
      video.__player.play()
    })

    store.setPipHold(true)
    await emitAppState("background")

    const playsBefore = video.__player.play.mock.calls.length

    // The release pauses first — the two gestures are indistinguishable at that
    // instant — and the foreground transition that follows identifies an expand
    // and undoes it.
    await act(async () => {
      store.setPipHold(false)
    })
    await emitAppState("active")

    expect(video.__player.playing).toBe(true)
    expect(video.__player.play.mock.calls.length).toBeGreaterThan(playsBefore)
    await unmountPlayer(renderer)
  })

  // The grace window must not resurrect a video the viewer closed and returned
  // to later — that would be the reported complaint in reverse.
  it("leaves the video paused when the viewer returns long after closing the window", async () => {
    const renderer = await renderPlayer()
    const store = getMiniPlayerStore()
    await act(async () => {
      video.__player.play()
    })

    store.setPipHold(true)
    await emitAppState("background")

    await act(async () => {
      store.setPipHold(false)
    })
    expect(video.__player.playing).toBe(false)

    // Return well outside the expand window.
    const realNow = Date.now
    Date.now = () => realNow() + PIP_EXPAND_GRACE_MS + 1000
    try {
      await emitAppState("active")
    } finally {
      Date.now = realNow
    }

    expect(video.__player.playing).toBe(false)
    await unmountPlayer(renderer)
  })

  // The device order is the REVERSE of the case above: the background event
  // lands before the window starts, so the ordinary branch records the
  // was-playing snapshot and the picture-in-picture guard never arms. Closing
  // the window and reopening the app then resumed a video the viewer had
  // dismissed — measured on hardware 2026-08-24, 22 seconds after the close.
  it("leaves the video paused when the window started after the background event", async () => {
    const renderer = await renderPlayer()
    const store = getMiniPlayerStore()
    await act(async () => {
      video.__player.play()
    })

    // Production order: the background pause runs first, then the window
    // reports itself and the started branch undoes that pause.
    await emitAppState("background")
    await act(async () => {
      store.setPipHold(true)
    })
    expect(video.__player.playing).toBe(true)

    // The viewer closes the window.
    await act(async () => {
      store.setPipHold(false)
    })
    expect(video.__player.playing).toBe(false)

    const realNow = Date.now
    Date.now = () => realNow() + PIP_EXPAND_GRACE_MS + 1000
    try {
      await emitAppState("active")
    } finally {
      Date.now = realNow
    }

    expect(video.__player.playing).toBe(false)
    await unmountPlayer(renderer)
  })

  // The grace window undoes the release pause. It must not undo a pause the
  // VIEWER made inside the window: expanding that video back into the app
  // started playing something they had deliberately stopped.
  it("does not resume a video paused inside the window when it expands back", async () => {
    const renderer = await renderPlayer()
    const store = getMiniPlayerStore()
    await act(async () => {
      video.__player.play()
    })

    await emitAppState("background")
    await act(async () => {
      store.setPipHold(true)
    })
    expect(video.__player.playing).toBe(true)

    await act(async () => {
      video.__player.pause()
    })
    await act(async () => {
      store.setPipHold(false)
    })
    await emitAppState("active")

    expect(video.__player.playing).toBe(false)
    await unmountPlayer(renderer)
  })

  // Both picture-in-picture transport calls sat behind a bare catch. The window
  // is on screen either way, so a failure looks like a frozen frame or like
  // audio that will not stop — the two complaints this branch exists to answer,
  // with nothing in the logs to tell them apart.
  it("reports a resume failure when the window opens onto a released player", async () => {
    const renderer = await renderPlayer()
    const store = getMiniPlayerStore()
    await act(async () => {
      video.__player.play()
    })
    await emitAppState("background")
    ;(datadogLog.warn as jest.Mock).mockClear()
    video.__player.play.mockImplementation(() => {
      throw new Error("released")
    })
    await act(async () => {
      store.setPipHold(true)
    })

    expect(datadogLog.warn).toHaveBeenCalledWith(
      "video.resume_failed",
      expect.objectContaining({ surface: "pip_start" }),
    )
    await unmountPlayer(renderer)
  })

  it("reports a pause failure when the viewer closes the window onto a released player", async () => {
    const renderer = await renderPlayer()
    const store = getMiniPlayerStore()
    await act(async () => {
      video.__player.play()
    })
    await emitAppState("background")
    await act(async () => {
      store.setPipHold(true)
    })
    ;(datadogLog.warn as jest.Mock).mockClear()
    video.__player.pause.mockImplementation(() => {
      throw new Error("released")
    })
    await act(async () => {
      store.setPipHold(false)
    })

    expect(datadogLog.warn).toHaveBeenCalledWith(
      "video.pause_failed",
      expect.objectContaining({ surface: "pip_release" }),
    )
    await unmountPlayer(renderer)
  })

  it("does not resume a video the viewer paused inside picture-in-picture", async () => {
    const renderer = await renderPlayer()
    const store = getMiniPlayerStore()
    await act(async () => {
      video.__player.play()
    })

    // An ordinary background first — this is what leaves the was-playing
    // snapshot set, and reading it on the return from picture-in-picture is
    // the defect. Without it the case passes for the wrong reason.
    await emitAppState("background")
    await emitAppState("active")
    expect(video.__player.play).toHaveBeenCalledTimes(2)
    expect(video.__player.playing).toBe(true)

    store.setPipHold(true)
    await emitAppState("background")
    // Playback survived, so there is no was-playing snapshot to refresh.
    expect(video.__player.pause).toHaveBeenCalledTimes(1)

    // The viewer pauses inside the operating system's window.
    await act(async () => {
      video.__player.pause()
    })
    const playsBeforeReturn = video.__player.play.mock.calls.length

    await emitAppState("active")

    expect(video.__player.play).toHaveBeenCalledTimes(playsBeforeReturn)
    expect(video.__player.playing).toBe(false)
    await unmountPlayer(renderer)
  })

  it("flushes under the dismiss trigger and finalizes as dismissed, not abandoned", async () => {
    const renderer = await renderPlayer()
    startStoreSession()
    expect(recorderMock.__flushCalls).toEqual([])
    expect(qoeMock.__sessions[0].finalize).not.toHaveBeenCalled()

    await act(async () => {
      getMiniPlayerStore().requestDismiss()
    })

    expect(recorderMock.__flushCalls).toEqual([
      { index: 0, trigger: "dismiss" },
    ])
    expect(qoeMock.__sessions[0].finalize).toHaveBeenCalledTimes(1)
    expect(qoeMock.__sessions[0].finalize).toHaveBeenCalledWith("dismissed")

    // The teardown safety net still runs and must not overwrite the reason:
    // the explicit signal ran first, so "abandoned" never reaches the summary.
    await unmountPlayer(renderer)
    expect(qoeMock.__sessions[0].finalize).toHaveBeenCalledTimes(1)
  })

  it("ends the first video as replaced and flushes it once when a second starts", async () => {
    await renderPlayer()
    startStoreSession()

    await act(async () => {
      getMiniPlayerStore().start({
        videoId: "video-b",
        videoSlug: "video-b-slug",
        title: "Another video",
      })
    })

    expect(recorderMock.__flushCalls).toEqual([
      { index: 0, trigger: "replace" },
    ])
    expect(qoeMock.__sessions[0].finalize).toHaveBeenCalledTimes(1)
    expect(qoeMock.__sessions[0].finalize).toHaveBeenCalledWith("replaced")
  })

  it("publishes one position update per poll tick while playing, and none while paused", async () => {
    // Fake timers so the adapter's one-second poll is driven, not waited on.
    jest.useFakeTimers()
    await renderPlayer()
    const store = getMiniPlayerStore()
    startStoreSession()
    let updates = 0
    const unsubscribe = store.subscribe(() => {
      updates += 1
    })

    video.__player.duration = 120
    await act(async () => {
      video.__player.play()
    })
    video.__player.currentTime = 5
    await act(async () => {
      jest.advanceTimersByTime(POLL_MS)
    })

    expect(updates).toBe(1)
    expect(store.getSnapshot().session?.positionSeconds).toBe(5)
    expect(store.getSnapshot().session?.durationSeconds).toBe(120)

    await act(async () => {
      video.__player.pause()
    })
    video.__player.currentTime = 9
    await act(async () => {
      jest.advanceTimersByTime(POLL_MS * 3)
    })

    expect(updates).toBe(1)
    expect(store.getSnapshot().session?.positionSeconds).toBe(5)
    unsubscribe()
  })
})

// U2 (KTD2): swap admission learns quality constraints. The pair below is the
// falsification structure — same asset + same constraint coalesces, same asset
// + different constraint admits — so admission is only explainable by the
// `sameQualityConstraint` term; removing it turns exactly one of them red.
describe("useManagedVideoPlayer — quality-constraint swap admission (U2)", () => {
  // Same playback id as URL_A with an unrelated param: one asset, and neither
  // URL carries a max/min_resolution constraint.
  const URL_A_VARIANT =
    "https://stream.mux.com/assetAAA111.m3u8?redundant_streams=true"
  const URL_A_CAPPED =
    "https://stream.mux.com/assetAAA111.m3u8?max_resolution=720p"

  it("still coalesces a same-asset URL change with no constraint change", async () => {
    const renderer = await renderPlayer(URL_A, IDENTITY_A)

    await rerender(renderer, URL_A_VARIANT, IDENTITY_A)

    expect(video.__player.replaceAsync).not.toHaveBeenCalled()
    expect(video.__player.replace).not.toHaveBeenCalled()
  })

  it("admits a same-asset swap whose quality constraint changed", async () => {
    const renderer = await renderPlayer(URL_A, IDENTITY_A)

    await rerender(renderer, URL_A_CAPPED, IDENTITY_A)

    expect(video.__player.replaceAsync).toHaveBeenCalledTimes(1)
    expect(video.__player.replaceAsync).toHaveBeenCalledWith(URL_A_CAPPED)
  })

  it("keeps the QoE session and the progress recorder across a constraint-only swap (R14/AE8)", async () => {
    const renderer = await renderPlayer(URL_A, IDENTITY_A)
    expect(qoeMock.createVideoQoeSession).toHaveBeenCalledTimes(1)

    await rerender(renderer, URL_A_CAPPED, IDENTITY_A)
    await act(async () => {
      video.__settleReplace()
    })

    // Not a session ending: no finalize, no new QoE session, no flush, and
    // the recorder never re-keys — progress continues on the same video.
    expect(qoeMock.createVideoQoeSession).toHaveBeenCalledTimes(1)
    expect(qoeMock.__sessions[0].finalize).not.toHaveBeenCalled()
    expect(recorderMock.__flushCalls).toEqual([])
    expect(recorderMock.__recorders).toHaveLength(1)
  })

  it("suppresses the promise-time resume for a constraint-only swap; a cross-asset swap keeps it", async () => {
    const renderer = await renderPlayer(URL_A, IDENTITY_A)
    await act(async () => {
      video.__player.play()
    })
    expect(video.__player.play).toHaveBeenCalledTimes(1)

    await rerender(renderer, URL_A_CAPPED, IDENTITY_A)
    await act(async () => {
      video.__settleReplace()
    })

    // The host's sourceLoad latch owns the constraint-swap resume: a play at
    // promise time would land before the seek and restart at zero.
    expect(video.__player.play).toHaveBeenCalledTimes(1)

    await rerender(renderer, URL_B, IDENTITY_A)
    await act(async () => {
      video.__settleReplace()
    })

    // Cross-asset keeps today's behavior exactly: promise-time resume, the
    // old QoE session finalized as abandoned, a new one opened.
    expect(video.__player.play).toHaveBeenCalledTimes(2)
    expect(qoeMock.createVideoQoeSession).toHaveBeenCalledTimes(2)
    expect(qoeMock.__sessions[0].finalize).toHaveBeenCalledWith("abandoned")
    expect(qoeMock.__sessions[1].contentId).toBe("assetBBB222")
  })
})

// The resume position for error recovery comes from THIS poll, not from
// expo-video's `timeUpdate` — that event only fires when
// `timeUpdateEventInterval` is set, which this app never does. An earlier
// version listened for it and the position silently stayed at zero while the
// tests passed, because they emitted the event by hand.
describe("useManagedVideoPlayer — healthy position for error recovery", () => {
  function renderProbe(sourceUrl: string | null) {
    const box: { get: () => number } = { get: () => -1 }
    function Probe({ url }: { url: string | null }) {
      const { getHealthyPosition } = useManagedVideoPlayer(url, undefined, {
        ownsSession: true,
      })
      box.get = getHealthyPosition
      return null
    }
    let renderer!: TestInstance
    act(() => {
      renderer = TestRenderer.create(<Probe url={sourceUrl} />)
    })
    return { box, renderer, Probe }
  }

  it("tracks the position the poll reports while the player is healthy", async () => {
    jest.useFakeTimers()
    const { box, renderer } = renderProbe(URL_A)

    video.__player.status = "readyToPlay"
    await act(async () => {
      video.__player.play()
    })
    video.__player.currentTime = 249.7
    await act(async () => {
      jest.advanceTimersByTime(POLL_MS)
    })

    expect(box.get()).toBe(249.7)

    // The failure zeroes the player's own clock; the tracked value must not
    // follow it down, because that is what recovery resumes from.
    video.__player.status = "error"
    video.__player.currentTime = 0
    await act(async () => {
      jest.advanceTimersByTime(POLL_MS)
    })

    expect(box.get()).toBe(249.7)
    await act(async () => {
      renderer.unmount()
    })
  })

  it("forgets the position when the source changes", async () => {
    jest.useFakeTimers()
    const { box, renderer, Probe } = renderProbe(URL_A)

    video.__player.status = "readyToPlay"
    await act(async () => {
      video.__player.play()
    })
    video.__player.currentTime = 249.7
    await act(async () => {
      jest.advanceTimersByTime(POLL_MS)
    })
    expect(box.get()).toBe(249.7)

    await act(async () => {
      renderer.update(<Probe url={URL_B} />)
    })

    expect(box.get()).toBe(0)
    await act(async () => {
      renderer.unmount()
    })
  })
})
