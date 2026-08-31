import { beforeEach, describe, expect, it, vi } from "vitest"

const start = vi.hoisted(() => vi.fn())
const createWorkflowRunLog = vi.hoisted(() => vi.fn())
const attachWorkflowRuntimeRunId = vi.hoisted(() => vi.fn())
const markWorkflowRunStarted = vi.hoisted(() => vi.fn())
const markWorkflowRunFailed = vi.hoisted(() => vi.fn())
const markWorkflowRunRuntimeStarted = vi.hoisted(() => vi.fn())
const createRun = vi.hoisted(() => vi.fn())
const claimRun = vi.hoisted(() => vi.fn())
const executeClaimedRun = vi.hoisted(() => vi.fn())
const failClaimedRun = vi.hoisted(() => vi.fn())
const prisma = vi.hoisted(() => ({
  recommendationPromotionRun: { update: vi.fn(), updateMany: vi.fn() },
  workflowRun: { update: vi.fn() },
  recommendationExperimentEvaluation: { findUnique: vi.fn() },
  recommendationPromotionPointer: { findUnique: vi.fn() },
}))

vi.mock("workflow/api", () => ({ start }))
vi.mock("@/services/workflow-run-log.service", () => ({
  createWorkflowRunLog,
  attachWorkflowRuntimeRunId,
  markWorkflowRunStarted,
  markWorkflowRunFailed,
  markWorkflowRunRuntimeStarted,
}))
vi.mock("./service", () => ({
  createRecommendationPromotionService: () => ({
    createRun,
    claimRun,
    executeClaimedRun,
    failClaimedRun,
  }),
}))
vi.mock("@/db/client", () => ({ prisma }))

const input = {
  actor: { id: "admin-1", role: "ADMIN" as const },
  action: "activate_bounded" as const,
  expectedPointerGeneration: 1,
  targetManifestId: "semantic-experiment-aa-v1",
  approvalId: "approval-1",
  evaluationId: "evaluation-1",
  exposureCeilingBps: 5_000,
  recentAuthentication: false,
}

describe("recommendation promotion workflow dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createRun.mockResolvedValue({ id: "run-1", generation: 1 })
    createWorkflowRunLog.mockResolvedValue({ id: "ledger-1" })
    start.mockResolvedValue({ runId: "runtime-1" })
    attachWorkflowRuntimeRunId.mockResolvedValue(undefined)
    markWorkflowRunFailed.mockResolvedValue(undefined)
    prisma.recommendationPromotionRun.update.mockResolvedValue({})
    prisma.recommendationPromotionRun.updateMany.mockResolvedValue({ count: 1 })
  })

  it("creates business truth before dispatch and attaches runtime identity", async () => {
    const { dispatchRecommendationPromotion } = await import("./job")
    await expect(dispatchRecommendationPromotion(input)).resolves.toMatchObject(
      {
        queued: true,
        runId: "run-1",
        workflowRunId: "runtime-1",
      },
    )
    expect(createRun).toHaveBeenCalledBefore(createWorkflowRunLog)
    expect(createWorkflowRunLog).toHaveBeenCalledBefore(start)
    expect(start).toHaveBeenCalledWith(expect.any(Function), [
      expect.objectContaining({
        runId: "run-1",
        expectedGeneration: 1,
        ledgerRunId: "ledger-1",
      }),
    ])
  })

  it("does not fail promotion truth after the workflow has started", async () => {
    attachWorkflowRuntimeRunId.mockRejectedValueOnce(
      new Error("attachment unavailable"),
    )
    prisma.recommendationPromotionRun.update.mockRejectedValueOnce(
      new Error("pointer unavailable"),
    )
    const { dispatchRecommendationPromotion } = await import("./job")

    await expect(dispatchRecommendationPromotion(input)).resolves.toMatchObject(
      { queued: true, workflowRunId: "runtime-1" },
    )
    expect(markWorkflowRunFailed).not.toHaveBeenCalled()
    expect(
      prisma.recommendationPromotionRun.updateMany,
    ).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: "FAILED" }),
      }),
    )
  })

  it("marks pending promotion truth failed when workflow start fails", async () => {
    start.mockRejectedValueOnce(new Error("runtime unavailable"))
    const { dispatchRecommendationPromotion } = await import("./job")

    await expect(dispatchRecommendationPromotion(input)).rejects.toThrow(
      "runtime unavailable",
    )
    expect(markWorkflowRunFailed).toHaveBeenCalledOnce()
    expect(prisma.recommendationPromotionRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: "FAILED" }),
      }),
    )
  })

  it("executes only a successfully claimed generation", async () => {
    claimRun.mockResolvedValue({ status: "claimed", claimId: "claim-1" })
    executeClaimedRun.mockResolvedValue({ status: "activated", generation: 2 })
    const { runRecommendationPromotionJob } = await import("./job")
    await expect(
      runRecommendationPromotionJob({
        runId: "run-1",
        expectedGeneration: 1,
        ledgerRunId: "ledger-1",
      }),
    ).resolves.toEqual({ status: "activated", generation: 2 })
    expect(executeClaimedRun).toHaveBeenCalledWith({
      runId: "run-1",
      expectedGeneration: 1,
      claimId: "claim-1",
    })
  })

  it("fences a stale workflow claim without executing the transition", async () => {
    claimRun.mockResolvedValue({ status: "fenced" })
    const { runRecommendationPromotionJob } = await import("./job")
    await expect(
      runRecommendationPromotionJob({
        runId: "run-1",
        expectedGeneration: 1,
        ledgerRunId: "ledger-1",
      }),
    ).resolves.toEqual({ status: "fenced", reason: "claim_unavailable" })
    expect(executeClaimedRun).not.toHaveBeenCalled()
  })

  it("dispatches an automatic rollback only for a failed active challenger", async () => {
    prisma.recommendationExperimentEvaluation.findUnique.mockResolvedValue({
      id: "evaluation-fail",
      state: "FAIL",
      experiment: {
        challengerManifestId: "semantic-experiment-aa-v1",
      },
    })
    prisma.recommendationPromotionPointer.findUnique.mockResolvedValue({
      activeManifestId: "semantic-experiment-aa-v1",
      lastKnownGoodManifestId: "semantic-transcript-pgvector-v1",
      activeApprovalId: "approval-1",
      stage: "BOUNDED",
      generation: 2,
    })
    const { dispatchAutomaticRecommendationRollback } = await import("./job")
    await dispatchAutomaticRecommendationRollback({
      evaluationId: "evaluation-fail",
    })
    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: expect.objectContaining({ role: "SYSTEM" }),
        action: "automatic_rollback",
        expectedPointerGeneration: 2,
        targetManifestId: "semantic-transcript-pgvector-v1",
      }),
    )
  })
})
