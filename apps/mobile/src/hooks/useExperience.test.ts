import type { ApolloClient } from "@apollo/client"

import {
  getWatchHome,
  getExperienceBySlug,
  type ExperienceResult,
} from "../lib/experienceService"
import { loadExperience } from "./useExperience"

// -- Mocks -------------------------------------------------------------------
// jest.mock is hoisted by babel-jest, so the mock is in place before imports run.

jest.mock("../lib/experienceService", () => ({
  getWatchHome: jest.fn(),
  getExperienceBySlug: jest.fn(),
}))

const mockGetWatchHome = getWatchHome as jest.MockedFunction<
  typeof getWatchHome
>
const mockGetBySlug = getExperienceBySlug as jest.MockedFunction<
  typeof getExperienceBySlug
>

const fakeClient = {} as ApolloClient

const successResult: ExperienceResult = {
  data: { documentId: "doc-1", slug: "easter", sections: [] },
  error: null,
}

const errorResult: ExperienceResult = {
  data: null,
  error: new Error("No experience found"),
}

// -- Tests -------------------------------------------------------------------

beforeEach(() => {
  jest.resetAllMocks()
})

describe("loadExperience", () => {
  describe("routing to correct fetch function", () => {
    it("calls getWatchHome when no slug is provided", async () => {
      mockGetWatchHome.mockResolvedValue(successResult)

      const result = await loadExperience(fakeClient, { locale: "en" })

      expect(mockGetWatchHome).toHaveBeenCalledWith(fakeClient, "en")
      expect(mockGetBySlug).not.toHaveBeenCalled()
      expect(result).toEqual(successResult)
    })

    it("calls getExperienceBySlug when slug is provided", async () => {
      mockGetBySlug.mockResolvedValue(successResult)

      const result = await loadExperience(fakeClient, {
        slug: "easter",
        locale: "en",
      })

      expect(mockGetBySlug).toHaveBeenCalledWith(fakeClient, "easter", "en")
      expect(mockGetWatchHome).not.toHaveBeenCalled()
      expect(result).toEqual(successResult)
    })

    it("passes locale through to the service", async () => {
      mockGetBySlug.mockResolvedValue(successResult)

      await loadExperience(fakeClient, { slug: "test", locale: "es" })

      expect(mockGetBySlug).toHaveBeenCalledWith(fakeClient, "test", "es")
    })
  })

  describe("fallback logic", () => {
    it("skips fallback when primary succeeds", async () => {
      mockGetWatchHome.mockResolvedValue(successResult)

      const result = await loadExperience(fakeClient, {
        fallbackSlug: "easter",
        locale: "en",
      })

      expect(mockGetWatchHome).toHaveBeenCalledTimes(1)
      expect(mockGetBySlug).not.toHaveBeenCalled()
      expect(result.data).toBeTruthy()
    })

    it("tries fallback slug when primary returns no data", async () => {
      mockGetWatchHome.mockResolvedValue(errorResult)
      mockGetBySlug.mockResolvedValue(successResult)

      const result = await loadExperience(fakeClient, {
        fallbackSlug: "easter",
        locale: "en",
      })

      expect(mockGetWatchHome).toHaveBeenCalledWith(fakeClient, "en")
      expect(mockGetBySlug).toHaveBeenCalledWith(fakeClient, "easter", "en")
      expect(result).toEqual(successResult)
    })

    it("returns primary error when no fallback slug is specified", async () => {
      mockGetWatchHome.mockResolvedValue(errorResult)

      const result = await loadExperience(fakeClient, { locale: "en" })

      expect(result).toEqual(errorResult)
      expect(mockGetBySlug).not.toHaveBeenCalled()
    })

    it("returns primary error when both primary and fallback fail", async () => {
      const fallbackError: ExperienceResult = {
        data: null,
        error: new Error("Fallback also failed"),
      }
      mockGetWatchHome.mockResolvedValue(errorResult)
      mockGetBySlug.mockResolvedValue(fallbackError)

      const result = await loadExperience(fakeClient, {
        fallbackSlug: "easter",
        locale: "en",
      })

      // Returns the original primary error, not the fallback error
      expect(result).toEqual(errorResult)
    })

    it("uses fallback with slug-based primary too", async () => {
      mockGetBySlug
        .mockResolvedValueOnce(errorResult) // primary by slug
        .mockResolvedValueOnce(successResult) // fallback

      const result = await loadExperience(fakeClient, {
        slug: "nonexistent",
        fallbackSlug: "easter",
        locale: "en",
      })

      expect(mockGetBySlug).toHaveBeenCalledTimes(2)
      expect(mockGetBySlug).toHaveBeenNthCalledWith(
        1,
        fakeClient,
        "nonexistent",
        "en",
      )
      expect(mockGetBySlug).toHaveBeenNthCalledWith(
        2,
        fakeClient,
        "easter",
        "en",
      )
      expect(result).toEqual(successResult)
    })
  })

  describe("error propagation", () => {
    it("propagates service errors in the result", async () => {
      const apolloError = { message: "GraphQL error", graphQLErrors: [] }
      const resultWithError: ExperienceResult = {
        data: null,
        error: apolloError as any,
      }
      mockGetWatchHome.mockResolvedValue(resultWithError)

      const result = await loadExperience(fakeClient, { locale: "en" })

      expect(result.error).toEqual(apolloError)
      expect(result.data).toBeNull()
    })

    it("throws when the service throws (not caught in loadExperience)", async () => {
      mockGetWatchHome.mockRejectedValue(new Error("Network failure"))

      await expect(
        loadExperience(fakeClient, { locale: "en" }),
      ).rejects.toThrow("Network failure")
    })
  })
})
