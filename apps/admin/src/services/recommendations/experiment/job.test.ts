import { beforeEach, describe, expect, it, vi } from "vitest"

const start = vi.hoisted(() => vi.fn())
const workflowLog = vi.hoisted(() => ({
  createWorkflowRunLog: vi.fn(),
  attachWorkflowRuntimeRunId: vi.fn(),
  markWorkflowRunFailed: vi.fn(),
  markWorkflowRunRuntimeStarted: vi.fn(),
  markWorkflowRunStarted: vi.fn(),
}))
const createRun = vi.hoisted(() => vi.fn())
const prisma = vi.hoisted(() => ({
  recommendationExperimentEvaluationRun: {
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  workflowRun: { update: vi.fn() },
}))

vi.mock("workflow/api", () => ({ start }))
vi.mock("@/db/client", () => ({ prisma }))
vi.mock("@/services/workflow-run-log.service", () => workflowLog)
vi.mock("./evaluation", () => ({
  createRecommendationExperimentEvaluationService: () => ({ createRun }),
}))
vi.mock("../promotion/job", () => ({
  dispatchAutomaticRecommendationRollback: vi.fn(),
}))

import { dispatchRecommendationExperimentEvaluation } from "./job"

const input = {
  experimentId: "experiment-1",
  expectedExperimentGeneration: 3,
  windowStart: new Date("2026-08-20T00:00:00.000Z"),
  windowEnd: new Date("2026-08-21T00:00:00.000Z"),
}

describe("recommendation experiment evaluation dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createRun.mockResolvedValue({ runId: "run-1", generation: 2 })
    workflowLog.createWorkflowRunLog.mockResolvedValue({ id: "ledger-1" })
    workflowLog.attachWorkflowRuntimeRunId.mockResolvedValue(undefined)
    workflowLog.markWorkflowRunFailed.mockResolvedValue(undefined)
    prisma.recommendationExperimentEvaluationRun.update.mockResolvedValue({})
    prisma.recommendationExperimentEvaluationRun.updateMany.mockResolvedValue({
      count: 1,
    })
    start.mockResolvedValue({ runId: "runtime-1" })
  })

  it("keeps an already-started evaluation pending when pointer recording fails", async () => {
    workflowLog.attachWorkflowRuntimeRunId.mockRejectedValueOnce(
      new Error("attachment unavailable"),
    )
    prisma.recommendationExperimentEvaluationRun.update.mockRejectedValueOnce(
      new Error("pointer unavailable"),
    )

    await expect(
      dispatchRecommendationExperimentEvaluation(input),
    ).resolves.toMatchObject({
      queued: true,
      runId: "run-1",
      workflowRunId: "runtime-1",
    })
    expect(workflowLog.markWorkflowRunFailed).not.toHaveBeenCalled()
    expect(
      prisma.recommendationExperimentEvaluationRun.updateMany,
    ).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: "FAILED" }),
      }),
    )
  })

  it("marks pending evaluation truth failed when workflow start fails", async () => {
    start.mockRejectedValueOnce(new Error("runtime unavailable"))

    await expect(
      dispatchRecommendationExperimentEvaluation(input),
    ).rejects.toThrow("runtime unavailable")
    expect(workflowLog.markWorkflowRunFailed).toHaveBeenCalledOnce()
    expect(
      prisma.recommendationExperimentEvaluationRun.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: "FAILED" }),
      }),
    )
  })
})
