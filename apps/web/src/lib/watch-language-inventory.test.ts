/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const { getWatchRouteManifestMock, queryMock } = vi.hoisted(() => ({
  getWatchRouteManifestMock: vi.fn(),
  queryMock: vi.fn(),
}))

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}))

vi.mock("@/lib/admin-client", () => ({
  default: {
    query: queryMock,
  },
}))

vi.mock("@/lib/watch-route-manifest", () => ({
  getWatchRouteManifest: getWatchRouteManifestMock,
}))

import {
  inventoryAgeDays,
  inventoryLengthBucket,
  inventoryTypeGroup,
  isNewRelease,
  publishedAtSortTime,
  resolveWatchLanguageInventory,
} from "./watch-language-inventory"

function inventoryItem({
  availability,
  id,
  parentSlug = null,
  slug,
  watchLanguageSlug,
}: {
  availability: "AUDIO" | "SUBTITLE_ONLY"
  id: string
  parentSlug?: string | null
  slug: string
  watchLanguageSlug: string
}) {
  return {
    id,
    coreId: id,
    slug,
    title: id,
    description: null,
    imageUrl: null,
    imageAlt: null,
    label: "SEGMENT",
    availability,
    watchLanguageSlug,
    parentSlug,
    parentTitle: parentSlug,
    parentOrder: null,
    durationSeconds: 60,
    childCount: 0,
    publishedAt: null,
    createdAt: null,
    updatedAt: null,
  }
}

function mockInventory({
  fallbackAudioLanguageSlug = "english",
  languageSlug,
  resolvedLanguageSlug = languageSlug,
}: {
  fallbackAudioLanguageSlug?: string
  languageSlug: string
  resolvedLanguageSlug?: string
}) {
  queryMock
    .mockResolvedValueOnce({
      data: {
        watchLanguageInventory: {
          language: {
            slug: resolvedLanguageSlug,
            bcp47: languageSlug === "russian" ? "ru" : "zh-Hans",
            name: { en: languageSlug },
          },
          counts: {
            audioCollections: 0,
            audioVideos: 1,
            subtitleOnlyVideos: 2,
            total: 3,
          },
          promoted: [],
          audioCollections: [],
          audioVideos: [
            inventoryItem({
              availability: "AUDIO",
              id: "dubbed-video",
              slug: "dubbed-video",
              watchLanguageSlug: languageSlug,
            }),
          ],
          subtitleOnlyVideos: [
            inventoryItem({
              availability: "SUBTITLE_ONLY",
              id: "standalone-subtitle",
              slug: "standalone-subtitle",
              watchLanguageSlug: fallbackAudioLanguageSlug,
            }),
            inventoryItem({
              availability: "SUBTITLE_ONLY",
              id: "episode-subtitle",
              parentSlug: "series",
              slug: "episode-subtitle",
              watchLanguageSlug: fallbackAudioLanguageSlug,
            }),
          ],
        },
      },
    })
    .mockResolvedValueOnce({ data: { languages: [] } })
}

describe("resolveWatchLanguageInventory", () => {
  beforeEach(() => {
    queryMock.mockReset()
    getWatchRouteManifestMock.mockReset()
    getWatchRouteManifestMock.mockResolvedValue(null)
  })

  it.each([
    {
      languageSlug: "chinese-simplified",
      fallbackAudioLanguageSlug: "english",
      expectedStandaloneHref:
        "/standalone-subtitle.html?subtitles=chinese-simplified",
      expectedEpisodeHref:
        "/series.html/episode-subtitle.html?subtitles=chinese-simplified",
    },
    {
      languageSlug: "russian",
      fallbackAudioLanguageSlug: "arabic-modern-standard",
      expectedStandaloneHref:
        "/standalone-subtitle.html/arabic-modern-standard.html?subtitles=russian",
      expectedEpisodeHref:
        "/series.html/episode-subtitle/arabic-modern-standard.html?subtitles=russian",
    },
  ])(
    "carries $languageSlug subtitle intent on subtitle-only fallback-audio routes",
    async ({
      languageSlug,
      fallbackAudioLanguageSlug,
      expectedStandaloneHref,
      expectedEpisodeHref,
    }) => {
      mockInventory({ languageSlug, fallbackAudioLanguageSlug })

      const inventory = await resolveWatchLanguageInventory("en", languageSlug)

      expect(inventory.audioVideos[0]?.href).toBe(
        `/dubbed-video.html/${languageSlug}.html`,
      )
      expect(inventory.subtitleOnlyVideos.map((item) => item.href)).toEqual([
        expectedStandaloneHref,
        expectedEpisodeHref,
      ])
    },
  )

  it("does not build subtitle links from an invalid resolved language slug", async () => {
    mockInventory({
      languageSlug: "russian",
      resolvedLanguageSlug: "Russian!",
    })

    const inventory = await resolveWatchLanguageInventory("en", "russian")

    expect(inventory.audioVideos[0]?.href).toBe(
      "/dubbed-video.html/russian.html",
    )
    expect(inventory.subtitleOnlyVideos.map((item) => item.href)).toEqual([
      null,
      null,
    ])
  })
})

describe("resolveWatchLanguageInventory — collection language counts", () => {
  // Routes each Admin call by its variables rather than by call ORDER, so these
  // stay valid if the resolver reorders its fetches.
  function routeQueries({
    counts,
    collectionSlugs,
  }: {
    counts?:
      | {
          slug: string
          audioLanguageCount: number
          subtitleLanguageCount: number
        }[]
      | Error
    collectionSlugs: string[]
  }) {
    const countsCalls: string[][] = []
    queryMock.mockImplementation(
      async ({ variables }: { variables: Record<string, unknown> }) => {
        if ("slugs" in variables) {
          countsCalls.push(variables.slugs as string[])
          if (counts instanceof Error) throw counts
          return { data: { watchCollectionLanguageCounts: counts ?? [] } }
        }
        if ("offset" in variables) return { data: { languages: [] } }
        return {
          data: {
            watchLanguageInventory: {
              language: {
                slug: "english",
                bcp47: "en",
                name: { en: "English" },
              },
              counts: {
                audioCollections: collectionSlugs.length,
                audioVideos: collectionSlugs.length,
                subtitleOnlyVideos: 0,
                total: collectionSlugs.length * 2,
              },
              promoted: [],
              audioCollections: collectionSlugs.map((slug) =>
                inventoryItem({
                  availability: "AUDIO",
                  id: slug,
                  slug,
                  watchLanguageSlug: "english",
                }),
              ),
              audioVideos: collectionSlugs.map((slug) =>
                inventoryItem({
                  availability: "AUDIO",
                  id: `${slug}-episode`,
                  parentSlug: slug,
                  slug: `${slug}-episode`,
                  watchLanguageSlug: "english",
                }),
              ),
              subtitleOnlyVideos: [],
            },
          },
        }
      },
    )
    return { countsCalls }
  }

  beforeEach(() => {
    queryMock.mockReset()
    getWatchRouteManifestMock.mockReset()
    getWatchRouteManifestMock.mockResolvedValue(null)
  })

  it("joins counts back by slug, not by response order", async () => {
    // Admin returns these in an order unrelated to the request, and omits
    // unknown slugs — verified against the real resolver, which answered
    // [relationships, jesus] for a [jesus, relationships, ...] request.
    routeQueries({
      collectionSlugs: ["jesus", "relationships"],
      counts: [
        {
          slug: "relationships",
          audioLanguageCount: 2282,
          subtitleLanguageCount: 89,
        },
        { slug: "jesus", audioLanguageCount: 2267, subtitleLanguageCount: 0 },
      ],
    })

    const model = await resolveWatchLanguageInventory("en", "english")

    expect(model.collectionLanguageCounts).toEqual({
      jesus: { audioLanguageCount: 2267, subtitleLanguageCount: 0 },
      relationships: { audioLanguageCount: 2282, subtitleLanguageCount: 89 },
    })
  })

  it("omits collections Admin did not return", async () => {
    routeQueries({
      collectionSlugs: ["known", "missing"],
      counts: [
        { slug: "known", audioLanguageCount: 7, subtitleLanguageCount: 2 },
      ],
    })

    const model = await resolveWatchLanguageInventory("en", "english")

    expect(Object.keys(model.collectionLanguageCounts)).toEqual(["known"])
    expect(model.collectionLanguageCounts.missing).toBeUndefined()
  })

  it("still resolves the page when the counts query fails", async () => {
    routeQueries({
      collectionSlugs: ["jesus"],
      counts: new Error("statement timeout"),
    })

    const model = await resolveWatchLanguageInventory("en", "english")

    // The indicator is decoration: its failure must not cost the page.
    expect(model.collectionLanguageCounts).toEqual({})
    expect(model.audioCollections).toHaveLength(1)
    expect(model.audioVideos).toHaveLength(1)
  })

  it("skips the round trip entirely when there are no collections", async () => {
    const { countsCalls } = routeQueries({ collectionSlugs: [] })

    const model = await resolveWatchLanguageInventory("en", "english")

    expect(countsCalls).toEqual([])
    expect(model.collectionLanguageCounts).toEqual({})
  })

  it("requests exactly the collection slugs on the page", async () => {
    const { countsCalls } = routeQueries({
      collectionSlugs: ["alpha", "beta"],
      counts: [],
    })

    await resolveWatchLanguageInventory("en", "english")

    expect(countsCalls).toEqual([["alpha", "beta"]])
  })
})

describe("inventory filter facets", () => {
  describe("inventoryLengthBucket", () => {
    it("buckets by the real duration distribution", () => {
      // Boundaries chosen from a production snapshot (2026-08-27): <2min 244,
      // 2-5min 423, 5-10min 284, 10-30min 37, 30-60min 1, 60+ 13. The single
      // 30-60min item is why 30+ is one bucket, not two.
      expect(inventoryLengthBucket(60)).toBe("under5")
      expect(inventoryLengthBucket(299)).toBe("under5")
      expect(inventoryLengthBucket(300)).toBe("5to10")
      expect(inventoryLengthBucket(599)).toBe("5to10")
      expect(inventoryLengthBucket(600)).toBe("10to30")
      expect(inventoryLengthBucket(1799)).toBe("10to30")
      expect(inventoryLengthBucket(1800)).toBe("over30")
      expect(inventoryLengthBucket(7200)).toBe("over30")
    })

    it("returns null for a missing or unusable duration", () => {
      // A card with no duration must be excluded from length filtering rather
      // than silently landing in the shortest bucket.
      expect(inventoryLengthBucket(null)).toBeNull()
      expect(inventoryLengthBucket(0)).toBeNull()
      expect(inventoryLengthBucket(-1)).toBeNull()
    })
  })

  describe("inventoryTypeGroup", () => {
    it("keeps feature and short films apart, and pairs the rest", () => {
      // Feature and short films are deliberately separate (decided 2026-08-27)
      // even though `featureFilm` is only 12 English items against
      // `shortFilm`'s 171 — telling a full film from a short is the point of
      // the filter. `episode`/`segment` and `series`/`collection` still pair,
      // because those are internal bookkeeping, not a viewer's choice.
      expect(inventoryTypeGroup("featureFilm")).toBe("featureFilm")
      expect(inventoryTypeGroup("shortFilm")).toBe("shortFilm")
      expect(inventoryTypeGroup("featureFilm")).not.toBe(
        inventoryTypeGroup("shortFilm"),
      )
      expect(inventoryTypeGroup("episode")).toBe("episode")
      expect(inventoryTypeGroup("segment")).toBe("episode")
      expect(inventoryTypeGroup("series")).toBe("collection")
      expect(inventoryTypeGroup("collection")).toBe("collection")
    })

    it("returns null for an unknown or absent label", () => {
      // Admin serves `label` as a raw pass-through string, so an added enum
      // member must drop out of filtering rather than be mis-grouped.
      expect(inventoryTypeGroup(null)).toBeNull()
      expect(inventoryTypeGroup("")).toBeNull()
      expect(inventoryTypeGroup("behindTheScenes")).toBeNull()
      expect(inventoryTypeGroup("trailer")).toBeNull()
    })
  })
})

describe("implausible future publish dates", () => {
  const now = new Date("2026-08-27T12:00:00Z")

  it("still accepts a just-future date-only midnight", () => {
    // Admin stores date-only publish dates at midnight UTC, so a renderer
    // behind that boundary legitimately sees "tomorrow".
    expect(isNewRelease("2026-08-28 00:00:00+00", now)).toBe(true)
    expect(inventoryAgeDays("2026-08-28 00:00:00+00", now)).toBe(0)
    expect(publishedAtSortTime("2026-08-28 00:00:00+00", now)).not.toBeNaN()
  })

  it("rejects a date far enough ahead to be a data error", () => {
    // Left unbounded, one bad row would sort to the top of the page, take the
    // hero through the first-collection rule, and wear a NEW badge forever.
    for (const bogus of [
      "2026-09-30 00:00:00+00",
      "2027-01-01 00:00:00+00",
      "2126-08-27 00:00:00+00",
    ]) {
      expect(isNewRelease(bogus, now)).toBe(false)
      expect(inventoryAgeDays(bogus, now)).toBeNull()
      expect(publishedAtSortTime(bogus, now)).toBeNaN()
    }
  })

  it("keeps the badge, the sort, and the age windows on one rule", () => {
    // A row the sort refuses must also lose its badge and drop out of every
    // window — three surfaces, one bound.
    const bogus = "2027-06-01 00:00:00+00"
    expect(publishedAtSortTime(bogus, now)).toBeNaN()
    expect(isNewRelease(bogus, now)).toBe(false)
    expect(inventoryAgeDays(bogus, now)).toBeNull()
  })
})
