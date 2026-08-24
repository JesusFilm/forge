import { beforeEach, describe, expect, it, vi } from "vitest"

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))

vi.mock("@forge/admin-graphql", () => ({
  adminGraphql: vi.fn(() => ({})),
}))
vi.mock("@forge/admin-graphql/fragments", () => ({
  adminAdventCountdownFragment: {},
  adminBibleQuotesCarouselFragment: {},
  adminCardFragment: {},
  adminContainerFragment: {},
  adminCtaFragment: {},
  adminEasterDatesFragment: {},
  adminInfoBlocksFragment: {},
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
      blocks: [],
    }
    queryMock.mockResolvedValue({ data: { experiencePreview: preview } })

    await expect(getExperiencePreview("capability-token")).resolves.toBe(
      preview,
    )
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { token: "capability-token" },
        fetchPolicy: "no-cache",
        context: { fetchOptions: { cache: "no-store" } },
      }),
    )
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
