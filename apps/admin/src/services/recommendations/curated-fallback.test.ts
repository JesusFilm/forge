import { describe, expect, it } from "vitest"
import { VideoNotFoundError } from "@/services/scene-recommendations.service"
import { curatedFallbackNominations } from "./curated-fallback"
import type { CuratedRecommendationCandidate } from "./curated-pools.types"
import { input, makeHarness, candidate } from "./delivery.service.test-helpers"

function curated(
  overrides: Partial<CuratedRecommendationCandidate> = {},
): CuratedRecommendationCandidate {
  return {
    ...candidate,
    videoCoreId: "curated-core",
    embeddingText: null,
    generator: "curated",
    sceneIndex: null,
    similarity: null,
    locale: "en",
    audioLanguageSlug: "english",
    watchPlayable: true,
    localePublished: true,
    poolKey: "start",
    poolVersion: "approved-v1",
    editorialRank: 1,
    ...overrides,
  }
}

describe("approved empty-row fallback", () => {
  it("retains current/recent and canonical-alias rejections with honest provenance", () => {
    const items = [
      curated({ videoId: "current" }),
      curated({ videoId: "recent" }),
      curated({ videoId: "alias", videoCoreId: "watched-core-ad" }),
      curated({ videoId: "same-title", videoTitle: "Watched title" }),
      curated({ videoId: "fresh" }),
    ]
    const result = curatedFallbackNominations(
      items,
      ["current", "recent"],
      [
        {
          videoId: "watched",
          videoCoreId: "watched-core",
          videoTitle: "Watched title",
        },
      ],
    )
    expect(result.map((item) => item.source.rejectionReason)).toEqual([
      "current_or_recent_video",
      "current_or_recent_video",
      "current_or_recent_video",
      "current_or_recent_video",
      null,
    ])
    expect(result[4]?.source).toMatchObject({
      generator: "curated",
      rank: 5,
      evidence: {
        poolVersion: "approved-v1",
        poolKey: "start",
        similarity: null,
      },
    })
  })

  it.each(["missing_embedding", "empty"])(
    "fills %s and persists the original shortfall and curated source",
    async (kind) => {
      const h = makeHarness({ curatedFallback: true })
      if (kind === "missing_embedding")
        h.retrieve.mockRejectedValue(new VideoNotFoundError("no embedding"))
      else h.retrieve.mockResolvedValue([])
      h.retrieveCuratedFallback.mockResolvedValue(
        curatedFallbackNominations([curated()], [], []),
      )
      const response = await h.service.deliver(input(`curated-${kind}`))
      expect(response).toMatchObject({
        result: "fallback",
        personalization: {
          lane: "semantic_fallback",
          executionMode: "curated_fallback",
        },
        reason:
          kind === "empty" ? "no_candidates" : "seed_embedding_unavailable",
        items: [
          {
            candidateGenerator: "curated",
            contributors: [{ generator: "curated" }],
          },
        ],
      })
      const request = h.tx.recommendationRequest.create.mock.calls[0]?.[0].data
      expect(request).toMatchObject({
        result: "FALLBACK",
        fallbackReason: response.reason,
        items: {
          create: [
            {
              candidateGenerator: "curated",
              candidateProvenance: {
                sources: [
                  {
                    generator: "curated",
                    evidence: { poolVersion: "approved-v1", similarity: null },
                  },
                ],
              },
            },
          ],
        },
      })
    },
  )

  it("keeps a healthy contextual row and avoids the extra retrieval", async () => {
    const h = makeHarness({ curatedFallback: true })
    const response = await h.service.deliver(input("curated-healthy"))
    expect(response.items[0]?.candidateGenerator).toBe("semantic")
    expect(h.retrieveCuratedFallback).not.toHaveBeenCalled()
  })

  it("passes the authoritative current-session recent history to fallback", async () => {
    const h = makeHarness({ curatedFallback: true })
    h.retrieve.mockResolvedValue([])
    h.resolveRecentContext.mockResolvedValue({
      videos: [
        { targetMediaId: "watched", reasonCodes: ["recent_playback_start"] },
      ],
    })
    await h.service.deliver(input("curated-recent"))
    expect(h.retrieveCuratedFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        seedMediaId: "curated-recent",
        excludedMediaIds: ["watched"],
        locale: "en",
        audioLanguageSlug: "english",
      }),
    )
  })

  it("does not invent fallback without reliable recent-history context", async () => {
    const h = makeHarness({ curatedFallback: true })
    h.retrieve.mockResolvedValue([])
    h.resolveRecentContext.mockRejectedValue(new Error("history unavailable"))
    const response = await h.service.deliver(
      input("curated-history-unavailable"),
    )
    expect(response).toMatchObject({ result: "empty", items: [] })
    expect(h.retrieveCuratedFallback).not.toHaveBeenCalled()
  })

  it.each(["wrong-audio", "unpublished", "unplayable", "no-art"])(
    "rejects %s through the shared eligibility pipeline",
    async (kind) => {
      const h = makeHarness({ curatedFallback: true })
      h.retrieve.mockResolvedValue([])
      const nominations = curatedFallbackNominations([curated()], [], []).map(
        (nomination) => ({
          ...nomination,
          presentation: {
            ...nomination.presentation,
            ...(kind === "wrong-audio" ? { audioLanguageSlug: "french" } : {}),
            ...(kind === "unpublished" ? { localePublished: false } : {}),
            ...(kind === "unplayable" ? { playbackId: "" } : {}),
            ...(kind === "no-art" ? { imageUrl: null } : {}),
          },
        }),
      )
      h.retrieveCuratedFallback.mockResolvedValue(nominations)
      expect(
        await h.service.deliver(input(`curated-ineligible-${kind}`)),
      ).toMatchObject({ result: "empty", items: [] })
    },
  )

  it("preserves the empty result when the approved pool fails", async () => {
    const h = makeHarness({ curatedFallback: true })
    h.retrieve.mockResolvedValue([])
    h.retrieveCuratedFallback.mockRejectedValue(new Error("pool unavailable"))
    expect(await h.service.deliver(input("curated-unavailable"))).toMatchObject(
      { result: "empty", reason: "no_candidates", items: [] },
    )
  })

  it("does not start fallback after the original delivery budget is spent", async () => {
    const h = makeHarness({ curatedFallback: true })
    h.retrieve.mockImplementation(async () => {
      h.advanceClock(1600)
      return []
    })
    await h.service.deliver(input("curated-deadline"))
    expect(h.retrieveCuratedFallback).not.toHaveBeenCalled()
  })
})
