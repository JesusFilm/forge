import { describe, expect, it, vi } from "vitest"

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

    expect(markRuntimeStarted).toHaveBeenCalledWith("ledger-1", "runtime-1")
    expect(markRuntimeStarted).toHaveBeenCalledBefore(runJob)
  })
})
