import { beforeEach, describe, expect, it, vi } from "vitest"

const { updateJobMock, updateStepStatusMock, mergeJobArtifactsMock } =
  vi.hoisted(() => ({
    updateJobMock: vi.fn(),
    updateStepStatusMock: vi.fn(),
    mergeJobArtifactsMock: vi.fn(),
  }))

vi.mock("@/lib/state", () => ({
  updateJob: updateJobMock,
  updateStepStatus: updateStepStatusMock,
  mergeJobArtifacts: mergeJobArtifactsMock,
}))

import {
  stepMergeJobArtifacts,
  stepUpdateJob,
  stepUpdateStepStatus,
} from "@/workflows/jobStateSteps"

describe("workflow job state steps", () => {
  beforeEach(() => {
    updateJobMock.mockReset()
    updateStepStatusMock.mockReset()
    mergeJobArtifactsMock.mockReset()
  })

  it("throws when a workflow job update returns null", async () => {
    updateJobMock.mockResolvedValueOnce(null)

    await expect(stepUpdateJob("job-1", { status: "failed" })).rejects.toThrow(
      "Workflow state write failed for job job-1 during updateJob",
    )
  })

  it("throws when a workflow step status update returns null", async () => {
    updateStepStatusMock.mockResolvedValueOnce(null)

    await expect(
      stepUpdateStepStatus("job-1", "metadata", "failed", "metadata offline"),
    ).rejects.toThrow(
      "Workflow state write failed for job job-1 during updateStepStatus(metadata)",
    )
  })

  it("throws when a workflow artifact merge returns null", async () => {
    mergeJobArtifactsMock.mockResolvedValueOnce(null)

    await expect(
      stepMergeJobArtifacts("job-1", {
        metadata: { kind: "downloadable" },
      }),
    ).rejects.toThrow(
      "Workflow state write failed for job job-1 during mergeJobArtifacts",
    )
  })
})
