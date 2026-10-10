import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Principal } from "@/auth/principal"

import {
  PUBLIC_LANGUAGE_SLUG_SQL_PATTERN,
  notRestrictedFromWatchWhere,
  SearchWatchabilityService,
  watchVisibilityWhere,
} from "./search-watchability"

const VIEWER: Principal = { id: "viewer-1", role: "VIEWER" }
const EDITOR: Principal = { id: "editor-1", role: "EDITOR" }
const ADMIN: Principal = { id: "admin-1", role: "ADMIN" }
const CONSUMER_BEARER: Principal = {
  id: null,
  role: "CONSUMER_BEARER",
  rateLimitBucketKey: "consumer-bucket-key",
}

describe("notRestrictedFromWatchWhere", () => {
  it("returns a NOT-has-watch where fragment", () => {
    expect(notRestrictedFromWatchWhere()).toEqual({
      NOT: { restrictViewPlatforms: { has: "watch" } },
    })
  })
})

describe("watchVisibilityWhere", () => {
  it("anonymous → excludes watch-restricted videos", () => {
    expect(watchVisibilityWhere(null)).toEqual({
      NOT: { restrictViewPlatforms: { has: "watch" } },
    })
  })

  it("VIEWER → excludes watch-restricted videos", () => {
    expect(watchVisibilityWhere(VIEWER)).toEqual({
      NOT: { restrictViewPlatforms: { has: "watch" } },
    })
  })

  it("CONSUMER_BEARER (web SSR) → excludes watch-restricted videos", () => {
    expect(watchVisibilityWhere(CONSUMER_BEARER)).toEqual({
      NOT: { restrictViewPlatforms: { has: "watch" } },
    })
  })

  it("EDITOR → no restriction (dashboard must show restricted videos)", () => {
    expect(watchVisibilityWhere(EDITOR)).toEqual({})
  })

  it("ADMIN → no restriction (dashboard must show restricted videos)", () => {
    expect(watchVisibilityWhere(ADMIN)).toEqual({})
  })
})

function mockPrisma() {
  return {
    language: { findFirst: vi.fn() },
    videoDub: { findMany: vi.fn() },
    videoSubtitle: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

// `hydrate` issues up to three raw queries (target subtitles, related fallback
// languages, containers), so a test must name the one it means rather than
// taking the last call — adding a tier would silently retarget every
// assertion.
function rawQueryContaining(
  prisma: ReturnType<typeof mockPrisma>,
  anchor: string,
): { sql?: string; values?: unknown[] } | undefined {
  return prisma.$queryRaw.mock.calls
    .map((call: unknown[]) => call[0] as { sql?: string; values?: unknown[] })
    .find((query: { sql?: string; values?: unknown[] }) =>
      query?.sql?.includes(anchor),
    )
}

function rawSql(prisma: ReturnType<typeof mockPrisma>, anchor: string): string {
  return rawQueryContaining(prisma, anchor)?.sql ?? ""
}

function rawValues(
  prisma: ReturnType<typeof mockPrisma>,
  anchor: string,
): unknown[] {
  return rawQueryContaining(prisma, anchor)?.values ?? []
}

const SUBTITLE_QUERY = "WITH candidate(video_id, video_edition_id) AS"
const CONTAINER_QUERY = "WITH RECURSIVE root AS"

const russianLanguage = {
  id: "lang-ru",
  slug: "russian",
  name: { en: "Russian" },
}

describe("SearchWatchabilityService", () => {
  let prisma: ReturnType<typeof mockPrisma>
  let service: SearchWatchabilityService

  beforeEach(() => {
    prisma = mockPrisma()
    prisma.language.findFirst.mockResolvedValue(russianLanguage)
    prisma.videoDub.findMany.mockResolvedValue([])
    prisma.videoSubtitle.findMany.mockResolvedValue([])
    prisma.$queryRaw.mockResolvedValue([])
    service = new SearchWatchabilityService(prisma)
  })

  it("returns target-language audio as the primary watchability", async () => {
    prisma.videoDub.findMany
      .mockResolvedValueOnce([
        {
          id: "dub-ru",
          videoId: "video-1",
          duration: 7200,
          language: russianLanguage,
          muxVideo: { playbackId: "mux-ru" },
        },
      ])
      .mockResolvedValueOnce([])

    const result = await service.hydrate({
      candidates: [{ videoId: "video-1" }],
      targetLanguageSlug: "russian",
    })

    expect(result.get("video-1")).toMatchObject({
      kind: "target_audio",
      languageSlug: "russian",
      languageEnglishName: "Russian",
      audio: true,
      subtitles: false,
      playbackId: "mux-ru",
      videoDubId: "dub-ru",
      hrefLanguageSlug: "russian",
    })
  })

  it("keeps target subtitle availability while using its same-edition Dub action", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        id: "sub-ru",
        videoId: "video-1",
        editionId: "edition-1",
        videoDubId: "dub-en",
        playbackId: "mux-en",
        durationSeconds: 7100,
        language: russianLanguage,
        audioLanguage: {
          id: "lang-en",
          slug: "english",
          name: { en: "English" },
        },
      },
    ])

    const result = await service.hydrate({
      candidates: [{ videoId: "video-1" }],
      targetLanguageSlug: "russian",
    })

    expect(result.get("video-1")).toMatchObject({
      kind: "target_subtitle",
      languageSlug: "russian",
      audio: false,
      subtitles: true,
      playbackId: "mux-en",
      videoDubId: "dub-en",
      videoSubtitleId: "sub-ru",
      durationSeconds: 7100,
      hrefLanguageSlug: "english",
    })
  })

  it("does not let subtitles override target-language audio", async () => {
    prisma.videoDub.findMany
      .mockResolvedValueOnce([
        {
          id: "dub-ru",
          videoId: "video-1",
          duration: 7200,
          language: russianLanguage,
          muxVideo: { playbackId: "mux-ru" },
        },
      ])
      .mockResolvedValueOnce([])
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        id: "sub-ru",
        videoId: "video-1",
        language: russianLanguage,
      },
    ])

    const result = await service.hydrate({
      candidates: [{ videoId: "video-1" }],
      targetLanguageSlug: "russian",
    })

    expect(result.get("video-1")).toMatchObject({
      kind: "target_audio",
      videoDubId: "dub-ru",
      videoSubtitleId: null,
    })
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it("bounds target subtitle hydration to the candidate edition and direct owner", async () => {
    const result = await service.hydrate({
      candidates: [{ videoId: "video-1", editionId: "edition-winning" }],
      targetLanguageSlug: "russian",
      includeOtherLanguageFallback: false,
    })

    expect(result.get("video-1")?.kind).toBe("unavailable")
    expect(rawValues(prisma, SUBTITLE_QUERY)).toEqual(
      expect.arrayContaining(["video-1", "edition-winning", "lang-ru"]),
    )
    const sql = rawSql(prisma, SUBTITLE_QUERY)
    expect(sql).toContain("WITH candidate(video_id, video_edition_id) AS")
    expect(sql).toContain("vs.video_edition_id = candidate.video_edition_id")
    expect(sql).toContain(
      "vs.video_id IS NULL OR vs.video_id = candidate.video_id",
    )
    expect(sql).toContain("fallback_dub.video_edition_id = vs.video_edition_id")
    expect(sql).toContain("NULLIF(BTRIM(vs.vtt_src), '') IS NOT NULL")
    expect(sql).not.toContain("BTRIM(vs.srt_src)")
    expect(sql).not.toContain("COALESCE(vs.video_id")
  })

  it("selects a public playable fallback Dub by primary, English, then stable deterministic order", async () => {
    await service.hydrate({
      candidates: [{ videoId: "video-1" }],
      targetLanguageSlug: "russian",
      includeOtherLanguageFallback: false,
    })

    const sql = rawSql(prisma, SUBTITLE_QUERY)
    expect(sql).toContain("video.deleted_at IS NULL")
    expect(sql).toContain("video.no_index = FALSE")
    expect(sql).toContain("published_locale.status = 'published'")
    expect(sql).toContain("ve.deleted_at IS NULL")
    expect(sql).toContain("target_language.deleted_at IS NULL")
    expect(sql).toContain("target_language.slug ~ ")
    expect(sql).toContain("fallback_dub.deleted_at IS NULL")
    expect(sql).toContain("fallback_dub.published = TRUE")
    expect(sql).toContain("fallback_language.slug ~ ")
    expect(PUBLIC_LANGUAGE_SLUG_SQL_PATTERN).toBe("^[a-z0-9-]+$")
    expect(sql).toContain("NULLIF(BTRIM(fallback_dub.hls), '') IS NOT NULL")
    expect(sql).toContain("NULLIF(BTRIM(vs.vtt_src), '') IS NOT NULL")
    expect(sql).not.toContain("BTRIM(vs.srt_src)")
    expect(sql).toMatch(
      /WHEN video\.primary_language_id = fallback_language\.id THEN 0[\s\S]*WHEN fallback_language\.slug = 'english' THEN 1[\s\S]*fallback_dub\.duration DESC NULLS LAST,[\s\S]*fallback_language\.slug ASC,[\s\S]*fallback_dub\.id ASC/,
    )
    expect(sql).toContain("END AS action_priority")
    expect(sql).toContain("fallback_language.slug AS language_slug")

    const outerOrder = sql.slice(sql.indexOf(") fallback_action ON TRUE"))
    expect(outerOrder).toMatch(
      /ORDER BY\s+candidate\.video_id,\s+fallback_action\.action_priority ASC,\s+fallback_action\.duration DESC NULLS LAST,\s+fallback_action\.language_slug ASC,\s+fallback_action\.id ASC,\s+vs\.video_edition_id ASC,\s+CASE WHEN vs\.video_id = candidate\.video_id THEN 0 ELSE 1 END ASC,\s+vs\.id ASC/,
    )
  })

  it("fails closed when target audio has a malformed public language slug", async () => {
    prisma.videoDub.findMany.mockResolvedValueOnce([
      {
        id: "dub-ru",
        videoId: "video-1",
        duration: 7200,
        language: { ...russianLanguage, slug: "Russian Language" },
        muxVideo: { playbackId: "mux-ru" },
      },
    ])

    const result = await service.hydrate({
      candidates: [{ videoId: "video-1" }],
      targetLanguageSlug: "russian",
      includeOtherLanguageFallback: false,
    })

    expect(result.get("video-1")).toMatchObject({
      kind: "unavailable",
      audio: false,
      playbackId: null,
      videoDubId: null,
      hrefLanguageSlug: null,
    })
  })

  it("falls back to a related playable language when no target watchability exists", async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "lang-en", priority: 10 }])
    prisma.videoDub.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: "dub-en",
        videoId: "video-1",
        duration: 7100,
        language: { id: "lang-en", slug: "english", name: { en: "English" } },
        muxVideo: { playbackId: "mux-en" },
      },
    ])

    const result = await service.hydrate({
      candidates: [{ videoId: "video-1" }],
      targetLanguageSlug: "russian",
    })

    expect(result.get("video-1")).toMatchObject({
      kind: "related_language",
      languageSlug: "english",
      audio: true,
      subtitles: false,
      hrefLanguageSlug: "english",
    })
  })

  it("ignores malformed related-language slugs and selects a valid fallback", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: "lang-malformed", priority: 1 },
      { id: "lang-en", priority: 2 },
    ])
    prisma.videoDub.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: "dub-malformed",
        videoId: "video-1",
        duration: 7200,
        language: {
          id: "lang-malformed",
          slug: "not a public slug",
          name: { en: "Malformed" },
        },
        muxVideo: { playbackId: "mux-malformed" },
      },
      {
        id: "dub-en",
        videoId: "video-1",
        duration: 7100,
        language: { id: "lang-en", slug: "english", name: { en: "English" } },
        muxVideo: { playbackId: "mux-en" },
      },
    ])

    const result = await service.hydrate({
      candidates: [{ videoId: "video-1" }],
      targetLanguageSlug: "russian",
    })

    expect(result.get("video-1")).toMatchObject({
      kind: "related_language",
      languageSlug: "english",
      playbackId: "mux-en",
      videoDubId: "dub-en",
      hrefLanguageSlug: "english",
    })
  })

  it("does not use arbitrary non-target languages without a related-language mapping", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])
    prisma.videoDub.findMany.mockResolvedValueOnce([])

    const result = await service.hydrate({
      candidates: [{ videoId: "video-1" }],
      targetLanguageSlug: "russian",
    })

    expect(result.get("video-1")).toMatchObject({
      kind: "unavailable",
      audio: false,
      subtitles: false,
    })
    expect(prisma.videoDub.findMany).toHaveBeenCalledTimes(1)
  })

  it("returns unavailable when the target language is unknown", async () => {
    prisma.language.findFirst.mockResolvedValueOnce(null)

    const result = await service.hydrate({
      candidates: [{ videoId: "video-1" }],
      targetLanguageSlug: "unknown",
    })

    expect(result.get("video-1")).toMatchObject({
      kind: "unavailable",
      audio: false,
      subtitles: false,
    })
    expect(prisma.videoDub.findMany).not.toHaveBeenCalled()
  })

  describe("container tier", () => {
    it("resolves a Series-Shaped candidate from a playable descendant", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { videoId: "collection-1", language: russianLanguage },
        ])

      const result = await service.hydrate({
        candidates: [{ videoId: "collection-1" }],
        targetLanguageSlug: "russian",
      })

      expect(result.get("collection-1")).toMatchObject({
        kind: "container",
        languageSlug: "russian",
        languageEnglishName: "Russian",
        hrefLanguageSlug: "russian",
        audio: false,
        subtitles: false,
        playbackId: null,
        videoDubId: null,
        videoSubtitleId: null,
        durationSeconds: null,
      })
    })

    it("never overrides a candidate that an earlier tier already resolved", async () => {
      prisma.videoDub.findMany.mockResolvedValueOnce([
        {
          id: "dub-ru",
          videoId: "collection-1",
          duration: 7200,
          language: russianLanguage,
          muxVideo: { playbackId: "mux-ru" },
        },
      ])
      prisma.$queryRaw.mockResolvedValue([
        { videoId: "collection-1", language: russianLanguage },
      ])

      const result = await service.hydrate({
        candidates: [{ videoId: "collection-1" }],
        targetLanguageSlug: "russian",
      })

      expect(result.get("collection-1")).toMatchObject({
        kind: "target_audio",
        playbackId: "mux-ru",
      })
    })

    it("issues no container query when every candidate resolved earlier", async () => {
      prisma.videoDub.findMany.mockResolvedValueOnce([
        {
          id: "dub-ru",
          videoId: "video-1",
          duration: 7200,
          language: russianLanguage,
          muxVideo: { playbackId: "mux-ru" },
        },
      ])

      await service.hydrate({
        candidates: [{ videoId: "video-1" }],
        targetLanguageSlug: "russian",
      })

      expect(prisma.$queryRaw).not.toHaveBeenCalled()
    })

    it("stays unavailable when the descendant language slug is not public", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            videoId: "collection-1",
            language: { id: "lang-x", slug: "Not_Public", name: { en: "X" } },
          },
        ])

      const result = await service.hydrate({
        candidates: [{ videoId: "collection-1" }],
        targetLanguageSlug: "russian",
      })

      expect(result.get("collection-1")?.kind).toBe("unavailable")
    })

    it("gates the container root on its own visibility, label, and public slug", async () => {
      await service.hydrate({
        candidates: [{ videoId: "collection-1" }],
        targetLanguageSlug: "russian",
        includeOtherLanguageFallback: false,
      })

      const sql = rawSql(prisma, CONTAINER_QUERY)
      expect(sql).toContain("container.deleted_at IS NULL")
      expect(sql).toContain("container.no_index = FALSE")
      expect(sql).toContain("root_locale.status = 'published'")
      expect(sql).toContain("container.label::text = ANY(")
      expect(sql).toContain("container.slug ~ ")
      // The root's own watch restriction has no other enforcement point: this
      // tier does not join through a candidate-owned Dub, so it cannot inherit
      // playableDubWhere()'s nested video clause.
      expect(sql).toContain(
        "NOT ('watch' = ANY(container.restrict_view_platforms))",
      )
      expect(rawValues(prisma, CONTAINER_QUERY)).toEqual(
        expect.arrayContaining([["collection", "series"], "^[a-z0-9_-]+$"]),
      )
    })

    it("applies the descendant visibility conditions playableDubWhere carries", async () => {
      await service.hydrate({
        candidates: [{ videoId: "collection-1" }],
        targetLanguageSlug: "russian",
        includeOtherLanguageFallback: false,
      })

      const sql = rawSql(prisma, CONTAINER_QUERY)
      expect(sql).toContain("descendant_video.deleted_at IS NULL")
      expect(sql).toContain("descendant_video.no_index = FALSE")
      expect(sql).toContain(
        "NOT ('watch' = ANY(descendant_video.restrict_view_platforms))",
      )
      expect(sql).toContain("descendant_locale.status = 'published'")
      expect(sql).toContain("child_dub.deleted_at IS NULL")
      expect(sql).toContain("child_dub.published = TRUE")
      expect(sql).toContain("NULLIF(BTRIM(child_dub.hls), '') IS NOT NULL")
      expect(sql).toContain("child_edition.deleted_at IS NULL")
      expect(sql).toContain("dub_language.slug ~ ")
      expect(PUBLIC_LANGUAGE_SLUG_SQL_PATTERN).toBe("^[a-z0-9-]+$")
    })

    it("gates traversal on visibility, not only the evaluated descendant", async () => {
      await service.hydrate({
        candidates: [{ videoId: "collection-1" }],
        targetLanguageSlug: "russian",
        includeOtherLanguageFallback: false,
      })

      // Both terms of the recursive CTE join through the visibility predicate,
      // so a hidden intermediate cannot carry a visible grandchild into the
      // result. Asserting the count catches a fix applied to one term only.
      const sql = rawSql(prisma, CONTAINER_QUERY)
      const gatedTraversals = sql.match(/descendant_video\.deleted_at IS NULL/g)
      // One per CTE term. Filtering only the evaluated descendant lets a
      // hidden intermediate carry a visible grandchild through.
      expect(gatedTraversals).toHaveLength(2)
    })

    it("bounds the descendant walk to two relation levels", async () => {
      await service.hydrate({
        candidates: [{ videoId: "collection-1" }],
        targetLanguageSlug: "russian",
        includeOtherLanguageFallback: false,
      })

      const sql = rawSql(prisma, CONTAINER_QUERY)
      expect(sql).toContain("WITH RECURSIVE root AS")
      expect(sql).toContain("relation.parent_id = root.id")
      expect(sql).toContain("relation.parent_id = descendant.video_id")
      expect(sql).toContain("WHERE descendant.depth <")
      // video_relation has no cycle constraint, so the bound is the only thing
      // that makes this walk terminate.
      expect(rawValues(prisma, CONTAINER_QUERY)).toEqual(
        expect.arrayContaining([2]),
      )
    })

    it("prefers a target-language descendant over a fallback-language one", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "lang-en", priority: 1 }])
        .mockResolvedValueOnce([])

      await service.hydrate({
        candidates: [{ videoId: "collection-1" }],
        targetLanguageSlug: "russian",
      })

      const sql = rawSql(prisma, CONTAINER_QUERY)
      expect(sql).toContain("array_position(")
      expect(rawValues(prisma, CONTAINER_QUERY)).toEqual(
        expect.arrayContaining([["lang-ru", "lang-en"]]),
      )
    })
  })
})
