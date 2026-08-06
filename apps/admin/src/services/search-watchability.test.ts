import { beforeEach, describe, expect, it, vi } from "vitest"

import { SearchWatchabilityService } from "./search-watchability"

function mockPrisma() {
  return {
    language: { findFirst: vi.fn() },
    videoDub: { findMany: vi.fn() },
    videoSubtitle: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function latestRawSql(prisma: ReturnType<typeof mockPrisma>): string {
  const query = prisma.$queryRaw.mock.calls.at(-1)?.[0] as
    | { sql?: string }
    | undefined
  return query?.sql ?? ""
}

function latestRawValues(prisma: ReturnType<typeof mockPrisma>): unknown[] {
  const query = prisma.$queryRaw.mock.calls.at(-1)?.[0] as
    | { values?: unknown[] }
    | undefined
  return query?.values ?? []
}

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
    expect(latestRawValues(prisma)).toEqual(
      expect.arrayContaining(["video-1", "edition-winning", "lang-ru"]),
    )
    const sql = latestRawSql(prisma)
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

    const sql = latestRawSql(prisma)
    expect(sql).toContain("video.deleted_at IS NULL")
    expect(sql).toContain("video.no_index = FALSE")
    expect(sql).toContain("published_locale.status = 'published'")
    expect(sql).toContain("ve.deleted_at IS NULL")
    expect(sql).toContain("target_language.deleted_at IS NULL")
    expect(sql).toContain("target_language.slug ~ '^[a-z0-9-]+$'")
    expect(sql).toContain("fallback_dub.deleted_at IS NULL")
    expect(sql).toContain("fallback_dub.published = TRUE")
    expect(sql).toContain("fallback_language.slug ~ '^[a-z0-9-]+$'")
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
})
