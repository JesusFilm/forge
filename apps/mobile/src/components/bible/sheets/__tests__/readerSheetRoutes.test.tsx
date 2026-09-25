/**
 * The three reader sheet routes (feat-551 U10, KTD9) as thin adapters: they
 * parse the params fail-closed, write the viewer's pick to the shared
 * stores, and close. Real stores; a fake router and fake services. Every
 * case renders under StrictMode, because the routes hold effects.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

// tsconfig maps `react` to its .d.ts; re-point it (see AccountSection.test.tsx).
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
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))

type MockRoute = {
  params: Record<string, unknown>
  back: jest.Mock
  screenOptions: { contentStyle?: { backgroundColor?: string } }[]
  services: unknown
  audioLanguage: string | null
  tablet: boolean
}
const mockRoute: MockRoute = {
  params: {},
  back: jest.fn(),
  screenOptions: [],
  services: null,
  audioLanguage: null,
  tablet: false,
}
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockRoute.params,
  useRouter: () => ({ back: mockRoute.back }),
  useNavigation: () => ({ addListener: () => () => {} }),
  Stack: {
    Screen: (props: { options: MockRoute["screenOptions"][number] }) => {
      mockRoute.screenOptions.push(props.options)
      return null
    },
  },
}))
jest.mock("../../../../lib/bible/reader/services", () => ({
  getReaderServices: () => mockRoute.services,
}))
jest.mock("../../../../contexts/WatchPreferencesProvider", () => ({
  useWatchPreferences: () => ({
    audioLanguageIso3: mockRoute.audioLanguage,
    isReady: true,
  }),
}))
jest.mock("../../../../hooks/useIsTabletLayout", () => ({
  useIsTabletLayout: () => mockRoute.tablet,
}))
// FlashList virtualizes against a layout jest never measures, so render the
// header and every row inline instead.
jest.mock("@shopify/flash-list", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  const react = jest.requireActual(
    path.dirname(r.resolve("react/package.json")),
  ) as {
    Fragment: unknown
    createElement: (
      type: unknown,
      props: unknown,
      ...children: unknown[]
    ) => unknown
  }
  return {
    FlashList: (props: {
      data: unknown[]
      renderItem: (args: { item: unknown; index: number }) => unknown
      ListHeaderComponent?: unknown
      ListEmptyComponent?: unknown
    }) =>
      react.createElement(
        react.Fragment,
        null,
        props.ListHeaderComponent,
        props.data.length === 0
          ? props.ListEmptyComponent
          : props.data.map((item, index) =>
              react.createElement(
                react.Fragment,
                { key: index },
                props.renderItem({ item, index }),
              ),
            ),
      ),
  }
})

import { StrictMode, act, type ComponentType } from "react"
import { StyleSheet } from "react-native"

import ReaderPassageRoute from "../../../../../app/reader-passage"
import ReaderSettingsRoute from "../../../../../app/reader-settings"
import ReaderTranslationRoute from "../../../../../app/reader-translation"
import type { BundledResult } from "../../../../lib/bible/data/bundled"
import { parseCatalog, type Catalog } from "../../../../lib/bible/data/catalog"
import {
  createReadingPositionStore,
  type ReadingPositionStore,
} from "../../../../lib/bible/position/store"
import { READER_COPY } from "../../../../lib/bible/reader/copy"
import type { ReaderServices } from "../../../../lib/bible/reader/services"
import type { TranslationDownloadState } from "../../../../lib/bible/repository/translationDownloads"
import { createReaderSettingsStore } from "../../../../lib/bible/settings/store"
import { READER_SHEET_COPY } from "../../../../lib/bible/sheets/copy"
import { readerSheetHref } from "../../../../lib/bible/sheets/routes"
import { translationStatusLabel } from "../../../../lib/bible/sheets/translationList"
import { readerTokens } from "../../../../lib/bible/theme/palettes"
import type { VerseRef } from "../../../../lib/bible/versification/convert"
import {
  TestRenderer,
  hasText,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type RenderedNode,
  type TestInstance,
} from "../../../../test-utils/rnTestRenderer"

declare const __dirname: string
const fs = jest.requireActual<{
  readFileSync(path: string, encoding: "utf8"): string
}>("fs")

function loadCatalog(): Catalog {
  const raw: unknown = JSON.parse(
    fs.readFileSync(
      `${__dirname}/../../../../../assets/bible/catalog.bible`,
      "utf8",
    ),
  )
  const catalog = parseCatalog(raw)
  if (!catalog) throw new Error("the bundled catalog did not parse")
  return catalog
}

const CATALOG = loadCatalog()
const SYNODAL = CATALOG.byId.get("rus_syn")!
const JOHN_3_16: VerseRef = { book: "JHN", chapter: 3, verse: 16 }
const PSALM_23_1: VerseRef = { book: "PSA", chapter: 23, verse: 1 }
const PASSAGE = READER_SHEET_COPY.passage
const TRANSLATION = READER_SHEET_COPY.translation
const SETTINGS = READER_SHEET_COPY.settings

type Harness = {
  position: ReadingPositionStore
  settings: ReturnType<typeof createReaderSettingsStore>
  loadCatalog: jest.Mock<Promise<BundledResult<Catalog>>, []>
}

function memoryStorage() {
  const items = new Map<string, string>()
  return {
    getItem: async (key: string) => items.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      items.set(key, value)
    },
  }
}

function install(): Harness {
  const position = createReadingPositionStore(memoryStorage())
  const settings = createReaderSettingsStore(memoryStorage())
  const loadCatalog = jest.fn(() =>
    Promise.resolve<BundledResult<Catalog>>({ status: "ok", value: CATALOG }),
  )
  const listeners = new Set<() => void>()
  const services: ReaderServices = {
    repository: {} as ReaderServices["repository"],
    downloads: {
      getState: (id: string): TranslationDownloadState =>
        id === "BSB" ? { kind: "bundled" } : { kind: "not-downloaded" },
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      check: () => Promise.resolve(),
    },
    loadCatalog,
    positionStore: position,
    settingsStore: settings,
    readPhoneLanguage: () => "es",
  }
  mockRoute.services = services
  return { position, settings, loadCatalog }
}

let mounted: TestInstance | null = null

async function renderRoute(Route: ComponentType): Promise<TestInstance> {
  await act(async () => {
    mounted = TestRenderer.create(
      <StrictMode>
        <Route />
      </StrictMode>,
    )
  })
  return mounted!
}

beforeEach(() => {
  mockRoute.params = {}
  mockRoute.back = jest.fn()
  mockRoute.screenOptions = []
  mockRoute.audioLanguage = null
  mockRoute.tablet = false
})

afterEach(async () => {
  if (mounted != null) {
    await unmount(mounted)
    mounted = null
  }
})

function controls(renderer: TestInstance, label: string): RenderedNode[] {
  return renderer.root.findAll(
    (node) =>
      typeof node.type !== "string" &&
      node.props.accessibilityLabel === label &&
      (typeof node.props.onPress === "function" ||
        typeof node.props.onValueChange === "function"),
  )
}

async function press(renderer: TestInstance, label: string): Promise<void> {
  const [target] = controls(renderer, label)
  if (!target) throw new Error(`no control labelled "${label}"`)
  await act(async () => {
    target.props.onPress?.()
  })
}

function lastBackground(): string | undefined {
  return mockRoute.screenOptions.at(-1)?.contentStyle?.backgroundColor
}

const SYNODAL_CONTEXT = {
  translation: SYNODAL,
  translationRef: { book: "PSA", chapter: 22, verse: 1 } as VerseRef,
  ref: PSALM_23_1,
  offline: false,
}

describe("reader-passage route", () => {
  it("moves the reader to the chosen verse, in BSB numbering, then closes", async () => {
    const { position } = install()
    mockRoute.params = readerSheetHref("passage", SYNODAL_CONTEXT).params
    const renderer = await renderRoute(ReaderPassageRoute)

    await press(renderer, "Psalms")
    await press(renderer, PASSAGE.chapter(50))
    await press(renderer, PASSAGE.verse(3))

    // Synodal Psalm 50:3 is BSB Psalm 51:1 (AE17).
    expect(position.getSnapshot().ref).toEqual({
      book: "PSA",
      chapter: 51,
      verse: 1,
    })
    expect(mockRoute.back).toHaveBeenCalledTimes(1)
  })

  it("refuses malformed params and falls back to BSB numbers", async () => {
    const { position } = install()
    mockRoute.params = {
      translation: "../../etc",
      ref: ["JHN.3.16"],
      shownRef: "PSA.0.0",
      offline: { nested: true },
    }
    const renderer = await renderRoute(ReaderPassageRoute)
    await press(renderer, "Psalms")
    expect(controls(renderer, PASSAGE.chapter(150))).toHaveLength(1)
    await press(renderer, PASSAGE.chapter(23))
    await press(renderer, PASSAGE.verse(1))
    expect(position.getSnapshot().ref).toEqual(PSALM_23_1)
  })

  it("marks the current verse from the BSB ref when the catalog fails", async () => {
    const { loadCatalog } = install()
    loadCatalog.mockImplementation(() =>
      Promise.resolve({ status: "failed", reason: "read-failed" }),
    )
    mockRoute.params = readerSheetHref("passage", SYNODAL_CONTEXT).params
    const renderer = await renderRoute(ReaderPassageRoute)
    await press(renderer, "Psalms")
    const [chapter] = controls(renderer, PASSAGE.chapter(23))
    expect(
      (chapter?.props.accessibilityState as { selected?: boolean }).selected,
    ).toBe(true)
  })

  it("paints the sheet in the reader's theme", async () => {
    const { settings } = install()
    settings.update({ mode: "light", palette: "trueDark" })
    await renderRoute(ReaderPassageRoute)
    expect(lastBackground()).toBe(readerTokens("trueDark", "light").background)
  })
})

describe("reader-translation route", () => {
  it("stores the pick as an explicit choice and keeps the passage (R24, R41)", async () => {
    const { position } = install()
    position.moveTo(JOHN_3_16)
    position.switchTranslationForSession("BSB")
    mockRoute.params = readerSheetHref("translation", {
      translation: CATALOG.byId.get("BSB")!,
      translationRef: JOHN_3_16,
      ref: JOHN_3_16,
      offline: false,
    }).params
    const renderer = await renderRoute(ReaderTranslationRoute)

    const label = `${SYNODAL.name}, ${translationStatusLabel(SYNODAL, {
      kind: "not-downloaded",
    })}`
    await press(renderer, label)

    const snapshot = position.getSnapshot()
    expect(snapshot.translationId).toBe("rus_syn")
    expect(snapshot.sessionTranslationId).toBeNull()
    expect(snapshot.ref).toEqual(JOHN_3_16)
    expect(mockRoute.back).toHaveBeenCalledTimes(1)
  })

  it("lists the phone language first when no audio language is known", async () => {
    install()
    const renderer = await renderRoute(ReaderTranslationRoute)
    const rows = renderer.root.findAll(
      (node) =>
        typeof node.type !== "string" &&
        node.props.accessibilityRole === "radio" &&
        typeof node.props.onPress === "function",
    )
    const first = rows[0]?.props.accessibilityLabel as string
    const spanish = CATALOG.translations.filter((t) => t.language === "spa")
    expect(spanish.some((t) => first.startsWith(`${t.name}, `))).toBe(true)
  })

  it("starts with the device filter on when the reader is offline", async () => {
    install()
    mockRoute.params = readerSheetHref("translation", {
      ...SYNODAL_CONTEXT,
      offline: true,
    }).params
    const renderer = await renderRoute(ReaderTranslationRoute)
    const [filter] = controls(renderer, TRANSLATION.onDeviceOnly)
    expect(filter?.props.value).toBe(true)
  })

  it("refuses malformed params without crashing, and a pick still works", async () => {
    const { position } = install()
    mockRoute.params = { translation: ["BSB"], ref: "nonsense", offline: 1 }
    const renderer = await renderRoute(ReaderTranslationRoute)
    const label = `${SYNODAL.name}, ${translationStatusLabel(SYNODAL, {
      kind: "not-downloaded",
    })}`
    await press(renderer, label)
    expect(position.getSnapshot().translationId).toBe("rus_syn")
    expect(position.getSnapshot().ref).toBeNull()
  })

  it("offers a retry when the catalog does not load", async () => {
    const { loadCatalog } = install()
    // StrictMode runs the load twice, so the failure must hold for both runs.
    loadCatalog.mockImplementation(() =>
      Promise.resolve({ status: "failed", reason: "read-failed" }),
    )
    const renderer = await renderRoute(ReaderTranslationRoute)
    expect(hasText(renderer, READER_COPY.failure.catalogTitle)).toBe(true)
    loadCatalog.mockImplementation(() =>
      Promise.resolve({ status: "ok", value: CATALOG }),
    )
    await press(renderer, READER_COPY.failure.retry)
    expect(hasText(renderer, READER_COPY.failure.catalogTitle)).toBe(false)
    expect(controls(renderer, TRANSLATION.onDeviceOnly)).toHaveLength(1)
  })
})

describe("reader-settings route", () => {
  it("writes each change to the store, and the sheet follows it", async () => {
    const { settings } = install()
    const renderer = await renderRoute(ReaderSettingsRoute)

    await press(renderer, SETTINGS.modes.light)
    expect(settings.getSnapshot().mode).toBe("light")
    await press(renderer, SETTINGS.palettes.trueDark)
    expect(settings.getSnapshot().palette).toBe("trueDark")
    // The sheet reads the same store as the reader, so its theme follows.
    const [root] = renderer.root.findAll(
      (node) => node.props.testID === "reader-settings-sheet",
    )
    const style = StyleSheet.flatten(root?.props.style as never) as {
      backgroundColor?: string
    }
    expect(style.backgroundColor).toBe(
      readerTokens("trueDark", "light").background,
    )
    expect(lastBackground()).toBe(readerTokens("trueDark", "light").background)

    await press(renderer, SETTINGS.typefaces.sans)
    await press(renderer, SETTINGS.lineSpacings.relaxed)
    await press(renderer, SETTINGS.textSizeStep(5, 5))
    const [verseNumbers] = controls(renderer, SETTINGS.verseNumbers)
    const [arrows] = controls(renderer, SETTINGS.showArrows)
    await act(async () => {
      ;(verseNumbers?.props.onValueChange as (v: boolean) => void)(false)
      ;(arrows?.props.onValueChange as (v: boolean) => void)(true)
    })
    expect(settings.getSnapshot()).toMatchObject({
      typeface: "sans",
      lineSpacing: "relaxed",
      textSizeStep: 4,
      verseNumbers: false,
      showArrows: true,
    })
  })

  it("hides Show arrow buttons on a tablet", async () => {
    install()
    mockRoute.tablet = true
    const renderer = await renderRoute(ReaderSettingsRoute)
    expect(controls(renderer, SETTINGS.showArrows)).toHaveLength(0)
  })

  it("credits the shown translation, and not BSB twice", async () => {
    install()
    mockRoute.params = readerSheetHref("settings", SYNODAL_CONTEXT).params
    const renderer = await renderRoute(ReaderSettingsRoute)
    expect(
      hasText(renderer, SETTINGS.currentCredit(SYNODAL.name, SYNODAL.credit)),
    ).toBe(true)
    await unmount(renderer)

    mockRoute.params = readerSheetHref("settings", {
      ...SYNODAL_CONTEXT,
      translation: CATALOG.byId.get("BSB")!,
    }).params
    mounted = await renderRoute(ReaderSettingsRoute)
    const bsb = CATALOG.byId.get("BSB")!
    expect(hasText(mounted, SETTINGS.currentCredit(bsb.name, bsb.credit))).toBe(
      false,
    )
  })

  it("refuses malformed params without crashing", async () => {
    install()
    mockRoute.params = { translation: "a/b", offline: "maybe" }
    const renderer = await renderRoute(ReaderSettingsRoute)
    expect(hasText(renderer, SETTINGS.aboutTitle)).toBe(true)
  })
})
