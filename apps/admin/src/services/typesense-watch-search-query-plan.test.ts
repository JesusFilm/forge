import { beforeEach, describe, expect, it, vi } from "vitest"

import type { SearchLanguageResolution } from "./search-language-resolution"
import { buildTypesenseWatchSearchQueryPlan } from "./typesense-watch-search-query-plan"

const languages = [
  {
    slug: "japanese",
    bcp47: "ja",
    name: { en: "Japanese" },
    locales: [{ locale: "ja", value: "日本語", primary: true }],
  },
  {
    slug: "spanish-castilian",
    bcp47: "es",
    name: { en: "Spanish" },
    locales: [{ locale: "es", value: "Español", primary: true }],
  },
]

function baseResolution(
  overrides: Partial<SearchLanguageResolution> = {},
): SearchLanguageResolution {
  return {
    targetLanguageSlug: "english",
    targetLanguageSource: "fallback",
    queryLanguageSlug: null,
    queryNamedLanguageSlug: null,
    displayLanguageSlug: null,
    displayLanguageBcp47: null,
    routeLanguageSlug: null,
    routeLanguageBcp47: null,
    currentWatchLanguageSlug: null,
    acceptLanguage: null,
    acceptLanguageSlug: null,
    ...overrides,
  }
}

function prismaFixture(rows = languages) {
  return {
    language: {
      findMany: vi.fn(async () => rows),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe("buildTypesenseWatchSearchQueryPlan", () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ["Jesus Japanese", "Jesus"],
    ["Jesus 日本語", "Jesus"],
  ])(
    "separates a named Japanese target from %s",
    async (query, contentQuery) => {
      const plan = await buildTypesenseWatchSearchQueryPlan({
        prisma: prismaFixture(),
        query,
        baseResolution: baseResolution(),
      })

      expect(plan).toMatchObject({
        contentQuery,
        namedLanguageSlug: "japanese",
        targetLanguageSlug: "japanese",
        targetLanguageSource: "query_named_language",
      })
      expect(plan.languageCandidates[0]).toMatchObject({
        slug: "japanese",
        reason: "named_language",
      })
    },
  )

  it("keeps an explicit Spanish target ahead of a Japanese query name", async () => {
    const plan = await buildTypesenseWatchSearchQueryPlan({
      prisma: prismaFixture(),
      query: "Jesus Japanese",
      baseResolution: baseResolution({
        targetLanguageSlug: "spanish-castilian",
        targetLanguageSource: "explicit_target",
      }),
    })

    expect(plan).toMatchObject({
      contentQuery: "Jesus",
      namedLanguageSlug: "japanese",
      targetLanguageSlug: "spanish-castilian",
      targetLanguageSource: "explicit_target",
    })
    expect(plan.languageCandidates.map(({ slug }) => slug)).toEqual([
      "japanese",
      "spanish-castilian",
    ])
  })

  it("preserves duplicate localized names as deterministic top-three evidence", async () => {
    const arabicLanguages = [
      "arabic-egyptian",
      "arabic-gulf",
      "arabic-levantine",
      "arabic-modern-standard",
    ].map((slug) => ({
      slug,
      bcp47: "ar",
      name: { en: "Arabic" },
      locales: [{ locale: "ar", value: "العربية", primary: true }],
    }))
    const plan = await buildTypesenseWatchSearchQueryPlan({
      prisma: prismaFixture(arabicLanguages),
      query: "hope Arabic",
      baseResolution: baseResolution({
        targetLanguageSlug: "arabic-modern-standard",
        targetLanguageSource: "query_script",
      }),
    })

    expect(plan.contentQuery).toBe("hope")
    expect(plan.namedLanguageSlug).toBeNull()
    expect(plan.languageCandidates).toHaveLength(3)
    expect(plan.languageCandidates.map(({ slug }) => slug)).toEqual([
      "arabic-egyptian",
      "arabic-gulf",
      "arabic-levantine",
    ])
  })

  it("does not consume short BCP-47 or slug collisions in ordinary content", async () => {
    const plan = await buildTypesenseWatchSearchQueryPlan({
      prisma: prismaFixture([
        {
          slug: "in",
          bcp47: "id",
          name: { en: "Indonesian" },
          locales: [],
        },
      ]),
      query: "hope in Jesus",
      baseResolution: baseResolution(),
    })

    expect(plan.contentQuery).toBe("hope in Jesus")
    expect(plan.languageCandidates).toEqual([])
  })

  it("recognizes an explicitly marked short BCP-47 alias", async () => {
    const plan = await buildTypesenseWatchSearchQueryPlan({
      prisma: prismaFixture(),
      query: "Jesus language:ja",
      baseResolution: baseResolution(),
    })

    expect(plan).toMatchObject({
      contentQuery: "Jesus",
      namedLanguageSlug: "japanese",
      targetLanguageSlug: "japanese",
    })
  })

  it("retains non-empty content for a language-only query", async () => {
    const plan = await buildTypesenseWatchSearchQueryPlan({
      prisma: prismaFixture(),
      query: "Japanese",
      baseResolution: baseResolution(),
    })

    expect(plan.contentQuery).toBe("Japanese")
    expect(plan.namedLanguageSlug).toBe("japanese")
  })

  it("caches one bounded active alias index per Prisma client", async () => {
    const prisma = prismaFixture()
    await buildTypesenseWatchSearchQueryPlan({
      prisma,
      query: "Jesus Japanese",
      baseResolution: baseResolution(),
    })
    await buildTypesenseWatchSearchQueryPlan({
      prisma,
      query: "Jesus 日本語",
      baseResolution: baseResolution(),
    })

    expect(prisma.language.findMany).toHaveBeenCalledTimes(1)
  })
})
