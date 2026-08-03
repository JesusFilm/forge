import { beforeEach, describe, expect, it, vi } from "vitest"

const searchMock = vi.hoisted(() => vi.fn())

vi.mock("@/services/watch-search.service", () => ({
  WatchSearchService: class {
    search = searchMock
  },
}))

import {
  fetchVideoImageForAgent,
  lookupBibleVerseForAgent,
  searchVideosForAgent,
  searchVideosRequestSchema,
  lookupBibleVerseRequestSchema,
} from "./agent-tools.service"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrisma = any

describe("searchVideosForAgent", () => {
  beforeEach(() => searchMock.mockReset())

  it("searches contentTypes:['video'] and drops playbackId-null rows (R7 — unplayable videos never reach the agent)", async () => {
    searchMock.mockResolvedValue({
      results: [
        {
          type: "video",
          id: "vid-1",
          slug: "jesus",
          title: "Jesus",
          imageUrl: "https://cdn/img.png",
          snippet: "About Jesus.",
          // Unplayable in the locale — must be dropped even though its
          // availability kind is the most-eligible one (the playability
          // filter is independent of kind).
          playbackId: null,
          durationSeconds: 7674,
          languageSlug: "english",
          availability: {
            kind: "target_audio",
            languageSlug: "english",
            languageEnglishName: "English",
            audio: true,
            subtitles: false,
          },
        },
        {
          type: "video",
          id: "vid-2",
          slug: "easter",
          title: "Easter",
          imageUrl: null,
          snippet: "Easter video.",
          playbackId: "pb-1", // playable — kept
          durationSeconds: 312,
          languageSlug: "english",
          availability: {
            kind: "target_audio",
            languageSlug: "english",
            languageEnglishName: "English",
            audio: true,
            subtitles: false,
          },
        },
      ],
      hasMore: false,
      query: "jesus",
      searchMode: "watch-search",
    })
    const prisma = {
      language: { findFirst: vi.fn().mockResolvedValue({ slug: "english" }) },
    } as AnyPrisma

    const result = await searchVideosForAgent(prisma, {
      q: "jesus",
      locale: "en",
      limit: 5,
    })

    expect(searchMock).toHaveBeenCalledWith({
      query: "jesus",
      targetLanguageSlug: "english",
      displayLanguageSlug: "english",
      routeLanguageSlug: "english",
      acceptLanguage: "en",
      limit: 5,
      resultTypes: ["video"],
    })
    // ONLY the playable row survives — this is the assertion a deleted filter
    // would fail (the null-playback row would leak through). toStrictEqual +
    // populated fixture fields so the playback-field projection is really
    // pinned (toEqual ignores undefined-valued keys). The fixture's
    // availability carries the FULL upstream object so this also pins the
    // { kind }-only projection — passing result.availability through whole
    // would leak languageSlug/audio/subtitles and fail here.
    expect(result.videos).toStrictEqual([
      {
        videoId: "vid-2",
        title: "Easter",
        snippet: "Easter video.",
        slug: "easter",
        imageUrl: null,
        playbackId: "pb-1",
        durationSeconds: 312,
        languageSlug: "english",
        availability: { kind: "target_audio" },
      },
    ])
  })

  it("projects fallback availability kinds verbatim — admin reports kind, it never filters by it (feat-326/P6)", async () => {
    // A playable target_subtitle row is the E10 blind spot: an
    // all-target_audio fixture set leaves a kind filter vacuously green.
    // Seeker's target_audio-only policy lives in mastra (feat-327), NOT here.
    searchMock.mockResolvedValue({
      results: [
        {
          type: "video",
          id: "vid-1",
          slug: "jesus",
          title: "Jesus",
          imageUrl: "https://cdn/img.png",
          snippet: "About Jesus.",
          playbackId: "pb-1",
          durationSeconds: 7674,
          languageSlug: "english",
          availability: {
            kind: "target_audio",
            languageSlug: "english",
            languageEnglishName: "English",
            audio: true,
            subtitles: false,
          },
        },
        {
          type: "video",
          id: "vid-2",
          slug: "easter",
          title: "Easter",
          imageUrl: null,
          snippet: "Easter video.",
          // Playable FALLBACK row. Deliberately synthetic:
          // watchabilityFromSubtitle (search-watchability.ts) hardcodes
          // playbackId null (verified by hand 2026-08-03; re-check if
          // watchability changes), so a playable target_subtitle row cannot
          // reach this projection in production today. The fixture pins the
          // no-kind-filter contract for ALL kinds — including ones only a
          // future upstream change could make playable. playbackId is the
          // single deliberate synthetic divergence; every other field pair
          // stays producer-consistent.
          playbackId: "pb-2",
          durationSeconds: 312,
          languageSlug: "french",
          availability: {
            kind: "target_subtitle",
            languageSlug: "french",
            languageEnglishName: "French",
            audio: false,
            subtitles: true,
          },
        },
      ],
      hasMore: false,
      query: "jesus",
      searchMode: "watch-search",
    })
    const prisma = {
      language: { findFirst: vi.fn().mockResolvedValue({ slug: "french" }) },
    } as AnyPrisma

    const result = await searchVideosForAgent(prisma, {
      q: "jesus",
      locale: "fr",
      limit: 5,
    })

    expect(result.videos).toStrictEqual([
      {
        videoId: "vid-1",
        title: "Jesus",
        snippet: "About Jesus.",
        slug: "jesus",
        imageUrl: "https://cdn/img.png",
        playbackId: "pb-1",
        durationSeconds: 7674,
        languageSlug: "english",
        availability: { kind: "target_audio" },
      },
      {
        videoId: "vid-2",
        title: "Easter",
        snippet: "Easter video.",
        slug: "easter",
        imageUrl: null,
        playbackId: "pb-2",
        durationSeconds: 312,
        languageSlug: "french",
        availability: { kind: "target_subtitle" },
      },
    ])
  })

  it("projects explicit nulls for durationSeconds/languageSlug on a playable row (post-#1789 regression)", async () => {
    searchMock.mockResolvedValue({
      results: [
        {
          type: "video",
          id: "vid-3",
          slug: "hope",
          title: "Hope",
          imageUrl: null,
          snippet: "Hope video.",
          playbackId: "pb-3",
          durationSeconds: null,
          languageSlug: null,
          availability: {
            kind: "related_language",
            languageSlug: "french",
            languageEnglishName: "French",
            audio: true,
            subtitles: false,
          },
        },
      ],
      hasMore: false,
      query: "hope",
      searchMode: "watch-search",
    })
    const prisma = {
      language: { findFirst: vi.fn().mockResolvedValue({ slug: "english" }) },
    } as AnyPrisma

    const result = await searchVideosForAgent(prisma, {
      q: "hope",
      locale: "en",
      limit: 5,
    })

    expect(result.videos).toStrictEqual([
      {
        videoId: "vid-3",
        title: "Hope",
        snippet: "Hope video.",
        slug: "hope",
        imageUrl: null,
        playbackId: "pb-3",
        durationSeconds: null,
        languageSlug: null,
        availability: { kind: "related_language" },
      },
    ])
  })

  it("clamps an over-cap limit at the schema boundary (max 20) and defaults to 8", () => {
    // The request schema is the server-side re-assertion of the cap; the
    // caller (mastra) is untrusted.
    expect(
      searchVideosRequestSchema.safeParse({ q: "x", locale: "en", limit: 999 })
        .success,
    ).toBe(false)
    expect(
      searchVideosRequestSchema.parse({ q: "x", locale: "en" }).limit,
    ).toBe(8)
  })
})

describe("lookupBibleVerseForAgent", () => {
  function makePrisma(rows: unknown[]) {
    return {
      bibleBook: { findMany: vi.fn().mockResolvedValue(rows) },
    } as AnyPrisma
  }

  it("OR-matches osisId / paratextAbbreviation / alternateName, orders by order asc, and caps via take", async () => {
    const prisma = makePrisma([])
    await lookupBibleVerseForAgent(prisma, {
      query: "John",
      locale: "en",
      limit: 3,
    })
    const args = prisma.bibleBook.findMany.mock.calls[0][0]
    expect(args.orderBy).toEqual({ order: "asc" })
    expect(args.take).toBe(3)
    expect(args.where.deletedAt).toBeNull()
    expect(args.where.OR).toEqual([
      { osisId: { equals: "John", mode: "insensitive" } },
      { paratextAbbreviation: { equals: "John", mode: "insensitive" } },
      { alternateName: { contains: "John", mode: "insensitive" } },
    ])
  })

  it("resolves displayName via locale → BCP-47 base → en → raw-query fallback", async () => {
    const prisma = makePrisma([
      {
        id: "b1",
        osisId: "John",
        name: { en: "John", es: "Juan", fr: "Jean" },
        testament: "NT",
        order: 43,
      },
      {
        id: "b2",
        osisId: "Mark",
        name: { en: "Mark" }, // no fr — falls back to en
        testament: "NT",
        order: 41,
      },
      {
        id: "b3",
        osisId: "Luke",
        name: "not-a-map", // unparseable — falls back to the raw query
        testament: "NT",
        order: 42,
      },
    ])
    const result = await lookupBibleVerseForAgent(prisma, {
      query: "the-query",
      locale: "fr-CA",
      limit: 3,
    })
    // b1: fr-CA → base "fr" → "Jean"
    expect(result.books[0].displayName).toBe("Jean")
    // b2: no fr → en → "Mark"
    expect(result.books[1].displayName).toBe("Mark")
    // b3: name not a map → raw query
    expect(result.books[2].displayName).toBe("the-query")
  })

  it("defaults locale to en and limit to 3 at the schema boundary", () => {
    const parsed = lookupBibleVerseRequestSchema.parse({ query: "John" })
    expect(parsed.locale).toBe("en")
    expect(parsed.limit).toBe(3)
  })
})

describe("fetchVideoImageForAgent", () => {
  function makePrisma(images: unknown[]) {
    return {
      videoImage: { findMany: vi.fn().mockResolvedValue(images) },
    } as AnyPrisma
  }

  it("returns the first non-empty by VARIANT_PRIORITY (mobileCinematicHigh wins over thumbnail)", async () => {
    const result = await fetchVideoImageForAgent(
      makePrisma([
        {
          mobileCinematicHigh: "https://cdn/hero.png",
          videoStill: null,
          thumbnail: "https://cdn/thumb.png",
          url: "https://cdn/legacy.png",
        },
      ]),
      { videoId: "v1" },
    )
    expect(result).toEqual({
      imageUrl: "https://cdn/hero.png",
      variant: "mobileCinematicHigh",
    })
  })

  it("falls through priority to the first populated lower variant", async () => {
    const result = await fetchVideoImageForAgent(
      makePrisma([
        {
          mobileCinematicHigh: null,
          videoStill: "",
          thumbnail: "https://cdn/thumb.png",
          url: "https://cdn/legacy.png",
        },
      ]),
      { videoId: "v1" },
    )
    expect(result).toEqual({
      imageUrl: "https://cdn/thumb.png",
      variant: "thumbnail",
    })
  })

  it("returns null/null when the video has no images", async () => {
    const result = await fetchVideoImageForAgent(makePrisma([]), {
      videoId: "v1",
    })
    expect(result).toEqual({ imageUrl: null, variant: null })
  })

  it("returns null/null when images exist but no priority variant is populated", async () => {
    const result = await fetchVideoImageForAgent(
      makePrisma([
        { mobileCinematicHigh: null, videoStill: null, thumbnail: "", url: "" },
      ]),
      { videoId: "v1" },
    )
    expect(result).toEqual({ imageUrl: null, variant: null })
  })
})
