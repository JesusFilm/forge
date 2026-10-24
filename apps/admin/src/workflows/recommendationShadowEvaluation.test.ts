import { beforeEach, describe, expect, it, vi } from "vitest"

const markRuntimeStarted = vi.hoisted(() => vi.fn())
const runJob = vi.hoisted(() => vi.fn())

vi.mock("@/services/recommendations/shadow-evaluation/job", () => ({
  markRecommendationShadowEvaluationRuntimeStarted: markRuntimeStarted,
  runRecommendationShadowEvaluationJob: runJob,
}))
vi.mock("workflow", () => ({
  getWorkflowMetadata: () => ({ workflowRunId: "runtime-1" }),
}))

import { runRecommendationShadowEvaluation } from "./recommendationShadowEvaluation"

describe("recommendation shadow evaluation workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    markRuntimeStarted.mockResolvedValue(true)
  })
  it("does not execute when runtime attachment is refused", async () => {
    markRuntimeStarted.mockResolvedValueOnce(false)
    await expect(
      runRecommendationShadowEvaluation({
        evaluationId: "evaluation-1",
        expectedGeneration: 1,
        generatorKey: "semantic-aa-v1",
        minimumRuns: 1,
        ledgerRunId: "ledger-1",
      }),
    ).resolves.toMatchObject({
      status: "fenced",
      reason: "dispatch_runtime_conflict",
    })
    expect(runJob).not.toHaveBeenCalled()
  })

  it("repairs ledger runtime identity before sampling work", async () => {
    runJob.mockResolvedValue({ status: "decided" })
    const input = {
      evaluationId: "evaluation-1",
      expectedGeneration: 2,
      generatorKey: "semantic-aa-v1",
      minimumRuns: 10,
      ledgerRunId: "ledger-1",
    }

    await runRecommendationShadowEvaluation(input)

    expect(markRuntimeStarted).toHaveBeenCalledWith(input, "runtime-1")
    expect(runJob).toHaveBeenCalledWith(input, "runtime-1")
    expect(markRuntimeStarted).toHaveBeenCalledBefore(runJob)
  })
})
