/**
 * U7 (R4): a download from the watch sheet records the locale its title was
 * read in, the screen's captured Admin forms. A title already in the UI
 * language then needs no refresh request.
 */

import { act } from "react"

import DownloadSheetRoute from "../download"
import { adminFormsFor } from "../../../src/i18n/adminLanguage"
import type { StartDownloadRequest } from "../../../src/lib/downloadRequestBuilders"
import type { WatchDownload } from "../../../src/lib/normalizeVideo"
import {
  TestRenderer,
  type TestInstance,
} from "../../../src/test-utils/rnTestRenderer"

type SheetProps = {
  onStartDownload: (
    rendition: WatchDownload,
    mode: "offline" | "raw",
    subtitleSlug: string | null,
  ) => Promise<void>
}

// The `mock` prefix is required: babel-plugin-jest-hoist lifts jest.mock above
// these declarations and rejects any other out-of-scope name in a factory.
const mockParams: { current: { swap?: string } } = { current: {} }
const mockSession: { current: Record<string, unknown> } = { current: {} }
const mockSheet: { current: SheetProps | null } = { current: null }
const mockStart = jest.fn(async (_request: StartDownloadRequest) => ({
  ok: true as const,
}))
const mockSwap = jest.fn(async (_request: StartDownloadRequest) => ({
  ok: true as const,
}))

jest.mock("expo-router", () => ({
  useRouter: () => ({ back: jest.fn() }),
  useLocalSearchParams: () => mockParams.current,
}))
jest.mock("../../../src/contexts/WatchSessionProvider", () => ({
  useWatchSession: () => mockSession.current,
}))
jest.mock("../../../src/contexts/DownloadsProvider", () => ({
  useDownloads: () => ({
    startDownload: mockStart,
    swapDownload: mockSwap,
    getRecord: () => null,
  }),
}))
jest.mock("../../../src/contexts/WatchPreferencesProvider", () => ({
  useWatchPreferences: () => ({ wifiOnly: false }),
}))
jest.mock("../../../src/components/watch/DownloadSheet", () => ({
  DownloadSheetContent: (props: SheetProps) => {
    mockSheet.current = props
    return null
  },
}))
jest.mock("../../../src/components/watch/SheetLoading", () => ({
  SheetLoading: () => null,
}))
jest.mock("../../../src/components/watch/SheetError", () => ({
  SheetError: () => null,
}))
jest.mock("../../../src/lib/rawExportRuntime", () => ({
  getRawExportAdapter: jest.fn(),
}))

const RENDITION: WatchDownload = {
  documentId: "rendition-720",
  quality: "720p",
  size: "5242880",
  url: "https://cdn.example/the-birth-of-jesus-720.mp4",
}

function session(video: { title: string | null; catalogTag: string }) {
  return {
    video: {
      slug: "the-birth-of-jesus",
      title: video.title,
      posterUrl: null,
      duration: 3600,
      parentSeries: null,
      variants: [{ documentId: "dub-ru", languageSlug: "russian" }],
      adminForms: adminFormsFor(video.catalogTag),
    },
    activeVariant: { documentId: "dub-ru", languageName: "Russian" },
    activeVariantMedia: { downloads: [RENDITION], subtitles: [] },
    activeVariantMediaLoading: false,
    activeVariantMediaError: false,
    ensureActiveVariantMedia: jest.fn(),
    activeSubtitleSlug: null,
    setSnackbarMessage: jest.fn(),
  }
}

let renderer: TestInstance | null = null

async function download(video: { title: string | null; catalogTag: string }) {
  mockSession.current = session(video)
  await act(async () => {
    renderer = TestRenderer.create(<DownloadSheetRoute />)
  })
  const sheet = mockSheet.current
  if (!sheet) throw new Error("the route rendered no sheet")
  await act(async () => {
    await sheet.onStartDownload(RENDITION, "offline", null)
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockParams.current = {}
  mockSheet.current = null
})

afterEach(async () => {
  await act(async () => {
    renderer?.unmount()
  })
  renderer = null
})

describe("watch download sheet: title locale (U7)", () => {
  it("records the screen's captured catalog tag with the title", async () => {
    await download({ title: "Рождение Иисуса", catalogTag: "ru" })
    expect(mockStart).toHaveBeenCalledTimes(1)
    expect(mockStart.mock.calls[0][0]).toMatchObject({
      title: "Рождение Иисуса",
      titleLocale: "ru",
    })
  })

  it("sends the same locale on a swap", async () => {
    mockParams.current = { swap: "1" }
    await download({ title: "Рождение Иисуса", catalogTag: "ru" })
    expect(mockSwap).toHaveBeenCalledTimes(1)
    expect(mockSwap.mock.calls[0][0]).toMatchObject({ titleLocale: "ru" })
  })

  it("records no locale while the text has not given a title", async () => {
    await download({ title: null, catalogTag: "ru" })
    expect(mockStart).toHaveBeenCalledTimes(1)
    expect(mockStart.mock.calls[0][0].titleLocale).toBeUndefined()
  })
})
