/**
 * The Experience card art and titles (useVideoThumbnails). The batch document
 * itself validates against the Admin SDL in
 * src/lib/__tests__/videoTextDocuments.contract.guard.test.js.
 */

jest.mock("react", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(path.dirname(r.resolve("react/package.json")))
})
jest.mock("../../lib/apolloClient", () => ({ getApolloClient: jest.fn() }))

// `ru` is a fixture catalog, so a phone change moves the locale epoch.
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
      ru: {},
    }),
)
jest.mock("../../i18n/pluralData.generated", () =>
  jest
    .requireActual("../../test-utils/uiLocaleFixture")
    .withFixturePluralData(
      jest.requireActual("../../i18n/pluralData.generated"),
      ["ru"],
    ),
)

import { StrictMode, act, createElement } from "react"

import { adminFormsFor } from "../../i18n/adminLanguage"
import {
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../i18n/localeStore"
import { getApolloClient } from "../../lib/apolloClient"
import type { WatchExperience } from "../../lib/queries"
import { phoneLocales } from "../../test-utils/uiLocaleFixture"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"
import {
  useVideoThumbnails,
  videoMetaFromResult,
  type VideoMetaMap,
} from "../useVideoThumbnails"

describe("useVideoThumbnails internals", () => {
  describe("SAFE_ID_RE validation", () => {
    const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/

    it("accepts standard CUID-style videoIds", () => {
      expect(SAFE_ID_RE.test("cmpbs74n6036v6d819ppuc9fo")).toBe(true)
    })

    it("accepts IDs with hyphens and underscores", () => {
      expect(SAFE_ID_RE.test("abc-123_def")).toBe(true)
    })

    it("rejects IDs with quotes", () => {
      expect(SAFE_ID_RE.test('abc"def')).toBe(false)
    })

    it("rejects IDs with spaces", () => {
      expect(SAFE_ID_RE.test("abc def")).toBe(false)
    })

    it("rejects IDs with GraphQL injection attempts", () => {
      expect(SAFE_ID_RE.test('") { __typename } v99: video(id: "x')).toBe(false)
    })

    it("rejects empty string", () => {
      expect(SAFE_ID_RE.test("")).toBe(false)
    })
  })
})

function video(
  id: string,
  ui: { languageSlug: string; title: string }[],
  english: string | null,
) {
  return {
    documentId: id,
    images: [
      { documentId: `img-${id}`, mobileCinematicHigh: `https://cdn/${id}.jpg` },
    ],
    locales: ui.map((row, i) => ({ documentId: `l-${id}-${i}`, ...row })),
    englishLocales: english
      ? [{ documentId: `l-${id}-en`, languageSlug: "english", title: english }]
      : [],
  }
}

describe("videoMetaFromResult (U6)", () => {
  it("titles each video in the UI language, else in English", () => {
    const map = videoMetaFromResult(
      ["a", "b"],
      {
        v0: video("a", [{ languageSlug: "russian", title: "ИИСУС" }], "JESUS"),
        v1: video("b", [], "Magdalena"),
      } as never,
      adminFormsFor("ru"),
    )
    expect(map.get("a")).toEqual({
      thumbnail: "https://cdn/a.jpg",
      title: "ИИСУС",
    })
    expect(map.get("b")?.title).toBe("Magdalena")
  })
})

// ── The effect follows the UI language (KTD16) ──────────────────────────────

const EXPERIENCE = {
  slug: "easter",
  blocks: [{ __typename: "VideoCardBlock", videoId: "a" }],
} as unknown as WatchExperience

let seen: VideoMetaMap[] = []

function Probe() {
  seen.push(useVideoThumbnails(EXPERIENCE))
  return null
}

describe("useVideoThumbnails across a live language change (U6)", () => {
  let mounted: TestInstance | null = null
  const query = jest.fn()

  beforeEach(() => {
    seen = []
    query.mockReset()
    ;(getApolloClient as jest.Mock).mockReturnValue({ query })
    resetLocaleStoreForTests()
    mockGetLocales.mockReturnValue(phoneLocales("en-US"))
    startLocaleSync()
  })

  afterEach(async () => {
    await act(async () => {
      mounted?.unmount()
    })
    mounted = null
    resetLocaleStoreForTests()
  })

  it("asks again in the new language and never shows the old titles", async () => {
    let answerRussian: (value: unknown) => void = () => undefined
    query.mockImplementation(
      ({ variables }: { variables: Record<string, string> }) =>
        variables.textSlug === "english"
          ? Promise.resolve({
              data: {
                v0: video(
                  "a",
                  [{ languageSlug: "english", title: "JESUS" }],
                  "JESUS",
                ),
              },
            })
          : new Promise((resolve) => {
              answerRussian = resolve
            }),
    )
    await act(async () => {
      mounted = TestRenderer.create(
        createElement(StrictMode, null, createElement(Probe)),
      )
    })
    expect(seen.at(-1)?.get("a")?.title).toBe("JESUS")

    mockGetLocales.mockReturnValue(phoneLocales("ru-RU"))
    await act(async () => {
      refreshLocale()
    })

    expect(query.mock.calls.at(-1)?.[0].variables).toMatchObject({
      textSlug: "russian",
      id0: "a",
    })
    // The art stays; the English title leaves while Russian loads.
    expect(seen.at(-1)?.get("a")).toEqual({
      thumbnail: "https://cdn/a.jpg",
      title: null,
    })

    await act(async () => {
      answerRussian({
        data: {
          v0: video(
            "a",
            [{ languageSlug: "russian", title: "ИИСУС" }],
            "JESUS",
          ),
        },
      })
    })
    expect(seen.at(-1)?.get("a")?.title).toBe("ИИСУС")
  })
})
