import { describe, expect, it, vi } from "vitest"
import {
  resolveExperimentAssignment,
  type ExperimentAssignmentContext,
} from "./assignment"
import {
  HYBRID_PERSONALIZED_MANIFEST,
  recommendationManifestDigest,
} from "../promotion/manifest"

const experiment = {
  id: "semantic-aa-v1",
  experimentVersion: "semantic-aa-v1",
  surfaceVersion: "watch-below-player-v1",
  assignmentPolicyVersion: "sticky-deterministic-assignment-v1",
  configurationDigest: "b".repeat(64),
  challengerProbability: 0.5,
  generation: 1,
  controlManifestId: "semantic-transcript-pgvector-v1",
  challengerManifestId: "semantic-experiment-aa-v1",
  startsAt: new Date("2026-08-01T00:00:00.000Z"),
  endsAt: new Date("2026-09-01T00:00:00.000Z"),
  controlManifest: {
    id: "semantic-transcript-pgvector-v1",
    strategyVersion: "semantic-transcript-pgvector-v1",
    generator: "semantic",
    contractVersion: "semantic-recommendation-v1",
    surfaceVersion: "watch-below-player-v1",
    maxItems: 6,
    configuration: {},
    enabled: true,
  },
  challengerManifest: {
    id: "semantic-experiment-aa-v1",
    strategyVersion: "semantic-experiment-aa-v1",
    generator: "semantic",
    contractVersion: "semantic-recommendation-v1",
    surfaceVersion: "watch-below-player-v1",
    maxItems: 6,
    configuration: {
      behaviorallyEquivalentTo: "semantic-transcript-pgvector-v1",
      completeServiceDeadlineMs: 1_500,
      learningReads: false,
    },
    enabled: true,
  },
}

function harness(existing: ExperimentAssignmentContext | null = null) {
  const assignment = existing
    ? {
        ...existing,
        unitDigest: "c".repeat(64),
        configurationDigest: experiment.configurationDigest,
        state: "ACTIVE",
      }
    : null
  const prisma = {
    recommendationExperiment: {
      findFirst: vi.fn().mockResolvedValue(experiment),
    },
    recommendationProfile: { findFirst: vi.fn().mockResolvedValue(null) },
    recommendationPromotionPointer: {
      findUnique: vi.fn().mockResolvedValue({
        id: "recommendation-promotion-pointer",
        activeManifestId: experiment.challengerManifestId,
        activeManifest: experiment.challengerManifest,
        activeApprovalId: "approval-1",
        activeApproval: {
          id: "approval-1",
          manifestId: experiment.challengerManifestId,
          manifestDigest: recommendationManifestDigest(
            experiment.challengerManifest,
          ),
          maxExposureBps: 5_000,
          expiresAt: new Date("2027-01-01T00:00:00.000Z"),
        },
        stage: "BOUNDED",
        exposureCeilingBps: 5_000,
        generation: 2,
        killSwitchEnabled: false,
      }),
    },
    recommendationExperimentAssignment: {
      findUnique: vi.fn().mockResolvedValue(assignment),
      create: vi.fn(async ({ data }) => ({ ...data, state: "ACTIVE" })),
    },
    recommendationShadowDecision: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  }
  return { prisma, assignment: prisma.recommendationExperimentAssignment }
}

const base = {
  surfaceVersion: "watch-below-player-v1",
  sessionDigest: "a".repeat(64),
  profileTokenDigest: null,
  eligibleHuman: true,
  now: new Date("2026-08-20T12:00:00.000Z"),
} as const

const profileExperiment = {
  ...experiment,
  id: "anonymous-profile-pilot-v1",
  experimentVersion: "anonymous-profile-pilot-v1",
  challengerProbability: 0.1,
  challengerManifestId: "multi-interest-profile-pilot-v1",
  challengerManifest: {
    id: "multi-interest-profile-pilot-v1",
    strategyVersion: "multi-interest-profile-pilot-v1",
    generator: "profile",
    contractVersion: "semantic-recommendation-v1",
    surfaceVersion: "watch-below-player-v1",
    maxItems: 6,
    configuration: {
      context: "recommendation-profile-context-v1",
      projection: "multi-interest-profile-projection-v1",
      clustering: "deterministic-farthest-first-medoids-v1",
      generator: "multi-interest-profile-candidate-v1",
      union: "canonical-video-union-v1",
      eligibility: "watch-playable-locale-v1",
      ranker: "semantic-deterministic-ranker-v1",
      composer: "minimal-playable-slate-v1",
      fallbackManifestId: "semantic-transcript-pgvector-v1",
      projectionManifestId: "multi-interest-profile-shadow-v1",
      shadowManifestId: "multi-interest-profile-shadow-v1",
      shadowDecisionRequired: "promote_to_experiment",
      completeServiceDeadlineMs: 1_500,
      learningReads: "published-projections-only",
      boundedLive: true,
    },
    enabled: true,
  },
}

const hybridExperiment = {
  ...profileExperiment,
  id: "anonymous-hybrid-personalized-v1",
  experimentVersion: "anonymous-hybrid-personalized-v1",
  challengerManifestId: HYBRID_PERSONALIZED_MANIFEST.id,
  challengerManifest: HYBRID_PERSONALIZED_MANIFEST,
}

describe("resolveExperimentAssignment", () => {
  it("never assigns the legacy profile-only challenger, even with its old shadow decision", async () => {
    const { prisma } = harness()
    prisma.recommendationExperiment.findFirst.mockResolvedValue(
      profileExperiment,
    )
    prisma.recommendationPromotionPointer.findUnique.mockResolvedValue({
      id: "recommendation-promotion-pointer",
      activeManifestId: profileExperiment.challengerManifestId,
      activeManifest: profileExperiment.challengerManifest,
      activeApprovalId: "approval-profile",
      activeApproval: {
        id: "approval-profile",
        manifestId: profileExperiment.challengerManifestId,
        manifestDigest: recommendationManifestDigest(
          profileExperiment.challengerManifest,
        ),
        maxExposureBps: 1_000,
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      },
      stage: "BOUNDED",
      exposureCeilingBps: 1_000,
      generation: 2,
      killSwitchEnabled: false,
    })
    prisma.recommendationShadowDecision.findFirst.mockResolvedValue({
      decision: "PROMOTE_TO_EXPERIMENT",
      evaluation: {
        manifestId: "multi-interest-profile-shadow-v1",
        generatorVersion: "multi-interest-profile-candidate-v1",
      },
    })
    prisma.recommendationProfile.findFirst.mockResolvedValue({
      id: "profile-1",
      privacyGeneration: 2,
    })

    await expect(
      resolveExperimentAssignment(prisma as never, {
        ...base,
        profileTokenDigest: "f".repeat(64),
      }),
    ).resolves.toEqual({
      assignment: null,
      bypassReason: "manifest_not_equivalent",
    })
    expect(prisma.recommendationShadowDecision.findFirst).not.toHaveBeenCalled()
    expect(prisma.recommendationProfile.findFirst).not.toHaveBeenCalled()
    expect(
      prisma.recommendationExperimentAssignment.create,
    ).not.toHaveBeenCalled()
  })

  it("admits the exact hybrid challenger only after its own counterfactual decision", async () => {
    const { prisma } = harness()
    prisma.recommendationExperiment.findFirst.mockResolvedValue(
      hybridExperiment,
    )
    prisma.recommendationPromotionPointer.findUnique.mockResolvedValue({
      id: "recommendation-promotion-pointer",
      activeManifestId: HYBRID_PERSONALIZED_MANIFEST.id,
      activeManifest: HYBRID_PERSONALIZED_MANIFEST,
      activeApprovalId: "approval-hybrid",
      activeApproval: {
        id: "approval-hybrid",
        manifestId: HYBRID_PERSONALIZED_MANIFEST.id,
        manifestDigest: recommendationManifestDigest(
          HYBRID_PERSONALIZED_MANIFEST,
        ),
        maxExposureBps: 1_000,
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      },
      stage: "BOUNDED",
      exposureCeilingBps: 1_000,
      generation: 2,
      killSwitchEnabled: false,
    })
    prisma.recommendationProfile.findFirst.mockResolvedValue({
      id: "profile-1",
      privacyGeneration: 4,
    })
    prisma.recommendationShadowDecision.findFirst.mockResolvedValue({
      decision: "PROMOTE_TO_EXPERIMENT",
      evaluation: {
        manifestId: HYBRID_PERSONALIZED_MANIFEST.id,
        generatorVersion: "semantic-profile-hybrid-generators-v1",
      },
    })

    await expect(
      resolveExperimentAssignment(prisma as never, {
        ...base,
        profileTokenDigest: "d".repeat(64),
      }),
    ).resolves.toMatchObject({
      assignment: {
        experimentId: "anonymous-hybrid-personalized-v1",
      },
      bypassReason: null,
    })
    expect(prisma.recommendationShadowDecision.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        evaluation: {
          manifestId: HYBRID_PERSONALIZED_MANIFEST.id,
          generatorVersion: "semantic-profile-hybrid-generators-v1",
        },
      }),
      select: { id: true },
    })

    prisma.recommendationShadowDecision.findFirst.mockResolvedValue({
      decision: "PROMOTE_TO_EXPERIMENT",
      evaluation: {
        manifestId: "multi-interest-profile-shadow-v1",
        generatorVersion: "multi-interest-profile-candidate-v1",
      },
    })
    // The repository mock returns any row regardless of the requested where;
    // make the mismatch explicit by returning no exact row on the next check.
    prisma.recommendationShadowDecision.findFirst.mockResolvedValueOnce(null)
    await expect(
      resolveExperimentAssignment(prisma as never, {
        ...base,
        sessionDigest: "e".repeat(64),
        profileTokenDigest: "d".repeat(64),
      }),
    ).resolves.toEqual({
      assignment: null,
      bypassReason: "shadow_decision_missing",
    })
  })
  it("returns one sticky immutable assignment for repeated and concurrent requests", async () => {
    const { prisma, assignment } = harness()
    const first = await resolveExperimentAssignment(prisma as never, base)
    assignment.findUnique.mockResolvedValue({
      id: first.assignment?.assignmentId,
      arm: first.assignment?.arm === "challenger" ? "CHALLENGER" : "CONTROL",
      assignmentProbability: first.assignment?.assignmentProbability,
      unitDigest: "c".repeat(64),
      configurationDigest: experiment.configurationDigest,
      state: "ACTIVE",
      generation: 1,
      expiresAt: new Date("2026-09-01T00:00:00.000Z"),
      profileId: null,
      privacyGeneration: null,
    })
    const second = await resolveExperimentAssignment(prisma as never, base)

    expect(first.assignment).not.toBeNull()
    expect(second.assignment).toMatchObject({
      assignmentId: first.assignment?.assignmentId,
      experimentId: "semantic-aa-v1",
      effectiveManifestId: first.assignment?.effectiveManifestId,
    })
    expect(assignment.create).toHaveBeenCalledTimes(1)
  })

  it("never reads profile state for a semantic A/A assignment", async () => {
    const { prisma, assignment } = harness()
    prisma.recommendationProfile.findFirst.mockResolvedValue({
      id: "profile-1",
      privacyGeneration: 4,
    })
    await resolveExperimentAssignment(prisma as never, {
      ...base,
      profileTokenDigest: "d".repeat(64),
    })

    expect(prisma.recommendationProfile.findFirst).not.toHaveBeenCalled()
    expect(assignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        unitKind: "ANONYMOUS_SESSION",
        profileId: null,
        privacyGeneration: null,
      }),
    })
  })

  it("excludes machine traffic and falls back on non-equivalent manifests", async () => {
    const { prisma, assignment } = harness()
    await expect(
      resolveExperimentAssignment(prisma as never, {
        ...base,
        eligibleHuman: false,
      }),
    ).resolves.toEqual({ assignment: null, bypassReason: "machine_ineligible" })
    expect(assignment.create).not.toHaveBeenCalled()

    prisma.recommendationExperiment.findFirst.mockResolvedValue({
      ...experiment,
      challengerManifest: {
        ...experiment.challengerManifest,
        maxItems: 5,
      },
    })
    await expect(
      resolveExperimentAssignment(prisma as never, base),
    ).resolves.toEqual({
      assignment: null,
      bypassReason: "manifest_not_equivalent",
    })
  })

  it("keeps challenger assignment off until an exact bounded promotion is active", async () => {
    const { prisma, assignment } = harness()
    prisma.recommendationPromotionPointer.findUnique.mockResolvedValue({
      activeManifestId: experiment.controlManifestId,
      stage: "CONTROL",
      exposureCeilingBps: 0,
      generation: 1,
      killSwitchEnabled: false,
      activeApproval: null,
      activeManifest: experiment.controlManifest,
    })

    await expect(
      resolveExperimentAssignment(prisma as never, base),
    ).resolves.toEqual({
      assignment: null,
      bypassReason: "promotion_not_active",
    })
    expect(assignment.create).not.toHaveBeenCalled()
  })

  it("caps assignment probability at the immutable promotion ceiling", async () => {
    const { prisma, assignment } = harness()
    prisma.recommendationExperiment.findFirst.mockResolvedValue({
      ...experiment,
      challengerProbability: 0.1,
    })
    prisma.recommendationPromotionPointer.findUnique.mockResolvedValue({
      id: "recommendation-promotion-pointer",
      activeManifestId: experiment.challengerManifestId,
      activeManifest: experiment.challengerManifest,
      activeApprovalId: "approval-1",
      activeApproval: {
        id: "approval-1",
        manifestId: experiment.challengerManifestId,
        manifestDigest: recommendationManifestDigest(
          experiment.challengerManifest,
        ),
        maxExposureBps: 1_000,
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      },
      stage: "BOUNDED",
      exposureCeilingBps: 1_000,
      generation: 2,
      killSwitchEnabled: false,
    })

    await resolveExperimentAssignment(prisma as never, base)
    expect([0.1, 0.9]).toContain(
      assignment.create.mock.calls[0]?.[0].data.assignmentProbability,
    )
  })

  it("serves the confirmed permanent manifest to every newly assigned eligible unit", async () => {
    const { prisma, assignment } = harness()
    prisma.recommendationPromotionPointer.findUnique.mockResolvedValue({
      id: "recommendation-promotion-pointer",
      activeManifestId: experiment.challengerManifestId,
      activeManifest: experiment.challengerManifest,
      activeApprovalId: "approval-1",
      activeApproval: {
        id: "approval-1",
        manifestId: experiment.challengerManifestId,
        manifestDigest: recommendationManifestDigest(
          experiment.challengerManifest,
        ),
        maxExposureBps: 5_000,
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      },
      stage: "PERMANENT",
      exposureCeilingBps: 10_000,
      generation: 3,
      killSwitchEnabled: false,
    })

    await expect(
      resolveExperimentAssignment(prisma as never, base),
    ).resolves.toMatchObject({
      assignment: {
        arm: "challenger",
        effectiveManifestId: experiment.challengerManifestId,
        assignmentProbability: 1,
      },
      bypassReason: null,
    })
    expect(assignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        arm: "CHALLENGER",
        assignmentProbability: 1,
      }),
    })
  })
})
