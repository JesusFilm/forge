/** The series download sheet, rendered. U7 (R4): a series batch records the
 *  locale its titles were read in, the series screen's captured Admin forms,
 *  on every episode request. */

import { act } from "react"

import SeriesDownloadRoute from "../download"
import { adminFormsFor } from "../../../src/i18n/adminLanguage"
import type { StartDownloadRequest } from "../../../src/lib/downloadRequestBuilders"
import type { SeriesDownloadResolution } from "../../../src/lib/seriesDownloadResolver"
import {
  TestRenderer,
  hasText,
  type TestInstance,
} from "../../../src/test-utils/rnTestRenderer"

// The `mock` prefix is required: babel-plugin-jest-hoist lifts jest.mock above
// these declarations and rejects any other out-of-scope name in a factory.
const mockSeriesSession: { current: Record<string, unknown> } = { current: {} }
const mockQueue = jest.fn(async (_request: StartDownloadRequest) => ({
  ok: true as const,
}))
const mockRecords = jest.fn(async (_requests: StartDownloadRequest[]) => {})
const mockResolution: { current: SeriesDownloadResolution | null } = {
  current: null,
}
const mockFreeBytes = { current: 10 ** 12 }

jest.mock("expo-router", () => ({
  useRouter: () => ({ back: jest.fn() }),
  useLocalSearchParams: () => ({}),
}))
jest.mock("@expo/vector-icons/Ionicons", () => () => null)
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
jest.mock("../../../src/contexts/SeriesSessionProvider", () => ({
  useSeriesSession: () => mockSeriesSession.current,
}))
jest.mock("../../../src/contexts/DownloadsProvider", () => ({
  useDownloads: () => ({
    getRecord: () => null,
    queueBatchDownload: mockQueue,
    supersedeDownload: jest.fn(),
    deleteDownload: jest.fn(),
    queueBatchRecords: mockRecords,
  }),
}))
jest.mock("../../../src/contexts/WatchPreferencesProvider", () => ({
  useWatchPreferences: () => ({ wifiOnly: false }),
}))
jest.mock("../../../src/lib/seriesDownloadResolver", () => ({
  ...jest.requireActual("../../../src/lib/seriesDownloadResolver"),
  resolveSeriesDownload: async () => mockResolution.current,
}))
jest.mock("../../../src/lib/offlineFileSystem", () => ({
  freeDiskBytes: async () => mockFreeBytes.current,
}))
jest.mock("../../../src/lib/apolloClient", () => ({
  getApolloClient: () => ({ query: jest.fn() }),
}))
jest.mock("../../../src/lib/rawExportRuntime", () => ({
  getRawExportAdapter: jest.fn(),
}))
jest.mock("../../../src/components/ExportReportHost", () => ({
  publishExportReport: jest.fn(),
}))
jest.mock("../../../src/lib/datadog", () => ({
  datadogLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))

const EPISODE = {
  slug: "episode-1",
  title: "Эпизод 1",
  posterUrl: null,
  status: "resolved" as const,
  dubDocumentId: "dub-ru-1",
  rendition: {
    documentId: "rend-1",
    quality: "Highest",
    size: "1000",
    url: "https://cdn.example/e1.mp4",
  },
  resolvedTier: "highest" as const,
  subtitleUrl: null,
  sizeBytes: 1000,
  seriesEpisodeIndex: 1,
  durationSeconds: 600,
}

const RESOLUTION: SeriesDownloadResolution = {
  episodes: [EPISODE],
  resolved: [EPISODE],
  resolvedCount: 1,
  skippedLanguageCount: 0,
  skippedNoRenditionCount: 0,
  failedCount: 0,
  totalBytes: 1000,
  totalIsLowerBound: false,
  tierTotals: {
    highest: { bytes: 1000, isLowerBound: false },
    high: { bytes: 0, isLowerBound: false },
    low: { bytes: 0, isLowerBound: false },
  },
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve()
  })
}

let renderer: TestInstance | null = null

afterEach(async () => {
  await act(async () => {
    renderer?.unmount()
  })
  renderer = null
  mockFreeBytes.current = 10 ** 12
})

/** Renders the sheet for a Russian series and presses the confirm button. */
async function renderAndConfirm(): Promise<TestInstance> {
  mockResolution.current = RESOLUTION
  mockSeriesSession.current = {
    series: {
      slug: "storyclubs",
      title: "Клубы историй",
      episodes: [{ slug: "episode-1", title: "Эпизод 1" }],
      adminForms: adminFormsFor("ru"),
    },
    selectedLanguageSlug: "russian",
    languages: [{ slug: "russian", name: "Русский" }],
  }
  await act(async () => {
    renderer = TestRenderer.create(<SeriesDownloadRoute />)
  })
  await settle()

  const confirm = renderer!.root.findAll(
    (node) =>
      node.props["dd-action-name"] === "series-download-confirm" &&
      typeof node.props.onPress === "function",
  )[0]
  if (!confirm) throw new Error("the route rendered no confirm button")
  expect(confirm.props.disabled).toBe(false)
  const press = confirm.props.onPress as () => void
  await act(async () => {
    press()
  })
  await settle()
  return renderer!
}

describe("series download sheet: storage message", () => {
  it("says the check failed when the free space is unreadable", async () => {
    mockFreeBytes.current = 0
    const sheet = await renderAndConfirm()
    expect(hasText(sheet, "Couldn't check storage. Try again.")).toBe(true)
  })
})

describe("series download sheet: title locale (U7)", () => {
  it("records the screen's captured catalog tag on each episode request", async () => {
    await renderAndConfirm()

    expect(mockRecords).toHaveBeenCalledTimes(1)
    expect(mockRecords.mock.calls[0][0]).toEqual([
      expect.objectContaining({ title: "Эпизод 1", titleLocale: "ru" }),
    ])
    expect(mockQueue).toHaveBeenCalledTimes(1)
    expect(mockQueue.mock.calls[0][0]).toMatchObject({
      seriesTitle: "Клубы историй",
      titleLocale: "ru",
    })
  })
})
