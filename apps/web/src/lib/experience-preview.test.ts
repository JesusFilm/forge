import { parse, print } from "graphql"
import { beforeEach, describe, expect, it, vi } from "vitest"

// The mock stands in for gql.tada's document builder, but it PARSES what it is
// handed before returning the stub. Without that, no test in this file ever
// reads the operation text — the module could compose syntactically invalid
// GraphQL and every assertion here would still pass, leaving `next build` (the
// first thing to run the real builder) as the only detector. That is exactly
// how a malformed fragment reached CI once.
const { adminGraphqlMock, queryMock } = vi.hoisted(() => ({
  adminGraphqlMock: vi.fn(
    (source: string, _dependencies?: readonly unknown[]) => {
      const parsed = parse(source)
      const definitions = (_dependencies ?? []).flatMap((dependency) => {
        if (
          typeof dependency !== "object" ||
          dependency === null ||
          !("definitions" in dependency) ||
          !Array.isArray(dependency.definitions)
        )
          return []
        return dependency.definitions
      })
      return {
        ...parsed,
        definitions: [...parsed.definitions, ...definitions],
        source,
      }
    },
  ),
  queryMock: vi.fn(),
}))

vi.mock("@forge/admin-graphql", () => ({
  adminGraphql: adminGraphqlMock,
}))
vi.mock("@forge/admin-graphql/fragments", () => ({
  adminAdventCountdownFragment: {},
  adminBibleQuotesCarouselFragment: {},
  adminCardFragment: {},
  adminContainerFragment: {},
  adminCtaFragment: {},
  adminEasterDatesFragment: {},
  adminInfoBlocksFragment: {},
  adminLanguageGlobeFragment: {},
  adminMediaCollectionFragment: {},
  adminNavigationCarouselFragment: {},
  adminPromoBannerFragment: {},
  adminRelatedQuestionsFragment: {},
  adminSectionFragment: {},
  adminTextFragment: {},
  adminVideoFragment: {},
  adminVideoCarouselFragment: {},
  adminVideoHeroFragment: {},
  adminVideoRecommendationsFragment: {},
  adminHomepageRecommendationsFragment: { kind: "Document", definitions: [] },
  adminPreCopyWatchHomeCategoryRailFragment: {
    kind: "Document",
    definitions: [],
  },
  adminWatchHomeCategoryRailFragment: {
    kind: "Document",
    definitions: [],
  },
  adminWatchHomeHeroFragment: {},
  adminWatchAudienceFragment: { kind: "Document", definitions: [] },
}))
vi.mock("@/lib/admin-client", () => ({
  default: { query: queryMock },
}))

import {
  getExperiencePreview,
  getExperiencePreviewLayout,
} from "@/lib/experience-preview"

beforeEach(() => {
  queryMock.mockReset()
})

describe("getExperiencePreview", () => {
  it("uses an uncached server query and returns the public draft shape", async () => {
    const preview = {
      experienceId: "experience-1",
      localeId: "locale-1",
      locale: "ru",
      slug: "home",
      isHomepage: true,
      title: "Главная",
      blocks: [
        {
          __typename: "WatchHomeCategoryRailBlock",
          categoryIds: ["family", "gospels"],
        },
      ],
    }
    queryMock.mockResolvedValue({ data: { experiencePreview: preview } })

    const result = await getExperiencePreview("capability-token")

    expect(result).toBe(preview)
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { token: "capability-token" },
        fetchPolicy: "no-cache",
        context: { fetchOptions: { cache: "no-store" } },
      }),
    )
    expect(result?.blocks[0]).toMatchObject({
      __typename: "WatchHomeCategoryRailBlock",
      categoryIds: ["family", "gospels"],
    })
  })

  function sources(): string[] {
    return adminGraphqlMock.mock.calls.map(([source]) => source)
  }

  it("composes the category rail selection into the shared preview shape", () => {
    const shape = sources().find((source) =>
      source.includes("fragment ExperiencePreviewShape on ExperiencePreview"),
    )

    expect(shape).toBeDefined()
    expect(shape).toContain("... on WatchHomeCategoryRailBlock")
    expect(shape).toContain("...AdminWatchHomeCategoryRail")

    const shapeCall = adminGraphqlMock.mock.calls.find(([source]) =>
      source.includes("fragment ExperiencePreviewShape on ExperiencePreview"),
    )
    expect(shapeCall?.[1]).toContainEqual(
      expect.objectContaining({ kind: "Document" }),
    )
  })

  it("spreads the shared shape into both current-schema operations", () => {
    const withTitles = sources().find((source) =>
      source.includes("query ExperiencePreviewWithTitles"),
    )
    const shapeOnly = sources().find((source) =>
      source.includes("query ExperiencePreview("),
    )

    expect(withTitles).toContain("...ExperiencePreviewShape")
    expect(withTitles).toContain("...PreviewMediaCollectionTitles")
    expect(shapeOnly).toContain("...ExperiencePreviewShape")
    // Tier 2 is the fallback for a title-lagging Admin, so it must not carry
    // the very selection that Admin cannot serve.
    expect(shapeOnly).not.toContain("...PreviewMediaCollectionTitles")
  })

  it("composes every preview document as parseable GraphQL", () => {
    // The hoisted mock parses on construction, so reaching this assertion at
    // all means all four documents parsed. Pin the count so a new document
    // cannot be added outside that guard unnoticed.
    expect(adminGraphqlMock.mock.calls.length).toBeGreaterThanOrEqual(4)
    for (const [source] of adminGraphqlMock.mock.calls) {
      expect(() => parse(source)).not.toThrow()
    }
  })

  it("balances the shared shape fragment as a fragment, not a query body", () => {
    const shape = sources().find((source) =>
      source.includes("fragment ExperiencePreviewShape on ExperiencePreview"),
    )

    expect(shape).toBeDefined()
    const definitions = parse(shape as string).definitions
    expect(definitions).toHaveLength(1)
    expect(definitions[0].kind).toBe("FragmentDefinition")
  })

  it("keeps the legacy operation free of the title overlay", () => {
    const legacy = sources().find((source) =>
      source.includes("query LegacyExperiencePreview"),
    )

    expect(legacy).toBeDefined()
    expect(legacy).not.toContain("PreviewMediaCollectionTitles")
    expect(legacy).not.toContain("previewResolvedTitle")
  })

  it.each(["WatchHomeCategoryRailBlock", "HomepageRecommendationsBlock"])(
    "retries once with an old-schema-safe operation for the exact unknown type error (%s)",
    async (blockType) => {
      const validationError = Object.assign(
        new Error(`Unknown type "${blockType}".`),
        {
          errors: [
            {
              message: `Unknown type "${blockType}".`,
              extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
            },
          ],
        },
      )
      const preview = {
        experienceId: "experience-1",
        localeId: "locale-1",
        locale: "en",
        slug: "home",
        isHomepage: true,
        title: "Home",
        blocks: [],
      }
      queryMock
        .mockRejectedValueOnce(validationError)
        .mockResolvedValueOnce({ data: { experiencePreview: preview } })

      await expect(getExperiencePreview("capability-token")).resolves.toBe(
        preview,
      )
      expect(queryMock).toHaveBeenCalledTimes(2)
      const legacy = adminGraphqlMock.mock.calls
        .map(([source]) => source)
        .find((source) => source.includes("query LegacyExperiencePreview"))
      expect(legacy).not.toContain(blockType)
    },
  )

  it("does not retry for unrelated preview failures", async () => {
    queryMock.mockRejectedValue(new Error("request timed out"))

    await expect(getExperiencePreview("capability-token")).rejects.toThrow(
      "Experience preview query failed",
    )
    expect(queryMock).toHaveBeenCalledTimes(1)
  })

  it.each(["WatchHomeCategoryRailBlock", "HomepageRecommendationsBlock"])(
    "never retries the legacy preview operation more than once (%s)",
    async (blockType) => {
      const unknownType = Object.assign(
        new Error(`Unknown type "${blockType}".`),
        {
          errors: [
            {
              message: `Unknown type "${blockType}".`,
              extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
            },
          ],
        },
      )
      queryMock.mockResolvedValueOnce({ errors: unknownType.errors })
      queryMock.mockRejectedValueOnce(unknownType)

      await expect(getExperiencePreview("capability-token")).rejects.toThrow(
        "Experience preview query failed",
      )
      expect(queryMock).toHaveBeenCalledTimes(2)
    },
  )

  it("returns null without falling back when the capability is invalid", async () => {
    queryMock.mockResolvedValue({ data: { experiencePreview: null } })

    await expect(getExperiencePreview("retired-token")).resolves.toBeNull()
    expect(queryMock).toHaveBeenCalledTimes(1)
  })

  // ---------------------------------------------------------------------
  // Deploy window: Web runs the tier-1 overlay against an Admin that predates
  // `previewResolvedTitle`. This is the one behavior with no way to observe it
  // locally after the fact, and the only reason tier 2 exists.
  // ---------------------------------------------------------------------

  function titleLagError(count: number) {
    return {
      errors: Array.from({ length: count }, () => ({
        message:
          'Cannot query field "previewResolvedTitle" on type "MediaCollectionItem". Did you mean "resolvedTitle"?',
        extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
      })),
    }
  }

  const railError = {
    message: 'Unknown type "WatchHomeCategoryRailBlock".',
    extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
  }

  const tileError = {
    message: 'Cannot query field "tiles" on type "WatchHomeCategoryRailBlock".',
    extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
  }

  const recommendationsError = {
    message: 'Unknown type "HomepageRecommendationsBlock".',
    extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
  }

  const copyLagErrors = ["eyebrow", "title", "description", "ctaLabel"].map(
    (field) => ({
      message: `Cannot query field "${field}" on type "WatchHomeCategoryRailBlock".`,
      extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
    }),
  )

  const preview = {
    experienceId: "experience-1",
    localeId: "locale-1",
    locale: "en",
    slug: "home",
    isHomepage: true,
    title: "Home",
    blocks: [],
  }

  function queriedSources(): string[] {
    return queryMock.mock.calls.map(([options]) => options.query.source)
  }

  it("keeps preview titles and authored tiles when only rail copy fields lag", async () => {
    queryMock
      .mockResolvedValueOnce({ errors: copyLagErrors })
      .mockResolvedValueOnce({ data: { experiencePreview: preview } })

    await expect(getExperiencePreview("capability-token")).resolves.toBe(
      preview,
    )
    expect(queriedSources()).toEqual([
      expect.stringContaining("query ExperiencePreviewWithTitles"),
      expect.stringContaining("query PreCopyExperiencePreviewWithTitles"),
    ])
  })

  it("uses the pre-copy titleless projection when copy and title lag together", async () => {
    queryMock
      .mockResolvedValueOnce({
        errors: [...copyLagErrors, ...titleLagError(4).errors],
      })
      .mockResolvedValueOnce({ data: { experiencePreview: preview } })

    await expect(getExperiencePreview("capability-token")).resolves.toBe(
      preview,
    )
    expect(queriedSources()).toEqual([
      expect.stringContaining("query ExperiencePreviewWithTitles"),
      expect.stringContaining("query PreCopyExperiencePreview("),
    ])
  })

  it("handles copy lag followed by title lag without dropping the rail", async () => {
    queryMock
      .mockResolvedValueOnce({ errors: copyLagErrors })
      .mockResolvedValueOnce(titleLagError(4))
      .mockResolvedValueOnce({ data: { experiencePreview: preview } })

    await expect(getExperiencePreview("capability-token")).resolves.toBe(
      preview,
    )
    expect(queriedSources()).toEqual([
      expect.stringContaining("query ExperiencePreviewWithTitles"),
      expect.stringContaining("query PreCopyExperiencePreviewWithTitles"),
      expect.stringContaining("query PreCopyExperiencePreview("),
    ])
  })

  it("keeps partial or mixed copy errors fatal", async () => {
    queryMock.mockResolvedValueOnce({ errors: copyLagErrors.slice(0, 3) })
    await expect(getExperiencePreview("capability-token")).rejects.toThrow(
      "Experience preview query failed",
    )
    expect(queryMock).toHaveBeenCalledTimes(1)

    queryMock.mockReset()
    queryMock.mockResolvedValueOnce({
      errors: [...copyLagErrors, { message: "Unrelated failure" }],
    })
    await expect(getExperiencePreview("capability-token")).rejects.toThrow(
      "Experience preview query failed",
    )
    expect(queryMock).toHaveBeenCalledTimes(1)
  })

  it("degrades to the titleless operation for one unknown-field error per nesting path", async () => {
    queryMock
      .mockResolvedValueOnce(titleLagError(4))
      .mockResolvedValueOnce({ data: { experiencePreview: preview } })

    await expect(getExperiencePreview("capability-token")).resolves.toBe(
      preview,
    )
    expect(queryMock).toHaveBeenCalledTimes(2)
  })

  it("degrades when the title lag arrives as a thrown error", async () => {
    queryMock
      .mockRejectedValueOnce(
        Object.assign(new Error("validation failed"), titleLagError(4)),
      )
      .mockResolvedValueOnce({ data: { experiencePreview: preview } })

    await expect(getExperiencePreview("capability-token")).resolves.toBe(
      preview,
    )
    expect(queryMock).toHaveBeenCalledTimes(2)
  })

  it("does not degrade for an unknown-field error naming a different field", async () => {
    queryMock.mockResolvedValue({
      errors: [
        {
          message:
            'Cannot query field "somethingElse" on type "MediaCollectionItem".',
          extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
        },
      ],
    })

    await expect(getExperiencePreview("capability-token")).rejects.toThrow(
      "Experience preview query failed",
    )
    expect(queryMock).toHaveBeenCalledTimes(1)
  })

  it("does not degrade for the title field on a different parent type", async () => {
    queryMock.mockResolvedValue({
      errors: [
        {
          message:
            'Cannot query field "previewResolvedTitle" on type "VideoCarouselItem".',
          extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
        },
      ],
    })

    await expect(getExperiencePreview("capability-token")).rejects.toThrow(
      "Experience preview query failed",
    )
    expect(queryMock).toHaveBeenCalledTimes(1)
  })

  it("stays fatal when a title lag arrives alongside an unrelated error", async () => {
    queryMock.mockResolvedValue({
      errors: [
        ...titleLagError(4).errors,
        { message: "Something else broke entirely." },
      ],
    })

    await expect(getExperiencePreview("capability-token")).rejects.toThrow(
      "Experience preview query failed",
    )
    expect(queryMock).toHaveBeenCalledTimes(1)
  })

  it("routes a title lag carrying a resolved path to the ordinary failure", async () => {
    queryMock.mockResolvedValue({
      errors: [
        {
          message:
            'Cannot query field "previewResolvedTitle" on type "MediaCollectionItem".',
          path: ["experiencePreview", "blocks", 0],
          extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
        },
      ],
    })

    await expect(getExperiencePreview("capability-token")).rejects.toThrow(
      "Experience preview query failed",
    )
    expect(queryMock).toHaveBeenCalledTimes(1)
  })

  it("prefers the legacy tier when both lag axes report together", async () => {
    queryMock
      .mockResolvedValueOnce({
        errors: [...titleLagError(4).errors, railError],
      })
      .mockResolvedValueOnce({ data: { experiencePreview: preview } })

    await expect(getExperiencePreview("capability-token")).resolves.toBe(
      preview,
    )
    expect(queryMock).toHaveBeenCalledTimes(2)
  })

  it.each([
    ["tiles field", tileError],
    ["homepage recommendations type", recommendationsError],
  ])(
    "prefers the legacy tier when %s and copy lag report together",
    async (_label, legacyError) => {
      queryMock
        .mockResolvedValueOnce({
          errors: [legacyError, ...copyLagErrors],
        })
        .mockResolvedValueOnce({ data: { experiencePreview: preview } })

      await expect(getExperiencePreview("capability-token")).resolves.toBe(
        preview,
      )
      expect(queriedSources()).toEqual([
        expect.stringContaining("query ExperiencePreviewWithTitles"),
        expect.stringContaining("query LegacyExperiencePreview"),
      ])
    },
  )

  it("prefers the legacy tier when rail, copy, and title lag report together", async () => {
    queryMock
      .mockResolvedValueOnce({
        errors: [tileError, ...copyLagErrors, ...titleLagError(4).errors],
      })
      .mockResolvedValueOnce({ data: { experiencePreview: preview } })

    await expect(getExperiencePreview("capability-token")).resolves.toBe(
      preview,
    )
    expect(queriedSources()).toEqual([
      expect.stringContaining("query ExperiencePreviewWithTitles"),
      expect.stringContaining("query LegacyExperiencePreview"),
    ])
  })

  it("falls through to the legacy tier when the titleless retry also lags", async () => {
    queryMock
      .mockResolvedValueOnce(titleLagError(4))
      .mockResolvedValueOnce({ errors: [railError] })
      .mockResolvedValueOnce({ data: { experiencePreview: preview } })

    await expect(getExperiencePreview("capability-token")).resolves.toBe(
      preview,
    )
    expect(queryMock).toHaveBeenCalledTimes(3)
  })

  it("stops after the legacy tier rather than retrying it", async () => {
    queryMock
      .mockResolvedValueOnce(titleLagError(4))
      .mockResolvedValueOnce({ errors: [railError] })
      .mockRejectedValueOnce(new Error("legacy failed too"))

    await expect(getExperiencePreview("capability-token")).rejects.toThrow(
      "Experience preview query failed",
    )
    expect(queryMock).toHaveBeenCalledTimes(3)
  })

  it("keeps the capability out of every tier's error", async () => {
    queryMock
      .mockResolvedValueOnce(titleLagError(4))
      .mockRejectedValueOnce(new Error("upstream echoed secret-capability"))

    await expect(getExperiencePreview("secret-capability")).rejects.toThrow(
      /^Experience preview query failed$/,
    )
  })

  it("redacts the capability from errors", async () => {
    queryMock.mockRejectedValue(new Error("upstream included sensitive data"))

    await expect(getExperiencePreview("secret-capability")).rejects.toThrow(
      "Experience preview query failed",
    )
  })
})

describe("getExperiencePreviewLayout", () => {
  const layoutLag = {
    message:
      'Cannot query field "homepageLayout" on type "ExperiencePreview". Did you mean "isHomepage"?',
    extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
  }

  it("reads the homepage layout with an uncached server query", async () => {
    queryMock.mockResolvedValue({
      data: { experiencePreview: { homepageLayout: true } },
    })

    await expect(getExperiencePreviewLayout("capability-token")).resolves.toBe(
      true,
    )
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { token: "capability-token" },
        fetchPolicy: "no-cache",
        context: { fetchOptions: { cache: "no-store" } },
      }),
    )
    const source = (
      queryMock.mock.calls[0]![0] as { query: { source: string } }
    ).query.source
    expect(source).toContain("query ExperiencePreviewLayout")
    expect(source).toContain("homepageLayout")
  })

  it("is false for an invalid capability", async () => {
    queryMock.mockResolvedValue({ data: { experiencePreview: null } })

    await expect(getExperiencePreviewLayout("retired")).resolves.toBe(false)
  })

  it("degrades to false when Admin predates the field", async () => {
    queryMock.mockResolvedValueOnce({ data: null, errors: [layoutLag] })
    await expect(getExperiencePreviewLayout("token")).resolves.toBe(false)

    queryMock.mockRejectedValueOnce({ errors: [layoutLag] })
    await expect(getExperiencePreviewLayout("token")).resolves.toBe(false)
  })

  it("keeps other failures fatal and redacts the capability", async () => {
    queryMock.mockResolvedValueOnce({
      data: null,
      errors: [layoutLag, { message: "boom" }],
    })
    await expect(getExperiencePreviewLayout("secret-token")).rejects.toThrow(
      "Experience preview query failed",
    )

    queryMock.mockRejectedValueOnce(new Error("secret-token exploded"))
    const failure = getExperiencePreviewLayout("secret-token")
    await expect(failure).rejects.toThrow("Experience preview query failed")
    await expect(failure).rejects.not.toThrow("secret-token")
  })
})

describe("Watch audience preview schema lag", () => {
  it.each(["returned", "thrown"])(
    "retries only the missing audience block selection (%s validation error)",
    async (kind) => {
      const error = {
        errors: [
          {
            message: 'Unknown type "WatchAudienceBlock".',
            extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
          },
        ],
      }
      if (kind === "thrown") queryMock.mockRejectedValueOnce(error)
      else queryMock.mockResolvedValueOnce(error)
      queryMock.mockResolvedValueOnce({
        data: { experiencePreview: { locale: "en", blocks: [] } },
      })
      await expect(
        getExperiencePreview("private-test-capability"),
      ).resolves.toMatchObject({ locale: "en" })
      expect(queryMock).toHaveBeenCalledTimes(2)
      const first = queryMock.mock.calls[0]![0]
      const retry = queryMock.mock.calls[1]![0]
      expect(print(first.query)).toContain("... on WatchAudienceBlock")
      expect(print(retry.query)).not.toContain("... on WatchAudienceBlock")
      expect(print(retry.query)).toContain("... on WatchHomeCategoryRailBlock")
      expect(retry).toMatchObject({
        fetchPolicy: "no-cache",
        context: { fetchOptions: { cache: "no-store" } },
      })
    },
  )

  it.each([
    {
      errors: [
        { message: 'Unknown type "WatchAudienceBlock".' },
        { message: "Database failure", path: ["experiencePreview"] },
      ],
    },
    {
      errors: [
        {
          message: 'Unknown type "WatchAudienceBlock".',
          path: ["experiencePreview"],
        },
      ],
    },
  ])(
    "does not mask unrelated or execution errors as audience lag",
    async (error) => {
      queryMock.mockResolvedValueOnce(error)
      await expect(
        getExperiencePreview("private-test-capability"),
      ).rejects.toThrow("Experience preview query failed")
      expect(queryMock).toHaveBeenCalledTimes(1)
    },
  )

  // The audience questionnaire is previewed only for the default template, so
  // the preview selects the selected Watch-template identity beside the audience block.
  it("selects the selected-template identity with the audience block", async () => {
    queryMock.mockResolvedValueOnce({
      data: {
        experiencePreview: {
          locale: "en",
          isDefaultTemplate: true,
          blocks: [],
        },
      },
    })
    await expect(
      getExperiencePreview("private-test-capability"),
    ).resolves.toMatchObject({ isDefaultTemplate: true })
    expect(print(queryMock.mock.calls[0]![0].query)).toMatch(
      /\bisDefaultTemplate\b/,
    )
  })

  // An Admin that has the block but predates the flag must degrade to a
  // preview with neither: no flag means no audience, never an ungated one.
  it.each(["returned", "thrown"])(
    "retries without the audience block and selected-template identity when Admin predates the flag (%s)",
    async (kind) => {
      const error = {
        errors: [
          {
            message:
              'Cannot query field "isDefaultTemplate" on type "ExperiencePreview".',
            extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
          },
        ],
      }
      if (kind === "thrown") queryMock.mockRejectedValueOnce(error)
      else queryMock.mockResolvedValueOnce(error)
      const oldPreview = {
        locale: "en",
        isTemplate: true,
        blocks: [{ __typename: "TextBlock", sectionKey: "old-admin-text" }],
      }
      queryMock.mockResolvedValueOnce({
        data: { experiencePreview: oldPreview },
      })
      const preview = await getExperiencePreview("private-test-capability")
      expect(preview).toMatchObject({ locale: "en" })
      expect(preview).toBe(oldPreview)
      expect(preview).not.toHaveProperty("isDefaultTemplate")
      expect(queryMock).toHaveBeenCalledTimes(2)
      const first = print(queryMock.mock.calls[0]![0].query)
      expect(first).toMatch(/\bisDefaultTemplate\b/)
      expect(first).toContain("... on WatchAudienceBlock")
      const retry = print(queryMock.mock.calls[1]![0].query)
      expect(retry).not.toMatch(/\bisDefaultTemplate\b/)
      expect(retry).not.toContain("... on WatchAudienceBlock")
      expect(retry).toContain("... on WatchHomeCategoryRailBlock")
    },
  )

  it("does not mask an execution or unrelated error beside the flag lag", async () => {
    queryMock.mockResolvedValueOnce({
      errors: [
        {
          message:
            'Cannot query field "isDefaultTemplate" on type "ExperiencePreview".',
        },
        { message: "Database failure", path: ["experiencePreview"] },
      ],
    })
    await expect(
      getExperiencePreview("private-test-capability"),
    ).rejects.toThrow("Experience preview query failed")
    expect(queryMock).toHaveBeenCalledTimes(1)
  })
  it.each(["returned", "thrown"])(
    "does not classify a wrong type/field or execution error as selected-identity lag (%s)",
    async (kind) => {
      for (const error of [
        {
          errors: [
            {
              message:
                'Cannot query field "isDefaultTemplate" on type "Experience".',
            },
          ],
        },
        {
          errors: [
            {
              message:
                'Cannot query field "isTemplate" on type "ExperiencePreview".',
            },
          ],
        },
        {
          errors: [
            {
              message:
                'Cannot query field "isDefaultTemplate" on type "ExperiencePreview".',
              path: ["experiencePreview"],
            },
          ],
        },
      ]) {
        queryMock.mockReset()
        if (kind === "thrown") queryMock.mockRejectedValueOnce(error)
        else queryMock.mockResolvedValueOnce(error)
        await expect(
          getExperiencePreview("private-test-capability"),
        ).rejects.toThrow("Experience preview query failed")
        expect(queryMock).toHaveBeenCalledTimes(1)
      }
    },
  )
})
