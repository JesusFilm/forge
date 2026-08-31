import { describe, expect, it, vi } from "vitest"
import {
  RecommendationPromotionService,
  recommendationManifestDigest,
} from "./service"
import { HYBRID_PERSONALIZED_MANIFEST } from "./manifest"

const ADMIN = { id: "admin-1", role: "ADMIN" } as const
const VIEWER = { id: "viewer-1", role: "VIEWER" } as const
const SYSTEM = { id: null, role: "SYSTEM" } as const

function exactProfileManifest() {
  return {
    id: "multi-interest-profile-pilot-v1",
    strategyVersion: "multi-interest-profile-pilot-v1",
    contractVersion: "semantic-recommendation-v1",
    surfaceVersion: "watch-below-player-v1",
    generator: "profile",
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
  }
}

function harness(
  options: {
    injectFailure?: (point: "before_pointer" | "after_pointer") => void
  } = {},
) {
  const pointer = {
    id: "recommendation-promotion-pointer",
    activeManifestId: "semantic-transcript-pgvector-v1",
    lastKnownGoodManifestId: "semantic-transcript-pgvector-v1",
    stage: "CONTROL",
    exposureCeilingBps: 0,
    generation: 1,
    killSwitchEnabled: false,
  }
  const approval = {
    id: "approval-1",
    manifestId: "semantic-experiment-aa-v1",
    manifestDigest: "a".repeat(64),
    maxExposureBps: 500,
    allowedStage: "BOUNDED",
    expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    manifest: {
      id: "semantic-experiment-aa-v1",
      strategyVersion: "semantic-experiment-aa-v1",
      contractVersion: "semantic-recommendation-v1",
      surfaceVersion: "watch-below-player-v1",
      generator: "semantic",
      maxItems: 6,
      configuration: {
        behaviorallyEquivalentTo: "semantic-transcript-pgvector-v1",
        completeServiceDeadlineMs: 1_500,
        learningReads: false,
      },
      enabled: true,
    },
  }
  approval.manifestDigest = recommendationManifestDigest(approval.manifest)
  const evaluation = {
    id: "evaluation-1",
    state: "PASS",
    guardrails: { passed: true },
    inputDigest: "e".repeat(64),
    experiment: {
      id: "semantic-aa-v1",
      generation: 1,
      challengerManifestId: approval.manifestId,
    },
  }
  const run = {
    id: "run-1",
    action: "ACTIVATE_BOUNDED",
    state: "CLAIMED",
    claimId: "11111111-1111-4111-8111-111111111111",
    generation: 1,
    expectedPointerGeneration: 1,
    targetManifestId: approval.manifestId,
    exposureCeilingBps: 500,
    approvalId: approval.id,
    evaluationId: evaluation.id,
    approval,
    evaluation,
  }
  let transactionApproval = approval
  const exactApprovalKeys = new Set([
    `${approval.manifestId}:${approval.manifestDigest}:${approval.maxExposureBps}`,
  ])
  const tx = {
    recommendationPromotionApproval: {
      createMany: vi.fn(async ({ data }) => {
        const key = `${data.manifestId}:${data.manifestDigest}:${data.maxExposureBps}`
        if (exactApprovalKeys.has(key)) return { count: 0 }
        exactApprovalKeys.add(key)
        transactionApproval = {
          ...approval,
          ...data,
          approvalPolicyVersion: "recommendation-promotion-approval-v1",
        }
        return { count: 1 }
      }),
      findUnique: vi.fn(async () => transactionApproval),
    },
    recommendationPromotionPointer: {
      findUnique: vi.fn(async () => ({ ...pointer })),
      updateMany: vi.fn(async ({ where, data }) => {
        if (where.generation !== pointer.generation) return { count: 0 }
        Object.assign(pointer, data)
        return { count: 1 }
      }),
    },
    recommendationPromotionRun: {
      create: vi.fn(async ({ data }) => ({ ...data, id: "run-new" })),
      findUnique: vi.fn(async () => run),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    recommendationShadowDecision: {
      findFirst: vi.fn(async () => null),
    },
    recommendationPromotionEvent: { create: vi.fn(async ({ data }) => data) },
    recommendationExperimentAssignment: {
      updateMany: vi.fn(async () => ({ count: 4 })),
    },
    recommendationExperimentEvaluationRun: {
      updateMany: vi.fn(async () => ({ count: 2 })),
    },
    recommendationExperiment: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      findFirst: vi.fn(async () => ({ id: "semantic-aa-v1", generation: 1 })),
      findMany: vi.fn(async () => [{ id: "semantic-aa-v1", generation: 1 }]),
      create: vi.fn(async ({ data }) => data),
    },
    $executeRaw: vi.fn(async () => 3),
  }
  const prisma = {
    $transaction: vi.fn(async (work) => {
      const pointerSnapshot = { ...pointer }
      try {
        return await work(tx)
      } catch (error) {
        Object.assign(pointer, pointerSnapshot)
        throw error
      }
    }),
    recommendationPromotionApproval: {
      create: vi.fn(async ({ data }) => ({ ...data, id: "approval-new" })),
      findUnique: vi.fn(async () => approval),
    },
    recommendationPromotionPointer: tx.recommendationPromotionPointer,
    recommendationPromotionRun: {
      create: vi.fn(async ({ data }) => ({ ...data, id: "run-new" })),
      updateMany: tx.recommendationPromotionRun.updateMany,
    },
    recommendationStrategyManifest: {
      findUnique: vi.fn(async () => approval.manifest),
    },
    recommendationShadowDecision: {
      findFirst: vi.fn(async () => null),
    },
    recommendationExperimentEvaluation: {
      findUnique: vi.fn(async () => evaluation),
    },
  }
  const invalidateCaches = vi.fn()
  const service = new RecommendationPromotionService({
    prisma: prisma as never,
    now: () => new Date("2026-08-26T00:00:00.000Z"),
    newId: () => "new-id",
    invalidateCaches,
    injectFailure: options.injectFailure,
  })
  return {
    service,
    prisma,
    tx,
    pointer,
    approval,
    evaluation,
    run,
    invalidateCaches,
  }
}

describe("RecommendationPromotionService", () => {
  it("denies viewers and keeps permanent-default authority away from workflows", async () => {
    const { service } = harness()
    await expect(
      service.approveBoundedStage({
        actor: VIEWER,
        manifestId: "semantic-experiment-aa-v1",
        maxExposureBps: 500,
      }),
    ).rejects.toThrow(/permission/i)
    await expect(
      service.createRun({
        actor: SYSTEM,
        action: "confirm_permanent",
        expectedPointerGeneration: 1,
        targetManifestId: "semantic-experiment-aa-v1",
        approvalId: "approval-1",
        evaluationId: "evaluation-1",
        exposureCeilingBps: 10_000,
        recentAuthentication: false,
      }),
    ).rejects.toThrow(/permanent/i)
  })

  it("requires recent human authentication for permanent-default confirmation", async () => {
    const { service } = harness()
    await expect(
      service.createRun({
        actor: ADMIN,
        action: "confirm_permanent",
        expectedPointerGeneration: 1,
        targetManifestId: "semantic-experiment-aa-v1",
        approvalId: "approval-1",
        evaluationId: "evaluation-1",
        exposureCeilingBps: 10_000,
        recentAuthentication: false,
      }),
    ).rejects.toThrow(/recent authentication/i)
  })

  it("never approves the legacy profile-only challenger, even with its old promote decision", async () => {
    const { service, prisma, tx } = harness()
    prisma.recommendationStrategyManifest.findUnique.mockResolvedValue(
      exactProfileManifest() as never,
    )
    prisma.recommendationShadowDecision.findFirst.mockResolvedValue({
      id: "u19-promote-decision",
    } as never)

    await expect(
      service.approveBoundedStage({
        actor: ADMIN,
        manifestId: "multi-interest-profile-pilot-v1",
        maxExposureBps: 500,
      }),
    ).rejects.toThrow(/required evidence/i)
    expect(prisma.recommendationShadowDecision.findFirst).not.toHaveBeenCalled()
    expect(tx.recommendationPromotionApproval.createMany).not.toHaveBeenCalled()
  })

  it("approves the exact hybrid manifest only after its own shadow decision", async () => {
    const { service, prisma, tx } = harness()
    prisma.recommendationStrategyManifest.findUnique.mockResolvedValue(
      HYBRID_PERSONALIZED_MANIFEST as never,
    )
    prisma.recommendationShadowDecision.findFirst.mockResolvedValue({
      id: "hybrid-promote-decision",
    } as never)

    await expect(
      service.approveBoundedStage({
        actor: ADMIN,
        manifestId: HYBRID_PERSONALIZED_MANIFEST.id,
        maxExposureBps: 100,
      }),
    ).resolves.toMatchObject({
      manifestId: HYBRID_PERSONALIZED_MANIFEST.id,
      maxExposureBps: 100,
    })
    expect(prisma.recommendationShadowDecision.findFirst).toHaveBeenCalledWith({
      where: {
        decision: "PROMOTE_TO_EXPERIMENT",
        expiresAt: { gt: new Date("2026-08-26T00:00:00.000Z") },
        evaluation: {
          manifestId: "semantic-profile-hybrid-v1",
          generatorVersion: "semantic-profile-hybrid-generators-v1",
        },
      },
      select: { id: true },
    })
    expect(tx.recommendationPromotionApproval.createMany).toHaveBeenCalledOnce()
  })

  it("replays an exact bounded approval without a duplicate row or event", async () => {
    const { service, prisma, tx } = harness()
    const manifest = HYBRID_PERSONALIZED_MANIFEST
    prisma.recommendationStrategyManifest.findUnique.mockResolvedValue(
      manifest as never,
    )
    prisma.recommendationShadowDecision.findFirst.mockResolvedValue({
      id: "hybrid-promote-decision",
    } as never)

    const first = await service.approveBoundedStage({
      actor: ADMIN,
      manifestId: manifest.id,
      maxExposureBps: 500,
    })
    const replay = await service.approveBoundedStage({
      actor: ADMIN,
      manifestId: manifest.id,
      maxExposureBps: 500,
    })

    expect(replay.id).toBe(first.id)
    expect(tx.recommendationPromotionApproval.createMany).toHaveBeenCalledTimes(
      2,
    )
    expect(tx.recommendationPromotionEvent.create).toHaveBeenCalledOnce()
  })

  it("refuses the legacy profile challenger when no new approval path exists", async () => {
    const { service, prisma, tx } = harness()
    prisma.recommendationStrategyManifest.findUnique.mockResolvedValue(
      exactProfileManifest() as never,
    )

    await expect(
      service.approveBoundedStage({
        actor: ADMIN,
        manifestId: "multi-interest-profile-pilot-v1",
        maxExposureBps: 500,
      }),
    ).rejects.toThrow(/required evidence/i)
    expect(tx.recommendationPromotionApproval.createMany).not.toHaveBeenCalled()
  })

  it("breaks the cold-start circle with exact shadow authority only for the initial bounded cohort", async () => {
    const { service, prisma, tx, pointer, approval, run } = harness()
    const manifest = HYBRID_PERSONALIZED_MANIFEST
    Object.assign(approval, {
      manifestId: manifest.id,
      manifest,
      manifestDigest: recommendationManifestDigest(manifest),
      maxExposureBps: 500,
    })
    prisma.recommendationPromotionApproval.findUnique = vi.fn(
      async () => approval as never,
    )
    prisma.recommendationExperimentEvaluation.findUnique.mockResolvedValue(
      null as never,
    )
    prisma.recommendationShadowDecision.findFirst.mockResolvedValue({
      id: "hybrid-promote-decision",
    } as never)
    tx.recommendationShadowDecision.findFirst.mockResolvedValue({
      id: "hybrid-promote-decision",
    } as never)

    await expect(
      service.createRun({
        actor: ADMIN,
        action: "activate_bounded",
        expectedPointerGeneration: 1,
        targetManifestId: manifest.id,
        approvalId: approval.id,
        evaluationId: null,
        exposureCeilingBps: 100,
        recentAuthentication: false,
      }),
    ).resolves.toMatchObject({
      targetManifestId: manifest.id,
      evaluationId: null,
      exposureCeilingBps: 100,
    })

    Object.assign(run, {
      targetManifestId: manifest.id,
      exposureCeilingBps: 100,
      approval,
      evaluation: null,
      evaluationId: null,
    })
    await expect(
      service.executeClaimedRun({
        runId: run.id,
        expectedGeneration: 1,
        claimId: run.claimId,
      }),
    ).resolves.toMatchObject({ status: "activated", generation: 2 })
    expect(pointer).toMatchObject({
      activeManifestId: manifest.id,
      stage: "BOUNDED",
      exposureCeilingBps: 100,
    })
    expect(tx.recommendationExperiment.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["semantic-aa-v1"] },
        state: "ACTIVE",
      },
      data: {
        state: "CLOSED",
        generation: { increment: 1 },
      },
    })
    expect(tx.recommendationExperiment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        controlManifestId: "semantic-transcript-pgvector-v1",
        challengerManifestId: manifest.id,
        challengerProbability: 0.01,
        assignmentPolicyVersion: "sticky-deterministic-assignment-v1",
        evaluationPolicyVersion: "recommendation-hybrid-personalized-v1",
        purpose: "anonymous_hybrid_personalization",
      }),
    })
    expect(
      tx.recommendationExperimentAssignment.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          experimentId: { in: ["semantic-aa-v1"] },
        }),
        data: expect.objectContaining({
          fenceReason: "experiment_superseded",
        }),
      }),
    )
    expect(tx.recommendationPromotionEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "ACTIVATION_EFFECTIVE",
        reasonCode: "bounded_hybrid_shadow_authorized",
      }),
    })
  })

  it("requires a live PASS before increasing an existing bounded cohort", async () => {
    const { service, prisma, pointer, approval } = harness()
    Object.assign(pointer, {
      activeManifestId: approval.manifestId,
      stage: "BOUNDED",
      exposureCeilingBps: 100,
      generation: 2,
    })
    prisma.recommendationExperimentEvaluation.findUnique.mockResolvedValue(
      null as never,
    )

    await expect(
      service.createRun({
        actor: ADMIN,
        action: "activate_bounded",
        expectedPointerGeneration: 2,
        targetManifestId: approval.manifestId,
        approvalId: approval.id,
        evaluationId: null,
        exposureCeilingBps: 200,
        recentAuthentication: false,
      }),
    ).rejects.toThrow(/live evaluation/i)
  })

  it.each([
    ["activate_bounded", 200],
    ["confirm_permanent", 10_000],
  ] as const)(
    "rejects a new Admin %s action against a historical profile-only approval",
    async (action, exposureCeilingBps) => {
      const { service, prisma, tx, pointer, approval, evaluation } = harness()
      const manifest = exactProfileManifest()
      Object.assign(approval, {
        manifestId: manifest.id,
        manifest,
        manifestDigest: recommendationManifestDigest(manifest),
        maxExposureBps: 500,
      })
      Object.assign(evaluation.experiment, {
        challengerManifestId: manifest.id,
      })
      Object.assign(pointer, {
        activeManifestId: manifest.id,
        activeApprovalId: approval.id,
        stage: "BOUNDED",
        exposureCeilingBps: 100,
        generation: 2,
      })
      prisma.recommendationPromotionApproval.findUnique = vi.fn(
        async () => approval as never,
      )

      await expect(
        service.createRun({
          actor: ADMIN,
          action,
          expectedPointerGeneration: 2,
          targetManifestId: manifest.id,
          approvalId: approval.id,
          evaluationId: evaluation.id,
          exposureCeilingBps,
          recentAuthentication: true,
        }),
      ).rejects.toThrow(/exact manifest approval is stale/i)
      expect(tx.recommendationPromotionRun.create).not.toHaveBeenCalled()
    },
  )

  it.each(["ACTIVATE_BOUNDED", "CONFIRM_PERMANENT"] as const)(
    "defensively rejects a claimed profile-pilot %s run before pointer mutation",
    async (action) => {
      const { service, tx, pointer, approval, evaluation, run } = harness()
      const manifest = exactProfileManifest()
      Object.assign(approval, {
        manifestId: manifest.id,
        manifest,
        manifestDigest: recommendationManifestDigest(manifest),
        maxExposureBps: 500,
      })
      Object.assign(evaluation.experiment, {
        challengerManifestId: manifest.id,
      })
      Object.assign(pointer, {
        activeManifestId: manifest.id,
        activeApprovalId: approval.id,
        stage: "BOUNDED",
        exposureCeilingBps: 100,
        generation: 2,
      })
      Object.assign(run, {
        action,
        expectedPointerGeneration: 2,
        targetManifestId: manifest.id,
        exposureCeilingBps: action === "CONFIRM_PERMANENT" ? 10_000 : 200,
        approval,
        evaluation,
        requestedActorClass: "admin",
        requestedActorId: "admin-1",
        recentAuthenticationVerified: true,
      })

      await expect(
        service.executeClaimedRun({
          runId: run.id,
          expectedGeneration: 1,
          claimId: run.claimId,
        }),
      ).rejects.toThrow(/exact manifest approval is stale/i)
      expect(
        tx.recommendationPromotionPointer.updateMany,
      ).not.toHaveBeenCalled()
      expect(tx.recommendationPromotionEvent.create).not.toHaveBeenCalled()
    },
  )

  it("commits the pointer and immutable activation event in one transaction", async () => {
    const { service, tx, pointer, invalidateCaches } = harness()
    await expect(
      service.executeClaimedRun({
        runId: "run-1",
        expectedGeneration: 1,
        claimId: "11111111-1111-4111-8111-111111111111",
      }),
    ).resolves.toMatchObject({ status: "activated", generation: 2 })
    expect(pointer).toMatchObject({
      activeManifestId: "semantic-experiment-aa-v1",
      stage: "BOUNDED",
      exposureCeilingBps: 500,
      generation: 2,
    })
    expect(tx.recommendationPromotionEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "ACTIVATION_EFFECTIVE",
        pointerGeneration: 2,
        reasonCode: "bounded_evaluation_passed",
      }),
    })
    expect(invalidateCaches).toHaveBeenCalledOnce()
  })

  it("restores last-known-good and fences assignments, stored slates, and workflows idempotently", async () => {
    const { service, run, pointer, tx, invalidateCaches } = harness()
    Object.assign(pointer, {
      activeManifestId: "semantic-experiment-aa-v1",
      stage: "BOUNDED",
      exposureCeilingBps: 500,
      generation: 2,
    })
    Object.assign(run, {
      action: "AUTOMATIC_ROLLBACK",
      expectedPointerGeneration: 2,
    })

    await expect(
      service.executeClaimedRun({
        runId: "run-1",
        expectedGeneration: 1,
        claimId: run.claimId,
      }),
    ).resolves.toMatchObject({ status: "rolled_back", generation: 3 })
    expect(pointer).toMatchObject({
      activeManifestId: "semantic-transcript-pgvector-v1",
      stage: "CONTROL",
      exposureCeilingBps: 0,
    })
    expect(tx.recommendationExperimentAssignment.updateMany).toHaveBeenCalled()
    expect(
      tx.recommendationExperimentEvaluationRun.updateMany,
    ).toHaveBeenCalled()
    expect(tx.$executeRaw).toHaveBeenCalled()
    expect(
      tx.recommendationExperimentAssignment.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          experimentId: { in: ["semantic-aa-v1"] },
        }),
      }),
    )
    expect(invalidateCaches).toHaveBeenCalledOnce()
  })

  it("fences a stale compare-and-swap claim without writing an event", async () => {
    const { service, run, pointer, tx } = harness()
    Object.assign(pointer, { generation: 2 })
    Object.assign(run, { expectedPointerGeneration: 1 })
    await expect(
      service.executeClaimedRun({
        runId: "run-1",
        expectedGeneration: 1,
        claimId: run.claimId,
      }),
    ).resolves.toEqual({ status: "fenced", reason: "pointer_changed" })
    expect(tx.recommendationPromotionEvent.create).not.toHaveBeenCalled()
  })

  it("applies and clears the manual kill switch with CAS audit and full influence fencing", async () => {
    const { service, pointer, tx, invalidateCaches } = harness()
    Object.assign(pointer, {
      activeManifestId: "semantic-experiment-aa-v1",
      stage: "BOUNDED",
      exposureCeilingBps: 500,
      generation: 2,
    })

    await expect(
      service.setKillSwitch({
        actor: ADMIN,
        expectedPointerGeneration: 2,
        enabled: true,
        reason: "operator_incident",
      }),
    ).resolves.toMatchObject({ enabled: true, generation: 3 })
    expect(pointer.killSwitchEnabled).toBe(true)
    expect(tx.recommendationExperimentAssignment.updateMany).toHaveBeenCalled()
    expect(tx.$executeRaw).toHaveBeenCalled()
    expect(tx.recommendationPromotionEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventType: "KILL_SWITCH_ENABLED" }),
    })

    await expect(
      service.setKillSwitch({
        actor: ADMIN,
        expectedPointerGeneration: 3,
        enabled: false,
        reason: "incident_resolved",
      }),
    ).resolves.toMatchObject({ enabled: false, generation: 4 })
    expect(pointer.killSwitchEnabled).toBe(false)
    expect(tx.recommendationPromotionEvent.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ eventType: "KILL_SWITCH_CLEARED" }),
    })
    expect(invalidateCaches).toHaveBeenCalledTimes(2)
  })

  it("supersedes bounded assignments before making the challenger permanent", async () => {
    const { service, pointer, run, tx } = harness()
    Object.assign(pointer, {
      activeManifestId: "semantic-experiment-aa-v1",
      activeApprovalId: "approval-1",
      stage: "BOUNDED",
      exposureCeilingBps: 500,
      generation: 2,
    })
    Object.assign(run, {
      action: "CONFIRM_PERMANENT",
      expectedPointerGeneration: 2,
      exposureCeilingBps: 10_000,
      requestedActorClass: "admin",
      requestedActorId: "admin-1",
      recentAuthenticationVerified: true,
    })

    await expect(
      service.executeClaimedRun({
        runId: run.id,
        expectedGeneration: 1,
        claimId: run.claimId,
      }),
    ).resolves.toMatchObject({ status: "permanent", generation: 3 })
    expect(pointer).toMatchObject({
      stage: "PERMANENT",
      exposureCeilingBps: 10_000,
    })
    expect(
      tx.recommendationExperimentAssignment.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fenceReason: "permanent_default" }),
      }),
    )
    expect(tx.recommendationExperiment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { generation: { increment: 1 } } }),
    )
  })

  it.each(["before_pointer", "after_pointer"] as const)(
    "rolls back pointer mutation when failure is injected %s",
    async (failurePoint) => {
      const { service, pointer, tx, run, invalidateCaches } = harness({
        injectFailure: (point) => {
          if (point === failurePoint) throw new Error(`injected:${point}`)
        },
      })
      await expect(
        service.executeClaimedRun({
          runId: run.id,
          expectedGeneration: 1,
          claimId: run.claimId,
        }),
      ).rejects.toThrow(`injected:${failurePoint}`)
      expect(pointer).toMatchObject({
        activeManifestId: "semantic-transcript-pgvector-v1",
        stage: "CONTROL",
        exposureCeilingBps: 0,
        generation: 1,
      })
      expect(tx.recommendationPromotionEvent.create).not.toHaveBeenCalled()
      expect(invalidateCaches).not.toHaveBeenCalled()
    },
  )
})
