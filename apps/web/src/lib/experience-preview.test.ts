import { beforeEach, describe, expect, it, vi } from "vitest"

const { adminGraphqlMock, queryMock } = vi.hoisted(() => ({
  adminGraphqlMock: vi.fn(
    (_source: string, _dependencies?: readonly unknown[]) => ({}),
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
  adminWatchHomeCategoryRailFragment: {
    kind: "Document",
    definitions: [],
  },
  adminWatchHomeHeroFragment: {},
}))
vi.mock("@/lib/admin-client", () => ({
  default: { query: queryMock },
}))

import { getExperiencePreview } from "@/lib/experience-preview"

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

  it("keeps the legacy operation free of the title overlay", () => {
    const legacy = sources().find((source) =>
      source.includes("query LegacyExperiencePreview"),
    )

    expect(legacy).toBeDefined()
    expect(legacy).not.toContain("PreviewMediaCollectionTitles")
    expect(legacy).not.toContain("previewResolvedTitle")
  })

  it("retries once with an old-schema-safe operation for the exact unknown type error", async () => {
    const validationError = Object.assign(
      new Error('Unknown type "WatchHomeCategoryRailBlock".'),
      {
        errors: [
          {
            message: 'Unknown type "WatchHomeCategoryRailBlock".',
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
    expect(legacy).not.toContain("WatchHomeCategoryRailBlock")
  })

  it("does not retry for unrelated preview failures", async () => {
    queryMock.mockRejectedValue(new Error("request timed out"))

    await expect(getExperiencePreview("capability-token")).rejects.toThrow(
      "Experience preview query failed",
    )
    expect(queryMock).toHaveBeenCalledTimes(1)
  })

  it("never retries the legacy preview operation more than once", async () => {
    const unknownType = Object.assign(
      new Error('Unknown type "WatchHomeCategoryRailBlock".'),
      {
        errors: [
          {
            message: 'Unknown type "WatchHomeCategoryRailBlock".',
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
  })

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

  const preview = {
    experienceId: "experience-1",
    localeId: "locale-1",
    locale: "en",
    slug: "home",
    isHomepage: true,
    title: "Home",
    blocks: [],
  }

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
