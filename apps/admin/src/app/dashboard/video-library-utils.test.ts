import { describe, expect, it } from "vitest"
import type { WatchRouteManifest } from "@/services/watch-route-manifest.service"
import {
  buildVideoVisitorUrl,
  createVideoLibraryPagination,
  formatVideoUpdatedRelative,
  hasActiveVideoLibraryFilters,
  isPublicAudioLanguageSlug,
  matchesVideoLibraryCategory,
  normalizeVideoThumbnailUrl,
  parseVideoLibraryCategory,
  parseVideoLibraryCollection,
  parseVideoLibraryLanguage,
  parseVideoLibraryPage,
  parseVideoLibraryQuery,
  parseVideoLibrarySelectedVideo,
  parseVideoLibrarySort,
  resolveVideoVisitorUrl,
  videoLibraryHref,
} from "./video-library-utils"

const manifest: WatchRouteManifest = {
  version: "test",
  generatedAt: "2026-06-01T00:00:00.000Z",
  contentSlugs: ["jesus", "collection"],
  oneSegmentSlugs: [],
  episodePairsByParent: {},
  audioLanguageSlugs: ["spanish-castilian", "english", "en"],
  audioLanguageIndexesByContent: {
    jesus: [0, 1],
    collection: [2],
  },
  audioLanguageIndexesByEpisode: {},
  nestedContainerAudioLanguageIndexesByParent: {},
}

describe("video-library-utils", () => {
  it("parses invalid, empty, and negative page params as page 1", () => {
    expect(parseVideoLibraryPage(undefined)).toBe(1)
    expect(parseVideoLibraryPage("abc")).toBe(1)
    expect(parseVideoLibraryPage("0")).toBe(1)
    expect(parseVideoLibraryPage("-2")).toBe(1)
  })

  it("normalizes video library search queries for URL-backed filtering", () => {
    expect(parseVideoLibraryQuery(undefined)).toBe("")
    expect(parseVideoLibraryQuery(["  Jesus   Film  ", "ignored"])).toBe(
      "Jesus Film",
    )
    expect(parseVideoLibraryQuery("x".repeat(140))).toHaveLength(120)
  })

  it("builds video library hrefs while preserving search query state", () => {
    expect(videoLibraryHref({ page: 1, query: "" })).toBe("/dashboard/videos")
    expect(videoLibraryHref({ page: 2, query: "Jesus Film" })).toBe(
      "/dashboard/videos?page=2&q=Jesus+Film",
    )
    expect(videoLibraryHref({ page: 1, query: "  mux  " })).toBe(
      "/dashboard/videos?q=mux",
    )
  })

  it("normalizes video library category, language, and sort params", () => {
    expect(parseVideoLibraryCategory("features")).toBe("features")
    expect(parseVideoLibraryCategory("episodes")).toBe("episodes")
    expect(parseVideoLibraryCategory("bad")).toBe("all")
    expect(parseVideoLibraryCategory(["series", "features"])).toBe("series")

    expect(parseVideoLibraryLanguage(["  Spanish   Castilian  "])).toBe(
      "Spanish Castilian",
    )
    expect(parseVideoLibraryLanguage("x".repeat(140))).toHaveLength(120)

    expect(parseVideoLibrarySort("created")).toBe("created")
    expect(parseVideoLibrarySort("bad")).toBe("recent")
  })

  it("matches canonical video labels to library categories", () => {
    expect(matchesVideoLibraryCategory("COLLECTION", "collections")).toBe(true)
    expect(matchesVideoLibraryCategory("EPISODE", "episodes")).toBe(true)
    expect(matchesVideoLibraryCategory("FEATURE_FILM", "features")).toBe(true)
    expect(matchesVideoLibraryCategory("SHORT_FILM", "shortFilms")).toBe(true)
    expect(matchesVideoLibraryCategory("SERIES", "series")).toBe(true)
    expect(matchesVideoLibraryCategory("SERIES", "collections")).toBe(false)
    expect(matchesVideoLibraryCategory("COLLECTION", "episodes")).toBe(false)
    expect(matchesVideoLibraryCategory(null, "features")).toBe(false)
    expect(matchesVideoLibraryCategory(null, "all")).toBe(true)
  })

  it("normalizes selected video and collection params for URL-backed drill-down", () => {
    expect(parseVideoLibrarySelectedVideo(" the-savior ")).toBe("the-savior")
    expect(parseVideoLibraryCollection(["magdalena-2", "ignored"])).toBe(
      "magdalena-2",
    )
    expect(parseVideoLibrarySelectedVideo("core_123")).toBe("core_123")
    expect(parseVideoLibraryCollection("bad value")).toBe("")
    expect(parseVideoLibrarySelectedVideo("/bad")).toBe("")
    expect(parseVideoLibraryCollection("x".repeat(160))).toHaveLength(140)
  })

  it("builds video library hrefs for active controls while omitting defaults", () => {
    expect(
      videoLibraryHref({
        page: 1,
        query: "Jesus",
        category: "features",
        language: "english",
        sort: "created",
      }),
    ).toBe(
      "/dashboard/videos?q=Jesus&type=features&language=english&sort=created",
    )

    expect(
      videoLibraryHref({
        page: 1,
        category: "all",
        language: "",
        sort: "recent",
      }),
    ).toBe("/dashboard/videos")
  })

  it("builds video library hrefs for selected videos and collections", () => {
    expect(
      videoLibraryHref({
        page: 2,
        query: "Jesus",
        category: "features",
        language: "english",
        collection: "the-story",
        video: "magdalena-2",
        sort: "created",
      }),
    ).toBe(
      "/dashboard/videos?page=2&q=Jesus&type=features&language=english&collection=the-story&video=magdalena-2&sort=created",
    )

    expect(
      videoLibraryHref({
        page: 1,
        collection: "the-story",
        video: "",
      }),
    ).toBe("/dashboard/videos?collection=the-story")
  })

  it("detects active video library filters excluding sort-only changes", () => {
    expect(
      hasActiveVideoLibraryFilters({
        query: "",
        category: "all",
        language: "",
      }),
    ).toBe(false)
    expect(
      hasActiveVideoLibraryFilters({
        query: "",
        category: "series",
        language: "",
      }),
    ).toBe(true)
    expect(
      hasActiveVideoLibraryFilters({
        query: "",
        category: "all",
        language: "english",
      }),
    ).toBe(true)
    expect(
      hasActiveVideoLibraryFilters({
        query: "",
        category: "all",
        collection: "the-story",
        language: "",
      }),
    ).toBe(true)
  })

  it("clamps pagination beyond the final page", () => {
    expect(
      createVideoLibraryPagination({
        total: 61,
        requestedPage: 99,
        pageSize: 30,
      }),
    ).toMatchObject({
      currentPage: 3,
      pageCount: 3,
      offset: 60,
      rangeStart: 61,
      rangeEnd: 61,
      hasNext: false,
      hasPrevious: true,
    })
  })

  it("keeps zero-result pagination safe", () => {
    expect(
      createVideoLibraryPagination({
        total: 0,
        requestedPage: 2,
        pageSize: 30,
      }),
    ).toMatchObject({
      currentPage: 1,
      pageCount: 1,
      offset: 0,
      rangeStart: 0,
      rangeEnd: 0,
      hasNext: false,
      hasPrevious: false,
    })
  })

  it("keeps non-finite direct pagination callers on page 1", () => {
    expect(
      createVideoLibraryPagination({
        total: 90,
        requestedPage: Number.NaN,
        pageSize: 30,
      }),
    ).toMatchObject({
      currentPage: 1,
      offset: 0,
      rangeStart: 1,
      rangeEnd: 30,
    })
  })

  it("formats updated timestamps as relative ago labels", () => {
    const now = new Date("2026-06-02T12:00:00.000Z")

    expect(
      formatVideoUpdatedRelative(new Date("2026-06-02T11:59:30.000Z"), now),
    ).toBe("just now")
    expect(
      formatVideoUpdatedRelative(new Date("2026-06-02T10:00:00.000Z"), now),
    ).toBe("2 hours ago")
    expect(
      formatVideoUpdatedRelative(new Date("2026-05-22T21:29:00.000Z"), now),
    ).toBe("11 days ago")
  })

  it("rejects BCP-47-like values as public audio language slugs", () => {
    expect(isPublicAudioLanguageSlug("en")).toBe(false)
    expect(isPublicAudioLanguageSlug("pt-br")).toBe(false)
    expect(isPublicAudioLanguageSlug("english")).toBe(true)
    expect(isPublicAudioLanguageSlug("spanish-castilian")).toBe(true)
  })

  it("adds the public Cloudflare Image Delivery variant when one is missing", () => {
    expect(
      normalizeVideoThumbnailUrl(
        "https://imagedelivery.net/tMY86qEHFACTO8_0kAeRFA/0ec667e3-7f67-4158-f2cb-054e665e4800",
      ),
    ).toBe(
      "https://imagedelivery.net/tMY86qEHFACTO8_0kAeRFA/0ec667e3-7f67-4158-f2cb-054e665e4800/public",
    )
  })

  it("keeps existing image variants and non-Cloudflare URLs unchanged", () => {
    expect(
      normalizeVideoThumbnailUrl(
        "https://imagedelivery.net/tMY86qEHFACTO8_0kAeRFA/poster.videoStill.jpg/public",
      ),
    ).toBe(
      "https://imagedelivery.net/tMY86qEHFACTO8_0kAeRFA/poster.videoStill.jpg/public",
    )
    expect(
      normalizeVideoThumbnailUrl("https://images.example.com/neon.jpg"),
    ).toBe("https://images.example.com/neon.jpg")
  })

  it("builds absolute visitor URLs from public watch slugs", () => {
    expect(
      buildVideoVisitorUrl({
        contentSlug: "jesus",
        languageSlug: "english",
        webOrigin: "https://www.jesusfilm.org/",
      }),
    ).toBe("https://www.jesusfilm.org/watch/jesus.html")
    expect(
      buildVideoVisitorUrl({
        contentSlug: "russian",
        languageSlug: "english",
        webOrigin: "https://www.jesusfilm.org/",
      }),
    ).toBe("https://www.jesusfilm.org/watch/russian.html/english.html")
    expect(
      buildVideoVisitorUrl({
        contentSlug: "jesus",
        languageSlug: "romanian",
        webOrigin: "https://www.jesusfilm.org/",
      }),
    ).toBe("https://www.jesusfilm.org/watch/jesus.html/romanian.html")
  })

  it("normalizes visitor URL origins before appending watch paths", () => {
    expect(
      buildVideoVisitorUrl({
        contentSlug: "jesus",
        languageSlug: "english",
        webOrigin: "https://example.com/root?ignored=true",
      }),
    ).toBe("https://example.com/watch/jesus.html")
  })

  it("does not emit visitor URLs from non-HTTP origins", () => {
    expect(
      buildVideoVisitorUrl({
        contentSlug: "jesus",
        languageSlug: "english",
        webOrigin: "ftp://example.com",
      }),
    ).toBeNull()
  })

  it("prefers manifest-backed public language slugs", () => {
    expect(
      resolveVideoVisitorUrl({
        contentSlug: "jesus",
        manifest,
        webOrigin: "https://www.jesusfilm.org",
      }),
    ).toBe("https://www.jesusfilm.org/watch/jesus.html")
  })

  it("falls back to row-level public language slugs when manifest data is missing", () => {
    expect(
      resolveVideoVisitorUrl({
        contentSlug: "missing-from-manifest",
        languageSlugs: ["spanish-castilian", "english"],
        manifest,
        webOrigin: "http://localhost:3000",
      }),
    ).toBe("http://localhost:3000/watch/missing-from-manifest.html")
  })

  it("does not emit visitor URLs when the manifest is unavailable", () => {
    expect(
      resolveVideoVisitorUrl({
        contentSlug: "jesus",
        manifest: null,
        webOrigin: "http://localhost:3000",
      }),
    ).toBeNull()
  })

  it("falls back to row-level public language slugs when the manifest is unavailable", () => {
    expect(
      resolveVideoVisitorUrl({
        contentSlug: "jesus",
        languageSlugs: ["en", "french"],
        manifest: null,
        webOrigin: "http://localhost:3000",
      }),
    ).toBe("http://localhost:3000/watch/jesus.html/french.html")
  })

  it("only emits visitor URLs for manifest-backed language pairs", () => {
    expect(
      resolveVideoVisitorUrl({
        contentSlug: "jesus",
        manifest,
        webOrigin: "http://localhost:3000",
      }),
    ).toBe("http://localhost:3000/watch/jesus.html")
  })

  it("does not emit links from internal locale keys", () => {
    expect(
      resolveVideoVisitorUrl({
        contentSlug: "collection",
        manifest,
        webOrigin: "https://www.jesusfilm.org",
      }),
    ).toBeNull()
  })
})
