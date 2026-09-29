/**
 * The watch route's "Keep watching" wiring (KTD11, KTD12, R43), rendered with
 * the REAL session provider. `PlayerSlot` records its props (its own suite pins
 * the publish). The no-intent cases pin that other entries behave as before.
 */

import { StrictMode, act, type ReactElement } from "react"
import { AccessibilityInfo } from "react-native"

import WatchVideoPage from "../[slug]"
import {
  WatchSessionProvider,
  useWatchSession,
} from "../../../src/contexts/WatchSessionProvider"
import {
  KEEP_WATCHING_OFFER_DURATION_MS,
  WATCH_INTENT_TTL_MS,
  getWatchIntentStore,
  type WatchIntent,
} from "../../../src/lib/explore/watchIntent"
import type {
  VariantMedia,
  WatchVariant,
  WatchVideoRecord,
} from "../../../src/lib/normalizeVideo"
import { encodeWatchSeed } from "../../../src/lib/watchSeed"
import { getPlaybackRequestStore } from "../../../src/lib/miniPlayer/playbackRequest"
import {
  resetPlaybackTransportForTests,
  setPlaybackTransport,
} from "../../../src/lib/playbackInterruption"
import {
  TestRenderer,
  press,
  type TestInstance,
} from "../../../src/test-utils/rnTestRenderer"

// The page reads Node's fs only in the premise check at the bottom.
declare const __dirname: string
declare const require: (moduleName: string) => {
  readFileSync: (path: string, encoding: string) => string
  join: (...parts: string[]) => string
}

type SlotProps = {
  streamingUrl: string | null
  subtitleVttSrc: string | null
  resumeAtSeconds: number | null
  progressHold?: { id: string; durationMs: number } | null
  session: { videoId: string | null; videoSlug: string } | null
}

// The `mock` prefix is required: babel-plugin-jest-hoist lifts jest.mock above
// these declarations and rejects any other out-of-scope name in a factory.
const mockSlotRenders: SlotProps[] = []
const mockParams: { current: { slug: string; seed?: string } } = {
  current: { slug: "jesus" },
}
const mockQuery: {
  current: { data: unknown; loading: boolean; error: unknown }
} = { current: { data: undefined, loading: true, error: undefined } }
const mockProgress: {
  current: { positionSeconds: number; durationSeconds: number } | undefined
} = { current: undefined }
const mockDownloads: {
  copy: { path: string; dubDocumentId: string | null } | null
} = { copy: null }
const mockPrefs = {
  audio: "english" as string | null,
  subtitle: null as string | null,
  subtitlesEnabled: false,
  setPreferredAudioLanguage: jest.fn(),
  setPreferredSubtitleLanguage: jest.fn(),
  setSubtitlesEnabled: jest.fn(),
}
const mockClient = { query: jest.fn() }

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams.current,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}))
jest.mock("expo-status-bar", () => ({ StatusBar: () => null }))
jest.mock("@expo/vector-icons/Ionicons", () => () => null)
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
jest.mock("@apollo/client/react", () => ({
  useApolloClient: () => mockClient,
  useQuery: () => ({ ...mockQuery.current, refetch: jest.fn() }),
}))
jest.mock("../../../src/lib/queries", () => ({
  GET_VIDEO_BY_SLUG: {},
  GET_VIDEO_DUB: {},
}))
// The fixtures below are already in the normalized shape.
jest.mock("../../../src/lib/normalizeVideo", () => ({
  normalizeVideo: (raw: unknown) => raw ?? null,
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
// One object, so the page sees a new cast state only when a case sets one.
const mockCast = {
  state: { phase: "idle" },
  position: null,
  duration: null,
  remotePlayerState: null,
  reset: () => {},
}
jest.mock("../../../src/hooks/useCastPlayback", () => ({
  useCastPlayback: () => mockCast,
}))
jest.mock("../../../src/hooks/useCastProgressRecording", () => ({
  useCastProgressRecording: () => {},
}))
const mockFullscreen = { current: false }
jest.mock("../../../src/hooks/useFullscreenPresentation", () => ({
  useFullscreenPresentation: () => ({
    isFullscreen: mockFullscreen.current,
    toggleFullscreen: () => {},
  }),
}))
// The real play flag, driven through the request store: it is the offer's
// first-frame signal.
jest.mock("../../../src/hooks/usePlaybackFrame", () => ({
  usePlaybackFrameVisible: () => false,
  usePlaybackPlaying: jest.requireActual("../../../src/hooks/usePlaybackFrame")
    .usePlaybackPlaying,
}))
jest.mock("../../../src/hooks/useWatchProgressEntry", () => ({
  useWatchProgressEntry: (videoId: string | null | undefined) =>
    videoId ? mockProgress.current : undefined,
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
    audioLanguageSlug: mockPrefs.audio,
    subtitleLanguageSlug: mockPrefs.subtitle,
    subtitleLanguageName: null,
    subtitlesEnabled: mockPrefs.subtitlesEnabled,
    isReady: true,
    setPreferredAudioLanguage: mockPrefs.setPreferredAudioLanguage,
    setPreferredSubtitleLanguage: mockPrefs.setPreferredSubtitleLanguage,
    setPreferredSubtitleName: () => {},
    setSubtitlesEnabled: mockPrefs.setSubtitlesEnabled,
  }),
}))
jest.mock("../../../src/contexts/DownloadsProvider", () => ({
  useDownloads: () => ({
    getRecord: () => undefined,
    deleteDownload: () => {},
    pauseDownload: () => {},
    resumeDownload: () => {},
    committedCopyFor: () =>
      mockDownloads.copy == null
        ? null
        : { ...mockDownloads.copy, subtitleLanguageSlug: null },
    isReady: true,
  }),
}))
jest.mock("../../../src/components/watch/PlayerSlot", () => ({
  PlayerSlot: (props: SlotProps) => {
    mockSlotRenders.push(props)
    return null
  },
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

const SLUG = "jesus"
const SEED_URL = "https://stream.mux.com/seedEnglish.m3u8"

function variant(languageSlug: string, id: string): WatchVariant {
  return {
    documentId: id,
    slug: `${SLUG}/${languageSlug}`,
    published: true,
    hls: `https://stream.mux.com/${id}.m3u8`,
    duration: 7200,
    languageCoreId: null,
    languageBcp47: null,
    languageSlug,
    languageName: languageSlug,
    languageNameNative: null,
    languageIso3: null,
    muxPlaybackId: id,
  }
}

const ENGLISH_URL = "https://stream.mux.com/dubEnglish.m3u8"
const SPANISH_URL = "https://stream.mux.com/dubSpanish.m3u8"
const OFFLINE_PATH = `file:///docs/offline-downloads/${SLUG}/a.mp4`

/** Spanish first, so a default that fell to `dubs[0]` would show. */
const JESUS: WatchVideoRecord = {
  documentId: "video-jesus",
  slug: SLUG,
  label: "FEATURE_FILM",
  title: "JESUS",
  description: null,
  snippet: null,
  posterUrl: null,
  streamingUrl: SPANISH_URL,
  muxPlaybackId: null,
  duration: 7200,
  primaryLanguageBcp47: null,
  primaryLanguageCoreId: null,
  parentSeries: null,
  siblings: [],
  variants: [
    variant("spanish", "dubSpanish"),
    variant("english", "dubEnglish"),
  ],
  studyQuestions: [],
  bibleCitations: [],
  episodes: [],
  languages: [],
}

const MEDIA: VariantMedia = {
  downloads: [],
  subtitles: ["english", "thai"].map((slug) => ({
    documentId: `sub-${slug}`,
    languageSlug: slug,
    languageName: slug,
    languageBcp47: "",
    vttSrc: `https://cdn.example/${slug}.vtt`,
    primary: false,
    aiGenerated: false,
  })),
}

/** AE6: saved progress at 1:10:00 of a two-hour film. */
const SAVED_AT_1_10_00 = { positionSeconds: 4200, durationSeconds: 7200 }

function putIntent(over: Partial<WatchIntent> = {}): WatchIntent {
  return getWatchIntentStore().put({
    videoSlug: SLUG,
    startSeconds: 740,
    audioLanguageSlug: "english",
    subtitleLanguageSlug: null,
    subtitleOnly: false,
    origin: "explore",
    ...over,
  })
}

function seeded() {
  mockParams.current = {
    slug: SLUG,
    seed: encodeWatchSeed({
      slug: SLUG,
      title: "JESUS",
      imageUrl: null,
      playbackId: "seedEnglish",
    }),
  }
}

function recordLoading() {
  mockQuery.current = { data: undefined, loading: true, error: undefined }
}

function recordLanded() {
  mockQuery.current = {
    data: { videoBySlug: JESUS },
    loading: false,
    error: undefined,
  }
}

let session!: ReturnType<typeof useWatchSession>
function SessionProbe() {
  session = useWatchSession()
  return null
}

function tree(strict = false): ReactElement {
  const page = (
    <WatchSessionProvider>
      <WatchVideoPage />
      <SessionProbe />
    </WatchSessionProvider>
  )
  return strict ? <StrictMode>{page}</StrictMode> : page
}

let mounted: TestInstance | null = null

async function render(element: ReactElement): Promise<TestInstance> {
  await act(async () => {
    mounted = TestRenderer.create(element)
  })
  return mounted as TestInstance
}

/** Re-render with whatever the mocks now answer (a query that settled). */
async function rerender(strict = false): Promise<void> {
  await act(async () => {
    mounted?.update(tree(strict))
  })
}

function lastSlot(): SlotProps {
  const last = mockSlotRenders[mockSlotRenders.length - 1]
  if (last == null) throw new Error("the page rendered no PlayerSlot")
  return last
}

// The dropped choice (owner, 2026-09-28). The finder below still looks for
// it, so a regression that brings it back turns these tests red.
const START = "Start from the beginning"
const RESUME_AT_1_10_00 = "Resume at 1:10:00"

/** The R17 offer's choices on screen, by label. */
function offerChoices(renderer: TestInstance): string[] {
  return renderer.root
    .findAll(
      (node) =>
        typeof node.props.onPress === "function" &&
        (node.props.accessibilityLabel === START ||
          (node.props.accessibilityLabel?.startsWith("Resume at") ?? false)),
    )
    .map((node) => node.props.accessibilityLabel as string)
}

async function choose(renderer: TestInstance, label: string) {
  const [node] = renderer.root.findAll(
    (n) =>
      typeof n.props.onPress === "function" &&
      n.props.accessibilityLabel === label,
  )
  if (node == null) throw new Error(`no offer choice "${label}"`)
  await press(node)
}

/** The host's play flag: the first frame, as far as the page can tell. */
async function firstFrame() {
  await act(async () => {
    getPlaybackRequestStore().setPlaying(true)
  })
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms)
  })
}

const mockSeek = jest.fn()
let screenReaderOn = false

beforeEach(() => {
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockResolvedValue(false)
  jest
    .spyOn(AccessibilityInfo, "isScreenReaderEnabled")
    .mockImplementation(() => Promise.resolve(screenReaderOn))
  jest.spyOn(AccessibilityInfo, "addEventListener").mockImplementation((() => ({
    remove: () => {},
  })) as unknown as typeof AccessibilityInfo.addEventListener)
  setPlaybackTransport({
    isPlaying: () => false,
    pause: () => {},
    play: () => {},
    seek: mockSeek,
  })
})

afterEach(async () => {
  if (mounted != null) {
    await act(async () => {
      mounted?.unmount()
    })
    mounted = null
  }
  jest.useRealTimers()
  jest.restoreAllMocks()
  resetPlaybackTransportForTests()
  getPlaybackRequestStore().reset()
  mockSeek.mockReset()
  screenReaderOn = false
  mockFullscreen.current = false
  mockCast.state = { phase: "idle" }
  getWatchIntentStore().clear()
  mockSlotRenders.length = 0
  mockParams.current = { slug: SLUG }
  recordLoading()
  mockProgress.current = undefined
  mockDownloads.copy = null
  mockPrefs.audio = "english"
  mockPrefs.subtitle = null
  mockPrefs.subtitlesEnabled = false
  mockPrefs.setPreferredAudioLanguage.mockClear()
  mockPrefs.setPreferredSubtitleLanguage.mockClear()
  mockPrefs.setSubtitlesEnabled.mockClear()
  mockClient.query.mockReset()
})

describe("a page opened by Keep watching", () => {
  it("starts at the tap point over saved progress that loaded first (AE6)", async () => {
    mockProgress.current = SAVED_AT_1_10_00
    recordLanded()
    const intent = putIntent()

    await render(tree())

    expect(lastSlot().resumeAtSeconds).toBe(740)
    expect(lastSlot().streamingUrl).toBe(ENGLISH_URL)
    // KTD12: the hold that keeps 1:10:00 while the offer shows.
    expect(lastSlot().progressHold).toEqual({
      id: `keep-watching:${SLUG}:${intent.createdAt}`,
      durationMs: KEEP_WATCHING_OFFER_DURATION_MS,
    })
    // One-shot: consumed once the page committed it.
    expect(getWatchIntentStore().peek(SLUG)).toBeNull()
  })

  it("takes the intent on a slug-only first render, under StrictMode", async () => {
    // The production first render: no record yet, so no video id.
    seeded()
    recordLoading()
    putIntent()

    await render(tree(true))

    const first = mockSlotRenders[0]
    expect(first.session?.videoId).toBeNull()
    expect(first.streamingUrl).toBe(SEED_URL)
    // Every render, the discarded StrictMode ones included.
    expect(mockSlotRenders.map((props) => props.resumeAtSeconds)).toEqual(
      mockSlotRenders.map(() => 740),
    )
    expect(lastSlot().progressHold).not.toBeNull()
    expect(getWatchIntentStore().peek(SLUG)).toBeNull()
  })

  it("applies the start again after the seed swap, and not after a later dub change", async () => {
    seeded()
    recordLoading()
    putIntent()
    await render(tree())
    expect(lastSlot()).toMatchObject({
      streamingUrl: SEED_URL,
      resumeAtSeconds: 740,
    })

    recordLanded()
    await rerender()
    expect(lastSlot()).toMatchObject({
      streamingUrl: ENGLISH_URL,
      resumeAtSeconds: 740,
    })

    const renders = mockSlotRenders.length
    await act(async () => {
      session.setActiveVariantIndex(0)
    })

    // No render ever pairs the new dub's URL with the tap point.
    const dubRenders = mockSlotRenders
      .slice(renders)
      .filter((props) => props.streamingUrl === SPANISH_URL)
    expect(dubRenders.length).toBeGreaterThan(0)
    expect(dubRenders.map((props) => props.resumeAtSeconds)).toEqual(
      dubRenders.map(() => null),
    )
  })

  it("plays the clip's dub over a download in another language", async () => {
    mockDownloads.copy = {
      path: `file:///docs/offline-downloads/${SLUG}/a.mp4`,
      dubDocumentId: "dubSpanish",
    }
    recordLanded()
    putIntent({ audioLanguageSlug: "english" })

    await render(tree())

    expect(session.activeVariant?.languageSlug).toBe("english")
    expect(lastSlot().streamingUrl).toBe(ENGLISH_URL)
    expect(mockPrefs.setPreferredAudioLanguage).not.toHaveBeenCalled()
  })

  it("never plays a download in another language while the clip's dub settles", async () => {
    // Before the record lands the dub is unsettled, and a download used to
    // win then in any language, before the clip's dub took over (R16).
    mockDownloads.copy = { path: OFFLINE_PATH, dubDocumentId: "dubSpanish" }
    seeded()
    recordLoading()
    putIntent({ audioLanguageSlug: "english" })

    await render(tree())
    expect(lastSlot().streamingUrl).toBe(SEED_URL)

    recordLanded()
    await rerender()
    expect(lastSlot().streamingUrl).toBe(ENGLISH_URL)
    expect(mockSlotRenders.map((props) => props.streamingUrl)).not.toContain(
      OFFLINE_PATH,
    )
  })

  it("shows the clip's subtitles after a subtitle-only clip, and saves nothing (R43)", async () => {
    mockPrefs.subtitle = "english"
    mockClient.query.mockResolvedValue({ data: { videoDub: MEDIA } })
    recordLanded()
    putIntent({ subtitleOnly: true, subtitleLanguageSlug: "thai" })

    await render(tree())
    await act(async () => {})

    expect(session.subtitleEnabled).toBe(true)
    expect(lastSlot().subtitleVttSrc).toBe("https://cdn.example/thai.vtt")

    await act(async () => {
      mounted?.unmount()
    })
    mounted = null
    expect(mockPrefs.setSubtitlesEnabled).not.toHaveBeenCalled()
    expect(mockPrefs.setPreferredSubtitleLanguage).not.toHaveBeenCalled()
  })

  it("keeps the saved subtitle setting after a muted dubbed clip (R43)", async () => {
    recordLanded()
    // The clip showed captions only because it was muted.
    putIntent({ subtitleOnly: false, subtitleLanguageSlug: "english" })

    await render(tree())

    expect(session.subtitleEnabled).toBe(false)
    expect(lastSlot().subtitleVttSrc).toBeNull()
    expect(mockClient.query).not.toHaveBeenCalled()
  })

  it("ignores an intent older than its time-to-live", async () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(1_000)
    putIntent()
    now.mockReturnValue(1_000 + WATCH_INTENT_TTL_MS)
    mockProgress.current = SAVED_AT_1_10_00
    recordLanded()

    await render(tree())

    expect(lastSlot().resumeAtSeconds).toBe(4200)
    expect(lastSlot().progressHold ?? null).toBeNull()
  })
})

describe("the R17 offer (KTD12)", () => {
  it("covers AE6: saved 1:10:00 and a tap at 0:12:20 offer Resume at, and no start from the beginning", async () => {
    mockProgress.current = SAVED_AT_1_10_00
    recordLanded()
    putIntent({ startSeconds: 740 })

    const renderer = await render(tree())

    expect(offerChoices(renderer)).toEqual([RESUME_AT_1_10_00])
  })

  it("Resume at seeks to 1:10:00, hides the offer, and ends the hold", async () => {
    mockProgress.current = SAVED_AT_1_10_00
    recordLanded()
    putIntent()
    const renderer = await render(tree())
    expect(lastSlot().progressHold).not.toBeNull()

    await choose(renderer, RESUME_AT_1_10_00)

    expect(mockSeek).toHaveBeenCalledTimes(1)
    expect(mockSeek).toHaveBeenCalledWith(4200)
    expect(offerChoices(renderer)).toEqual([])
    expect(lastSlot().progressHold ?? null).toBeNull()
    // KTD11: a later canonical load lands on the choice, not the tap point.
    expect(lastSlot().resumeAtSeconds).toBe(4200)
  })

  it("starts its clock at the first frame: a 4 s load keeps the full time", async () => {
    jest.useFakeTimers()
    mockProgress.current = SAVED_AT_1_10_00
    recordLanded()
    const intent = putIntent()
    const renderer = await render(tree())

    await advance(4_000)
    expect(offerChoices(renderer)).toHaveLength(1)

    await firstFrame()
    await advance(KEEP_WATCHING_OFFER_DURATION_MS - 1)
    expect(offerChoices(renderer)).toHaveLength(1)

    await advance(1)
    expect(offerChoices(renderer)).toEqual([])
    expect(mockSeek).not.toHaveBeenCalled()
    // The hold is the adapter's: it ends at its own deadline, not here.
    expect(lastSlot().progressHold?.id).toBe(
      `keep-watching:${SLUG}:${intent.createdAt}`,
    )
  })

  it("keeps one clock through fullscreen: back inside its time, never after it", async () => {
    jest.useFakeTimers()
    mockProgress.current = SAVED_AT_1_10_00
    recordLanded()
    putIntent()
    const renderer = await render(tree())
    await firstFrame()

    const setFullscreen = async (on: boolean) => {
      mockFullscreen.current = on
      await rerender()
    }
    await advance(1_000)
    await setFullscreen(true)
    expect(offerChoices(renderer)).toEqual([])
    await advance(1_000)
    await setFullscreen(false)
    expect(offerChoices(renderer)).toEqual([RESUME_AT_1_10_00])

    // The time left runs from the first frame, not from the return.
    await advance(KEEP_WATCHING_OFFER_DURATION_MS - 2_001)
    expect(offerChoices(renderer)).toHaveLength(1)
    await setFullscreen(true)
    await advance(1)
    await setFullscreen(false)
    expect(offerChoices(renderer)).toEqual([])
    expect(mockSeek).not.toHaveBeenCalled()
  })

  it("keeps one clock through casting: hidden while the receiver plays", async () => {
    jest.useFakeTimers()
    mockProgress.current = SAVED_AT_1_10_00
    recordLanded()
    putIntent()
    const renderer = await render(tree())
    await firstFrame()

    const setCastPhase = async (phase: string) => {
      mockCast.state = { phase }
      await rerender()
    }
    await advance(1_000)
    await setCastPhase("active")
    expect(offerChoices(renderer)).toEqual([])
    await advance(1_000)
    await setCastPhase("idle")
    expect(offerChoices(renderer)).toEqual([RESUME_AT_1_10_00])

    // The time left runs from the first frame, not from the cast's end.
    await advance(KEEP_WATCHING_OFFER_DURATION_MS - 2_001)
    expect(offerChoices(renderer)).toHaveLength(1)
    await advance(1)
    expect(offerChoices(renderer)).toEqual([])
  })

  it("shows no offer for a saved place before the tap point", async () => {
    mockProgress.current = { positionSeconds: 600, durationSeconds: 7200 }
    recordLanded()
    putIntent({ startSeconds: 740 })

    const renderer = await render(tree())

    expect(offerChoices(renderer)).toEqual([])
  })

  it("shows no offer for a complete video", async () => {
    // 97%: past the 90% rule, so the video counts as complete.
    mockProgress.current = { positionSeconds: 7000, durationSeconds: 7200 }
    recordLanded()
    putIntent({ startSeconds: 740 })

    const renderer = await render(tree())

    expect(offerChoices(renderer)).toEqual([])
  })

  it("names the saved place once the record lands, and keeps it past later writes", async () => {
    seeded()
    recordLoading()
    mockProgress.current = SAVED_AT_1_10_00
    putIntent({ startSeconds: 740 })
    const renderer = await render(tree())
    // No record, so no saved progress is known yet: no offer.
    expect(offerChoices(renderer)).toEqual([])

    recordLanded()
    await rerender()
    expect(offerChoices(renderer)).toEqual([RESUME_AT_1_10_00])

    // After the hold, this page's own writes move the entry past the tap
    // point: that is not a place to resume.
    mockProgress.current = { positionSeconds: 750, durationSeconds: 7200 }
    await rerender()
    expect(offerChoices(renderer)).toEqual([RESUME_AT_1_10_00])
  })

  it("stays up for a screen reader, while the hold keeps its own deadline", async () => {
    jest.useFakeTimers()
    screenReaderOn = true
    mockProgress.current = SAVED_AT_1_10_00
    recordLanded()
    putIntent()
    const renderer = await render(tree())
    const hold = lastSlot().progressHold

    await firstFrame()
    await advance(KEEP_WATCHING_OFFER_DURATION_MS * 50)

    expect(offerChoices(renderer)).toEqual([RESUME_AT_1_10_00])
    // Same id and duration: the page never extends or restarts the hold.
    expect(lastSlot().progressHold).toEqual(hold)
    expect(hold?.durationMs).toBe(KEEP_WATCHING_OFFER_DURATION_MS)
  })
})

describe("a page opened with no intent (Home, Search, deep link, expand)", () => {
  it("resumes saved progress and publishes no hold, as before", async () => {
    mockProgress.current = SAVED_AT_1_10_00
    recordLanded()

    await render(tree())

    expect(lastSlot().resumeAtSeconds).toBe(4200)
    expect(lastSlot().progressHold ?? null).toBeNull()
    expect(session.activeVariant?.languageSlug).toBe("english")
    expect(session.subtitleEnabled).toBe(false)
  })

  it("shows no offer, before or after the first frame", async () => {
    mockProgress.current = SAVED_AT_1_10_00
    recordLanded()

    const renderer = await render(tree())
    expect(offerChoices(renderer)).toEqual([])

    await firstFrame()
    expect(offerChoices(renderer)).toEqual([])
    expect(mockSeek).not.toHaveBeenCalled()
  })

  it("plays a completed download before the dub settles, as before", async () => {
    mockDownloads.copy = { path: OFFLINE_PATH, dubDocumentId: "dubSpanish" }
    seeded()
    recordLoading()

    await render(tree())

    expect(lastSlot().streamingUrl).toBe(OFFLINE_PATH)
  })

  it("drops the intent when a warm deep link reuses the page for another video", async () => {
    // expo-router reuses the route object for a same-name navigate, so the
    // page instance keeps its state while the slug changes under it.
    recordLanded()
    putIntent()
    await render(tree())
    expect(lastSlot().resumeAtSeconds).toBe(740)
    expect(session.subtitleEnabled).toBe(false)

    mockParams.current = { slug: "magdalena" }
    recordLoading()
    await rerender()

    expect(lastSlot().session?.videoSlug).toBe("magdalena")
    expect(lastSlot().resumeAtSeconds).toBeNull()
    expect(lastSlot().progressHold ?? null).toBeNull()
  })

  it("ignores, and leaves, an intent for another video", async () => {
    const other = putIntent({ videoSlug: "magdalena" })
    recordLanded()

    await render(tree())

    expect(lastSlot().resumeAtSeconds).toBeNull()
    expect(lastSlot().progressHold ?? null).toBeNull()
    expect(getWatchIntentStore().peek("magdalena")).toBe(other)
  })
})

describe("the premise the spent rule stands on", () => {
  it("VideoPlayer re-arms its resume seek only when the published URL changes", () => {
    // `advanceKeepWatching` keeps the start live over the canonical URL
    // because the player seeks once per URL. A re-arm on anything else (a
    // quality swap, a re-render) would jump back to the tap point.
    const fs = require("node:fs")
    const path = require("node:path")
    const source = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "src",
        "components",
        "watch",
        "VideoPlayer.tsx",
      ),
      "utf8",
    )
    const resets = source.split("resumeSeekedRef.current = false")
    expect(resets).toHaveLength(2)
    const effectTail = resets[1].slice(0, resets[1].indexOf("})") + 20)
    expect(effectTail).toContain("}, [streamingUrl])")
  })
})
