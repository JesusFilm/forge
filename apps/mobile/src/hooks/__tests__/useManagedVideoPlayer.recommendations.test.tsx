/**
 * Wiring pins for the recommendation episode recorder inside the adapter
 * (feat-516). The recorder's own decisions live in
 * `src/lib/recommendations/__tests__/playbackRecorder.test.ts`; this suite
 * proves the adapter CREATES one for the session-owning host, feeds it the
 * player's lifecycle, and disposes it on teardown — the seam a one-line
 * revert at any call site would silently sever.
 *
 * Same harness as `useManagedVideoPlayer.test.tsx`: the adapter runs inside
 * the real `PlaybackHost`, with the module boundaries faked.
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

jest.mock("expo-video", () =>
  require("../../test-utils/expoVideoMock").createExpoVideoMock(),
)

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

jest.mock("expo-network", () => ({
  useNetworkState: () => ({ isInternetReachable: true }),
}))
jest.mock("expo-image", () => ({ Image: () => null }))
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }))
jest.mock("expo-glass-effect", () => ({ GlassView: () => null }))
jest.mock("expo-router", () => ({
  useRouter: () => ({
    back: jest.fn(),
    canGoBack: () => true,
    replace: jest.fn(),
    push: jest.fn(),
  }),
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
jest.mock("../../lib/videoQoe", () => {
  const actual = jest.requireActual("../../lib/videoQoe")
  return {
    ...actual,
    createVideoQoeSession: jest.fn(() => ({
      onFirstPlaying: jest.fn(() => null),
      onRebuffer: jest.fn(),
      onError: jest.fn(),
      onTimeUpdate: jest.fn(),
      finalize: jest.fn(() => null),
    })),
  }
})

// The seam under test. One fake recorder per factory call, so every lifecycle
// call is attributable to the media it was created for.
jest.mock("../../lib/recommendations/playbackRecorderClient", () => {
  const recorders: FakeRecorder[] = []
  const factory = jest.fn(
    (input: { mediaId: string; discoveryKeys: unknown[] }) => {
      const recorder: FakeRecorder = {
        input,
        start: jest.fn(),
        onPlayingChange: jest.fn(),
        onTick: jest.fn(),
        onBuffering: jest.fn(),
        onBufferingEnd: jest.fn(),
        onVisibility: jest.fn(),
        onError: jest.fn(),
        onEnd: jest.fn(),
        dispose: jest.fn(),
        getState: jest.fn(),
      }
      recorders.push(recorder)
      return recorder
    },
  )
  return {
    createPlaybackRecorderForMedia: factory,
    __recorders: recorders,
    __reset: () => {
      recorders.length = 0
      factory.mockClear()
    },
  }
})

import { act } from "react"
import { AppState } from "react-native"

import { PlaybackHost } from "../../components/watch/PlaybackHost"
import { resetPlayerSettings } from "../../test-utils/resetPlayerSettings"
import { getMiniPlayerStore } from "../../lib/miniPlayer/store"
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

type FakeRecorder = {
  input: { mediaId: string; discoveryKeys: unknown[] }
  start: jest.Mock
  onPlayingChange: jest.Mock
  onTick: jest.Mock
  onBuffering: jest.Mock
  onBufferingEnd: jest.Mock
  onVisibility: jest.Mock
  onError: jest.Mock
  onEnd: jest.Mock
  dispose: jest.Mock
  getState: jest.Mock
}
type RecorderClientMock = {
  createPlaybackRecorderForMedia: jest.Mock
  __recorders: FakeRecorder[]
  __reset: () => void
}

jest.setTimeout(20_000)

const video = jest.requireMock("expo-video") as ExpoVideoMock
const requestStore = getPlaybackRequestStore()
const recorderClient = jest.requireMock(
  "../../lib/recommendations/playbackRecorderClient",
) as RecorderClientMock

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
const POLL_MS = 1000

let appStateHandlers: Array<(state: string) => void> = []
let mounted: TestInstance | null = null
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
  streamingUrl: string | null,
  identity: ProgressIdentity,
) {
  await act(async () => {
    if (slotId != null)
      requestStore.updateSlot(slotId, request(streamingUrl, identity))
  })
}

async function emitAppState(state: string) {
  await act(async () => {
    for (const handler of [...appStateHandlers]) handler(state)
  })
}

function latestRecorder(): FakeRecorder {
  const recorder =
    recorderClient.__recorders[recorderClient.__recorders.length - 1]
  if (!recorder) throw new Error("no recorder was created")
  return recorder
}

function resetMiniPlayerStore() {
  requestStore.reset()
  slotId = null
  const store = getMiniPlayerStore()
  store.setPipHold(false)
  store.end("abandoned")
}

beforeEach(() => {
  video.__reset()
  recorderClient.__reset()
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

describe("useManagedVideoPlayer — recommendation episode recorder wiring", () => {
  it("creates and starts one recorder for the host's media, keyed by Admin id and slug", async () => {
    await renderPlayer()
    expect(recorderClient.createPlaybackRecorderForMedia).toHaveBeenCalledTimes(
      1,
    )
    const recorder = latestRecorder()
    expect(recorder.input).toEqual({
      mediaId: "video-a",
      discoveryKeys: ["video-a-slug", "video-a"],
    })
    expect(recorder.start).toHaveBeenCalledTimes(1)
  })

  it("creates no recorder without an Admin video id", async () => {
    await renderPlayer(URL_A, { videoSlug: "offline-slug", languageSlug: null })
    expect(recorderClient.createPlaybackRecorderForMedia).not.toHaveBeenCalled()
  })

  // The seed path: a search result or a Home tile plays the seed stream while
  // the record (and with it the Admin id) is still loading, so the recorder is
  // created AFTER playback began and the isPlaying effect never re-runs.
  it("primes a recorder created after playback began with the live playing state", async () => {
    await renderPlayer(URL_A, { videoSlug: "video-a-slug", languageSlug: null })
    expect(recorderClient.createPlaybackRecorderForMedia).not.toHaveBeenCalled()
    const player = video.__player
    await act(async () => {
      player.play()
    })
    await rerender(URL_A, IDENTITY_A)
    const recorder = latestRecorder()
    expect(recorder.start).toHaveBeenCalledTimes(1)
    expect(recorder.onPlayingChange).toHaveBeenCalledWith(
      true,
      expect.any(Number),
    )
    expect(recorder.start.mock.invocationCallOrder[0]).toBeLessThan(
      recorder.onPlayingChange.mock.invocationCallOrder[0]!,
    )
  })

  it("does not prime a recorder while the player is paused", async () => {
    await renderPlayer(URL_A, { videoSlug: "video-a-slug", languageSlug: null })
    await rerender(URL_A, IDENTITY_A)
    const recorder = latestRecorder()
    expect(recorder.start).toHaveBeenCalledTimes(1)
    expect(recorder.onPlayingChange).not.toHaveBeenCalled()
  })

  it("feeds play, pause, ticks and play-to-end to the recorder", async () => {
    jest.useFakeTimers()
    await renderPlayer()
    const recorder = latestRecorder()
    const player = video.__player
    await act(async () => {
      player.__emit("playingChange", { isPlaying: true })
    })
    expect(recorder.onPlayingChange).toHaveBeenLastCalledWith(
      true,
      expect.any(Number),
    )
    await act(async () => {
      jest.advanceTimersByTime(POLL_MS * 3)
    })
    expect(recorder.onTick).toHaveBeenCalledTimes(3)
    await act(async () => {
      player.__emit("playingChange", { isPlaying: false })
    })
    expect(recorder.onPlayingChange).toHaveBeenLastCalledWith(
      false,
      expect.any(Number),
    )
    await act(async () => {
      player.__emit("playToEnd")
    })
    expect(recorder.onEnd).toHaveBeenCalledWith(
      "ended",
      expect.any(Number),
      expect.any(Number),
    )
  })

  it("reports background and foreground as visibility", async () => {
    await renderPlayer()
    const recorder = latestRecorder()
    await emitAppState("background")
    expect(recorder.onVisibility).toHaveBeenLastCalledWith(
      false,
      expect.any(Number),
    )
    await emitAppState("active")
    expect(recorder.onVisibility).toHaveBeenLastCalledWith(
      true,
      expect.any(Number),
    )
  })

  it("keeps the video visible while the OS window holds it", async () => {
    await renderPlayer()
    const recorder = latestRecorder()
    await act(async () => {
      getMiniPlayerStore().setPipHold(true)
    })
    await emitAppState("background")
    expect(recorder.onVisibility).toHaveBeenLastCalledWith(
      true,
      expect.any(Number),
    )
  })

  // Closing the OS window fires no AppState event; the hold's release is the
  // only signal, and it is a separate branch from the listener above.
  it("reports the video hidden when the OS window is closed while the app is away", async () => {
    await renderPlayer()
    const recorder = latestRecorder()
    const player = video.__player
    await act(async () => {
      player.play()
    })
    await act(async () => {
      getMiniPlayerStore().setPipHold(true)
    })
    await emitAppState("background")
    recorder.onVisibility.mockClear()
    await act(async () => {
      getMiniPlayerStore().setPipHold(false)
    })
    expect(recorder.onVisibility).toHaveBeenCalledWith(
      false,
      expect.any(Number),
    )
    expect(player.pause).toHaveBeenCalled()
  })

  it("routes a player error and a rebuffer to the recorder", async () => {
    await renderPlayer()
    const recorder = latestRecorder()
    const player = video.__player
    // Playback must have STARTED before a `loading` counts as a rebuffer; the
    // adapter latches that from the committed play state, so commit it first.
    await act(async () => {
      player.__emit("playingChange", { isPlaying: true })
    })
    await act(async () => {
      player.__emit("statusChange", { status: "loading" })
    })
    expect(recorder.onBuffering).toHaveBeenCalledWith(
      "waiting",
      expect.any(Number),
    )
    await act(async () => {
      player.__emit("statusChange", { status: "readyToPlay" })
    })
    expect(recorder.onBufferingEnd).toHaveBeenCalledWith(
      true,
      expect.any(Number),
    )
    await act(async () => {
      player.__emit("statusChange", {
        status: "error",
        error: { message: "x" },
      })
    })
    expect(recorder.onError).toHaveBeenCalledWith(expect.any(Number))
  })

  it("disposes the first recorder and creates a second when the media changes", async () => {
    await renderPlayer()
    const first = latestRecorder()
    await rerender(URL_B, IDENTITY_B)
    expect(first.dispose).toHaveBeenCalledTimes(1)
    expect(recorderClient.createPlaybackRecorderForMedia).toHaveBeenCalledTimes(
      2,
    )
    expect(latestRecorder().input.mediaId).toBe("video-b")
  })

  it("keeps the recorder across a dub switch of the same media", async () => {
    await renderPlayer()
    const first = latestRecorder()
    await rerender(URL_B, { ...IDENTITY_A, languageSlug: "french" })
    expect(first.dispose).not.toHaveBeenCalled()
    expect(recorderClient.createPlaybackRecorderForMedia).toHaveBeenCalledTimes(
      1,
    )
  })

  // Regression from the device smoke (2026-09-16): the first source arriving
  // (null → url) and a dub switch both end the QoE session as "abandoned";
  // mapping that onto the episode ended every episode 19 ms after it began.
  it("does not end the episode when the source swaps in or changes dub", async () => {
    await renderPlayer(null, IDENTITY_A)
    const recorder = latestRecorder()
    await rerender(URL_A, IDENTITY_A)
    await rerender(URL_B, { ...IDENTITY_A, languageSlug: "french" })
    expect(recorder.onEnd).not.toHaveBeenCalled()
    expect(recorder.onError).not.toHaveBeenCalled()
    expect(recorder.dispose).not.toHaveBeenCalled()
  })

  it("ends the episode as a route exit when the viewer dismisses the window", async () => {
    await renderPlayer()
    const recorder = latestRecorder()
    await act(async () => {
      getMiniPlayerStore().start({
        videoId: "video-a",
        videoSlug: "video-a-slug",
        title: "A video",
      })
    })
    await act(async () => {
      getMiniPlayerStore().requestDismiss()
    })
    expect(recorder.onEnd).toHaveBeenCalledWith(
      "route_exit",
      expect.any(Number),
      expect.any(Number),
    )
  })

  // The live `replaced` path: the request store ends the session INSIDE its
  // commit, before the host re-renders, so the flush lands on the departing
  // media's recorder and never on the one created for the new media.
  it("ends the departing episode as a route exit when new content replaces the session", async () => {
    await renderPlayer()
    const first = latestRecorder()
    await act(async () => {
      getMiniPlayerStore().start({
        videoId: "video-a",
        videoSlug: "video-a-slug",
        title: "A video",
      })
    })
    await rerender(URL_B, IDENTITY_B)
    expect(first.onEnd).toHaveBeenCalledWith(
      "route_exit",
      expect.any(Number),
      expect.any(Number),
    )
    expect(first.dispose).toHaveBeenCalledTimes(1)
    const second = latestRecorder()
    expect(second).not.toBe(first)
    expect(second.input.mediaId).toBe("video-b")
    expect(second.onEnd).not.toHaveBeenCalled()
  })

  it("disposes the recorder on unmount", async () => {
    const renderer = await renderPlayer()
    const recorder = latestRecorder()
    await unmountPlayer(renderer)
    expect(recorder.dispose).toHaveBeenCalledTimes(1)
  })
})
