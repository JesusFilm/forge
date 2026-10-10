import { describe, expect, it, vi } from "vitest"
import {
  BOOTSTRAP_RECOMMENDATION_MANIFEST_ID,
  CANDIDATE_PLATFORM_RECOMMENDATION_MANIFEST_ID,
  getRecommendationServingState,
} from "./manifest.service"
import { HYBRID_PERSONALIZED_MANIFEST } from "./promotion/manifest"

function buildPrisma(control: unknown) {
  return {
    recommendationServingControl: {
      findUnique: vi.fn(async () => control),
    },
  }
}

const compatibleControl = {
  id: "recommendation-serving-control",
  enabled: true,
  manifestId: BOOTSTRAP_RECOMMENDATION_MANIFEST_ID,
  emergencyRevokedKids: [],
  manifest: {
    id: BOOTSTRAP_RECOMMENDATION_MANIFEST_ID,
    strategyVersion: BOOTSTRAP_RECOMMENDATION_MANIFEST_ID,
    contractVersion: "semantic-recommendation-v1",
    surfaceVersion: "watch-below-player-v1",
    generator: "semantic",
    enabled: true,
    maxItems: 6,
  },
}

describe("recommendation serving manifest", () => {
  it("requires the environment ceiling, healthy retention, active signer, shared control, and exact manifest", async () => {
    for (const [overrides, reason] of [
      [{ environmentEnabled: false }, "environment_disabled"],
      [{ hasActiveSigner: false }, "keyring_unavailable"],
      [{ retentionHealthy: false }, "retention_overdue"],
    ] as const) {
      const prisma = buildPrisma(compatibleControl)
      await expect(
        getRecommendationServingState({
          prisma: prisma as never,
          environmentEnabled: overrides.environmentEnabled ?? true,
          hasActiveSigner: overrides.hasActiveSigner ?? true,
          retentionHealthy: overrides.retentionHealthy ?? true,
        }),
      ).resolves.toMatchObject({ canIssue: false, reason })
    }

    await expect(
      getRecommendationServingState({
        prisma: buildPrisma({
          ...compatibleControl,
          enabled: false,
        }) as never,
        environmentEnabled: true,
        hasActiveSigner: true,
        retentionHealthy: true,
      }),
    ).resolves.toMatchObject({
      canIssue: false,
      reason: "control_disabled",
    })
    await expect(
      getRecommendationServingState({
        prisma: buildPrisma(null) as never,
        environmentEnabled: true,
        hasActiveSigner: true,
        retentionHealthy: true,
      }),
    ).resolves.toMatchObject({
      canIssue: false,
      reason: "manifest_missing",
    })
  })

  it("returns the pinned semantic-only manifest and bounded revocation set", async () => {
    const prisma = buildPrisma({
      ...compatibleControl,
      emergencyRevokedKids: ["kid-a", "kid-b"],
    })

    await expect(
      getRecommendationServingState({
        prisma: prisma as never,
        environmentEnabled: true,
        hasActiveSigner: true,
        retentionHealthy: true,
      }),
    ).resolves.toMatchObject({
      canIssue: true,
      reason: "ready",
      revokedKids: ["kid-a", "kid-b"],
      manifest: {
        id: BOOTSTRAP_RECOMMENDATION_MANIFEST_ID,
        generator: "semantic",
        maxItems: 6,
      },
    })
    expect(
      prisma.recommendationServingControl.findUnique,
    ).toHaveBeenCalledOnce()
  })

  it("accepts the published candidate manifest only after both independent A/A parity gates pass", async () => {
    const platformControl = {
      ...compatibleControl,
      manifestId: CANDIDATE_PLATFORM_RECOMMENDATION_MANIFEST_ID,
      manifest: {
        ...compatibleControl.manifest,
        id: CANDIDATE_PLATFORM_RECOMMENDATION_MANIFEST_ID,
        strategyVersion: CANDIDATE_PLATFORM_RECOMMENDATION_MANIFEST_ID,
        configuration: {
          context: "recommendation-context-v1",
          generator: "semantic-transcript-candidate-v1",
          union: "canonical-video-union-v1",
          eligibility: "watch-playable-locale-v1",
          ranker: "semantic-deterministic-ranker-v1",
          rrfBenchmark: "rrf-k60-v1",
          composer: "minimal-playable-slate-v1",
          candidateEligibilityParity: "passed",
          rankerParity: "passed",
          fallbackManifestId: BOOTSTRAP_RECOMMENDATION_MANIFEST_ID,
          completeServiceDeadlineMs: 1_500,
          learningReads: false,
        },
      },
    }

    await expect(
      getRecommendationServingState({
        prisma: buildPrisma(platformControl) as never,
        environmentEnabled: true,
        hasActiveSigner: true,
        retentionHealthy: true,
      }),
    ).resolves.toMatchObject({
      canIssue: true,
      reason: "ready",
      manifest: { id: CANDIDATE_PLATFORM_RECOMMENDATION_MANIFEST_ID },
      lastKnownGoodManifestId: BOOTSTRAP_RECOMMENDATION_MANIFEST_ID,
    })

    await expect(
      getRecommendationServingState({
        prisma: buildPrisma({
          ...platformControl,
          manifest: {
            ...platformControl.manifest,
            configuration: {
              ...platformControl.manifest.configuration,
              rankerParity: "failed",
            },
          },
        }) as never,
        environmentEnabled: true,
        hasActiveSigner: true,
        retentionHealthy: true,
      }),
    ).resolves.toMatchObject({
      canIssue: false,
      reason: "manifest_incompatible",
    })
  })

  it("does not let a published hybrid manifest bypass shadow, experiment, and promotion authority", async () => {
    await expect(
      getRecommendationServingState({
        prisma: buildPrisma({
          ...compatibleControl,
          manifestId: HYBRID_PERSONALIZED_MANIFEST.id,
          manifest: HYBRID_PERSONALIZED_MANIFEST,
        }) as never,
        environmentEnabled: true,
        hasActiveSigner: true,
        retentionHealthy: true,
      }),
    ).resolves.toMatchObject({
      canIssue: false,
      reason: "manifest_incompatible",
    })
  })
})
