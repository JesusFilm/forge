/**
 * The SDUI hero yields the decoder too (U8, R9/R10).
 *
 * R19 keeps this hero OUT of the mini player, which is exactly why it is easy
 * to forget: it can never become the floating window, but it still holds a
 * video surface while the window plays over it.
 *
 * The real `useMiniPlayerActive` runs here over an injected store, so the
 * subscription itself is under test rather than stubbed away.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("expo-video", () =>
  require("../../../test-utils/expoVideoMock").expoVideoModuleMock(),
)
jest.mock("expo", () => {
  const actual = jest.requireActual("expo")
  return {
    ...actual,
    useEvent: (_player: unknown, _name: string, initial: unknown) => initial,
  }
})
jest.mock("expo-image", () => {
  const { View } = require("react-native")
  return { Image: View }
})
jest.mock("expo-linear-gradient", () => {
  const { View } = require("react-native")
  return { LinearGradient: View }
})
jest.mock("expo-blur", () => {
  const { View } = require("react-native")
  return { BlurView: View }
})
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("../../../contexts/ExperienceProvider", () => ({
  useVideoThumbnail: () => "https://images.test/hero.jpg",
}))
jest.mock("../../../lib/blockVideoDub", () => ({
  blockStreamingUrl: () => "https://stream.mux.com/abc123.m3u8",
}))
jest.mock("../../../lib/miniPlayer", () => ({
  getMiniPlayerStore: () => mockMiniPlayerStore,
  getMiniPlayerSheets: () => {
    throw new Error("videoHeroDecoder test reached the singleton sheet counter")
  },
  registerSessionEnd: () => () => {},
}))
// Everything below is what PlaybackHost needs to render beside the hero.
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

import { act, useMemo } from "react"
import { AppState } from "react-native"
import { VideoView, useVideoPlayer } from "expo-video"

import { VideoHeroRenderer } from "../VideoHeroRenderer"
import { PlaybackHost } from "../../watch/PlaybackHost"
import { useHostPlayback } from "../../../hooks/useHostPlayback"
import { useMiniPlayerActive } from "../../../hooks/useMiniPlayerActive"
import { createSessionEndRegistry } from "../../../lib/miniPlayer/endRegistry"
import { resetHostPlayerBridge } from "../../../lib/miniPlayer/hostPlayer"
import type { PlaybackClaim } from "../../../lib/miniPlayer/hostPlayer"
import {
  createMiniPlayerStore,
  type MiniPlayerStore,
} from "../../../lib/miniPlayer/store"
import { createSheetCounter } from "../../../lib/miniPlayer/suppression"
import { showsSeriesTrailer } from "../../../lib/seriesHero"
import type { AdminBlock } from "../../../lib/queries"
import {
  createdFakePlayers,
  lastFakePlayer,
  peakMountedSurfaces,
  resetExpoVideoMock,
} from "../../../test-utils/expoVideoMock"
import {
  TestRenderer,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

let mockMiniPlayerStore: MiniPlayerStore

const SECTION = {
  __typename: "VideoHeroBlock",
  heading: "Watch the film",
  subheading: null,
  ctaLabel: null,
  ctaLink: null,
  sectionKey: "hero",
  videoId: "video-1",
} as unknown as AdminBlock

let live: TestInstance[] = []

function videoSurfaces(renderer: TestInstance) {
  return renderer.root.findAll(
    (node) => node.props.testID === "expo-video-view",
  )
}

async function mount() {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<VideoHeroRenderer section={SECTION} />)
  })
  live.push(renderer)
  return renderer
}

async function startSession() {
  await act(async () => {
    mockMiniPlayerStore.start({
      videoSlug: "birth-of-jesus",
      streamingUrl: "https://stream.test/mini.m3u8",
    })
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  resetExpoVideoMock()
  resetHostPlayerBridge()
  sheets = createSheetCounter()
  registry = createSessionEndRegistry()
  live = []
  mockMiniPlayerStore = createMiniPlayerStore({
    getSubjectId: () => "account-1",
    subscribeToSubject: () => () => {},
  })
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
  mockMiniPlayerStore.destroy()
  resetHostPlayerBridge()
})

describe("the SDUI hero and the one decoder", () => {
  it("mounts its video view when no session holds playback", async () => {
    const renderer = await mount()

    expect(videoSurfaces(renderer)).toHaveLength(1)
  })

  it("unmounts the video view while a session holds playback", async () => {
    const renderer = await mount()

    await startSession()

    expect(videoSurfaces(renderer)).toHaveLength(0)
  })

  it("still paints its poster while suppressed", async () => {
    // Dropping the surface without the poster leaves a hero-sized hole, which
    // reads as a broken page rather than as deference.
    const renderer = await mount()

    await startSession()

    const posters = renderer.root.findAll(
      (node) => node.props.recyclingKey === "hero-img",
    )
    expect(posters.length).toBeGreaterThan(0)
  })

  it("pauses the transport as well as dropping the surface", async () => {
    const renderer = await mount()
    const player = lastFakePlayer()
    player.pause.mockClear()

    await startSession()

    expect(player.pause).toHaveBeenCalled()
    expect(videoSurfaces(renderer)).toHaveLength(0)
  })

  it("comes back when the session ends", async () => {
    const renderer = await mount()
    await startSession()

    await act(async () => {
      mockMiniPlayerStore.end("dismissed")
    })

    expect(videoSurfaces(renderer)).toHaveLength(1)
    expect(lastFakePlayer().play).toHaveBeenCalled()
  })

  it("does not re-render on the session's one-second position write", async () => {
    // useMiniPlayerActive reads a BOOLEAN, not the snapshot. Subscribing to the
    // object re-renders every consumer once a second, Home's feed included.
    await mount()
    await startSession()
    const before = lastFakePlayer().pause.mock.calls.length

    await act(async () => {
      mockMiniPlayerStore.updateProgress(12, 120)
      mockMiniPlayerStore.updateProgress(13, 120)
    })

    expect(lastFakePlayer().pause.mock.calls.length).toBe(before)
  })
})

// ── The screen you were ON when you opened a watch route ────────────────────

let sheets: ReturnType<typeof createSheetCounter>
let registry: ReturnType<typeof createSessionEndRegistry>

const WATCH_URL = "https://stream.test/watch.m3u8"
const TRAILER_URL = "https://stream.test/trailer.m3u8"
const EXPERIENCE_SEGMENTS = ["experience", "[slug]"] as const
const WATCH_SEGMENTS = ["watch", "[slug]"] as const

/** The watch route's player block, the same shape the real route uses. */
function FakeWatchRoute({ streamingUrl }: { streamingUrl: string }) {
  const claim = useMemo<PlaybackClaim | null>(
    () => ({
      videoId: "watch-1",
      videoSlug: "birth-of-jesus",
      languageSlug: null,
      streamingUrl,
    }),
    [streamingUrl],
  )
  const { player } = useHostPlayback({ claim, store: mockMiniPlayerStore })
  if (player == null) return null
  return <VideoView player={player.player} />
}

/**
 * The series screen's trailer, reduced to its decoder. It reads the same two
 * things the real screen does — `useMiniPlayerActive` for the gate and
 * `showsSeriesTrailer` for the decision — and nothing else on that screen says
 * anything about who owns the decoder.
 */
function FakeSeriesTrailer() {
  const miniPlayerActive = useMiniPlayerActive()
  const showTrailer = showsSeriesTrailer({
    hasSeries: true,
    hasTrailer: true,
    miniPlayerActive,
  })
  const player = useVideoPlayer(TRAILER_URL, (p) => {
    if (showTrailer) p.play()
  })
  if (!showTrailer) return null
  return <VideoView player={player} />
}

type TogetherProps = {
  previous: "experience" | "series"
  watchUrl: string | null
  segments: readonly string[]
}

/**
 * The previous screen, the watch route and the root host in ONE tree. A native
 * stack keeps the previous screen mounted for the whole push, so a suite that
 * renders either half alone counts one decoder and calls it correct.
 */
function Together({ previous, watchUrl, segments }: TogetherProps) {
  return (
    <>
      {previous === "experience" ? (
        <VideoHeroRenderer section={SECTION} />
      ) : (
        <FakeSeriesTrailer />
      )}
      {watchUrl != null && <FakeWatchRoute streamingUrl={watchUrl} />}
      <PlaybackHost
        store={mockMiniPlayerStore}
        sheets={sheets}
        registerEnd={registry.register}
        useRouteSegments={() => segments}
        canGoBack={() => true}
        navigateToVideo={() => {}}
      />
    </>
  )
}

async function mountTogether(props: TogetherProps) {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<Together {...props} />)
  })
  live.push(renderer)
  return renderer
}

async function updateTogether(renderer: TestInstance, props: TogetherProps) {
  await act(async () => {
    renderer.update(<Together {...props} />)
  })
}

describe("opening a watch route over the previous screen", () => {
  it("drops the SDUI hero's surface on the CLAIM, before playback starts", async () => {
    // The session does not exist until playback starts and admission latches.
    // Suppression that waits for it leaves this whole window unguarded, and a
    // native stack keeps the hero mounted through all of it.
    const renderer = await mountTogether({
      previous: "experience",
      watchUrl: null,
      segments: EXPERIENCE_SEGMENTS,
    })
    expect(videoSurfaces(renderer)).toHaveLength(1)
    expect(mockMiniPlayerStore.getSnapshot()).toBeNull()

    await updateTogether(renderer, {
      previous: "experience",
      watchUrl: WATCH_URL,
      segments: WATCH_SEGMENTS,
    })

    // Still no session — the claim is what does the work here.
    expect(mockMiniPlayerStore.getSnapshot()).toBeNull()
    expect(videoSurfaces(renderer)).toHaveLength(1)
    expect(peakMountedSurfaces()).toBe(1)
  })

  it("silences the series trailer on the CLAIM, before playback starts", async () => {
    // Otherwise the viewer hears the trailer over the episode they just opened.
    const renderer = await mountTogether({
      previous: "series",
      watchUrl: null,
      segments: ["series", "[slug]"],
    })
    const trailer = lastFakePlayer()
    expect(trailer.play).toHaveBeenCalled()
    trailer.play.mockClear()

    await updateTogether(renderer, {
      previous: "series",
      watchUrl: WATCH_URL,
      segments: WATCH_SEGMENTS,
    })

    expect(mockMiniPlayerStore.getSnapshot()).toBeNull()
    expect(trailer.play).not.toHaveBeenCalled()
    expect(videoSurfaces(renderer)).toHaveLength(1)
    expect(peakMountedSurfaces()).toBe(1)
  })

  it("brings the hero back when the watch route leaves without playing", async () => {
    // The complement. A claim that never became a session must not leave the
    // page it was opened from with a dead hero.
    const renderer = await mountTogether({
      previous: "experience",
      watchUrl: WATCH_URL,
      segments: WATCH_SEGMENTS,
    })
    // The hero mounts first, so its player is the first one created. The host
    // builds its own after it, and `at(-1)` would name that one.
    const hero = createdFakePlayers()[0]
    hero.play.mockClear()

    await updateTogether(renderer, {
      previous: "experience",
      watchUrl: null,
      segments: EXPERIENCE_SEGMENTS,
    })

    expect(videoSurfaces(renderer)).toHaveLength(1)
    expect(hero.play).toHaveBeenCalled()
  })
})

describe("the SDUI hero's transport under suppression", () => {
  it("does NOT start at creation while the window already holds playback", async () => {
    // The creation setup runs once, outside every effect that could correct
    // it, so an unconditional play() here is audio with no video.
    await startSession()

    const renderer = await mount()

    expect(videoSurfaces(renderer)).toHaveLength(0)
    expect(lastFakePlayer().play).not.toHaveBeenCalled()
  })

  it("does NOT resume on foreground while the window holds playback", async () => {
    const listeners = captureAppStateListeners()

    await mount()
    await startSession()
    const player = lastFakePlayer()
    player.play.mockClear()

    await act(async () => {
      for (const listener of listeners) listener("background")
    })
    await act(async () => {
      for (const listener of listeners) listener("active")
    })

    expect(player.play).not.toHaveBeenCalled()
  })

  it("DOES resume on foreground when nothing holds playback", async () => {
    // Anti-vacuous: the guard above must not be "the hero never resumes".
    const listeners = captureAppStateListeners()

    await mount()
    const player = lastFakePlayer()
    player.play.mockClear()

    await act(async () => {
      for (const listener of listeners) listener("background")
    })
    await act(async () => {
      for (const listener of listeners) listener("active")
    })

    expect(player.play).toHaveBeenCalled()
  })
})

/** The hero's own AppState handler, so a test drives the real listener. */
function captureAppStateListeners(): ((state: string) => void)[] {
  const listeners: ((state: string) => void)[] = []
  jest.spyOn(AppState, "addEventListener").mockImplementation(((
    _event: string,
    handler: (s: string) => void,
  ) => {
    listeners.push(handler)
    return { remove: () => {} }
  }) as never)
  return listeners
}
