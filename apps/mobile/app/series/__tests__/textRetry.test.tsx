// KTD10: a failed GET_SERIES_TEXT offers a retry on the loaded page.
// KTD16: the Subtitles pill reads the cached name in the screen's captured tag.

import { act } from "react"

import SeriesScreen from "../[slug]"
import { getCatalogTag } from "../../../src/i18n/localeStore"
import type { WatchVideoRecord } from "../../../src/lib/normalizeVideo"
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
type ActionRowProps = { subtitleLabel: unknown }

// The `mock` prefix is required: babel-plugin-jest-hoist lifts jest.mock above
// these declarations and rejects any other out-of-scope name in a factory.
const mockRecordQuery: { current: QueryAnswer } = {
  current: { data: undefined, loading: true, error: undefined },
}
const mockTextQuery: { current: QueryAnswer } = {
  current: { data: undefined, loading: true, error: undefined },
}
const mockRefetch = jest.fn()
const mockRefetchText = jest.fn()
const mockSeriesSession: { current: Record<string, unknown> } = { current: {} }
const mockCapturedTag = { current: "en" }
const mockPrefs = {
  subtitleLanguageSlug: null as string | null,
  subtitleLanguageName: null as string | null,
  subtitleLanguageNameLocale: null as string | null,
  subtitlesEnabled: false,
}
const mockActionRows: ActionRowProps[] = []

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ slug: "the-chosen" }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}))
jest.mock("expo-status-bar", () => ({ StatusBar: () => null }))
jest.mock("expo-image", () => ({ Image: () => null }))
jest.mock("@expo/vector-icons/Ionicons", () => () => null)
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
jest.mock("../../../src/lib/queries", () => ({
  GET_SERIES_BY_SLUG: { query: "record" },
  GET_SERIES_TEXT: { query: "text" },
}))
// Each query answers from its own mock, so the record can land while the text
// fails.
jest.mock("@apollo/client/react", () => ({
  useQuery: (query: unknown) => {
    const { GET_SERIES_TEXT } = jest.requireMock("../../../src/lib/queries")
    return query === GET_SERIES_TEXT
      ? { ...mockTextQuery.current, refetch: mockRefetchText }
      : { ...mockRecordQuery.current, refetch: mockRefetch }
  },
}))
jest.mock("../../../src/lib/normalizeVideo", () => ({
  normalizeSeries: (raw: unknown) => raw ?? null,
}))
jest.mock("../../../src/i18n/useScreenAdminForms", () => ({
  useScreenAdminForms: () =>
    jest
      .requireActual("../../../src/i18n/adminLanguage")
      .adminFormsFor(mockCapturedTag.current),
}))
// The page reads the series from the session, which the record publishes.
jest.mock("../../../src/contexts/SeriesSessionProvider", () => ({
  useSeriesSession: () => mockSeriesSession.current,
}))
jest.mock("../../../src/contexts/WatchPreferencesProvider", () => ({
  useWatchPreferences: () => mockPrefs,
}))
jest.mock("../../../src/contexts/DownloadsProvider", () => ({
  useDownloads: () => ({
    downloadedSlugs: new Set(),
    offlineRecords: [],
    pendingSwapSlugs: new Set(),
    getRecord: () => undefined,
    deleteDownload: () => {},
    pauseDownload: () => {},
    resumeDownload: () => {},
    cancelDownload: () => {},
  }),
}))
jest.mock("../../../src/lib/seriesDownloadAggregate", () => ({
  deriveEpisodeBadges: () => ({}),
  deriveSeriesDownloadState: () => ({
    inProgress: false,
    pausedAggregate: false,
    total: 0,
    inFlightSlugs: [],
    exportingSlugs: [],
  }),
  seriesAllDownloaded: () => false,
}))
jest.mock("../../../src/hooks/useSeriesSubtitleUnion", () => ({
  useSeriesSubtitleUnion: () => ({ subtitles: null, error: null }),
}))
jest.mock("../../../src/hooks/useExportSession", () => ({
  useScopedExportSession: () => ({ targets: [], pausedTargets: [] }),
  useSeriesExportProgress: () => null,
}))
jest.mock("../../../src/lib/exportSession", () => ({
  getExportSessionStore: () => ({}),
}))
jest.mock("../../../src/lib/seriesExportProgress", () => ({
  requestSeriesExportCancel: () => {},
}))
jest.mock("../../../src/lib/recommendations/playbackDiscovery", () => ({
  discoverySourceFromParam: () => null,
  markPlaybackDiscovery: () => {},
}))
jest.mock("../../../src/hooks/useFullscreenPresentation", () => ({
  useFullscreenPresentation: () => ({
    isFullscreen: false,
    toggleFullscreen: () => {},
  }),
}))
jest.mock("../../../src/hooks/usePlaybackFrame", () => ({
  usePlaybackFrameVisible: () => false,
}))
jest.mock("../../../src/components/watch/PlayerSlot", () => ({
  PlayerSlot: () => null,
}))
jest.mock("../../../src/components/watch/VideoDetailSkeleton", () => ({
  VideoDetailSkeleton: () => null,
}))
jest.mock("../../../src/components/watch/VideoMetadata", () => ({
  VideoMetadata: () => null,
}))
jest.mock("../../../src/components/watch/VideoDescription", () => ({
  VideoDescription: () => null,
}))
jest.mock("../../../src/components/watch/SeriesActionRow", () => ({
  SeriesActionRow: (props: ActionRowProps) => {
    mockActionRows.push(props)
    return null
  },
}))
// The grid draws the header, which holds the retry rows.
jest.mock("../../../src/components/series/SeriesEpisodesGrid", () => ({
  SeriesEpisodesGrid: ({ header }: { header: unknown }) => header,
}))
jest.mock("../../../src/components/ui/FloatingBackButton", () => ({
  FloatingBackButton: () => null,
}))
jest.mock("../../../src/components/ui/Snackbar", () => ({
  Snackbar: () => null,
}))

const DETAILS_ERROR = "Couldn't load full details."
const FAILED: QueryAnswer = {
  data: undefined,
  dataState: "empty",
  loading: false,
  error: new Error("Network request failed"),
}
const TEXT = { videoBySlug: { documentId: "video-the-chosen" } }
const LOADED_TEXT: QueryAnswer = {
  data: TEXT,
  dataState: "complete",
  loading: false,
  error: undefined,
}

/** The loaded series with no text, as the merge leaves it after a failure. */
const THE_CHOSEN: WatchVideoRecord = {
  documentId: "video-the-chosen",
  slug: "the-chosen",
  label: "SERIES",
  title: null,
  description: null,
  snippet: null,
  posterUrl: null,
  streamingUrl: null,
  muxPlaybackId: null,
  duration: null,
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

function seriesLoaded() {
  mockRecordQuery.current = {
    data: { videoBySlug: THE_CHOSEN },
    dataState: "complete",
    loading: false,
    error: undefined,
  }
  mockSeriesSession.current = {
    series: THE_CHOSEN,
    setSeries: () => {},
    languages: [],
    selectedLanguageSlug: null,
  }
}

let mounted: TestInstance | null = null

async function render(): Promise<TestInstance> {
  await act(async () => {
    mounted = TestRenderer.create(<SeriesScreen />)
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

function lastActionRow(): ActionRowProps {
  const last = mockActionRows[mockActionRows.length - 1]
  if (last == null) throw new Error("the page rendered no SeriesActionRow")
  return last
}

afterEach(async () => {
  if (mounted != null) {
    await act(async () => {
      mounted?.unmount()
    })
    mounted = null
  }
  mockRecordQuery.current = { data: undefined, loading: true, error: undefined }
  mockTextQuery.current = { data: undefined, loading: true, error: undefined }
  mockRefetch.mockReset()
  mockRefetchText.mockReset()
  mockSeriesSession.current = {}
  mockCapturedTag.current = "en"
  mockPrefs.subtitleLanguageSlug = null
  mockPrefs.subtitleLanguageName = null
  mockPrefs.subtitleLanguageNameLocale = null
  mockPrefs.subtitlesEnabled = false
  mockActionRows.length = 0
})

describe("a failed text load on a loaded series page", () => {
  beforeEach(seriesLoaded)

  it.each<[string, QueryAnswer]>([
    ["with no data", FAILED],
    [
      "over a partial cached row",
      { ...FAILED, data: TEXT, dataState: "partial" },
    ],
  ])("offers a retry that reloads only the text, %s", async (_, answer) => {
    mockTextQuery.current = answer

    const renderer = await render()

    expect(hasText(renderer, DETAILS_ERROR)).toBe(true)
    const [retry] = retries(renderer, "series-text-retry")
    await press(retry as RenderedNode)
    expect(mockRefetchText).toHaveBeenCalledTimes(1)
    expect(mockRefetch).not.toHaveBeenCalled()
  })

  it.each<[string, QueryAnswer]>([
    ["the text loads", LOADED_TEXT],
    [
      "a refetch fails over complete text",
      { ...LOADED_TEXT, error: FAILED.error },
    ],
  ])("shows no retry when %s", async (_, answer) => {
    mockTextQuery.current = answer

    const renderer = await render()

    expect(retries(renderer, "series-text-retry")).toHaveLength(0)
    expect(hasText(renderer, DETAILS_ERROR)).toBe(false)
  })
})

// KTD16, KD12: after a live Android change the open screen keeps the tag it
// captured, and the pill follows that tag, never the live one.
describe("the cached subtitle name on the series pill", () => {
  function subtitlesOn(name: string, locale: string) {
    mockPrefs.subtitlesEnabled = true
    mockPrefs.subtitleLanguageSlug = "french"
    mockPrefs.subtitleLanguageName = name
    mockPrefs.subtitleLanguageNameLocale = locale
  }

  it("paints a name cached in the screen's captured tag", async () => {
    seriesLoaded()
    mockCapturedTag.current = "es"
    subtitlesOn("Francés", "es")

    await render()

    expect(lastActionRow().subtitleLabel).toBe("Francés")
  })

  // `en` is also the live UI tag, so the old live-tag gate painted this name.
  it("does not paint a name cached in another tag", async () => {
    expect(getCatalogTag()).toBe("en")
    seriesLoaded()
    mockCapturedTag.current = "es"
    subtitlesOn("French", "en")

    await render()

    expect(lastActionRow().subtitleLabel).toBeNull()
  })
})
