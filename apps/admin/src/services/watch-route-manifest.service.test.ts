import { describe, expect, it, vi } from "vitest"
import {
  WatchRouteManifestService,
  summarizeWatchRouteManifest,
} from "./watch-route-manifest.service"

function mockPrisma() {
  return {
    $queryRaw: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function sqlText(call: unknown[]): string {
  const [strings] = call
  return Array.isArray(strings) ? strings.join(" ") : String(strings)
}

describe("WatchRouteManifestService.generate", () => {
  it("builds a deterministic manifest from compact slug sets", async () => {
    const prisma = mockPrisma()
    prisma.$queryRaw
      .mockResolvedValueOnce([{ slug: "easter" }, { slug: "jesus" }])
      .mockResolvedValueOnce([{ slug: "easter" }])
      .mockResolvedValueOnce([{ slug: "en" }, { slug: "es" }])
      .mockResolvedValueOnce([
        { parentSlug: "book-of-acts", childSlug: "pentecost" },
        { parentSlug: "book-of-acts", childSlug: "saul" },
      ])
      .mockResolvedValueOnce([{ slug: "english" }, { slug: "spanish" }])
      .mockResolvedValueOnce([
        { contentSlug: "jesus", audioLanguageSlug: "english" },
        { contentSlug: "jesus", audioLanguageSlug: "spanish" },
      ])
      .mockResolvedValueOnce([
        {
          parentSlug: "book-of-acts",
          childSlug: "pentecost",
          audioLanguageSlug: "english",
        },
        {
          parentSlug: "book-of-acts",
          childSlug: "saul",
          audioLanguageSlug: "spanish",
        },
      ])

    const service = new WatchRouteManifestService(prisma, {
      now: () => new Date("2026-05-29T12:00:00.000Z"),
    })

    const first = await service.generate()

    prisma.$queryRaw.mockClear()
    prisma.$queryRaw
      .mockResolvedValueOnce([{ slug: "easter" }, { slug: "jesus" }])
      .mockResolvedValueOnce([{ slug: "easter" }])
      .mockResolvedValueOnce([{ slug: "en" }, { slug: "es" }])
      .mockResolvedValueOnce([
        { parentSlug: "book-of-acts", childSlug: "pentecost" },
        { parentSlug: "book-of-acts", childSlug: "saul" },
      ])
      .mockResolvedValueOnce([{ slug: "english" }, { slug: "spanish" }])
      .mockResolvedValueOnce([
        { contentSlug: "jesus", audioLanguageSlug: "english" },
        { contentSlug: "jesus", audioLanguageSlug: "spanish" },
      ])
      .mockResolvedValueOnce([
        {
          parentSlug: "book-of-acts",
          childSlug: "pentecost",
          audioLanguageSlug: "english",
        },
        {
          parentSlug: "book-of-acts",
          childSlug: "saul",
          audioLanguageSlug: "spanish",
        },
      ])

    const second = await service.generate()

    expect(first).toEqual({
      version: second.version,
      generatedAt: "2026-05-29T12:00:00.000Z",
      contentSlugs: ["easter", "jesus"],
      oneSegmentSlugs: ["easter"],
      homepageLocales: ["en", "es"],
      episodePairsByParent: {
        "book-of-acts": ["pentecost", "saul"],
      },
      audioLanguageSlugs: ["english", "spanish"],
      audioLanguageIndexesByContent: {
        jesus: [0, 1],
      },
      audioLanguageIndexesByEpisode: {
        "book-of-acts": {
          pentecost: [0],
          saul: [1],
        },
      },
    })
    expect(first.version).toMatch(/^[a-f0-9]{64}$/)
  })

  it("keeps episode pair fanout separate from audio-language fanout", async () => {
    const prisma = mockPrisma()
    prisma.$queryRaw
      .mockResolvedValueOnce([{ slug: "book-of-acts" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ slug: "en" }])
      .mockResolvedValueOnce([
        { parentSlug: "book-of-acts", childSlug: "episode-1" },
        { parentSlug: "book-of-acts", childSlug: "episode-2" },
      ])
      .mockResolvedValueOnce([
        { slug: "english" },
        { slug: "spanish" },
        { slug: "french" },
      ])
      .mockResolvedValueOnce([
        { contentSlug: "book-of-acts", audioLanguageSlug: "english" },
        { contentSlug: "book-of-acts", audioLanguageSlug: "spanish" },
      ])
      .mockResolvedValueOnce([
        {
          parentSlug: "book-of-acts",
          childSlug: "episode-1",
          audioLanguageSlug: "english",
        },
        {
          parentSlug: "book-of-acts",
          childSlug: "episode-1",
          audioLanguageSlug: "spanish",
        },
        {
          parentSlug: "book-of-acts",
          childSlug: "episode-2",
          audioLanguageSlug: "french",
        },
      ])

    const service = new WatchRouteManifestService(prisma)
    const manifest = await service.generate()
    const summary = summarizeWatchRouteManifest(manifest)

    expect(summary).toMatchObject({
      contentSlugs: 1,
      homepageLocales: 1,
      parentSlugs: 1,
      parentChildPairs: 2,
      audioLanguageSlugs: 3,
      contentAudioLanguagePairs: 2,
      episodeAudioLanguagePairs: 3,
    })
    expect(JSON.stringify(manifest)).not.toContain("episode-1/english")
    expect(JSON.stringify(manifest)).not.toContain("episode-2/spanish")
  })

  it("encodes public-route visibility filters in the aggregate SQL", async () => {
    const prisma = mockPrisma()
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const service = new WatchRouteManifestService(prisma)
    await service.generate()

    const allSql = prisma.$queryRaw.mock.calls.map(sqlText).join("\n")
    expect(allSql).toContain("status = 'published'::\"LocaleStatus\"")
    expect(allSql).toContain('"deleted_at" IS NULL')
    expect(allSql).toContain("published = TRUE")
    expect(allSql).toContain("hls IS NOT NULL")
    expect(allSql).toContain("published_parent_slugs")
    expect(allSql).toContain('"is_template" = FALSE')
    expect(allSql).toContain('"is_homepage" = FALSE')
    expect(allSql).toContain('"is_homepage" = TRUE')
    expect(allSql).toContain('"path_segment" IS NULL')
  })

  it("rejects malformed query rows instead of emitting a partial manifest", async () => {
    const prisma = mockPrisma()
    prisma.$queryRaw
      .mockResolvedValueOnce([{ slug: "" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const service = new WatchRouteManifestService(prisma)

    await expect(service.generate()).rejects.toThrow()
  })
})
