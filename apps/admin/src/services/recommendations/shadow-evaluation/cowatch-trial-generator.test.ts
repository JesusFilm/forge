import type { PrismaClient } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  adaptSemanticCandidates,
  type CandidateNomination,
  type SemanticCandidatePoolItem,
} from "../candidate"
import { getSemanticDeliveryCandidatePool } from "../delivery-retriever"
import {
  runCandidatePlatform,
  runSemanticCandidatePlatform,
} from "../orchestration"
import { COWATCH_MMR_TRIAL_MANIFEST_ID } from "../promotion/manifest"
import type { ViewingModeAffinity } from "../viewing-mode"
import { loadViewingModeAffinity } from "../viewing-mode.service"
import { createCowatchTrialShadowGenerator } from "./cowatch-trial-generator"
import type { ShadowGenerator, ShadowGeneratorContext } from "./service"

const sources = vi.hoisted(() => ({
  profile: vi.fn(),
  graph: vi.fn(),
  env: { RECOMMENDATION_VIEWING_MODE_ENABLED: "true" },
}))
vi.mock("@/config/env", () => ({ env: sources.env }))
vi.mock("../delivery-retriever", () => ({
  getSemanticDeliveryCandidatePool: vi.fn(),
}))
vi.mock("../delivery-runtime", () => ({
  runRecommendationRetrievalQuery: vi.fn(async (db, _deadline, work) =>
    work(db),
  ),
}))
vi.mock("../candidates/profile-candidate.service", () => ({
  createDatabaseProfileSourceNominationGenerator: () => sources.profile,
}))
vi.mock("../cowatch/candidate.service", () => ({
  createDatabaseCowatchShadowGenerator: () => sources.graph,
}))
vi.mock("../viewing-mode.service", () => ({
  loadViewingModeAffinity: vi.fn(),
}))
vi.mock("../orchestration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../orchestration")>()
  return {
    ...actual,
    runSemanticCandidatePlatform: vi.fn(actual.runSemanticCandidatePlatform),
    runCandidatePlatform: vi.fn(actual.runCandidatePlatform),
  }
})

const NOW = new Date("2026-09-29T00:00:00Z")
const EXPIRES = new Date("2026-09-30T00:00:00Z")
const GRAPH = "b".repeat(64)
const context: ShadowGeneratorContext = {
  surface: "watch-below-player-v1",
  purpose: "watch",
  locale: "en",
  audioLanguageSlug: "english",
  seedMediaId: "seed",
  manifestId: COWATCH_MMR_TRIAL_MANIFEST_ID,
  contextProjection: {
    ref: "projection",
    version: "multi-interest-profile-projection-v1",
    digest: "a".repeat(64),
    privacyGeneration: 1,
  },
  liveItems: [],
  history: { status: "request_window_reconstruction", recentVideos: [] },
}

function candidate(
  id: string,
  overrides: Partial<SemanticCandidatePoolItem> = {},
): SemanticCandidatePoolItem {
  return {
    videoId: id,
    videoSlug: id,
    videoTitle: id,
    videoCoreId: id,
    embeddingText: null,
    imageUrl: `https://images.example/${id}.jpg`,
    sceneIndex: 0,
    description: "A relevant scene",
    startSeconds: 0,
    endSeconds: 30,
    similarity: 0.9,
    themes: ["hope"],
    demographics: [],
    spiritualContext: [],
    playbackId: `playback-${id}`,
    locale: "en",
    audioLanguageSlug: "english",
    watchPlayable: true,
    localePublished: true,
    ...overrides,
  }
}

function nomination(
  id: string,
  generator = "multi-interest-profile",
  overrides: Partial<SemanticCandidatePoolItem> = {},
): CandidateNomination {
  const base = adaptSemanticCandidates([candidate(id, overrides)], context)
    .nominations[0]!
  return {
    ...base,
    nominationKey: `${generator}:1:${id}`,
    source: {
      ...base.source,
      generator,
      generatorVersion: `${generator}-v1`,
      evidence: { generation: GRAPH, interestOrdinal: 0 },
    },
  }
}

function sourceResult(
  nominations: CandidateNomination[],
  sourceFailureReason: string | null = null,
): Awaited<ReturnType<ShadowGenerator>> {
  return {
    nominations,
    projectionCapturedAt: NOW,
    cohortQuality: 1,
    sourceFailureReason,
  }
}

function fixture() {
  const findUnique = vi.fn().mockResolvedValue({
    scope: "DURABLE",
    state: "PUBLISHED",
    expiresAt: EXPIRES,
    privacyGeneration: 1,
    profile: {
      state: "ACTIVE",
      tokenDigest: "profile-token",
      expiresAt: EXPIRES,
      privacyGeneration: 1,
    },
  })
  const db = {
    recommendationProfileProjectionGeneration: { findUnique },
  } as unknown as PrismaClient
  return {
    findUnique,
    generate: createCowatchTrialShadowGenerator(db, GRAPH, () => NOW),
  }
}

describe("co-watch trial shadow incumbent parity", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sources.env.RECOMMENDATION_VIEWING_MODE_ENABLED = "true"
    vi.mocked(getSemanticDeliveryCandidatePool).mockResolvedValue([
      candidate("semantic"),
    ])
    sources.profile.mockResolvedValue(sourceResult([nomination("profile")]))
    sources.graph.mockResolvedValue(
      sourceResult([nomination("cowatch", "directional-cowatch")]),
    )
    vi.mocked(loadViewingModeAffinity).mockResolvedValue(null)
  })

  it("checks the real incumbent before adding co-watch, using the same history and source-specific mode reads", async () => {
    const history = {
      status: "request_window_reconstruction" as const,
      recentVideos: [
        {
          targetMediaId: "semantic",
          reasonCodes: ["recently_tried" as const],
        },
      ],
    }
    vi.mocked(getSemanticDeliveryCandidatePool).mockResolvedValue([
      candidate("semantic"),
      candidate("fresh", { similarity: 0.8 }),
    ])
    const result = await fixture().generate({ ...context, history })

    expect(result.sourceFailureReason).toBeNull()
    expect(result.nominations.map((row) => row.targetMediaId)).toEqual([
      "semantic",
      "profile",
      "cowatch",
      "fresh",
    ])
    const semanticCall = vi.mocked(runSemanticCandidatePlatform).mock
      .calls[0]![0]
    const hybridCall = vi.mocked(runCandidatePlatform).mock.calls[0]![0]
    expect(semanticCall.composition).toEqual({
      currentVideoId: "seed",
      recentVideos: history.recentVideos,
    })
    expect(hybridCall.composition).toBe(semanticCall.composition)
    expect(
      vi.mocked(runSemanticCandidatePlatform).mock.results[0]?.value.composed[0]
        ?.targetMediaId,
    ).toBe("fresh")
    expect(loadViewingModeAffinity).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        mediaIds: ["semantic", "profile", "fresh"],
      }),
    )
    expect(loadViewingModeAffinity).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        mediaIds: ["semantic", "profile", "cowatch", "fresh"],
      }),
    )
    expect(sources.graph.mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(runCandidatePlatform).mock.invocationCallOrder[0]!,
    )
  })

  it.each([
    ["empty retrieval", []],
    ["unplayable", [candidate("semantic", { watchPlayable: false })]],
    ["missing playback", [candidate("semantic", { playbackId: "" })]],
    [
      "source rejected",
      [candidate("semantic", { sourceRejectionReason: "content_unavailable" })],
    ],
    ["unpublished locale", [candidate("semantic", { localePublished: false })]],
    ["seed only", [candidate("seed")]],
  ])(
    "retains %s as a failed sample even when profile and co-watch have candidates",
    async (_label, candidates) => {
      vi.mocked(getSemanticDeliveryCandidatePool).mockResolvedValue(candidates)

      expect(await fixture().generate(context)).toMatchObject({
        nominations: [],
        sourceFailureReason: "semantic_candidates_unavailable",
      })
      expect(sources.graph).not.toHaveBeenCalled()
    },
  )

  it.each([
    undefined,
    { status: "unavailable" as const, recentVideos: [] },
    { status: "retention_incomplete" as const, recentVideos: [] },
  ])(
    "refuses to invent an incumbent history when reconstruction is missing: %j",
    async (history) => {
      expect(await fixture().generate({ ...context, history })).toMatchObject({
        nominations: [],
        sourceFailureReason: "recent_context_unavailable",
      })
      expect(getSemanticDeliveryCandidatePool).not.toHaveBeenCalled()
      expect(sources.graph).not.toHaveBeenCalled()
    },
  )

  it.each([
    ["empty source", []],
    [
      "ineligible source",
      [nomination("profile", "multi-interest-profile", { playbackId: "" })],
    ],
  ])(
    "requires an eligible profile candidate: %s",
    async (_label, nominations) => {
      sources.profile.mockResolvedValue(sourceResult(nominations))
      expect(await fixture().generate(context)).toMatchObject({
        nominations: [],
        sourceFailureReason: "profile_candidates_sparse",
      })
      expect(sources.graph).not.toHaveBeenCalled()
    },
  )

  it("preserves an explicit profile source failure without graph rescue", async () => {
    sources.profile.mockResolvedValue(
      sourceResult([nomination("profile")], "profile_projection_expired"),
    )
    expect(await fixture().generate(context)).toMatchObject({
      nominations: [],
      sourceFailureReason: "profile_projection_expired",
    })
    expect(sources.graph).not.toHaveBeenCalled()
  })

  it("treats semantic parity failure as source failure even with a nonempty slate", async () => {
    const actual = runSemanticCandidatePlatform({
      candidates: [candidate("semantic")],
      context,
      limit: 6,
    })
    vi.mocked(runSemanticCandidatePlatform).mockReturnValueOnce({
      ...actual,
      parity: { ...actual.parity, candidateEligibility: "failed" },
    })
    expect(await fixture().generate(context)).toMatchObject({
      nominations: [],
      sourceFailureReason: "semantic_parity_mismatch",
    })
    expect(sources.graph).not.toHaveBeenCalled()
  })

  it.each([
    ["candidate_platform_unavailable", runSemanticCandidatePlatform],
    ["hybrid_candidate_platform_unavailable", runCandidatePlatform],
  ])(
    "records platform exceptions as failed samples (%s)",
    async (reason, platform) => {
      vi.mocked(platform).mockImplementationOnce(() => {
        throw new Error("platform unavailable")
      })
      expect(await fixture().generate(context)).toMatchObject({
        nominations: [],
        sourceFailureReason: reason,
      })
      expect(sources.graph).not.toHaveBeenCalled()
    },
  )

  it("uses ordinary incumbent relevance when optional mode evidence fails", async () => {
    vi.mocked(loadViewingModeAffinity).mockRejectedValueOnce(
      new Error("mode unavailable"),
    )
    expect((await fixture().generate(context)).sourceFailureReason).toBeNull()
    expect(runSemanticCandidatePlatform).toHaveBeenCalledWith(
      expect.objectContaining({ viewingMode: null }),
    )
    expect(runCandidatePlatform).toHaveBeenCalledWith(
      expect.objectContaining({ viewingMode: null }),
    )
    expect(sources.graph).toHaveBeenCalledOnce()
  })

  it("applies incumbent mode evidence to both real pipelines and returns the separate bundle snapshot", async () => {
    const incumbentMode: ViewingModeAffinity = {
      authority: { profileId: "profile", privacyGeneration: 1 },
      version: "viewing-mode-affinity-v1",
      soundOffPreference: 1,
      confidence: 1,
      qualifiedVideos: 3,
      candidates: [
        { mediaId: "second", viewers: 30, qualifiedViewers: 28, affinity: 0.8 },
      ],
    }
    const bundleMode: ViewingModeAffinity = {
      ...incumbentMode,
      candidates: [
        ...incumbentMode.candidates,
        {
          mediaId: "cowatch",
          viewers: 30,
          qualifiedViewers: 28,
          affinity: 0.8,
        },
      ],
    }
    vi.mocked(getSemanticDeliveryCandidatePool).mockResolvedValue([
      candidate("semantic"),
      candidate("second", { similarity: 0.895 }),
      candidate("distant", { similarity: 0.5 }),
    ])
    vi.mocked(loadViewingModeAffinity)
      .mockResolvedValueOnce(incumbentMode)
      .mockResolvedValueOnce(bundleMode)

    const result = await fixture().generate(context)
    expect(result.sourceFailureReason).toBeNull()
    expect(result.viewingMode).toBe(bundleMode)
    expect(
      vi.mocked(runSemanticCandidatePlatform).mock.calls[0]![0].viewingMode,
    ).toBe(incumbentMode)
    expect(vi.mocked(runCandidatePlatform).mock.calls[0]![0].viewingMode).toBe(
      incumbentMode,
    )
    expect(
      vi.mocked(runSemanticCandidatePlatform).mock.results[0]?.value.composed[0]
        ?.targetMediaId,
    ).toBe("second")
  })

  it("honors the existing viewing mode switch for both source reads", async () => {
    sources.env.RECOMMENDATION_VIEWING_MODE_ENABLED = "false"
    expect((await fixture().generate(context)).sourceFailureReason).toBeNull()
    expect(loadViewingModeAffinity).not.toHaveBeenCalled()
  })
})
