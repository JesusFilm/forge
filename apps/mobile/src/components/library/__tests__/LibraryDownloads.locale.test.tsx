// The downloads list after a UI language change. Its rows and series
// cards are memoized, and a change keeps their props, so each must follow the
// language through its own subscription (KTD2) rather than a parent re-render.
import { act } from "react"

jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("expo-image", () => ({ Image: () => null }))
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}))
// Stable identities, as in the app: a new callback each render would defeat
// the rows' memo and hide a row that misses the language change.
const mockNavigation = { setOptions: () => {}, addListener: () => () => {} }
const mockRouter = { push: () => {}, navigate: () => {} }
jest.mock("expo-router", () => ({
  useNavigation: () => mockNavigation,
  useIsFocused: () => true,
  useRouter: () => mockRouter,
}))
jest.mock("../../../lib/tabBarVisibility", () => ({
  setTabBarHidden: () => {},
  resetTabBarHidden: () => {},
}))
jest.mock("../../../lib/datadog", () => ({
  datadogLog: { info: () => {}, warn: () => {}, error: () => {} },
}))
jest.mock("../../ui/Snackbar", () => ({ Snackbar: () => null }))

const MB = 1024 * 1024
const mockRecords = [
  {
    version: 1,
    videoSlug: "the-birth-of-jesus",
    dubDocumentId: "dub-1",
    renditionDocumentId: "rendition-1",
    qualityLabel: "High",
    title: "The Birth of Jesus",
    subtitleLanguageSlug: null,
    state: "downloaded",
    committedPath: "/downloads/the-birth-of-jesus.mp4",
    pendingPath: null,
    posterPath: null,
    bytesWritten: 74 * MB,
    totalBytes: 74 * MB,
    enqueuedAt: 2,
  },
  {
    version: 1,
    videoSlug: "lumo-episode-1",
    dubDocumentId: "dub-2",
    renditionDocumentId: "rendition-2",
    qualityLabel: "High",
    title: "Episode 1",
    seriesSlug: "lumo",
    seriesTitle: "Lumo",
    seriesEpisodeIndex: 0,
    subtitleLanguageSlug: null,
    state: "failed",
    committedPath: null,
    pendingPath: null,
    posterPath: null,
    bytesWritten: 0,
    totalBytes: 10 * MB,
    enqueuedAt: 1,
  },
]
const mockDownloads = {
  offlineRecords: mockRecords,
  isReady: true,
  deleteDownload: () => Promise.resolve(),
  retryDownload: () => Promise.resolve(),
  resumeDownload: () => Promise.resolve(),
}
jest.mock("../../../contexts/DownloadsProvider", () => ({
  useDownloads: () => mockDownloads,
}))
const mockPreferences = {
  longPressHintSeen: true,
  setLongPressHintSeen: () => {},
  isReady: true,
}
jest.mock("../../../contexts/WatchPreferencesProvider", () => ({
  useWatchPreferences: () => mockPreferences,
}))

const mockGetLocales = jest.fn()
jest.mock("expo-localization", () => ({
  getLocales: () => mockGetLocales(),
}))
jest.mock("expo-localization/build/ExpoLocalization", () => ({
  addLocaleListener: () => ({ remove: () => undefined }),
}))
jest.mock("../../../i18n/catalogs.generated", () =>
  jest
    .requireActual("../../../test-utils/uiLocaleFixture")
    .withFixtureCatalogs(
      jest.requireActual("../../../i18n/catalogs.generated"),
      {
        es: {
          Library: {
            downloadedStatus: "{size} · Descargado",
            seriesMeta:
              "{count, plural, one {# vídeo · {size}} other {# vídeos · {size}}}",
            failedCount: "· {count} con error",
            seriesAriaLabel:
              "{title}, {count, plural, one {# vídeo} other {# vídeos}}",
            select: "Seleccionar",
            selectDownloadsAriaLabel: "Seleccionar descargas",
          },
        },
      },
    ),
)
jest.mock("../../../i18n/pluralData.generated", () =>
  jest
    .requireActual("../../../test-utils/uiLocaleFixture")
    .withFixturePluralData(
      jest.requireActual("../../../i18n/pluralData.generated"),
      ["es"],
    ),
)

import {
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../../i18n/localeStore"
import {
  phoneLocales,
  tapActionName,
} from "../../../test-utils/uiLocaleFixture"
import {
  TestRenderer,
  hasText,
  pressableByLabel,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { LibraryDownloads } from "../LibraryDownloads"

let renderer: TestInstance | null = null

/** A string child of some node, alone or beside a nested Text. */
function hasPart(list: TestInstance, part: string): boolean {
  return (
    list.root.findAll((node) => {
      const children = node.props.children
      return Array.isArray(children)
        ? children.includes(part)
        : children === part
    }).length > 0
  )
}

async function render(): Promise<TestInstance> {
  await act(async () => {
    renderer = TestRenderer.create(<LibraryDownloads />)
  })
  return renderer!
}

beforeEach(() => {
  resetLocaleStoreForTests()
  mockGetLocales.mockReset()
  mockGetLocales.mockReturnValue(phoneLocales("en-US"))
  startLocaleSync()
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})
afterAll(() => resetLocaleStoreForTests())

describe("the downloads list after a UI language change", () => {
  it("relabels rows and cards whose props did not change, and keeps their tap names", async () => {
    const list = await render()
    expect(hasText(list, "74 MB · Downloaded")).toBe(true)
    expect(hasPart(list, "1 video · 0 MB")).toBe(true)
    expect(hasPart(list, "· 1 failed")).toBe(true)
    const english = [
      "The Birth of Jesus, 74 MB · Downloaded",
      "Lumo, 1 video",
      "Select downloads",
    ].map((label) => tapActionName(pressableByLabel(list, label)))

    mockGetLocales.mockReturnValue(phoneLocales("es-ES"))
    await act(async () => {
      refreshLocale()
    })

    expect(hasText(list, "74 MB · Descargado")).toBe(true)
    expect(hasText(list, "74 MB · Downloaded")).toBe(false)
    expect(hasPart(list, "1 vídeo · 0 MB")).toBe(true)
    expect(hasPart(list, "· 1 con error")).toBe(true)
    expect(hasText(list, "Seleccionar")).toBe(true)
    const spanish = [
      "The Birth of Jesus, 74 MB · Descargado",
      "Lumo, 1 vídeo",
      "Seleccionar descargas",
    ].map((label) => tapActionName(pressableByLabel(list, label)))
    expect(spanish).toEqual(english)
    expect([english[0], english[2]]).toEqual([
      "library-download-row",
      "library-select",
    ])
  })
})
