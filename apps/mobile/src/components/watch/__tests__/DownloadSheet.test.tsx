/**
 * U4: the download mode control on both sheets (R1, R2, R3, R5, R6, R7, R15,
 * R32, R33, R35, R37). Every raw-mode case carries an offline companion,
 * because R3 keeps the offline path exactly as it is today.
 *
 * The build-time switch is mocked through a GETTER, not a fresh module
 * registry: `jest.isolateModules` would hand the sheet a second React copy and
 * break every hook.
 */

// The composition root binds expo-media-library, the download engine and
// AsyncStorage at module scope. This suite renders the series route while
// mocking DownloadsProvider away, so nothing else keeps those out of its graph.
jest.mock("../../../lib/rawExportRuntime", () => ({
  getRawExportAdapter: () => ({
    // A settled result, not a bare jest.fn(): the run reads `result.kind`, so
    // an undefined return throws inside the confirm handler.
    exportVideo: async () => ({
      kind: "settled",
      outcome: "saved",
      albumIntent: "library",
      reused: false,
    }),
    completeStagedExport: async () => "saved",
    discardStagedExport: async () => "abandoned",
    cancelExport: () => false,
  }),
  attachRawExportRuntime: () => undefined,
}))
jest.mock("../../../lib/rawExportConstants", () => ({
  ...jest.requireActual("../../../lib/rawExportConstants"),
}))

// Ionicons requires native font modules at import time under jest.
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("@expo/vector-icons/MaterialCommunityIcons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))

// ── Series route seams ──────────────────────────────────────────────
const mockBack = jest.fn()
const mockGetRecord = jest.fn()
const mockResolveSeries = jest.fn()

jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack }),
}))
jest.mock("../../../contexts/SeriesSessionProvider", () => ({
  useSeriesSession: () => ({
    series: mockSeries,
    selectedLanguageSlug: "en",
    languages: [{ slug: "en", name: "English" }],
  }),
}))
jest.mock("../../../contexts/DownloadsProvider", () => ({
  useDownloads: () => ({
    getRecord: (slug: string) => mockGetRecord(slug),
    startDownload: jest.fn(),
    swapDownload: jest.fn(),
    queueBatchDownload: jest.fn(),
    supersedeDownload: jest.fn(),
    deleteDownload: jest.fn(),
    queueBatchRecords: jest.fn(),
  }),
}))
jest.mock("../../../contexts/WatchPreferencesProvider", () => ({
  useWatchPreferences: () => ({ wifiOnly: false }),
}))
jest.mock("../../../lib/apolloClient", () => ({
  getApolloClient: () => ({ query: jest.fn() }),
}))
jest.mock("../../../lib/queries", () => ({
  GET_VIDEO_DUB: "GET_VIDEO_DUB",
  GET_VIDEO_DUB_INDEX: "GET_VIDEO_DUB_INDEX",
}))
jest.mock("../../../lib/offlineFileSystem", () => ({
  freeDiskBytes: jest.fn(async () => 50_000_000_000),
}))
jest.mock("../../../lib/seriesDownloadResolver", () => ({
  ...jest.requireActual("../../../lib/seriesDownloadResolver"),
  resolveSeriesDownload: (...args: unknown[]) => mockResolveSeries(...args),
}))

import { act } from "react"
import { Alert } from "react-native"

import SeriesDownloadRoute from "../../../../app/series/download"
import {
  DOWNLOAD_MODE_LABELS,
  DownloadSheetContent,
  PERSONAL_USE_NOTE,
  formatOfflineReuseNote,
  formatSeriesReuseNote,
  resetPersonalUseNoteForTests,
  suspendedInRawMode,
  type DownloadMode,
} from "../DownloadSheet"
import {
  summarizeResolution,
  type SeriesEpisodeResolution,
} from "../../../lib/seriesDownloadResolver"
import type { QualityTier } from "../../../lib/downloadTiers"
import type { OfflineDownloadRecord } from "../../../lib/offlineManifest"
import type { WatchDownload } from "../../../lib/normalizeVideo"
import {
  TestRenderer,
  hasText,
  press,
  pressableByLabel,
  unmount,
  type NodeRequireLike,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

// R33's switch is a module constant, and the sheet reads it through a live
// binding, so a test flips it on the mocked module rather than in a second
// module registry — `jest.isolateModules` would hand the sheet a second React.
const rawExportConstants = jest.requireMock(
  "../../../lib/rawExportConstants",
) as { RAW_EXPORT_ENABLED: boolean }

// ── Fixtures ────────────────────────────────────────────────────────

const DOWNLOADS: WatchDownload[] = [
  {
    documentId: "d-high",
    quality: "1080p",
    size: "300000000",
    url: "https://cdn.example.com/high.mp4",
  },
  {
    documentId: "d-mid",
    quality: "720p",
    size: "150000000",
    url: "https://cdn.example.com/mid.mp4",
  },
  {
    documentId: "d-low",
    quality: "360p",
    size: "50000000",
    url: "https://cdn.example.com/low.mp4",
  },
]

const EPISODE_SLUGS = ["ep-one", "ep-two", "ep-three"] as const
const TIERS: readonly QualityTier[] = ["Highest", "High", "Low"]

// Module scope, and returned by identity: a fresh series object per render
// re-creates the route's resolve callback and spins the mount effect forever.
const mockSeries = {
  slug: "washi-gospel",
  title: "Washi Gospel",
  episodes: EPISODE_SLUGS.map((slug, index) => ({
    documentId: `doc-${slug}`,
    slug,
    label: null,
    title: `Episode ${index + 1}`,
    posterUrl: null,
    seriesEpisodeIndex: index,
  })),
}

function renditionId(slug: string, tier: QualityTier): string {
  return `${slug}-${tier}`
}

function buildResolution(tier: QualityTier) {
  const episodes: SeriesEpisodeResolution[] = EPISODE_SLUGS.map(
    (slug, index) => ({
      slug,
      title: `Episode ${index + 1}`,
      posterUrl: null,
      status: "resolved",
      dubDocumentId: `dub-${slug}`,
      rendition: {
        documentId: renditionId(slug, tier),
        quality: tier,
        size: "1000000",
        url: `https://cdn.example.com/${slug}-${tier}.mp4`,
      },
      tiered: TIERS.map((t) => ({
        documentId: renditionId(slug, t),
        quality: t,
        size: "1000000",
        url: `https://cdn.example.com/${slug}-${t}.mp4`,
        tier: t,
      })),
      resolvedTier: tier,
      subtitleUrl: null,
      sizeBytes: 1000000,
      seriesEpisodeIndex: index,
    }),
  )
  return summarizeResolution(episodes)
}

/** A verified offline copy of every episode at the Highest tier. */
function savedRecord(slug: string): OfflineDownloadRecord {
  return {
    version: 1,
    videoSlug: slug,
    dubDocumentId: `dub-${slug}`,
    renditionDocumentId: renditionId(slug, "Highest"),
    qualityLabel: "Highest",
    title: slug,
    subtitleLanguageSlug: null,
    state: "downloaded",
    committedPath: `file:///offline/${slug}.mp4`,
    pendingPath: null,
    posterPath: null,
    bytesWritten: 1000000,
    totalBytes: 1000000,
  }
}

// ── Render helpers ──────────────────────────────────────────────────

type SheetProps = {
  subtitleLanguageName?: string | null
  offlineCopyQuality?: string | null
  onStartDownload?: (rendition: WatchDownload, mode: DownloadMode) => void
}

function element(props: SheetProps = {}) {
  return (
    <DownloadSheetContent
      videoTitle="The Birth of Jesus"
      duration={1800}
      languageName="English"
      downloads={DOWNLOADS}
      subtitleLanguageName={
        props.subtitleLanguageName === undefined
          ? "Spanish"
          : props.subtitleLanguageName
      }
      offlineCopyQuality={props.offlineCopyQuality ?? null}
      onStartDownload={props.onStartDownload ?? (() => {})}
    />
  )
}

async function renderSheet(props: SheetProps = {}): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(element(props))
  })
  return renderer
}

async function renderSeries(): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<SeriesDownloadRoute />)
  })
  return renderer
}

function radioByLabel(
  renderer: TestInstance,
  label: string,
): RenderedNode | null {
  const matches = renderer.root.findAll(
    (node) =>
      node.props.accessibilityLabel === label &&
      node.props.accessibilityRole === "radio",
  )
  return matches[0] ?? null
}

function checkedState(node: RenderedNode | null): boolean {
  const state = node?.props.accessibilityState as
    | { checked?: boolean }
    | undefined
  return state?.checked === true
}

function nodeByLabel(
  renderer: TestInstance,
  label: string,
): RenderedNode | null {
  return (
    renderer.root.findAll(
      (node) => node.props.accessibilityLabel === label,
    )[0] ?? null
  )
}

/** A dropdown section is present when its collapsed trigger is. */
function hasDropdownSection(renderer: TestInstance, section: string): boolean {
  return (
    renderer.root.findAll((node) => {
      const label = node.props.accessibilityLabel
      return typeof label === "string" && label.startsWith(`${section}, `)
    }).length > 0
  )
}

async function chooseMode(renderer: TestInstance, mode: DownloadMode) {
  await press(pressableByLabel(renderer, DOWNLOAD_MODE_LABELS[mode]))
}

async function acceptTerms(renderer: TestInstance) {
  await press(pressableByLabel(renderer, "I agree to the Terms of Use"))
}

/** Open a quality dropdown by its section label, then take one tier row. */
async function chooseQuality(
  renderer: TestInstance,
  section: string,
  current: string,
  next: QualityTier,
) {
  await press(pressableByLabel(renderer, `${section}, ${current}`))
  await press(pressableByLabel(renderer, next))
}

beforeEach(() => {
  rawExportConstants.RAW_EXPORT_ENABLED = true
  mockBack.mockReset()
  mockGetRecord.mockReset()
  mockGetRecord.mockReturnValue(null)
  mockResolveSeries.mockReset()
  mockResolveSeries.mockImplementation(
    async (_episodes: unknown, choice: { qualityTier: QualityTier }) =>
      buildResolution(choice.qualityTier),
  )
  resetPersonalUseNoteForTests()
  jest.spyOn(Alert, "alert").mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ── Per-video sheet ─────────────────────────────────────────────────

describe("DownloadSheetContent mode control", () => {
  it("opens on the offline mode and exposes radio semantics", async () => {
    const renderer = await renderSheet()

    const offline = radioByLabel(renderer, DOWNLOAD_MODE_LABELS.offline)
    const raw = radioByLabel(renderer, DOWNLOAD_MODE_LABELS.raw)
    expect(offline).not.toBeNull()
    expect(raw).not.toBeNull()
    expect(checkedState(offline)).toBe(true)
    expect(checkedState(raw)).toBe(false)
    expect(
      renderer.root.findAll(
        (node) => node.props.accessibilityRole === "radiogroup",
      ).length,
    ).toBeGreaterThan(0)

    await unmount(renderer)
  })

  it("carries the chosen mode to the start callback", async () => {
    const onStartDownload = jest.fn()
    const renderer = await renderSheet({ onStartDownload })

    await acceptTerms(renderer)
    await press(pressableByLabel(renderer, "Download video"))
    expect(onStartDownload).toHaveBeenLastCalledWith(
      expect.objectContaining({ documentId: "d-high" }),
      "offline",
    )

    await chooseMode(renderer, "raw")
    await press(pressableByLabel(renderer, "Save video to the device"))
    expect(onStartDownload).toHaveBeenLastCalledWith(
      expect.objectContaining({ documentId: "d-high" }),
      "raw",
    )

    await unmount(renderer)
  })

  it("hides the subtitle pill in raw mode and shows it in offline mode", async () => {
    const renderer = await renderSheet({ subtitleLanguageName: "Spanish" })
    expect(hasText(renderer, "Spanish")).toBe(true)

    await chooseMode(renderer, "raw")
    expect(hasText(renderer, "Spanish")).toBe(false)

    await chooseMode(renderer, "offline")
    expect(hasText(renderer, "Spanish")).toBe(true)

    await unmount(renderer)
  })

  it("keeps the Terms of Use gate in raw mode", async () => {
    const onStartDownload = jest.fn()
    const renderer = await renderSheet({ onStartDownload })

    await chooseMode(renderer, "raw")
    const button = nodeByLabel(renderer, "Save video to the device")
    expect(button?.props.disabled).toBe(true)
    await press(pressableByLabel(renderer, "Save video to the device"))
    expect(onStartDownload).not.toHaveBeenCalled()

    await acceptTerms(renderer)
    await press(pressableByLabel(renderer, "Save video to the device"))
    expect(onStartDownload).toHaveBeenCalledTimes(1)

    await unmount(renderer)
  })

  it("opens on the offline mode again after an export, never on the last choice", async () => {
    const onStartDownload = jest.fn()
    const first = await renderSheet({ onStartDownload })
    await chooseMode(first, "raw")
    await acceptTerms(first)
    await press(pressableByLabel(first, "Save video to the device"))
    expect(onStartDownload).toHaveBeenLastCalledWith(expect.anything(), "raw")
    await unmount(first)

    const second = await renderSheet({ onStartDownload })
    expect(
      checkedState(radioByLabel(second, DOWNLOAD_MODE_LABELS.offline)),
    ).toBe(true)
    expect(checkedState(radioByLabel(second, DOWNLOAD_MODE_LABELS.raw))).toBe(
      false,
    )
    // The start callback is the second half of the same claim: a persisted mode
    // would send "raw" from a sheet whose control reads offline.
    await acceptTerms(second)
    await press(pressableByLabel(second, "Download video"))
    expect(onStartDownload).toHaveBeenLastCalledWith(
      expect.anything(),
      "offline",
    )

    await unmount(second)
  })
})

describe("personal-use note", () => {
  it("states the personal-use terms on the first raw selection only", async () => {
    const first = await renderSheet()
    expect(hasText(first, PERSONAL_USE_NOTE)).toBe(false)
    await chooseMode(first, "raw")
    expect(hasText(first, PERSONAL_USE_NOTE)).toBe(true)
    await unmount(first)

    const second = await renderSheet()
    await chooseMode(second, "raw")
    expect(hasText(second, PERSONAL_USE_NOTE)).toBe(false)
    await unmount(second)
  })
})

describe("offline-copy reuse note", () => {
  it("names the quality already held and the cost of another quality", async () => {
    const renderer = await renderSheet({ offlineCopyQuality: "High" })
    await chooseMode(renderer, "raw")

    expect(hasText(renderer, formatOfflineReuseNote("High"))).toBe(true)

    await unmount(renderer)
  })

  it("is absent without an offline copy, and absent in offline mode", async () => {
    const withoutCopy = await renderSheet({ offlineCopyQuality: null })
    await chooseMode(withoutCopy, "raw")
    expect(hasText(withoutCopy, "reuses that file")).toBe(false)
    await unmount(withoutCopy)

    const offlineMode = await renderSheet({ offlineCopyQuality: "High" })
    expect(hasText(offlineMode, "reuses that file")).toBe(false)
    await unmount(offlineMode)
  })

  it("names the offline copy's quality, not the current selection", async () => {
    const renderer = await renderSheet({ offlineCopyQuality: "High" })
    await chooseMode(renderer, "raw")
    await chooseQuality(renderer, "Select a file size", "Highest", "Low")

    expect(hasText(renderer, formatOfflineReuseNote("High"))).toBe(true)
    expect(hasText(renderer, formatOfflineReuseNote("Low"))).toBe(false)

    await unmount(renderer)
  })
})

describe("build-time switch", () => {
  it("removes the mode control from the per-video sheet and starts offline", async () => {
    rawExportConstants.RAW_EXPORT_ENABLED = false
    const onStartDownload = jest.fn()
    const renderer = await renderSheet({ onStartDownload })

    expect(radioByLabel(renderer, DOWNLOAD_MODE_LABELS.raw)).toBeNull()
    expect(nodeByLabel(renderer, "Save video to the device")).toBeNull()
    await acceptTerms(renderer)
    await press(pressableByLabel(renderer, "Download video"))
    expect(onStartDownload).toHaveBeenLastCalledWith(
      expect.anything(),
      "offline",
    )

    await unmount(renderer)
  })

  it("keeps the mode control on the per-video sheet while the switch is on", async () => {
    const renderer = await renderSheet()
    expect(radioByLabel(renderer, DOWNLOAD_MODE_LABELS.raw)).not.toBeNull()
    await unmount(renderer)
  })

  it("removes the mode control from the series sheet", async () => {
    rawExportConstants.RAW_EXPORT_ENABLED = false
    const renderer = await renderSeries()
    expect(radioByLabel(renderer, DOWNLOAD_MODE_LABELS.raw)).toBeNull()
    await unmount(renderer)
  })

  it("guards both start paths on the switch in source", () => {
    const nodeRequire = require as unknown as NodeRequireLike
    const fs = nodeRequire("fs") as {
      readFileSync: (path: string, encoding: string) => string
    }
    for (const route of [
      "../../../../app/watch/download",
      "../../../../app/series/download",
    ]) {
      const source = fs.readFileSync(nodeRequire.resolve(route), "utf8")
      expect(source).toContain("RAW_EXPORT_ENABLED")
    }
  })
})

// ── Series sheet ────────────────────────────────────────────────────

describe("series sheet mode control", () => {
  it("hides the subtitle selector in raw mode and shows it in offline mode", async () => {
    const renderer = await renderSeries()
    expect(hasDropdownSection(renderer, "Subtitles")).toBe(true)

    await chooseMode(renderer, "raw")
    expect(hasDropdownSection(renderer, "Subtitles")).toBe(false)

    await chooseMode(renderer, "offline")
    expect(hasDropdownSection(renderer, "Subtitles")).toBe(true)

    await unmount(renderer)
  })

  it("keeps every already-downloaded gate in offline mode", async () => {
    mockGetRecord.mockImplementation((slug: string) => savedRecord(slug))
    const renderer = await renderSeries()

    // The saved tier stays disabled and carries its note.
    await press(pressableByLabel(renderer, "Quality, High"))
    const savedRow = nodeByLabel(renderer, "Highest, Already downloaded")
    expect(savedRow?.props.disabled).toBe(true)

    // Re-downloading the saved series in a new quality warns before replacing.
    await acceptTerms(renderer)
    await press(pressableByLabel(renderer, "Download all episodes"))
    expect(Alert.alert).toHaveBeenCalledWith(
      "Replace downloads?",
      expect.any(String),
      expect.any(Array),
    )

    await unmount(renderer)
  })

  it("lifts every already-downloaded gate in raw mode", async () => {
    mockGetRecord.mockImplementation((slug: string) => savedRecord(slug))
    const renderer = await renderSeries()

    await chooseMode(renderer, "raw")
    await acceptTerms(renderer)

    // The saved tier is selectable again, and selecting it is what would
    // otherwise trip the nothing-to-do block.
    await press(pressableByLabel(renderer, "Quality, High"))
    expect(nodeByLabel(renderer, "Highest, Already downloaded")).toBeNull()
    await press(pressableByLabel(renderer, "Highest"))

    const confirm = nodeByLabel(renderer, "Save all episodes to the device")
    expect(confirm).not.toBeNull()
    expect(confirm?.props.disabled).toBe(false)

    await press(pressableByLabel(renderer, "Save all episodes to the device"))
    expect(Alert.alert).not.toHaveBeenCalled()
    // R15: starting a raw export dismisses the sheet.
    expect(mockBack).toHaveBeenCalledTimes(1)

    await unmount(renderer)
  })

  it("counts the episodes that reuse an offline copy at the selected quality", async () => {
    mockGetRecord.mockImplementation((slug: string) => savedRecord(slug))
    const renderer = await renderSeries()

    await chooseMode(renderer, "raw")
    // The sheet opened on High, and every saved copy is Highest.
    expect(hasText(renderer, formatSeriesReuseNote(0, 3))).toBe(true)

    await chooseQuality(renderer, "Quality", "High", "Highest")
    expect(hasText(renderer, formatSeriesReuseNote(3, 3))).toBe(true)

    await unmount(renderer)
  })

  it("shows no reuse note without an offline copy", async () => {
    const renderer = await renderSeries()
    await chooseMode(renderer, "raw")
    expect(hasText(renderer, "reuse an offline copy")).toBe(false)
    await unmount(renderer)
  })
})

describe("suspendedInRawMode", () => {
  it("lifts a gate value in raw mode and keeps it in offline mode", () => {
    expect(suspendedInRawMode("raw", "es")).toBeUndefined()
    expect(suspendedInRawMode("offline", "es")).toBe("es")
    expect(suspendedInRawMode("raw", true)).toBeUndefined()
    expect(suspendedInRawMode("offline", true)).toBe(true)
  })
})
