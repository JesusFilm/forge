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

describe("resolveSearchLanguageSignals", () => {
  let prisma: ReturnType<typeof mockPrisma>

  beforeEach(() => {
    prisma = mockPrisma()
    prisma.$queryRaw.mockResolvedValue([])
    prisma.language.findMany.mockResolvedValue([])
  })

  it("lets the explicit target language win over query-named and route signals", async () => {
    const result = await resolveSearchLanguageSignals({
      prisma,
      input: {
        targetLanguageSlug: "spanish-castilian",
        queryNamedLanguageSlug: "russian",
        routeLanguageSlug: "english",
        acceptLanguage: "fr-FR,fr;q=0.9",
      },
    })

    expect(result).toMatchObject({
      targetLanguageSlug: "spanish-castilian",
      targetLanguageSource: "explicit_target",
      queryNamedLanguageSlug: "russian",
      routeLanguageSlug: "english",
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
          bcp47: { in: ["fr-FR", "pt-BR"] },
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
