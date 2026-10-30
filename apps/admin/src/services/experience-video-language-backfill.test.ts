import { describe, expect, it, vi } from "vitest"
import {
  backfillExperienceVideoLanguageIds,
  type VideoLanguageBackfillDb,
} from "./experience-video-language-backfill"

function mockPrisma(options: {
  targetLanguageId?: string | null
  fallbackLanguageId?: string | null
  availableTargetVideoIds?: string[]
}) {
  const languageRows = new Map([
    ["es", options.targetLanguageId ?? null],
    ["en", options.fallbackLanguageId ?? null],
  ])

  return {
    language: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { OR: Array<{ bcp47?: string; slug?: string; iso3?: string }> }
        }) => {
          const code = where.OR.flatMap((item) => [
            item.bcp47,
            item.slug,
            item.iso3,
          ]).find((value): value is string => typeof value === "string")
          const id = code ? languageRows.get(code) : null
          return id ? { id } : null
        },
      ),
    },
    videoDub: {
      findMany: vi.fn(
        async ({ where }: { where: { videoId: { in: string[] } } }) =>
          (options.availableTargetVideoIds ?? [])
            .filter((videoId) => where.videoId.in.includes(videoId))
            .map((videoId) => ({ videoId })),
      ),
    },
  } as unknown as VideoLanguageBackfillDb
}

describe("backfillExperienceVideoLanguageIds", () => {
  it("uses the experience locale language for videos with playable locale dubs and English otherwise", async () => {
    const prisma = mockPrisma({
      targetLanguageId: "language-es",
      fallbackLanguageId: "language-en",
      availableTargetVideoIds: ["video-es"],
    })

    const result = await backfillExperienceVideoLanguageIds({
      prisma,
      locale: "es",
      blocks: [
        {
          t: "videoHero",
          videoId: "video-es",
          streamingUrl: "https://example.com/es.m3u8",
        },
        {
          t: "video",
          videoId: "video-missing-es",
          streamingUrl: "https://example.com/en.m3u8",
          clipStartSeconds: 12,
        },
        {
          t: "videoCarousel",
          items: [
            { videoId: "video-es" },
            {
              videoId: "video-preserved",
              languageId: "language-custom",
              streamingUrl: "https://example.com/custom.m3u8",
            },
          ],
        },
        {
          t: "mediaCollection",
          items: [{ videoId: "video-missing-es" }],
        },
      ],
    })

    expect(result.changed).toBe(true)
    expect(result.updatedRecords).toBe(2)
    expect(result.blocks).toEqual([
      {
        t: "videoHero",
        videoId: "video-es",
        streamingUrl: "https://example.com/es.m3u8",
      },
      {
        t: "video",
        videoId: "video-missing-es",
        streamingUrl: "https://example.com/en.m3u8",
        clipStartSeconds: 12,
      },
      {
        t: "videoCarousel",
        items: [
          { videoId: "video-es", languageId: "language-es" },
          {
            videoId: "video-preserved",
            languageId: "language-custom",
            streamingUrl: "https://example.com/custom.m3u8",
          },
        ],
      },
      {
        t: "mediaCollection",
        items: [{ videoId: "video-missing-es", languageId: "language-en" }],
      },
    ])
  })

  it("falls back to English when the experience locale language is missing", async () => {
    const prisma = mockPrisma({
      targetLanguageId: null,
      fallbackLanguageId: "language-en",
      availableTargetVideoIds: [],
    })

    const result = await backfillExperienceVideoLanguageIds({
      prisma,
      locale: "zz",
      blocks: [{ t: "video", videoId: "video-1" }],
    })

    expect(result.blocks).toEqual([
      { t: "video", videoId: "video-1", languageId: "language-en" },
    ])
    expect(prisma.videoDub.findMany).not.toHaveBeenCalled()
  })

  it("preserves legacy streaming URLs on routine saves", async () => {
    const prisma = mockPrisma({
      targetLanguageId: "language-es",
      fallbackLanguageId: "language-en",
      availableTargetVideoIds: [],
    })

    const result = await backfillExperienceVideoLanguageIds({
      prisma,
      locale: "es",
      blocks: [
        {
          t: "video",
          videoId: "video-1",
          languageId: "language-es",
          streamingUrl: "https://example.com/es.m3u8",
        },
      ],
    })

    expect(result.changed).toBe(false)
    expect(result.blocks).toEqual([
      {
        t: "video",
        videoId: "video-1",
        languageId: "language-es",
        streamingUrl: "https://example.com/es.m3u8",
      },
    ])
    expect(prisma.videoDub.findMany).not.toHaveBeenCalled()
  })

  it("canonicalizes a legacy URL only for an intentional Apply carrying a language id", async () => {
    const prisma = mockPrisma({
      targetLanguageId: "language-es",
      fallbackLanguageId: "language-en",
      availableTargetVideoIds: [],
    })

    const result = await backfillExperienceVideoLanguageIds({
      prisma,
      locale: "es",
      canonicalizeLegacySelectors: true,
      blocks: [
        {
          t: "video",
          videoId: "video-1",
          languageId: "language-es",
          streamingUrl: "https://example.com/es.m3u8",
        },
      ],
    })

    expect(result.changed).toBe(true)
    expect(result.blocks).toEqual([
      { t: "video", videoId: "video-1", languageId: "language-es" },
    ])
  })

  it("checks target-language availability in batches of at most 100 videos", async () => {
    const prisma = mockPrisma({
      targetLanguageId: "language-es",
      fallbackLanguageId: "language-en",
      availableTargetVideoIds: ["video-100"],
    })
    const items = Array.from({ length: 101 }, (_, index) => ({
      videoId: `video-${index}`,
    }))

    await backfillExperienceVideoLanguageIds({
      prisma,
      locale: "es",
      blocks: [{ t: "videoCarousel", items }],
    })

    const findMany = vi.mocked(prisma.videoDub.findMany)
    expect(findMany).toHaveBeenCalledTimes(2)
    for (const call of findMany.mock.calls) {
      const input = call[0] as { where: { videoId: { in: string[] } } }
      expect(input.where.videoId.in.length).toBeLessThanOrEqual(100)
    }
  })
})
