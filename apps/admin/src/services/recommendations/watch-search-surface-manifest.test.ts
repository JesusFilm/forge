import { createHash, createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"
import type {
  WatchSearchResponse,
  WatchSearchResult,
} from "../watch-search.service"
import {
  signWatchSearchSurfaceManifest,
  watchSearchSurfaceItemPath,
} from "./watch-search-surface-manifest"

const result: WatchSearchResult = {
  type: "video",
  id: "public-film",
  slug: "public-film",
  title: "Public Film",
  description: null,
  snippet: null,
  imageUrl: null,
  imageBlurDataUrl: null,
  muxThumbnailBlurDataUrl: null,
  playbackId: null,
  startSeconds: null,
  score: 1,
  scoreBreakdown: {
    total: 1,
    sourceRelevance: 1,
    evidenceBoost: 0,
    relevance: 1,
    availability: 1,
    match: 1,
    sourceScore: 1,
  },
  label: null,
  durationSeconds: null,
  childCount: null,
  languageSlug: "english",
  languageEnglishName: "English",
  availability: {
    kind: "target_audio",
    languageSlug: "english",
    languageEnglishName: "English",
    audio: true,
    subtitles: false,
  },
  evidence: { kind: "metadata", languageSlug: null, label: null },
  action: { kind: "watch", hrefLanguageSlug: "english" },
  fallback: { kind: "none", message: null },
}
const response: WatchSearchResponse = {
  query: "public",
  results: [result],
  hasMore: false,
  nextOffset: 1,
  searchMode: "default",
  requestId: "not-in-signed-source",
  degraded: false,
  latencyMs: 1,
  laneStatuses: [],
  languageInterpretation: {
    queryLanguageSlug: null,
    queryNamedLanguageSlug: null,
    targetLanguageSlug: "spanish",
    targetLanguageSource: "explicit_target",
    displayLanguageSlug: null,
    routeLanguageSlug: null,
    currentWatchLanguageSlug: null,
    acceptLanguage: null,
    acceptLanguageSlug: null,
  },
}

describe("trusted search page source descriptors", () => {
  it("matches Web's canonical signing protocol and excludes search/request identity", () => {
    const now = Date.parse("2026-09-29T00:00:00Z")
    const signed = signWatchSearchSurfaceManifest(
      response,
      "local-public-source-test",
      now,
    )
    expect(signed).not.toBeNull()
    const sourcePayload = JSON.stringify([
      "watch-search",
      "results",
      "result-list",
      "search-results",
      [[0, "/watch/public-film.html"]],
    ])
    const sourceVersion = createHash("sha256")
      .update(sourcePayload)
      .digest("hex")
    const expiresAt = "2026-09-30T23:55:00.000Z"
    const signature = createHmac("sha256", "local-public-source-test")
      .update(
        JSON.stringify([
          "watch-public-surface-manifest-v2",
          sourcePayload,
          "watch-exposure-v2",
          sourceVersion,
          expiresAt,
        ]),
      )
      .digest("base64url")
    expect(signed).toEqual({
      manifest: {
        surface: "watch-search",
        block: "results",
        presentation: "result-list",
        placement: "search-results",
        policyVersion: "watch-exposure-v2",
        items: [{ position: 0, itemPath: "/watch/public-film.html" }],
        sourceVersion,
        expiresAt,
      },
      signature,
    })
    expect(
      signWatchSearchSurfaceManifest(
        {
          ...response,
          query: "other-private-query",
          requestId: "different-request",
        },
        "local-public-source-test",
        now,
      ),
    ).toEqual(signed)
  })

  it("uses exact canonical audio, subtitle audio, collisions and unavailable action paths", () => {
    expect(watchSearchSurfaceItemPath(result, "spanish")).toBe(
      "/watch/public-film.html",
    )
    expect(
      watchSearchSurfaceItemPath({ ...result, slug: "english" }, "spanish"),
    ).toBe("/watch/english.html/english.html")
    expect(
      watchSearchSurfaceItemPath(
        {
          ...result,
          action: { ...result.action, hrefLanguageSlug: "spanish" },
        },
        "spanish",
      ),
    ).toBe("/watch/public-film.html/spanish.html")
    const subtitle = {
      ...result,
      languageSlug: "spanish",
      availability: {
        ...result.availability,
        kind: "target_subtitle" as const,
        languageSlug: "spanish",
      },
    }
    expect(watchSearchSurfaceItemPath(subtitle, "spanish")).toBe(
      "/watch/public-film.html",
    )
    expect(
      watchSearchSurfaceItemPath(
        { ...subtitle, action: { ...result.action, hrefLanguageSlug: null } },
        "spanish",
      ),
    ).toBeNull()
    expect(
      watchSearchSurfaceItemPath(
        {
          ...result,
          availability: { ...result.availability, kind: "unavailable" },
        },
        "english",
      ),
    ).toBe("/watch/public-film.html/english.html")
  })

  it("withholds authority for absent token, unsupported or ambiguous source and uses page-local positions", () => {
    expect(signWatchSearchSurfaceManifest(response, undefined)).toBeNull()
    expect(
      signWatchSearchSurfaceManifest(
        { ...response, results: [{ ...result, type: "experience" }] },
        "test",
      ),
    ).toBeNull()
    expect(
      signWatchSearchSurfaceManifest(
        {
          ...response,
          results: [
            {
              ...result,
              action: { ...result.action, hrefLanguageSlug: null },
              languageSlug: null,
            },
          ],
        },
        "test",
      ),
    ).toBeNull()
    expect(
      signWatchSearchSurfaceManifest(
        { ...response, results: [result, result], nextOffset: 32 },
        "test",
      )?.manifest.items.map((item) => item.position),
    ).toEqual([0, 1])
  })
})
