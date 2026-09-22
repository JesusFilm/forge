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
        },
        {
          contentSlug: "jesus",
          languageSlug: "spanish-castilian",
          bcp47: "es",
        },
        {
          contentSlug: "jesus",
          languageSlug: "spanish-latin-american",
          bcp47: "es",
        },
        {
          contentSlug: "jesus",
          languageSlug: "bad-script",
          bcp47: "zh-Hans",
        },
        {
          contentSlug: "pentecost",
          languageSlug: "english",
          bcp47: "en",
        },
        {
          contentSlug: "pentecost",
          languageSlug: "portuguese-brazil",
          bcp47: "pt-BR",
        },
      ])
      .mockResolvedValueOnce([
        {
          parentSlug: "book-of-acts",
          childSlug: "pentecost",
          languageSlug: "english",
          bcp47: "en",
        },
        {
          parentSlug: "book-of-acts",
          childSlug: "pentecost",
          languageSlug: "portuguese-brazil",
          bcp47: "pt-BR",
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
          alternates: [
            { hreflang: "en", languageSlug: "english" },
            { hreflang: "es", languageSlug: "spanish-castilian" },
          ],
          // Every playable language keeps a canonical URL, including the ones
          // the hreflang cluster drops as unsupported (`bad-script`) or
          // duplicate (`spanish-latin-american`).
          languageSlugs: [
            "bad-script",
            "english",
            "spanish-castilian",
            "spanish-latin-american",
          ],
        },
        {
          contentSlug: "pentecost",
          alternates: [
            { hreflang: "en", languageSlug: "english" },
            { hreflang: "pt-BR", languageSlug: "portuguese-brazil" },
          ],
          languageSlugs: ["english", "portuguese-brazil"],
        },
      ],
      episodeRouteGroups: [
        {
          parentSlug: "book-of-acts",
          childSlug: "pentecost",
          alternates: [
            { hreflang: "en", languageSlug: "english" },
            { hreflang: "pt-BR", languageSlug: "portuguese-brazil" },
          ],
        },
      ],
      skippedHreflangValues: {
        "duplicate:es": 1,
        "zh-Hans": 1,
      },
    })
    expect(summarizeWatchSeoManifest(manifest)).toMatchObject({
      videoRouteGroups: 2,
      episodeRouteGroups: 1,
      alternateLinks: 6,
      canonicalVideoUrls: 6,
      skippedHreflangValues: 2,
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
  })

  it("keeps every playable audio language in languageSlugs even without a Google hreflang", async () => {
    const prisma = mockPrisma()
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { contentSlug: "jesus", languageSlug: "english", bcp47: "en" },
        { contentSlug: "jesus", languageSlug: "cebuano", bcp47: "ceb" },
        { contentSlug: "jesus", languageSlug: "ilocano", bcp47: null },
        { contentSlug: "jesus", languageSlug: "hiligaynon", bcp47: "hil" },
      ])
      .mockResolvedValueOnce([])

    const service = new WatchSeoManifestService(prisma)
    const manifest = await service.generate()

    expect(manifest.videoRouteGroups[0]?.languageSlugs).toEqual([
      "cebuano",
      "english",
      "hiligaynon",
      "ilocano",
    ])
    expect(manifest.videoRouteGroups[0]?.alternates).toEqual([
      { hreflang: "en", languageSlug: "english" },
    ])
  })

  it("keeps a content group whose languages all lack a Google hreflang", async () => {
    const prisma = mockPrisma()
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { contentSlug: "jesus", languageSlug: "cebuano", bcp47: "ceb" },
      ])
      .mockResolvedValueOnce([])

    const service = new WatchSeoManifestService(prisma)
    const manifest = await service.generate()

    expect(manifest.videoRouteGroups).toEqual([
      {
        contentSlug: "jesus",
        alternates: [],
        languageSlugs: ["cebuano"],
      },
    ])
    expect(manifest.skippedHreflangValues).toEqual({ ceb: 1 })
  })

  it("de-dupes repeated language slugs across the content and parent unions", async () => {
    const prisma = mockPrisma()
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { contentSlug: "jesus", languageSlug: "cebuano", bcp47: "ceb" },
        { contentSlug: "jesus", languageSlug: "cebuano", bcp47: "ceb" },
        { contentSlug: "jesus", languageSlug: "english", bcp47: "en" },
      ])
      .mockResolvedValueOnce([])

    const service = new WatchSeoManifestService(prisma)
    const manifest = await service.generate()

    expect(manifest.videoRouteGroups[0]?.languageSlugs).toEqual([
      "cebuano",
      "english",
    ])
    expect(summarizeWatchSeoManifest(manifest)).toMatchObject({
      canonicalVideoUrls: 2,
    })
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
        },
      ])
      .mockResolvedValueOnce([
        {
          parentSlug: "book-of-acts",
          childSlug: "pentecost",
          languageSlug: "portuguese-brazil",
          bcp47: "pt-BR",
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
