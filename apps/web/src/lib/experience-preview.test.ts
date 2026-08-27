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

  it("composes the category rail selection into the preview operation", () => {
    const [source, dependencies] = adminGraphqlMock.mock.calls[0]

    expect(source).toContain("... on WatchHomeCategoryRailBlock")
    expect(source).toContain("...AdminWatchHomeCategoryRail")
    expect(dependencies).toContainEqual(
      expect.objectContaining({ kind: "Document" }),
    )
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
    expect(adminGraphqlMock.mock.calls[1][0]).not.toContain(
      "WatchHomeCategoryRailBlock",
    )
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

  it("redacts the capability from errors", async () => {
    queryMock.mockRejectedValue(new Error("upstream included sensitive data"))

    await expect(getExperiencePreview("secret-capability")).rejects.toThrow(
      "Experience preview query failed",
    )
  })
})
