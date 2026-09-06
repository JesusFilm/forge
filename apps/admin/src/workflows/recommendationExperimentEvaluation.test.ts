import { describe, expect, it, vi } from "vitest"

const markRuntimeStarted = vi.hoisted(() => vi.fn())
const runJob = vi.hoisted(() => vi.fn())

vi.mock("@/services/recommendations/experiment/job", () => ({
  markRecommendationExperimentEvaluationRuntimeStarted: markRuntimeStarted,
  runRecommendationExperimentEvaluationJob: runJob,
}))
vi.mock("workflow", () => ({
  getWorkflowMetadata: () => ({ workflowRunId: "runtime-1" }),
}))

import { runRecommendationExperimentEvaluation } from "./recommendationExperimentEvaluation"

describe("recommendation experiment evaluation workflow", () => {
  it("repairs ledger and business runtime identity before claiming work", async () => {
    runJob.mockResolvedValue({ status: "published" })
    const input = {
      runId: "run-1",
      expectedGeneration: 2,
      expectedExperimentGeneration: 3,
      ledgerRunId: "ledger-1",
    }

    await runRecommendationExperimentEvaluation(input)

    expect(markRuntimeStarted).toHaveBeenCalledWith(input, "runtime-1")
    expect(markRuntimeStarted).toHaveBeenCalledBefore(runJob)
  })
})
