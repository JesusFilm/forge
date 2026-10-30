// KTD10: the title, description, and study questions come from GET_VIDEO_TEXT,
// so a failed text load offers a retry on the loaded page, not silence.

import { act, type ReactElement } from "react"
import { AccessibilityInfo } from "react-native"

import WatchVideoPage from "../[slug]"
import { WatchSessionProvider } from "../../../src/contexts/WatchSessionProvider"
import type { WatchVideoRecord } from "../../../src/lib/normalizeVideo"
import { encodeWatchSeed } from "../../../src/lib/watchSeed"
import {
  TestRenderer,
  hasText,
  press,
  type RenderedNode,
  type TestInstance,
} from "../../../src/test-utils/rnTestRenderer"

type QueryAnswer = {
  data: unknown
  dataState?: "empty" | "partial" | "complete"
  loading: boolean
  error: unknown
}

// The `mock` prefix is required: babel-plugin-jest-hoist lifts jest.mock above
// these declarations and rejects any other out-of-scope name in a factory.
const mockParams: { current: { slug: string; seed?: string } } = {
  current: { slug: "jesus" },
}
const mockRecordQuery: { current: QueryAnswer } = {
  current: { data: undefined, loading: true, error: undefined },
}
const mockTextQuery: { current: QueryAnswer } = {
  current: { data: undefined, loading: true, error: undefined },
}
const mockRefetch = jest.fn()
const mockRefetchText = jest.fn()

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams.current,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  // The watch screen re-reads its quote cards on each return (KTD11).
  useIsFocused: () => true,
}))
jest.mock("expo-status-bar", () => ({ StatusBar: () => null }))
jest.mock("@expo/vector-icons/Ionicons", () => () => null)
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
jest.mock("../../../src/lib/queries", () => ({
  GET_VIDEO_BY_SLUG: { query: "record" },
  GET_VIDEO_TEXT: { query: "text" },
  GET_VIDEO_DUB: { query: "dub" },
}))
// Each query answers from its own mock, so the record can land while the text
// fails.
jest.mock("@apollo/client/react", () => ({
  useApolloClient: () => ({ query: jest.fn() }),
  useQuery: (query: unknown) => {
    const { GET_VIDEO_TEXT } = jest.requireMock("../../../src/lib/queries")
    return query === GET_VIDEO_TEXT
      ? { ...mockTextQuery.current, refetch: mockRefetchText }
      : { ...mockRecordQuery.current, refetch: mockRefetch }
  },
}))
// The fixtures are in the normalized shape. As in the real merge, the title
// comes from the text companion only.
jest.mock("../../../src/lib/normalizeVideo", () => ({
  normalizeVideo: (
    raw: Record<string, unknown> | null,
    _forms: unknown,
    text: { title?: string } | null,
  ) => (raw == null ? null : { ...raw, title: text?.title ?? null }),
  normalizeDubMedia: (raw: unknown) => raw ?? { downloads: [], subtitles: [] },
}))
jest.mock("../../../src/lib/datadog", () => ({
  datadogLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
  reportDatadogAction: jest.fn(),
}))
// The page's Explore telemetry imports the clip record, which imports this.
jest.mock("@react-native-async-storage/async-storage", () =>
  jest.requireActual(
    "@react-native-async-storage/async-storage/jest/async-storage-mock",
  ),
)
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
jest.mock("../../../src/hooks/useFullscreenPresentation", () => {
  const presentation = { isFullscreen: false, toggleFullscreen: () => {} }
  return { useFullscreenPresentation: () => presentation }
})
jest.mock("../../../src/hooks/usePlaybackFrame", () => ({
  usePlaybackFrameVisible: () => false,
  usePlaybackPlaying: () => false,
}))
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
    audioLanguageIso3: null,
    subtitleLanguageSlug: null,
    subtitleLanguageName: null,
    subtitleLanguageNameLocale: null,
    subtitlesEnabled: false,
    isReady: true,
    setPreferredAudioLanguage: () => {},
    backfillAudioLanguageIso3: () => {},
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
jest.mock("../../../src/components/watch/PlayerSlot", () => ({
  PlayerSlot: () => null,
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

const SLUG = "jesus"
const DETAILS_ERROR = "Couldn't load full details."

const JESUS: Omit<WatchVideoRecord, "title"> = {
  documentId: "video-jesus",
  slug: SLUG,
  label: "FEATURE_FILM",
  description: null,
  snippet: null,
  posterUrl: null,
  streamingUrl: "https://stream.mux.com/dubEnglish.m3u8",
  muxPlaybackId: null,
  duration: 7200,
  primaryLanguageBcp47: null,
  primaryLanguageCoreId: null,
  parentSeries: null,
  siblings: [],
  variants: [],
  studyQuestions: [],
  bibleCitations: [],
  episodes: [],
  languages: [],
}

const FAILED: QueryAnswer = {
  data: undefined,
  dataState: "empty",
  loading: false,
  error: new Error("Network request failed"),
}
const TEXT = { videoBySlug: { documentId: "video-jesus", title: "JESUS" } }
const LOADED_TEXT: QueryAnswer = {
  data: TEXT,
  dataState: "complete",
  loading: false,
  error: undefined,
}

let mounted: TestInstance | null = null

async function render(): Promise<TestInstance> {
  const page: ReactElement = (
    <WatchSessionProvider>
      <WatchVideoPage />
    </WatchSessionProvider>
  )
  await act(async () => {
    mounted = TestRenderer.create(page)
  })
  return mounted as TestInstance
}

/** The retry controls for one Datadog action name. */
function retries(renderer: TestInstance, actionName: string): RenderedNode[] {
  return renderer.root.findAll(
    (node) =>
      node.props["dd-action-name"] === actionName &&
      typeof node.props.onPress === "function",
  )
}

beforeEach(() => {
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockResolvedValue(false)
  jest.spyOn(AccessibilityInfo, "addEventListener").mockImplementation((() => ({
    remove: () => {},
  })) as unknown as typeof AccessibilityInfo.addEventListener)
})

afterEach(async () => {
  if (mounted != null) {
    await act(async () => {
      mounted?.unmount()
    })
    mounted = null
  }
  jest.restoreAllMocks()
  mockParams.current = { slug: SLUG }
  mockRecordQuery.current = { data: undefined, loading: true, error: undefined }
  mockTextQuery.current = { data: undefined, loading: true, error: undefined }
  mockRefetch.mockReset()
  mockRefetchText.mockReset()
})

describe("a failed text load on a loaded watch page", () => {
  beforeEach(() => {
    mockRecordQuery.current = {
      data: { videoBySlug: JESUS },
      dataState: "complete",
      loading: false,
      error: undefined,
    }
  })

  it.each<[string, QueryAnswer]>([
    ["with no data", FAILED],
    // Apollo keeps the previous result on a failure: Home's cached row can hold
    // a title while the description and study questions never arrived.
    [
      "over a partial cached row",
      { ...FAILED, data: TEXT, dataState: "partial" },
    ],
  ])("offers a retry that reloads only the text, %s", async (_, answer) => {
    mockTextQuery.current = answer

    const renderer = await render()

    expect(hasText(renderer, DETAILS_ERROR)).toBe(true)
    const [retry] = retries(renderer, "watch-text-retry")
    expect(retry?.props.accessibilityLabel).toBe("Retry loading video details")
    await press(retry as RenderedNode)
    expect(mockRefetchText).toHaveBeenCalledTimes(1)
    expect(mockRefetch).not.toHaveBeenCalled()
  })

  it.each<[string, QueryAnswer]>([
    ["the text loads", LOADED_TEXT],
    [
      "the text is still loading",
      { data: undefined, dataState: "empty", loading: true, error: undefined },
    ],
    [
      "a refetch fails over complete text",
      { ...LOADED_TEXT, error: FAILED.error },
    ],
  ])("shows no retry when %s", async (_, answer) => {
    mockTextQuery.current = answer

    const renderer = await render()

    expect(retries(renderer, "watch-text-retry")).toHaveLength(0)
    expect(hasText(renderer, DETAILS_ERROR)).toBe(false)
  })
})

describe("a failed record load on a seeded watch page", () => {
  it("retries both the record and the text", async () => {
    mockParams.current = {
      slug: SLUG,
      seed: encodeWatchSeed({
        slug: SLUG,
        title: "JESUS",
        imageUrl: null,
        playbackId: "seedEnglish",
      }),
    }
    mockRecordQuery.current = FAILED
    mockTextQuery.current = FAILED

    const renderer = await render()

    expect(retries(renderer, "watch-text-retry")).toHaveLength(0)
    const [retry] = retries(renderer, "watch-details-retry")
    await press(retry as RenderedNode)
    expect(mockRefetch).toHaveBeenCalledTimes(1)
    expect(mockRefetchText).toHaveBeenCalledTimes(1)
  })
})
