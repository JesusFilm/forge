import { describe, expect, it, vi } from "vitest"
import {
  WatchSeoManifestCoverageError,
  WatchSeoManifestService,
  normalizeGoogleHreflang,
  summarizeWatchSeoManifest,
} from "./watch-seo-manifest.service"

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

describe("normalizeGoogleHreflang", () => {
  it("accepts language and language-region tags supported by sitemap hreflang", () => {
    expect(normalizeGoogleHreflang("en")).toBe("en")
    expect(normalizeGoogleHreflang("pt-br")).toBe("pt-BR")
    expect(normalizeGoogleHreflang("en_US")).toBe("en-US")
  })

  it("rejects script, numeric-region, missing, and non-ISO language tags", () => {
    expect(normalizeGoogleHreflang("zh-Hans")).toBeNull()
    expect(normalizeGoogleHreflang("es-419")).toBeNull()
    expect(normalizeGoogleHreflang("eng")).toBeNull()
    expect(normalizeGoogleHreflang(null)).toBeNull()
  })
})

describe("WatchSeoManifestService.generate", () => {
  it("builds deterministic sitemap route groups and de-dupes hreflang per route", async () => {
    const prisma = mockPrisma()
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          contentSlug: "jesus",
          languageSlug: "english",
          bcp47: "en",
          hreflangPriority: 100,
        },
        {
          contentSlug: "jesus",
          languageSlug: "spanish-castilian",
          bcp47: "es",
          hreflangPriority: 100,
        },
        {
          contentSlug: "jesus",
          languageSlug: "spanish-latin-american",
          bcp47: "es",
          hreflangPriority: 500,
        },
        {
          contentSlug: "jesus",
          languageSlug: "spanish-mexican",
          bcp47: "es",
          hreflangPriority: 500,
        },
        {
          contentSlug: "jesus",
          languageSlug: "bad-script",
          bcp47: "zh-Hans",
          hreflangPriority: 10,
        },
        {
          contentSlug: "pentecost",
          languageSlug: "english",
          bcp47: "en",
          hreflangPriority: 100,
        },
        {
          contentSlug: "pentecost",
          languageSlug: "portuguese-brazil",
          bcp47: "pt-BR",
          hreflangPriority: 500,
        },
      ])
      .mockResolvedValueOnce([
        {
          parentSlug: "book-of-acts",
          childSlug: "pentecost",
          languageSlug: "english",
          bcp47: "en",
          hreflangPriority: 100,
        },
        {
          parentSlug: "book-of-acts",
          childSlug: "pentecost",
          languageSlug: "portuguese-brazil",
          bcp47: "pt-BR",
          hreflangPriority: 500,
        },
      ])

    const service = new WatchSeoManifestService(prisma, {
      now: () => new Date("2026-06-12T12:00:00.000Z"),
    })

    const manifest = await service.generate()

    expect(manifest).toEqual({
      version: expect.stringMatching(/^[a-f0-9]{64}$/),
      generatedAt: "2026-06-12T12:00:00.000Z",
      videoRouteGroups: [
        {
          contentSlug: "jesus",
          languageSlugs: [
            "english",
            "spanish-castilian",
            "spanish-latin-american",
            "spanish-mexican",
          ],
          alternates: [
            { hreflang: "en", languageSlug: "english" },
            { hreflang: "es", languageSlug: "spanish-latin-american" },
          ],
        },
        {
          contentSlug: "pentecost",
          languageSlugs: ["english", "portuguese-brazil"],
          alternates: [
            { hreflang: "en", languageSlug: "english" },
            { hreflang: "pt-BR", languageSlug: "portuguese-brazil" },
          ],
        },
      ],
      episodeRouteGroups: [
        {
          parentSlug: "book-of-acts",
          childSlug: "pentecost",
          languageSlugs: ["english", "portuguese-brazil"],
          alternates: [
            { hreflang: "en", languageSlug: "english" },
            { hreflang: "pt-BR", languageSlug: "portuguese-brazil" },
          ],
        },
      ],
      skippedHreflangValues: {
        "duplicate:es": 2,
        "zh-Hans": 1,
      },
    })
    expect(summarizeWatchSeoManifest(manifest)).toMatchObject({
      videoRouteGroups: 2,
      episodeRouteGroups: 1,
      alternateLinks: 6,
      skippedHreflangValues: 3,
    })
  })

  it("encodes public watch route filters in aggregate SQL", async () => {
    const prisma = mockPrisma()
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    const service = new WatchSeoManifestService(prisma)
    await service.generate()

    const allSql = prisma.$queryRaw.mock.calls.map(sqlText).join("\n")
    expect(allSql).toContain("status = 'published'::\"LocaleStatus\"")
    expect(allSql).toContain('"deleted_at" IS NULL')
    expect(allSql).toContain("published = TRUE")
    expect(allSql).toContain("hls IS NOT NULL")
    expect(allSql).toContain("parent_video_audio")
    expect(allSql).toContain("child_lang.bcp47")
    expect(allSql).toContain('"hreflangPriority"')
    expect(allSql).toContain('FROM "country_language"')
  })

  it("rejects malformed query rows instead of emitting a partial manifest", async () => {
    const prisma = mockPrisma()
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          contentSlug: "",
          languageSlug: "english",
          bcp47: "en",
        },
      ])
      .mockResolvedValueOnce([])

    const service = new WatchSeoManifestService(prisma)

    await expect(service.generate()).rejects.toThrow()
  })

  it("rejects contextual child languages missing canonical coverage", async () => {
    const prisma = mockPrisma()
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          contentSlug: "pentecost",
          languageSlug: "english",
          bcp47: "en",
          hreflangPriority: 100,
        },
      ])
      .mockResolvedValueOnce([
        {
          parentSlug: "book-of-acts",
          childSlug: "pentecost",
          languageSlug: "portuguese-brazil",
          bcp47: "pt-BR",
          hreflangPriority: 500,
        },
      ])
    const service = new WatchSeoManifestService(prisma)

    await expect(service.generate()).rejects.toThrowError(
      expect.objectContaining<Partial<WatchSeoManifestCoverageError>>({
        childSlug: "pentecost",
        languageSlug: "portuguese-brazil",
      }),
    )
  })
})
