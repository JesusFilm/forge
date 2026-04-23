/**
 * Execution tests for the `sceneRecommendations` public query resolver.
 *
 * Invokes the resolver function directly (via schema.getFields()) to
 * dodge vitest's transitive-graphql double-instance issue. Mocks
 * SceneRecommendationsService so we verify resolver wiring, arg
 * validation, and VideoNotFoundError soft-swallow without touching the DB.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const getRecommendationsMock = vi.fn()
vi.mock("@/services/scene-recommendations.service", async () => {
  const actual = await vi.importActual<
    typeof import("@/services/scene-recommendations.service")
  >("@/services/scene-recommendations.service")
  return {
    ...actual,
    SceneRecommendationsService: vi.fn(() => ({
      getRecommendations: getRecommendationsMock,
    })),
  }
})

vi.mock("@/db/client", () => ({ prisma: {} }))

import { schema } from "@/graphql/schema"
import { VideoNotFoundError } from "@/services/scene-recommendations.service"

type ResolverArgs = {
  videoId?: string
  slug?: string
  locale: string
  sceneIndex?: number
  limit?: number
}

type FieldWithResolve = {
  resolve: (
    root: unknown,
    args: ResolverArgs,
    ctx: unknown,
    info: unknown,
  ) => unknown
}

function getResolver(): FieldWithResolve["resolve"] {
  const fields = schema.getQueryType()!.getFields()
  const field = fields.sceneRecommendations as unknown as FieldWithResolve
  return field.resolve
}

async function invoke(args: ResolverArgs) {
  const resolve = getResolver()
  return resolve(null, args, {}, {})
}

beforeEach(() => {
  vi.clearAllMocks()
  getRecommendationsMock.mockResolvedValue([])
})

describe("sceneRecommendations resolver", () => {
  it("passes args through to the service", async () => {
    await invoke({ slug: "jesus", locale: "en", limit: 5 })
    expect(getRecommendationsMock).toHaveBeenCalledWith({
      videoId: undefined,
      slug: "jesus",
      locale: "en",
      sceneIndex: undefined,
      limit: 5,
    })
  })

  it("accepts videoId as the seed", async () => {
    await invoke({ videoId: "vid-1", locale: "en" })
    expect(getRecommendationsMock).toHaveBeenCalledWith(
      expect.objectContaining({ videoId: "vid-1", slug: undefined }),
    )
  })

  it("throws when neither videoId nor slug is supplied", async () => {
    await expect(invoke({ locale: "en" })).rejects.toThrow(
      "Either videoId or slug must be provided",
    )
  })

  it("returns [] when the service throws VideoNotFoundError (soft-swallow)", async () => {
    getRecommendationsMock.mockRejectedValueOnce(
      new VideoNotFoundError("vid-1"),
    )
    const result = await invoke({ videoId: "vid-1", locale: "en" })
    expect(result).toEqual([])
  })

  it("surfaces a masked error on unexpected service failure", async () => {
    getRecommendationsMock.mockRejectedValueOnce(new Error("boom"))
    await expect(invoke({ videoId: "vid-1", locale: "en" })).rejects.toThrow(
      "Scene recommendation features not available",
    )
  })

  it("returns the list of recommendations from the service", async () => {
    const payload = [
      {
        videoId: "vid-2",
        videoSlug: "other",
        videoTitle: "Other",
        imageUrl: null,
        sceneIndex: 3,
        description: "scene text",
        startSeconds: 12,
        endSeconds: 42,
        similarity: 0.9,
        themes: ["a"],
        demographics: ["b"],
        spiritualContext: ["c"],
        playbackId: "mux-x",
      },
    ]
    getRecommendationsMock.mockResolvedValueOnce(payload)
    const result = await invoke({ slug: "jesus", locale: "en" })
    expect(result).toEqual(payload)
  })
})
