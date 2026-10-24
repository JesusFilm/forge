import { Prisma } from "@prisma/client"
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

function renderedSql(call: unknown[]): Prisma.Sql {
  const [strings, ...values] = call
  return Prisma.sql(strings as TemplateStringsArray, ...values)
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
        },
        {
          contentSlug: "pentecost",
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

  it("excludes watch-restricted videos on every video the routes depend on", async () => {
    const prisma = mockPrisma()
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    await new WatchSeoManifestService(prisma).generate()

    const [contentSql, episodeSql] = prisma.$queryRaw.mock.calls.map(
      (call: unknown[]) => renderedSql(call).sql,
    )
    for (const alias of ["v", "parent", "child"]) {
      expect(contentSql).toContain(
        `NOT ('watch' = ANY(${alias}.restrict_view_platforms))`,
      )
    }
    for (const alias of ["parent", "child"]) {
      expect(episodeSql).toContain(
        `NOT ('watch' = ANY(${alias}.restrict_view_platforms))`,
      )
    }
  })

  it("inherits child languages only for parents Watch renders as a series", async () => {
    const prisma = mockPrisma()
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    await new WatchSeoManifestService(prisma).generate()

    const content = renderedSql(prisma.$queryRaw.mock.calls[0])
    const parentAudio = content.sql.slice(
      content.sql.indexOf("parent_video_audio AS"),
    )
    expect(parentAudio).toMatch(
      /parent\.label IS NULL\s+OR parent\.label::text = ANY\(\?::text\[\]\)/,
    )
    // A feature film with chapters plays only its own Dubs (N58).
    expect(content.values).toContainEqual(["collection", "series"])
    expect(content.values).not.toContainEqual(
      expect.arrayContaining(["featureFilm"]),
    )
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
