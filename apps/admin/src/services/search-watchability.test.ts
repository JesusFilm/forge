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

  it("uses target-language subtitles when target audio is unavailable", async () => {
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
      kind: "target_subtitle",
      languageSlug: "russian",
      audio: false,
      subtitles: true,
      videoSubtitleId: "sub-ru",
    })
    const subtitleSql = (
      prisma.$queryRaw.mock.calls[0]?.[0] as { strings: string[] }
    ).strings.join(" ")
    expect(subtitleSql).toContain("vd.published = true")
    expect(subtitleSql).toContain("NULLIF(BTRIM(vd.hls), '') IS NOT NULL")
    expect(subtitleSql).toContain("NULLIF(BTRIM(vs.vtt_src), '') IS NOT NULL")
    expect(subtitleSql).toContain("NULLIF(BTRIM(vs.srt_src), '') IS NOT NULL")
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
