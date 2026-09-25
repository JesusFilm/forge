/**
 * The watch page's Explore full play (KTD17, R34), with the REAL slot and
 * stores: the window keeps the playback session, so a full play can outlive
 * the page. The telemetry is the real module on an injected clock.
 */

import { StrictMode, act, type ReactElement } from "react"
import { AccessibilityInfo } from "react-native"

import WatchVideoPage from "../[slug]"
import { WatchSessionProvider } from "../../../src/contexts/WatchSessionProvider"
import {
  createExploreTelemetry,
  type ExploreTelemetry,
} from "../../../src/lib/explore/telemetry"
import {
  getWatchIntentStore,
  type WatchIntent,
} from "../../../src/lib/explore/watchIntent"
import { getPlaybackRequestStore } from "../../../src/lib/miniPlayer/playbackRequest"
import { endSessionForViewerInitiatedPlayback } from "../../../src/lib/miniPlayer/pictureInPicture"
import { getMiniPlayerStore } from "../../../src/lib/miniPlayer/store"
import { encodeWatchSeed } from "../../../src/lib/watchSeed"
import {
  TestRenderer,
  type TestInstance,
} from "../../../src/test-utils/rnTestRenderer"

// The `mock` prefix is required: babel-plugin-jest-hoist lifts jest.mock above
// these declarations and rejects any other out-of-scope name in a factory.
const mockParams: { current: { slug: string; seed?: string } } = {
  current: { slug: "" },
}
const mockTelemetry: { current: ExploreTelemetry | null } = { current: null }

jest.mock("../../../src/lib/explore/telemetry", () => ({
  ...jest.requireActual("../../../src/lib/explore/telemetry"),
  getExploreTelemetry: () => mockTelemetry.current,
}))
jest.mock("@react-native-async-storage/async-storage", () =>
  jest.requireActual(
    "@react-native-async-storage/async-storage/jest/async-storage-mock",
  ),
)
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams.current,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}))
jest.mock("expo-status-bar", () => ({ StatusBar: () => null }))
jest.mock("expo-image", () => ({ Image: () => null }))
jest.mock("@expo/vector-icons/Ionicons", () => () => null)
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
// No record: the seed paints the page and gives the slot its stream.
jest.mock("@apollo/client/react", () => ({
  useApolloClient: () => ({ query: jest.fn() }),
  useQuery: () => ({
    data: undefined,
    loading: true,
    error: undefined,
    refetch: jest.fn(),
  }),
}))
jest.mock("../../../src/lib/queries", () => ({
  GET_VIDEO_BY_SLUG: {},
  GET_VIDEO_DUB: {},
}))
jest.mock("../../../src/lib/datadog", () => ({
  datadogLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
  reportDatadogAction: jest.fn(),
}))
jest.mock("../../../src/lib/deepLinkOrigin", () => ({
  consumeDeepLinkArrival: () => null,
  whenDeepLinkOriginsReady: () => Promise.resolve(),
}))
jest.mock("../../../src/lib/cachePersistence", () => ({
  schedulePersist: jest.fn(),
}))
jest.mock("../../../src/lib/recommendations/playbackDiscovery", () => ({
  markPlaybackDiscovery: jest.fn(),
}))
jest.mock("../../../src/lib/offlineFileSystem", () => ({
  OFFLINE_ROOT: "file:///docs/offline-downloads/",
}))
jest.mock("../../../src/lib/cast/castAdapter", () => ({
  showCastDialog: () => Promise.resolve(),
}))
jest.mock("../../../src/lib/cast/castMediaResolver", () => ({
  resolveCastMedia: () => null,
}))
jest.mock("../../../src/lib/miniPlayer/playerSettings", () => ({
  effectivePlayerSettings: () => ({ speed: 1, qualityTier: "auto" }),
  getPlayerSettingsStore: () => ({ getSnapshot: () => ({}) }),
}))
jest.mock("../../../src/hooks/useCastPlayback", () => {
  const cast = {
    state: { phase: "idle" },
    position: null,
    duration: null,
    remotePlayerState: null,
    reset: () => {},
  }
  return { useCastPlayback: () => cast }
})
jest.mock("../../../src/hooks/useCastProgressRecording", () => ({
  useCastProgressRecording: () => {},
}))
// One object: the real slot republishes on a new callback, and every publish
// re-renders the page.
jest.mock("../../../src/hooks/useFullscreenPresentation", () => {
  const presentation = { isFullscreen: false, toggleFullscreen: () => {} }
  return { useFullscreenPresentation: () => presentation }
})
jest.mock("../../../src/hooks/useWatchProgressEntry", () => ({
  useWatchProgressEntry: () => undefined,
}))
jest.mock("../../../src/hooks/useExportSession", () => ({
  exportControls: {},
  useExportEntry: () => undefined,
}))
jest.mock("../../../src/hooks/useBibleVerses", () => ({
  useBibleVerses: () => ({ cards: [], reportArtworkFailure: () => {} }),
}))
jest.mock("../../../src/contexts/WatchPreferencesProvider", () => ({
  useWatchPreferences: () => ({
    audioLanguageSlug: "english",
    subtitleLanguageSlug: null,
    subtitleLanguageName: null,
    subtitlesEnabled: false,
    isReady: true,
    setPreferredAudioLanguage: () => {},
    setPreferredSubtitleLanguage: () => {},
    setPreferredSubtitleName: () => {},
    setSubtitlesEnabled: () => {},
  }),
}))
jest.mock("../../../src/contexts/DownloadsProvider", () => ({
  useDownloads: () => ({
    getRecord: () => undefined,
    deleteDownload: () => {},
    pauseDownload: () => {},
    resumeDownload: () => {},
    committedCopyFor: () => null,
    isReady: true,
  }),
}))
jest.mock("../../../src/components/watch/DownloadSheet", () => ({
  rawModeLabel: () => "",
}))
jest.mock("../../../src/components/watch/VideoDetailSkeleton", () => ({
  VideoDetailSkeleton: () => null,
}))
jest.mock("../../../src/components/watch/WatchAmbient", () => ({
  WatchAmbient: () => null,
}))
jest.mock("../../../src/components/watch/VideoMetadata", () => ({
  VideoMetadata: () => null,
}))
jest.mock("../../../src/components/watch/ActionButtonRow", () => ({
  ActionButtonRow: () => null,
}))
jest.mock("../../../src/components/watch/SignInPrompt", () => ({
  SignInPrompt: () => null,
}))
jest.mock("../../../src/components/watch/UpNextCarousel", () => ({
  UpNextCarousel: () => null,
}))
jest.mock("../../../src/components/watch/VideoDescription", () => ({
  VideoDescription: () => null,
}))
jest.mock("../../../src/components/sections/RelatedQuestionsRenderer", () => ({
  RelatedQuestionsRenderer: () => null,
}))
jest.mock(
  "../../../src/components/sections/BibleQuotesCarouselRenderer",
  () => ({ BibleQuotesCarouselRenderer: () => null }),
)
jest.mock("../../../src/components/ui/Snackbar", () => ({
  Snackbar: () => null,
}))
jest.mock("../../../src/components/ui/FloatingBackButton", () => ({
  FloatingBackButton: () => null,
}))

const requests = getPlaybackRequestStore()
const sessions = getMiniPlayerStore()

// The page keys a full play on its intent, and that key outlives a test, so
// each case opens a video of its own.
let caseNumber = 0
let slug = ""
let clock = 0
let playbackStarted = false
let reachedEnd = false
const actions = jest.fn()

function sent(name: string): Record<string, unknown>[] {
  return actions.mock.calls
    .filter(([action]) => action === name)
    .map(([, context]) => context as Record<string, unknown>)
}

function openAt(videoSlug: string) {
  mockParams.current = {
    slug: videoSlug,
    seed: encodeWatchSeed({
      slug: videoSlug,
      title: "JESUS",
      imageUrl: null,
      playbackId: "seedEnglish",
    }),
  }
}

function putIntent(over: Partial<WatchIntent> = {}): WatchIntent {
  return getWatchIntentStore().put({
    videoSlug: slug,
    startSeconds: 740,
    audioLanguageSlug: "english",
    subtitleLanguageSlug: null,
    subtitleOnly: false,
    origin: "explore",
    ...over,
  })
}

function tree(strict = false): ReactElement {
  const page = (
    <WatchSessionProvider>
      <WatchVideoPage />
    </WatchSessionProvider>
  )
  return strict ? <StrictMode>{page}</StrictMode> : page
}

let mounted: TestInstance | null = null

async function render(strict = false): Promise<void> {
  await act(async () => {
    mounted = TestRenderer.create(tree(strict))
  })
}

async function rerender(strict = false): Promise<void> {
  await act(async () => {
    mounted?.update(tree(strict))
  })
}

/** A committed back press: the slot detaches, and a started video floats. */
async function back(): Promise<void> {
  await act(async () => {
    mounted?.unmount()
  })
  mounted = null
}

/** The host's play flag. Its first rise is the page's first frame. */
async function setPlaying(playing: boolean): Promise<void> {
  if (playing) playbackStarted = true
  await act(async () => {
    requests.setPlaying(playing)
  })
}

async function onStore(change: () => void): Promise<void> {
  await act(async () => {
    change()
  })
}

beforeEach(() => {
  caseNumber += 1
  slug = `jesus-${caseNumber}`
  openAt(slug)
  clock = 0
  playbackStarted = false
  reachedEnd = false
  mockTelemetry.current = createExploreTelemetry({
    reportDatadogAction: actions,
    telemetry: { info: jest.fn(), warn: jest.fn() },
    clipRecord: {
      hydrate: () => Promise.resolve(),
      recordVisit: () => null,
      getLastVisitDate: () => null,
    },
    now: () => clock,
  })
  requests.setPlaybackFactsSource({
    hasPlaybackStarted: () => playbackStarted,
    hasReachedEnd: () => reachedEnd,
    readPosition: () => 0,
    readDuration: () => 0,
  })
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockResolvedValue(false)
  jest
    .spyOn(AccessibilityInfo, "isScreenReaderEnabled")
    .mockResolvedValue(false)
  jest.spyOn(AccessibilityInfo, "addEventListener").mockImplementation((() => ({
    remove: () => {},
  })) as unknown as typeof AccessibilityInfo.addEventListener)
})

afterEach(async () => {
  if (mounted != null) await back()
  await onStore(() => {
    sessions.end("abandoned")
    requests.reset()
  })
  jest.restoreAllMocks()
  getWatchIntentStore().clear()
  actions.mockReset()
  mockTelemetry.current = null
})

describe("a page opened from Explore", () => {
  it("starts at the first frame, not at the first render", async () => {
    putIntent()
    await render()
    expect(sent("explore.full_play_start")).toEqual([])

    clock = 4_000
    await setPlaying(true)

    expect(sent("explore.full_play_start")).toEqual([
      { explore_visit_id: null, explore_video_slug: slug },
    ])
    expect(sent("explore.full_play_end")).toEqual([])
  })

  it("runs into the window and ends when the window is dismissed, without paused time", async () => {
    putIntent()
    await render()
    await setPlaying(true)

    clock = 10_000
    await setPlaying(false)
    clock = 70_000
    await setPlaying(true)
    clock = 75_000
    await back()
    // The video floats on: the page is gone, the session is not.
    expect(sessions.getSnapshot().session?.videoSlug).toBe(slug)
    expect(sent("explore.full_play_end")).toEqual([])

    clock = 95_000
    await onStore(() => sessions.requestDismiss())

    expect(sent("explore.full_play_end")).toEqual([
      {
        explore_visit_id: null,
        explore_video_slug: slug,
        explore_full_play_ms: 35_000,
        explore_end_reason: "dismissed",
      },
    ])
  })

  it("ends as played to the end when the window's video ends", async () => {
    putIntent()
    await render()
    await setPlaying(true)
    await back()

    clock = 30_000
    await onStore(() => sessions.markEnded("playToEnd"))

    expect(sent("explore.full_play_end")).toEqual([
      expect.objectContaining({
        explore_full_play_ms: 30_000,
        explore_end_reason: "ended",
      }),
    ])
  })

  it("keeps the store's reason when the window's session is replaced", async () => {
    // end() clears the session, and so the request, BEFORE it reports why.
    putIntent()
    await render()
    await setPlaying(true)
    await back()

    clock = 12_000
    await onStore(() => endSessionForViewerInitiatedPlayback())

    expect(sent("explore.full_play_end")).toEqual([
      expect.objectContaining({
        explore_full_play_ms: 12_000,
        explore_end_reason: "replaced",
      }),
    ])
  })

  it("ends as abandoned when the page closes with no window", async () => {
    putIntent()
    await render()
    await setPlaying(true)

    clock = 50_000
    reachedEnd = true
    await back()

    expect(sessions.getSnapshot().session).toBeNull()
    expect(sent("explore.full_play_end")).toEqual([
      expect.objectContaining({
        explore_video_slug: slug,
        explore_full_play_ms: 50_000,
        explore_end_reason: "abandoned",
      }),
    ])
  })

  it("ends as replaced when a warm deep link reuses the page for another video", async () => {
    putIntent()
    await render()
    await setPlaying(true)

    clock = 8_000
    openAt(`${slug}-next`)
    await rerender()

    expect(sent("explore.full_play_end")).toEqual([
      expect.objectContaining({
        explore_video_slug: slug,
        explore_full_play_ms: 8_000,
        explore_end_reason: "replaced",
      }),
    ])
  })

  it("sends one start and one end under StrictMode and later re-renders", async () => {
    putIntent()
    await render(true)
    await setPlaying(true)
    await rerender(true)
    await setPlaying(false)
    await setPlaying(true)
    await rerender(true)

    expect(sent("explore.full_play_start")).toHaveLength(1)

    await back()
    await onStore(() => sessions.requestDismiss())
    await onStore(() => sessions.end("abandoned"))

    expect(sent("explore.full_play_end")).toEqual([
      expect.objectContaining({ explore_end_reason: "dismissed" }),
    ])
  })

  it("ends the first full play as replaced when a second hand-off takes the player", async () => {
    putIntent()
    await render()
    await setPlaying(true)
    await back()
    // Paused: the host's flag stays up across a source swap, so a playing
    // window would start the next page's full play at its mount.
    clock = 20_000
    await setPlaying(false)

    const first = slug
    slug = `${first}-second`
    openAt(slug)
    putIntent()
    await render()
    clock = 21_000
    await setPlaying(true)
    clock = 31_000
    await back()
    await onStore(() => sessions.requestDismiss())

    expect(sent("explore.full_play_start")).toEqual([
      expect.objectContaining({ explore_video_slug: first }),
      expect.objectContaining({ explore_video_slug: slug }),
    ])
    expect(sent("explore.full_play_end")).toEqual([
      expect.objectContaining({
        explore_video_slug: first,
        explore_full_play_ms: 20_000,
        explore_end_reason: "replaced",
      }),
      expect.objectContaining({
        explore_video_slug: slug,
        explore_full_play_ms: 10_000,
        explore_end_reason: "dismissed",
      }),
    ])
  })
})

describe("a page not opened from Explore (Home, Search, deep link, expand)", () => {
  it("sends nothing from the first frame to the window's end", async () => {
    await render()
    await setPlaying(true)
    await setPlaying(false)
    await setPlaying(true)
    await back()
    await onStore(() => sessions.requestDismiss())

    expect(actions).not.toHaveBeenCalled()
  })

  it("ignores an intent for another video", async () => {
    putIntent({ videoSlug: `${slug}-other` })
    await render()
    await setPlaying(true)
    await back()

    expect(actions).not.toHaveBeenCalled()
  })
})
