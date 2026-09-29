/** KTD10 against a real InMemoryCache. The text companions write onto the same
 *  normalized Video entities as the language-free player documents, so these
 *  cases pin the cache mechanism, not only the shapes `queries.test.ts` checks. */
import { ApolloClient, ApolloLink, InMemoryCache } from "@apollo/client"
import { parse, print } from "graphql"
import type { DocumentNode } from "graphql"

import {
  GET_SERIES_BY_SLUG,
  GET_SERIES_TEXT,
  GET_VIDEO_BY_SLUG,
  GET_VIDEO_TEXT,
  GET_WATCH_HOME_VIDEOS,
  type SeriesTextData,
  type SeriesVideoData,
  type VideoTextData,
  type WatchHomeVideosData,
  type WatchVideoData,
} from "../queries"

const SLUG = "birth-of-jesus"
const ES = "spanish-latin-american"
const RU = "russian"

function row(id: string, languageSlug: string, title: string) {
  return {
    __typename: "VideoLocale" as const,
    documentId: id,
    languageSlug,
    title,
    description: `${title} description`,
    snippet: `${title} snippet`,
    imageAlt: `${title} image`,
  }
}

function titleRow(id: string, languageSlug: string, title: string) {
  return {
    __typename: "VideoLocale" as const,
    documentId: id,
    languageSlug,
    title,
  }
}

const EN_ROW = row("loc-birth-en", "english", "The Birth of Jesus")
const ES_ROW = row("loc-birth-es", ES, "El nacimiento de Jesús")
const RU_ROW = row("loc-birth-ru", RU, "Рождение Иисуса")

function relative(documentId: string, slug: string) {
  return {
    __typename: "Video" as const,
    documentId,
    slug,
    label: "SEGMENT" as const,
    images: [],
  }
}

// The player-gating read. Every list the fragment selects is present, so the
// read below is complete for the right reason. The cache needs `__typename`,
// which the result types omit, hence `as unknown as` on each fixture.
const VIDEO_RESULT: WatchVideoData = {
  videoBySlug: {
    __typename: "Video",
    documentId: "vid-birth",
    slug: SLUG,
    label: "SEGMENT",
    images: [],
    primaryLanguage: { __typename: "Language", coreId: "529", bcp47: "en" },
    parents: [
      {
        __typename: "VideoRelation",
        parent: {
          __typename: "Video",
          documentId: "vid-jesus",
          slug: "jesus",
          label: "FEATURE_FILM",
          images: [],
          children: [
            {
              __typename: "VideoRelation",
              child: relative("vid-birth", SLUG),
            },
            {
              __typename: "VideoRelation",
              child: relative("vid-baptism", "the-baptism"),
            },
          ],
        },
      },
    ],
    variants: [],
    bibleCitations: [],
  },
} as unknown as WatchVideoData

function textResult(uiRow: ReturnType<typeof row>): VideoTextData {
  return {
    videoBySlug: {
      __typename: "Video",
      documentId: "vid-birth",
      locales: [uiRow],
      englishLocales: [EN_ROW],
      studyQuestions: [],
      englishStudyQuestions: [],
      parents: [
        {
          __typename: "VideoRelation",
          parent: {
            __typename: "Video",
            documentId: "vid-jesus",
            locales: [titleRow("loc-jesus-es", ES, "JESÚS")],
            englishLocales: [titleRow("loc-jesus-en", "english", "JESUS")],
            children: [
              {
                __typename: "VideoRelation",
                child: {
                  __typename: "Video",
                  documentId: "vid-birth",
                  locales: [titleRow(uiRow.documentId, ES, uiRow.title)],
                  englishLocales: [
                    titleRow(EN_ROW.documentId, "english", EN_ROW.title),
                  ],
                },
              },
              {
                __typename: "VideoRelation",
                child: {
                  __typename: "Video",
                  documentId: "vid-baptism",
                  locales: [],
                  englishLocales: [
                    titleRow("loc-baptism-en", "english", "The Baptism"),
                  ],
                },
              },
            ],
          },
        },
      ],
    },
  } as unknown as VideoTextData
}

function homeResult(uiRow: ReturnType<typeof row>): WatchHomeVideosData {
  return {
    watchHomeVideos: [
      {
        __typename: "Video",
        documentId: "vid-birth",
        coreId: "1_jf6101-0-0",
        slug: SLUG,
        label: "SEGMENT",
        durationSeconds: 180,
        images: [],
        locales: [uiRow],
        englishLocales: [EN_ROW],
        children: [],
      },
    ],
  } as unknown as WatchHomeVideosData
}

const esText = { slug: SLUG, textSlug: ES }

describe("GET_VIDEO_TEXT beside the language-free watch document", () => {
  it("leaves the player-gating read intact after the text write", () => {
    const cache = new InMemoryCache()
    cache.writeQuery({
      query: GET_VIDEO_BY_SLUG,
      variables: { slug: SLUG },
      data: VIDEO_RESULT,
    })
    cache.writeQuery({
      query: GET_VIDEO_TEXT,
      variables: esText,
      data: textResult(ES_ROW),
    })

    const read = cache.readQuery({
      query: GET_VIDEO_BY_SLUG,
      variables: { slug: SLUG },
    })
    expect(read?.videoBySlug?.slug).toBe(SLUG)
    expect(read?.videoBySlug?.parents?.[0]?.parent?.children).toHaveLength(2)
  })

  // The case the plan names: a Home write in another language touches the
  // same Video entity, and the watch screen's text must not move. The watch
  // screen holds the query's current result, so that is what this observes.
  it("keeps the watch text result object and title after a Home write under ru", async () => {
    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link: new ApolloLink(() => {
        throw new Error("cache-only: no request expected")
      }),
    })
    client.writeQuery({
      query: GET_VIDEO_TEXT,
      variables: esText,
      data: textResult(ES_ROW),
    })
    const watch = client.watchQuery({
      query: GET_VIDEO_TEXT,
      variables: esText,
      fetchPolicy: "cache-only",
    })
    const emitted: unknown[] = []
    const subscription = watch.subscribe((result) => emitted.push(result.data))
    await flush()
    const before = watch.getCurrentResult().data
    expect(before?.videoBySlug?.locales?.[0]?.title).toBe(
      "El nacimiento de Jesús",
    )
    const emittedBefore = emitted.length

    client.writeQuery({
      query: GET_WATCH_HOME_VIDEOS,
      variables: { coreIds: ["1_jf6101-0-0"], textSlug: RU },
      data: homeResult(RU_ROW),
    })
    await flush()
    const after = watch.getCurrentResult().data

    expect(after).toBe(before)
    expect(emitted).toHaveLength(emittedBefore)
    expect(after?.videoBySlug?.locales?.[0]?.title).toBe(
      "El nacimiento de Jesús",
    )
    subscription.unsubscribe()
  })

  // Negative control: a write that DOES change the watch rows is seen, so the
  // case above is not passing on a watcher that never updates.
  it("does see a change to the watch rows themselves (positive control)", async () => {
    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link: new ApolloLink(() => {
        throw new Error("cache-only: no request expected")
      }),
    })
    client.writeQuery({
      query: GET_VIDEO_TEXT,
      variables: esText,
      data: textResult(ES_ROW),
    })
    const watch = client.watchQuery({
      query: GET_VIDEO_TEXT,
      variables: esText,
      fetchPolicy: "cache-only",
    })
    const subscription = watch.subscribe(() => {})
    await flush()
    const before = watch.getCurrentResult().data

    client.writeQuery({
      query: GET_WATCH_HOME_VIDEOS,
      variables: { coreIds: ["1_jf6101-0-0"], textSlug: ES },
      data: homeResult({ ...ES_ROW, title: "Nacimiento (editado)" }),
    })
    await flush()

    expect(watch.getCurrentResult().data).not.toBe(before)
    expect(
      watch.getCurrentResult().data?.videoBySlug?.locales?.[0]?.title,
    ).toBe("Nacimiento (editado)")
    subscription.unsubscribe()
  })

  // One argument set (KTD10): Home's rows are the watch title's rows once a
  // warm-up of the language-free document has linked the slug to the video.
  it("serves the watch title from a Home write in the same language", () => {
    const cache = new InMemoryCache()
    cache.writeQuery({
      query: GET_WATCH_HOME_VIDEOS,
      variables: { coreIds: ["1_jf6101-0-0"], textSlug: ES },
      data: homeResult(ES_ROW),
    })
    cache.writeQuery({
      query: GET_VIDEO_BY_SLUG,
      variables: { slug: SLUG },
      data: VIDEO_RESULT,
    })

    const diff = cache.diff<VideoTextData>({
      query: GET_VIDEO_TEXT,
      variables: esText,
      returnPartialData: true,
      optimistic: false,
    })

    // Incomplete only because Home selects no parent titles.
    expect(diff.complete).toBe(false)
    expect(diff.result?.videoBySlug?.locales?.[0]?.title).toBe(
      "El nacimiento de Jesús",
    )
    expect(diff.result?.videoBySlug?.englishLocales?.[0]?.title).toBe(
      "The Birth of Jesus",
    )
  })
})

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

// ── GET_SERIES_TEXT beside GET_SERIES_BY_SLUG ───────────────────────────────

const SERIES_SLUG = "the-chosen"

function episode(documentId: string, slug: string) {
  return {
    __typename: "Video" as const,
    documentId,
    slug,
    label: "EPISODE" as const,
    durationSeconds: 60,
    images: [],
  }
}

const SERIES_RESULT: SeriesVideoData = {
  videoBySlug: {
    __typename: "Video",
    documentId: "vid-series",
    slug: SERIES_SLUG,
    label: "SERIES",
    images: [],
    primaryLanguage: { __typename: "Language", coreId: "529", bcp47: "en" },
    variants: [],
    studyQuestions: [],
    bibleCitations: [],
    children: [
      { __typename: "VideoRelation", order: 1, child: episode("ep-1", "ep-1") },
      { __typename: "VideoRelation", order: 2, child: episode("ep-2", "ep-2") },
    ],
    childDubLanguages: [],
  },
} as unknown as SeriesVideoData

const SERIES_TEXT_RESULT: SeriesTextData = {
  videoBySlug: {
    __typename: "Video",
    documentId: "vid-series",
    locales: [row("loc-series-es", ES, "Los elegidos")],
    englishLocales: [row("loc-series-en", "english", "The Chosen")],
    children: [
      {
        __typename: "VideoRelation",
        order: 1,
        child: {
          __typename: "Video",
          documentId: "ep-1",
          locales: [titleRow("loc-ep1-es", ES, "Episodio 1")],
          englishLocales: [titleRow("loc-ep1-en", "english", "Episode 1")],
        },
      },
      {
        __typename: "VideoRelation",
        order: 2,
        child: {
          __typename: "Video",
          documentId: "ep-2",
          locales: [],
          englishLocales: [titleRow("loc-ep2-en", "english", "Episode 2")],
        },
      },
    ],
  },
} as unknown as SeriesTextData

/** The shipped series companion with `order` removed and nothing else. */
function seriesTextWithoutOrder(): DocumentNode {
  const sdl = print(GET_SERIES_TEXT as DocumentNode)
  const stripped = sdl.replace(/\n\s*order\n/, "\n")
  expect(stripped).not.toBe(sdl)
  return parse(stripped)
}

describe("GET_SERIES_TEXT beside the language-free series document", () => {
  it("keeps the episode order in the series read after the text write", () => {
    const cache = new InMemoryCache()
    cache.writeQuery({
      query: GET_SERIES_BY_SLUG,
      variables: { slug: SERIES_SLUG },
      data: SERIES_RESULT,
    })
    cache.writeQuery({
      query: GET_SERIES_TEXT,
      variables: { slug: SERIES_SLUG, textSlug: ES },
      data: SERIES_TEXT_RESULT,
    })

    const read = cache.readQuery({
      query: GET_SERIES_BY_SLUG,
      variables: { slug: SERIES_SLUG },
    })
    expect(read?.videoBySlug?.children?.map((rel) => rel.order)).toEqual([1, 2])
  })

  // The mechanism, not only the outcome: a `children { child }` write
  // replaces the list and the series read loses `order`. If this case ever
  // goes green, the relation-shape comment in queries.ts is out of date.
  it("loses the series read when the text write drops `order`", () => {
    const cache = new InMemoryCache()
    cache.writeQuery({
      query: GET_SERIES_BY_SLUG,
      variables: { slug: SERIES_SLUG },
      data: SERIES_RESULT,
    })
    const withoutOrder = {
      videoBySlug: {
        ...SERIES_TEXT_RESULT.videoBySlug,
        children: SERIES_TEXT_RESULT.videoBySlug?.children?.map((rel) => ({
          __typename: "VideoRelation",
          child: rel.child,
        })),
      },
    }
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {})
    const error = jest.spyOn(console, "error").mockImplementation(() => {})
    cache.writeQuery({
      query: seriesTextWithoutOrder(),
      variables: { slug: SERIES_SLUG, textSlug: ES },
      data: withoutOrder,
    })
    warn.mockRestore()
    error.mockRestore()

    const diff = cache.diff({
      query: GET_SERIES_BY_SLUG,
      variables: { slug: SERIES_SLUG },
      optimistic: false,
      returnPartialData: true,
    })
    expect(diff.complete).toBe(false)
  })
})
