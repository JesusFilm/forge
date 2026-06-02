import { describe, expect, it } from "vitest"
import type { WatchRouteManifest } from "@/services/watch-route-manifest.service"
import {
  buildVideoVisitorUrl,
  createVideoLibraryPagination,
  formatVideoUpdatedRelative,
  isPublicAudioLanguageSlug,
  normalizeVideoThumbnailUrl,
  parseVideoLibraryPage,
  resolveVideoVisitorUrl,
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
}

describe("video-library-utils", () => {
  it("parses invalid, empty, and negative page params as page 1", () => {
    expect(parseVideoLibraryPage(undefined)).toBe(1)
    expect(parseVideoLibraryPage("abc")).toBe(1)
    expect(parseVideoLibraryPage("0")).toBe(1)
    expect(parseVideoLibraryPage("-2")).toBe(1)
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
    ).toBe("https://www.jesusfilm.org/watch/jesus.html/english.html")
  })

  it("normalizes visitor URL origins before appending watch paths", () => {
    expect(
      buildVideoVisitorUrl({
        contentSlug: "jesus",
        languageSlug: "english",
        webOrigin: "https://example.com/root?ignored=true",
      }),
    ).toBe("https://example.com/watch/jesus.html/english.html")
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
    ).toBe("https://www.jesusfilm.org/watch/jesus.html/english.html")
  })

  it("falls back to row-level public language slugs when manifest data is missing", () => {
    expect(
      resolveVideoVisitorUrl({
        contentSlug: "missing-from-manifest",
        languageSlugs: ["spanish-castilian", "english"],
        manifest,
        webOrigin: "http://localhost:3000",
      }),
    ).toBe(
      "http://localhost:3000/watch/missing-from-manifest.html/english.html",
    )
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
    ).toBe("http://localhost:3000/watch/jesus.html/english.html")
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
