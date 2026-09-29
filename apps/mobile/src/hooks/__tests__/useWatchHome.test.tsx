/**
 * feat-517 KTD1: the Home model and the recommendations insert index must land
 * in ONE state write, so no rendered frame can pair a new model with the
 * previous model's authored position. A probe component records every render's
 * pair, for the network paint and for the cold-launch snapshot paint.
 *
 * apps/mobile's tsconfig maps `react` to its .d.ts and jest-expo mirrors
 * tsconfig paths into jest's moduleNameMapper, so the mocks below re-point
 * `react` at the real package (see apps/mobile/CLAUDE.md "Component render
 * tests"). Only the hook's module-scope dependencies are mocked; the adapter,
 * the model builder and the snapshot parser all run for real.
 */

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
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}))
jest.mock("../../lib/apolloClient", () => ({ getApolloClient: jest.fn() }))
jest.mock("../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
jest.mock("../../lib/watchHome/heroStreamCooldown", () => ({
  clearAllHeroStreamCooldowns: jest.fn(),
}))
// Sentinel documents: the real module pulls the whole typed client in, and the
// hook only needs to tell its two queries apart.
jest.mock("../../lib/queries", () => ({
  GET_WATCH_HOME_VIDEOS: { name: "videos" },
  GET_WATCH_SETTING: { name: "setting" },
}))

// U6: the phone's languages reach the hook through the real locale store.
// `es` and `ru` are fixture catalogs, so a phone change moves the epoch; a
// suite that never starts the store stays on English.
const mockGetLocales = jest.fn()
jest.mock("expo-localization", () => ({
  getLocales: () => mockGetLocales(),
}))
jest.mock("expo-localization/build/ExpoLocalization", () => ({
  addLocaleListener: () => ({ remove: () => undefined }),
}))
jest.mock("../../i18n/catalogs.generated", () =>
  jest
    .requireActual("../../test-utils/uiLocaleFixture")
    .withFixtureCatalogs(jest.requireActual("../../i18n/catalogs.generated"), {
      es: {},
      ru: {},
    }),
)
jest.mock("../../i18n/pluralData.generated", () =>
  jest
    .requireActual("../../test-utils/uiLocaleFixture")
    .withFixturePluralData(
      jest.requireActual("../../i18n/pluralData.generated"),
      ["es", "ru"],
    ),
)

import { StrictMode, act, createElement } from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"

import {
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../i18n/localeStore"
import { datadogLog } from "../../lib/datadog"
import { phoneLocales } from "../../test-utils/uiLocaleFixture"
import { useWatchHome } from "../useWatchHome"
import { getApolloClient } from "../../lib/apolloClient"
import { GET_WATCH_HOME_VIDEOS, GET_WATCH_SETTING } from "../../lib/queries"
import { adminFormsFor } from "../../i18n/adminLanguage"
import type {
  WatchHomeModel,
  WatchHomeVideoInput,
} from "../../lib/watchHome/model"
import { serializeHomeSnapshotFromVideosJson } from "../../lib/watchHomePersistence"
import {
  TestRenderer,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

const storage = AsyncStorage as unknown as {
  getItem: jest.Mock
  setItem: jest.Mock
  removeItem: jest.Mock
}
const mockGetApolloClient = getApolloClient as jest.Mock
// The jest mock above replaces the typed document with a sentinel, so compare
// as unknown: the real type and the sentinel have no overlap.
const videosDocument = GET_WATCH_HOME_VIDEOS as unknown

/**
 * `WatchHomeModel` must never carry the index (KTD1). This resolves to `never`
 * the moment the field is added, so the assignment below stops compiling.
 */
type ModelHasNoIndex = "recommendationsInsertIndex" extends keyof WatchHomeModel
  ? never
  : true

const video: WatchHomeVideoInput = {
  documentId: "d-jesus",
  coreId: "1_jf-0-0",
  slug: "jesus",
  label: "FEATURE_FILM",
  images: [{ mobileCinematicHigh: "https://cdn/jesus.jpg" }],
  locales: [{ title: "JESUS" }],
}

// Items carry no coreId, so the hook finds nothing divergent and runs no
// top-up fetch. The recommendations block sits between the two shelves.
function collection(sectionKey: string): Record<string, unknown> {
  return {
    __typename: "MediaCollectionBlock",
    sectionKey,
    title: sectionKey,
    mediaCollectionVariant: "carousel",
    items: [
      {
        videoId: `v-${sectionKey}`,
        videoSlug: sectionKey,
        titleOverride: sectionKey,
      },
    ],
  }
}
const blocks = [
  collection("first"),
  { __typename: "HomepageRecommendationsBlock" },
  collection("second"),
]

type Frame = { model: WatchHomeModel | null; index: number | null }

let frames: Frame[] = []

function Probe(): null {
  const { model, recommendationsInsertIndex } = useWatchHome()
  frames.push({ model, index: recommendationsInsertIndex })
  return null
}

/**
 * One microtask per `act` scope. React collapses every update made inside a
 * single scope into one commit, so a wider flush would hide the torn frame this
 * suite exists to detect: stepping makes each turn its own commit.
 */
async function step(): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

async function renderProbe(): Promise<TestInstance> {
  let renderer: TestInstance | undefined
  await act(() => {
    renderer = TestRenderer.create(createElement(Probe))
  })
  await step()
  return renderer as TestInstance
}

/** The first frame that painted a model, and every frame before it. */
function firstPaint(): { at: number; frame: Frame } {
  const at = frames.findIndex((frame) => frame.model != null)
  expect(at).toBeGreaterThanOrEqual(0)
  return { at, frame: frames[at] }
}

beforeEach(() => {
  frames = []
  jest.clearAllMocks()
  storage.getItem.mockResolvedValue(null)
  storage.setItem.mockResolvedValue(undefined)
})

describe("useWatchHome — the model and the insert index land in one state write (KTD1)", () => {
  it("never exposes the index inside WatchHomeModel", () => {
    const modelHasNoIndex: ModelHasNoIndex = true
    expect(modelHasNoIndex).toBe(true)
  })

  it("paints the network model and its index in the same render", async () => {
    mockGetApolloClient.mockReturnValue({
      query: jest.fn((args: { query: unknown }) =>
        args.query === videosDocument
          ? Promise.resolve({ data: { watchHomeVideos: [video] } })
          : Promise.resolve({
              data: { watchSetting: { homepageExperience: { blocks } } },
            }),
      ),
    })

    const renderer = await renderProbe()
    const { at, frame } = firstPaint()

    // The authored position arrives WITH the model, not a render later.
    expect(frame.index).toBe(1)
    expect(frame.model?.sections.map((section) => section.id)).toEqual([
      "first",
      "second",
    ])
    // No earlier frame leaked an index without a model.
    for (const earlier of frames.slice(0, at)) {
      expect(earlier.index).toBeNull()
    }
    // No later frame pairs a model with a different index.
    for (const later of frames.slice(at)) {
      expect(later.index).toBe(1)
    }
    expect(Object.keys(frame.model ?? {})).not.toContain(
      "recommendationsInsertIndex",
    )
    await unmount(renderer)
  })

  it("paints the snapshot model and its index in the same render", async () => {
    storage.getItem.mockResolvedValue(
      serializeHomeSnapshotFromVideosJson(
        JSON.stringify([video]),
        new Date(),
        JSON.stringify(blocks),
        "[]",
      ),
    )
    // The required videos fetch fails, so only the snapshot paints.
    mockGetApolloClient.mockReturnValue({
      query: jest.fn(() => Promise.reject(new Error("offline"))),
    })

    const renderer = await renderProbe()
    const { at, frame } = firstPaint()

    expect(frame.index).toBe(1)
    expect(frame.model?.sections.map((section) => section.id)).toEqual([
      "first",
      "second",
    ])
    for (const earlier of frames.slice(0, at)) {
      expect(earlier.index).toBeNull()
    }
    for (const later of frames.slice(at)) {
      expect(later.index).toBe(1)
    }
    await unmount(renderer)
  })

  /**
   * The render assertions above catch a torn frame, which is what an index
   * derived one commit later produces. They CANNOT catch a second state slot
   * written in the same tick: React batches those two writes into one commit,
   * so the rendered pairs are identical. This source check covers that shape.
   */
  it("holds the painted body in one state slot, written with both fields", () => {
    const nodeRequire = require as unknown as NodeRequireLike
    const fs = nodeRequire("fs") as {
      readFileSync: (path: string, encoding: string) => string
    }
    const source = fs.readFileSync(
      nodeRequire.resolve("../useWatchHome"),
      "utf8",
    )

    expect(source.match(/useState<WatchHomeBody>\(/g)).toHaveLength(1)
    expect(source).not.toMatch(/setRecommendationsInsertIndex/)
    const writes = source.match(/setBody\(\{[^}]*\}\)/g) ?? []
    // The network paint and the snapshot paint are the two production writes.
    expect(writes).toHaveLength(2)
    for (const write of writes) {
      expect(write).toContain("model:")
      expect(write).toContain("recommendationsInsertIndex")
    }
  })

  it("reports a null index beside the model when no block is published", async () => {
    mockGetApolloClient.mockReturnValue({
      query: jest.fn((args: { query: unknown }) =>
        args.query === videosDocument
          ? Promise.resolve({ data: { watchHomeVideos: [video] } })
          : Promise.resolve({
              data: {
                watchSetting: {
                  homepageExperience: {
                    blocks: [collection("first"), collection("second")],
                  },
                },
              },
            }),
      ),
    })

    const renderer = await renderProbe()
    const { frame } = firstPaint()

    expect(frame.model?.sections).toHaveLength(2)
    expect(frame.index).toBeNull()
    await unmount(renderer)
  })
})

// ── U6. Home in the UI locale, and a live language change (KTD10, KTD16) ────

const settingDocument = GET_WATCH_SETTING as unknown

const TITLES: Record<string, string> = {
  english: "JESUS",
  "spanish-latin-american": "JESÚS",
  russian: "ИИСУС",
}

/** The JESUS film as the Home query answers it for one text slug. */
function jesusIn(textSlug: string): WatchHomeVideoInput {
  return {
    documentId: "d-jesus",
    coreId: "1_jf-0-0",
    slug: "jesus",
    label: "FEATURE_FILM",
    images: [{ mobileCinematicHigh: "https://cdn/jesus.jpg" }],
    locales: [{ languageSlug: textSlug, title: TITLES[textSlug] }],
    englishLocales: [{ languageSlug: "english", title: "JESUS" }],
  }
}

/** A homepage whose one card links the JESUS film. */
function homepage(sectionKey: string, titleOverride: string) {
  return {
    homepageExperience: {
      blocks: [
        {
          __typename: "MediaCollectionBlock",
          sectionKey,
          title: sectionKey,
          mediaCollectionVariant: "carousel",
          items: [
            {
              videoId: "v-jesus",
              coreId: "1_jf-0-0",
              videoSlug: "jesus",
              titleOverride,
            },
          ],
        },
      ],
    },
  }
}

type PendingCall = {
  query: unknown
  variables: Record<string, unknown>
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

let calls: PendingCall[] = []

/** Every query waits until the test answers it. */
function useDeferredClient() {
  mockGetApolloClient.mockReturnValue({
    query: jest.fn(
      (args: { query: unknown; variables: Record<string, unknown> }) =>
        new Promise((resolve, reject) => {
          calls.push({ ...args, resolve, reject })
        }),
    ),
  })
}

function pending(document: unknown, locale: string): PendingCall[] {
  return calls.filter((call) => {
    if (call.query !== document) return false
    if (document === videosDocument) {
      return call.variables.textSlug === adminFormsFor(locale).textSlug
    }
    return call.variables.locale === locale
  })
}

async function settle(settleCalls: () => void) {
  await act(async () => {
    settleCalls()
  })
  await step()
}

async function answerVideos(locale: string) {
  const slug = adminFormsFor(locale).textSlug
  await settle(() => {
    for (const call of pending(videosDocument, locale)) {
      call.resolve({ data: { watchHomeVideos: [jesusIn(slug)] } })
    }
  })
}

async function answerSetting(locale: string, data: unknown) {
  await settle(() => {
    for (const call of pending(settingDocument, locale)) {
      call.resolve({ data })
    }
  })
}

async function failSetting(locale: string) {
  await settle(() => {
    for (const call of pending(settingDocument, locale)) {
      call.reject(new Error("offline"))
    }
  })
}

async function changePhone(tag: string) {
  mockGetLocales.mockReturnValue(phoneLocales(tag))
  await act(async () => {
    refreshLocale()
  })
  await step()
}

async function renderStrictProbe(): Promise<TestInstance> {
  let renderer: TestInstance | undefined
  await act(() => {
    renderer = TestRenderer.create(
      createElement(StrictMode, null, createElement(Probe)),
    )
  })
  await step()
  return renderer as TestInstance
}

function cardTitles(frame: Frame): string[] {
  return (frame.model?.sections ?? []).flatMap((section) =>
    section.cards.map((card) => card.title),
  )
}

function sectionIds(frame: Frame): string[] {
  return (frame.model?.sections ?? []).map((section) => section.id)
}

describe("useWatchHome in the UI locale (U6)", () => {
  beforeEach(() => {
    calls = []
    resetLocaleStoreForTests()
  })

  afterEach(() => resetLocaleStoreForTests())

  function startPhone(tag: string) {
    mockGetLocales.mockReturnValue(phoneLocales(tag))
    startLocaleSync()
  }

  it("asks for the catalog tag's homepage, the en one, and the text slug", async () => {
    startPhone("es-MX")
    useDeferredClient()
    const renderer = await renderStrictProbe()

    expect(pending(settingDocument, "es")[0]?.variables).toEqual({
      locale: "es",
      isEnglish: false,
    })
    expect(pending(videosDocument, "es")[0]?.variables).toMatchObject({
      textSlug: "spanish-latin-american",
    })
    await unmount(renderer)
  })

  // Covers AE1: Admin's own `es` homepage renders, authored text first.
  it("renders the es homepage with its authored Spanish card text (AE1)", async () => {
    startPhone("es-MX")
    useDeferredClient()
    const renderer = await renderStrictProbe()

    await answerVideos("es")
    await answerSetting("es", {
      watchSetting: homepage("ver", "Ver JESÚS"),
      englishWatchSetting: null,
    })

    expect(sectionIds(frames[frames.length - 1])).toEqual(["ver"])
    expect(cardTitles(frames[frames.length - 1])).toEqual(["Ver JESÚS"])
    await unmount(renderer)
  })

  // Covers AE2: no `ru` homepage; the `en` one gives the shelves, and the
  // video's Russian title beats its English authored text.
  it("falls back to the en homepage with Russian video titles (AE2)", async () => {
    startPhone("ru-RU")
    useDeferredClient()
    const renderer = await renderStrictProbe()

    await answerVideos("ru")
    await answerSetting("ru", {
      watchSetting: null,
      englishWatchSetting: homepage("films", "JESUS"),
    })

    expect(sectionIds(frames[frames.length - 1])).toEqual(["films"])
    expect(cardTitles(frames[frames.length - 1])).toEqual(["ИИСУС"])
    // The snapshot records the locale and the fallback it was built under.
    const blob = storage.setItem.mock.calls.at(-1)?.[1] as string
    expect(blob).toContain('"locale":"ru"')
    expect(blob).toContain('"homepageSource":"en-fallback"')
    await unmount(renderer)
  })

  // Covers AE6: the old epoch's answer lands after the change and is dropped;
  // no English frame ever paints before the Spanish one.
  it("drops a response for the old epoch after a language change (AE6)", async () => {
    startPhone("en-US")
    useDeferredClient()
    const renderer = await renderStrictProbe()
    expect(pending(videosDocument, "en").length).toBeGreaterThan(0)

    await changePhone("es-MX")
    await answerVideos("en")
    await answerSetting("en", { watchSetting: homepage("old", "JESUS") })

    expect(frames.every((frame) => frame.model == null)).toBe(true)

    await answerVideos("es")
    await answerSetting("es", {
      watchSetting: homepage("ver", "Ver JESÚS"),
      englishWatchSetting: null,
    })

    expect(cardTitles(frames[frames.length - 1])).toEqual(["Ver JESÚS"])
    expect(frames.some((frame) => sectionIds(frame).includes("old"))).toBe(
      false,
    )
    await unmount(renderer)
  })

  // Covers AE6: the old body leaves at once, and a failed Experience fetch in
  // the new locale shows the fallback body, never the old last-good body.
  it("clears the old body at once and never reuses its last-good blocks (AE6)", async () => {
    startPhone("en-US")
    useDeferredClient()
    const renderer = await renderStrictProbe()
    await answerVideos("en")
    await answerSetting("en", { watchSetting: homepage("first", "JESUS") })
    expect(sectionIds(frames[frames.length - 1])).toEqual(["first"])

    const beforeChange = frames.length
    await changePhone("es-MX")
    const afterChange = frames.slice(beforeChange)
    expect(afterChange.length).toBeGreaterThan(0)
    expect(afterChange[0].model).toBeNull()
    ;(datadogLog.warn as jest.Mock).mockClear()
    await answerVideos("es")
    await failSetting("es")

    const last = frames[frames.length - 1]
    expect(last.model).not.toBeNull()
    expect(sectionIds(last)).not.toContain("first")
    expect(
      frames.slice(beforeChange).some((f) => sectionIds(f).includes("first")),
    ).toBe(false)
    expect(datadogLog.warn).toHaveBeenCalledWith("watch_home_fallback", {
      reason: "error",
      body_source: "config",
    })
    await unmount(renderer)
  })

  it("never paints an en snapshot under es", async () => {
    storage.getItem.mockResolvedValue(
      serializeHomeSnapshotFromVideosJson(
        JSON.stringify([jesusIn("english")]),
        new Date(),
        JSON.stringify(homepage("first", "JESUS").homepageExperience.blocks),
        "[]",
      ),
    )
    startPhone("es-MX")
    mockGetApolloClient.mockReturnValue({
      query: jest.fn(() => Promise.reject(new Error("offline"))),
    })

    const renderer = await renderStrictProbe()

    expect(frames.every((frame) => frame.model == null)).toBe(true)
    await unmount(renderer)
  })

  it("paints a snapshot with no locale field under en", async () => {
    storage.getItem.mockResolvedValue(
      JSON.stringify({
        version: 3,
        persistedAt: Date.now(),
        videos: [jesusIn("english")],
        blocks: homepage("first", "JESUS").homepageExperience.blocks,
        hydrationVideos: [],
      }),
    )
    startPhone("en-US")
    mockGetApolloClient.mockReturnValue({
      query: jest.fn(() => Promise.reject(new Error("offline"))),
    })

    const renderer = await renderStrictProbe()

    expect(sectionIds(firstPaint().frame)).toEqual(["first"])
    await unmount(renderer)
  })

  it("repaints a snapshot saved under the en fallback with its precedence", async () => {
    storage.getItem.mockResolvedValue(
      serializeHomeSnapshotFromVideosJson(
        JSON.stringify([jesusIn("russian")]),
        new Date(),
        JSON.stringify(homepage("films", "JESUS").homepageExperience.blocks),
        "[]",
        { locale: "ru", homepageSource: "en-fallback" },
      ),
    )
    startPhone("ru-RU")
    mockGetApolloClient.mockReturnValue({
      query: jest.fn(() => Promise.reject(new Error("offline"))),
    })

    const renderer = await renderStrictProbe()

    expect(cardTitles(firstPaint().frame)).toEqual(["ИИСУС"])
    await unmount(renderer)
  })
})
