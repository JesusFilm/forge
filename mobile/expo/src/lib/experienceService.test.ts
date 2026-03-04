import type { ApolloClient } from "@apollo/client"

import { getWatchHome, getExperienceBySlug } from "./experienceService"

const mockClient = (queryFn: jest.Mock): ApolloClient =>
  ({ query: queryFn }) as unknown as ApolloClient

const fakeExperience = {
  documentId: "doc-1",
  slug: "homepage",
  sections: [],
}

describe("getWatchHome", () => {
  it("returns data on success", async () => {
    const query = jest.fn().mockResolvedValue({
      data: { experiences: [fakeExperience] },
    })
    const result = await getWatchHome(mockClient(query), "en")

    expect(result).toEqual({ data: fakeExperience, error: null })
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { locale: "en", filters: { isHomepage: { eq: true } } },
      }),
    )
  })

  it("returns error when experiences array is empty", async () => {
    const query = jest.fn().mockResolvedValue({
      data: { experiences: [] },
    })
    const result = await getWatchHome(mockClient(query), "en")

    expect(result.data).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
    expect((result.error as Error).message).toBe("No experience found")
  })

  it("returns error when result.error is present", async () => {
    const apolloError = { message: "GraphQL error", graphQLErrors: [] }
    const query = jest.fn().mockResolvedValue({
      data: { experiences: [] },
      error: apolloError,
    })
    const result = await getWatchHome(mockClient(query), "en")

    expect(result).toEqual({ data: null, error: apolloError })
  })

  it("catches network errors", async () => {
    const query = jest.fn().mockRejectedValue(new Error("Network failure"))
    const result = await getWatchHome(mockClient(query), "en")

    expect(result.data).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
    expect((result.error as Error).message).toBe("Network failure")
  })
})

describe("getExperienceBySlug", () => {
  it("returns data with slug filter", async () => {
    const query = jest.fn().mockResolvedValue({
      data: { experiences: [{ ...fakeExperience, slug: "about" }] },
    })
    const result = await getExperienceBySlug(mockClient(query), "about", "en")

    expect(result.data).toEqual({ ...fakeExperience, slug: "about" })
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { locale: "en", filters: { slug: { eq: "about" } } },
      }),
    )
  })

  it("returns error when slug not found", async () => {
    const query = jest.fn().mockResolvedValue({
      data: { experiences: [] },
    })
    const result = await getExperienceBySlug(
      mockClient(query),
      "nonexistent",
      "en",
    )

    expect(result.data).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
    expect((result.error as Error).message).toBe("No experience found")
  })

  it("returns error when result.error is present", async () => {
    const apolloError = { message: "GraphQL error", graphQLErrors: [] }
    const query = jest.fn().mockResolvedValue({
      data: { experiences: [] },
      error: apolloError,
    })
    const result = await getExperienceBySlug(
      mockClient(query),
      "test-slug",
      "en",
    )

    expect(result).toEqual({ data: null, error: apolloError })
  })

  it("catches network errors", async () => {
    const query = jest.fn().mockRejectedValue(new Error("Network failure"))
    const result = await getExperienceBySlug(
      mockClient(query),
      "test-slug",
      "en",
    )

    expect(result.data).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
    expect((result.error as Error).message).toBe("Network failure")
  })
})
