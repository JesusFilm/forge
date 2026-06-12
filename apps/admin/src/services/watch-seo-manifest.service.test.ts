import { describe, expect, it, vi } from "vitest"
import {
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
      videoRouteGroups: 1,
      episodeRouteGroups: 1,
      alternateLinks: 4,
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
})
