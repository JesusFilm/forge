import { beforeEach, describe, expect, it, vi } from "vitest"

import { resolveSearchLanguageSignals } from "./search-language-resolution"

function mockPrisma() {
  return {
    $queryRaw: vi.fn(),
    language: {
      findMany: vi.fn(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const activeLanguages = [
  { bcp47: "en", slug: "english" },
  { bcp47: "es", slug: "spanish-castilian" },
  { bcp47: "fr", slug: "french" },
  { bcp47: "pt-BR", slug: "portuguese-brazil" },
  { bcp47: "ru", slug: "russian" },
]

describe("resolveSearchLanguageSignals", () => {
  let prisma: ReturnType<typeof mockPrisma>

  beforeEach(() => {
    prisma = mockPrisma()
    prisma.$queryRaw.mockResolvedValue([])
    prisma.language.findMany.mockResolvedValue(activeLanguages)
  })

  it("lets the explicit target language win over every lower-priority signal", async () => {
    const result = await resolveSearchLanguageSignals({
      prisma,
      input: {
        targetLanguageSlug: "spanish-castilian",
        queryNamedLanguageSlug: "russian",
        currentWatchLanguageSlug: "french",
        routeLanguageSlug: "english",
        displayLanguageSlug: "portuguese-brazil",
        acceptLanguage: "fr-FR,fr;q=0.9",
      },
    })

    expect(result).toMatchObject({
      targetLanguageSlug: "spanish-castilian",
      targetLanguageSource: "explicit_target",
      queryNamedLanguageSlug: "russian",
      currentWatchLanguageSlug: "french",
      routeLanguageSlug: "english",
      displayLanguageSlug: "portuguese-brazil",
    })
  })

  it.each(["en", "en-US", "EN-us"])(
    "canonicalizes %s to English without changing its source",
    async (targetLanguageSlug) => {
      const result = await resolveSearchLanguageSignals({
        prisma,
        input: { targetLanguageSlug },
      })

      expect(result).toMatchObject({
        targetLanguageSlug: "english",
        targetLanguageSource: "explicit_target",
      })
    },
  )

  it("preserves a canonical slug with case-insensitive exact matching", async () => {
    const result = await resolveSearchLanguageSignals({
      prisma,
      input: { routeLanguageSlug: "EnGliSh" },
    })

    expect(result).toMatchObject({
      targetLanguageSlug: "english",
      targetLanguageSource: "route",
      routeLanguageSlug: "english",
    })
  })

  it("prefers an exact canonical slug over the same value as a BCP-47 tag", async () => {
    prisma.language.findMany.mockResolvedValueOnce([
      { bcp47: "zz", slug: "en" },
      { bcp47: "en", slug: "english" },
    ])

    const result = await resolveSearchLanguageSignals({
      prisma,
      input: { targetLanguageSlug: "EN" },
    })

    expect(result).toMatchObject({
      targetLanguageSlug: "en",
      targetLanguageSource: "explicit_target",
    })
  })

  it("resolves a uniquely matching regional BCP-47 tag", async () => {
    const result = await resolveSearchLanguageSignals({
      prisma,
      input: { displayLanguageSlug: "PT-br" },
    })

    expect(result).toMatchObject({
      targetLanguageSlug: "portuguese-brazil",
      targetLanguageSource: "display",
      displayLanguageSlug: "portuguese-brazil",
    })
  })

  it("falls through when a complete BCP-47 tag maps to multiple slugs", async () => {
    prisma.language.findMany.mockResolvedValueOnce([
      { bcp47: "pt-BR", slug: "portuguese-brazil" },
      { bcp47: "pt-BR", slug: "portuguese-brazil-legacy" },
      { bcp47: "en", slug: "english" },
    ])

    const result = await resolveSearchLanguageSignals({
      prisma,
      input: {
        targetLanguageSlug: "pt-BR",
        routeLanguageSlug: "en",
      },
    })

    expect(result).toMatchObject({
      targetLanguageSlug: "english",
      targetLanguageSource: "route",
    })
  })

  it("falls through when a less-specific primary tag is ambiguous", async () => {
    prisma.language.findMany.mockResolvedValueOnce([
      { bcp47: "en", slug: "english" },
      { bcp47: "en", slug: "english-legacy" },
      { bcp47: "fr", slug: "french" },
    ])

    const result = await resolveSearchLanguageSignals({
      prisma,
      input: {
        currentWatchLanguageSlug: "en-US",
        displayLanguageSlug: "fr",
      },
    })

    expect(result).toMatchObject({
      targetLanguageSlug: "french",
      targetLanguageSource: "display",
    })
  })

  it("falls through unknown language identities to the next valid signal", async () => {
    const result = await resolveSearchLanguageSignals({
      prisma,
      input: {
        targetLanguageSlug: "zz-ZZ",
        routeLanguageSlug: "en-US",
      },
    })

    expect(result).toMatchObject({
      targetLanguageSlug: "english",
      targetLanguageSource: "route",
    })
  })

  it("falls back to English when every supplied identity is unknown", async () => {
    const result = await resolveSearchLanguageSignals({
      prisma,
      input: { targetLanguageSlug: "zz-ZZ" },
    })

    expect(result).toMatchObject({
      targetLanguageSlug: "english",
      targetLanguageSource: "fallback",
    })
  })

  it("keeps query-language and query-named-language values canonical", async () => {
    const result = await resolveSearchLanguageSignals({
      prisma,
      input: {
        queryLanguageSlug: "EN-us",
        queryNamedLanguageSlug: "RU-ru",
        routeLanguageSlug: "fr",
      },
    })

    expect(result).toMatchObject({
      targetLanguageSlug: "russian",
      targetLanguageSource: "query_named_language",
      queryLanguageSlug: "english",
      queryNamedLanguageSlug: "russian",
    })
  })

  it("uses a query-named language when no explicit target is present", async () => {
    const result = await resolveSearchLanguageSignals({
      prisma,
      input: {
        queryNamedLanguageSlug: "russian",
        routeLanguageSlug: "english",
      },
    })

    expect(result).toMatchObject({
      targetLanguageSlug: "russian",
      targetLanguageSource: "query_named_language",
      queryNamedLanguageSlug: "russian",
      routeLanguageSlug: "english",
    })
  })

  it("infers a query-named language from the search text", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ slug: "maori" }])

    const result = await resolveSearchLanguageSignals({
      prisma,
      input: {
        query: "jesus maori",
        routeLanguageSlug: "english",
      },
    })

    expect(result).toMatchObject({
      targetLanguageSlug: "maori",
      targetLanguageSource: "query_named_language",
      queryNamedLanguageSlug: "maori",
      routeLanguageSlug: "english",
    })
  })

  it("uses script detection before route fallback", async () => {
    const result = await resolveSearchLanguageSignals({
      prisma,
      input: {
        query: "Иисус и надежда",
        routeLanguageSlug: "english",
      },
    })

    expect(result).toMatchObject({
      targetLanguageSlug: "russian",
      targetLanguageSource: "query_script",
      queryNamedLanguageSlug: null,
      routeLanguageSlug: "english",
    })
  })

  it("keeps the explicit target ahead of an inferred query language", async () => {
    const result = await resolveSearchLanguageSignals({
      prisma,
      input: {
        query: "jesus maori",
        targetLanguageSlug: "spanish-castilian",
        routeLanguageSlug: "english",
      },
    })

    expect(result).toMatchObject({
      targetLanguageSlug: "spanish-castilian",
      targetLanguageSource: "explicit_target",
      queryNamedLanguageSlug: null,
    })
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it("falls back through current watch, route, display, accept-language, and English", async () => {
    await expect(
      resolveSearchLanguageSignals({
        prisma,
        input: { currentWatchLanguageSlug: "french", routeLanguageSlug: "en" },
      }),
    ).resolves.toMatchObject({
      targetLanguageSlug: "french",
      targetLanguageSource: "current_watch",
    })

    await expect(
      resolveSearchLanguageSignals({
        prisma,
        input: { routeLanguageSlug: "spanish-castilian" },
      }),
    ).resolves.toMatchObject({
      targetLanguageSlug: "spanish-castilian",
      targetLanguageSource: "route",
    })

    await expect(
      resolveSearchLanguageSignals({
        prisma,
        input: { displayLanguageSlug: "portuguese-brazil" },
      }),
    ).resolves.toMatchObject({
      targetLanguageSlug: "portuguese-brazil",
      targetLanguageSource: "display",
    })

    await expect(
      resolveSearchLanguageSignals({ prisma, input: {} }),
    ).resolves.toMatchObject({
      targetLanguageSlug: "english",
      targetLanguageSource: "fallback",
    })
  })

  it("maps Accept-Language to a supported Admin language slug in header priority order", async () => {
    prisma.language.findMany.mockResolvedValueOnce([
      { bcp47: "fr-FR", slug: "french" },
      { bcp47: "pt-BR", slug: "portuguese-brazil" },
    ])

    const result = await resolveSearchLanguageSignals({
      prisma,
      input: { acceptLanguage: "pt-BR;q=0.7, fr-FR;q=0.9" },
    })

    expect(prisma.language.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          OR: expect.arrayContaining([
            {
              bcp47: {
                in: ["fr-fr", "fr", "pt-br", "pt"],
                mode: "insensitive",
              },
            },
          ]),
        }),
      }),
    )
    expect(result).toMatchObject({
      targetLanguageSlug: "french",
      targetLanguageSource: "accept_language",
      acceptLanguageSlug: "french",
    })
  })
})
