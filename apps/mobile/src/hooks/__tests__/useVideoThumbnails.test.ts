/** The Experience card art and titles (useVideoThumbnails). The batch document
 *  itself validates against the Admin SDL in
 *  src/lib/__tests__/videoTextDocuments.contract.guard.test.js. */

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
import {
  Kind,
  type DocumentNode,
  type FragmentDefinitionNode,
  type SelectionSetNode,
} from "graphql"

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
  VIDEO_THUMBNAIL_BATCH_SIZE,
  useVideoThumbnails,
  videoMetaFromResult,
  videoThumbnailsDocument,
  type VideoMetaMap,
} from "../useVideoThumbnails"

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

// ── Admin's alias limit ──────────────────────────────────────────────────────

// Admin rejects a document with more than 200 aliases ("Aliases limit of 200
// exceeded"), counted after fragment spreads expand.
const ADMIN_ALIAS_LIMIT = 200

function expandedAliasCount(document: DocumentNode): number {
  const fragments = new Map<string, FragmentDefinitionNode>()
  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION)
      fragments.set(definition.name.value, definition)
  }
  const count = (set: SelectionSetNode | undefined): number =>
    (set?.selections ?? []).reduce((total, selection) => {
      if (selection.kind === Kind.FIELD)
        return total + (selection.alias ? 1 : 0) + count(selection.selectionSet)
      if (selection.kind === Kind.FRAGMENT_SPREAD)
        return total + count(fragments.get(selection.name.value)?.selectionSet)
      return total + count(selection.selectionSet)
    }, 0)
  return document.definitions.reduce(
    (total, definition) =>
      definition.kind === Kind.OPERATION_DEFINITION
        ? total + count(definition.selectionSet)
        : total,
    0,
  )
}

describe("the thumbnail batch stays under Admin's alias limit", () => {
  it("counts the production failure exactly (anti-vacuous)", () => {
    // 57 videos was the Experience that Admin rejected with "found 342".
    expect(
      expandedAliasCount(videoThumbnailsDocument(57) as DocumentNode),
    ).toBe(342)
  })

  it("keeps a full batch at or under the limit", () => {
    expect(
      expandedAliasCount(
        videoThumbnailsDocument(VIDEO_THUMBNAIL_BATCH_SIZE) as DocumentNode,
      ),
    ).toBeLessThanOrEqual(ADMIN_ALIAS_LIMIT)
  })
})

// ── The hook ─────────────────────────────────────────────────────────────────

function experienceOf(slug: string, videoIds: string[]): WatchExperience {
  return {
    slug,
    blocks: videoIds.map((videoId) => ({
      __typename: "VideoCardBlock",
      videoId,
    })),
  } as unknown as WatchExperience
}

let experience: WatchExperience
let seen: VideoMetaMap[] = []

function Probe() {
  seen.push(useVideoThumbnails(experience))
  return null
}

describe("useVideoThumbnails", () => {
  let mounted: TestInstance | null = null
  const query = jest.fn()

  async function mount(root: ReturnType<typeof createElement>) {
    await act(async () => {
      mounted = TestRenderer.create(root)
    })
  }

  beforeEach(() => {
    experience = experienceOf("easter", ["a"])
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

  // KTD16: the effect follows the UI language.
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
    await mount(createElement(StrictMode, null, createElement(Probe)))
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

  it("sends only ids of letters, digits, hyphens, and underscores", async () => {
    experience = experienceOf("easter", [
      "cmpbs74n6036v6d819ppuc9fo",
      "abc-123_def",
      'abc"def',
      "abc def",
      '") { __typename } v99: video(id: "x',
    ])
    query.mockResolvedValue({ data: {} })
    await mount(createElement(Probe))
    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0][0].variables).toEqual({
      textSlug: "english",
      id0: "cmpbs74n6036v6d819ppuc9fo",
      id1: "abc-123_def",
    })
  })

  it("keeps the last art when every batch fails", async () => {
    query.mockImplementation(
      ({ variables }: { variables: Record<string, string> }) =>
        variables.textSlug === "english"
          ? Promise.resolve({ data: { v0: video("a", [], "JESUS") } })
          : Promise.reject(new Error("offline")),
    )
    await mount(createElement(Probe))
    mockGetLocales.mockReturnValue(phoneLocales("ru-RU"))
    await act(async () => {
      refreshLocale()
    })

    expect(seen.at(-1)?.get("a")).toEqual({
      thumbnail: "https://cdn/a.jpg",
      title: null,
    })
  })

  describe("with a large Experience", () => {
    function answer(variables: Record<string, string>) {
      const data: Record<string, unknown> = {}
      for (const [name, id] of Object.entries(variables)) {
        if (name.startsWith("id")) data[`v${name.slice(2)}`] = video(id, [], id)
      }
      return { data }
    }

    beforeEach(() => {
      experience = experienceOf(
        "large",
        Array.from({ length: 57 }, (_, i) => `v${i}`),
      )
    })

    it("splits the ids into batches and merges every title", async () => {
      query.mockImplementation(
        ({ variables }: { variables: Record<string, string> }) =>
          Promise.resolve(answer(variables)),
      )
      await mount(createElement(Probe))
      expect(query).toHaveBeenCalledTimes(2)
      for (const [{ variables }] of query.mock.calls) {
        const ids = Object.keys(variables).filter((k) => k.startsWith("id"))
        expect(ids.length).toBeLessThanOrEqual(VIDEO_THUMBNAIL_BATCH_SIZE)
      }
      const map = seen.at(-1)
      expect(map?.size).toBe(57)
      expect(map?.get("v0")?.title).toBe("v0")
      expect(map?.get("v56")?.title).toBe("v56")
    })

    it("keeps the batches that succeed when one batch fails", async () => {
      query.mockImplementation(
        ({ variables }: { variables: Record<string, string> }) =>
          variables.id0 === "v0"
            ? Promise.reject(new Error("offline"))
            : Promise.resolve(answer(variables)),
      )
      await mount(createElement(Probe))
      const map = seen.at(-1)
      expect(map?.has("v0")).toBe(false)
      expect(map?.get("v56")?.title).toBe("v56")
    })
  })
})
