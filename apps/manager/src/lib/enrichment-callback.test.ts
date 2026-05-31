import { beforeEach, describe, expect, it, vi } from "vitest"
import type { JobRecord } from "@/types/job"

const {
  getJobLookupMock,
  mergeJobArtifactsMock,
  updateJobMock,
  updateStepStatusMock,
} = vi.hoisted(() => ({
  getJobLookupMock: vi.fn(),
  mergeJobArtifactsMock: vi.fn(),
  updateJobMock: vi.fn(),
  updateStepStatusMock: vi.fn(),
}))

vi.mock("@/lib/state", () => ({
  getJobLookup: getJobLookupMock,
  mergeJobArtifacts: mergeJobArtifactsMock,
  updateJob: updateJobMock,
  updateStepStatus: updateStepStatusMock,
}))

import { applyEnrichmentCallback } from "@/lib/enrichment-callback"

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    muxAssetId: "asset-1",
    muxPlaybackId: "playback-1",
    languages: ["fr"],
    options: {
      engine: "mastra",
      currentRunId: "run-1",
    },
    status: "running",
    retries: 0,
    createdAt: "2026-05-31T00:00:00.000Z",
    updatedAt: "2026-05-31T00:00:00.000Z",
    artifacts: {},
    steps: [
      { name: "translation", status: "running", retries: 0 },
      { name: "chapters", status: "completed", retries: 0 },
    ],
    errors: [],
    ...overrides,
  }
}

describe("applyEnrichmentCallback", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getJobLookupMock.mockResolvedValue({ status: "found", job: job() })
    updateStepStatusMock.mockResolvedValue(job())
    updateJobMock.mockResolvedValue(job())
    mergeJobArtifactsMock.mockResolvedValue(job())
  })

  it("applies a completed step with artifacts and language details", async () => {
    await expect(
      applyEnrichmentCallback({
        jobId: "job-1",
        engine: "mastra",
        runId: "run-1",
        sequence: 2,
        status: "completed",
        step: "translation",
        artifactsDelta: ["subtitles-fr", "translation-fr"],
        languageResults: [{ lang: "fr", status: "completed" }],
      }),
    ).resolves.toEqual({ ok: true, action: "applied" })

    expect(mergeJobArtifactsMock).toHaveBeenCalledWith("job-1", {
      "subtitles-fr": { kind: "downloadable" },
      "translation-fr": { kind: "downloadable" },
    })
    expect(updateStepStatusMock).toHaveBeenCalledWith(
      "job-1",
      "translation",
      "completed",
      undefined,
      { languageResults: [{ lang: "fr", status: "completed" }] },
    )
    expect(updateJobMock).toHaveBeenCalledWith("job-1", {
      options: {
        engine: "mastra",
        currentRunId: "run-1",
        callbackSequences: { translation: 2 },
      },
    })
  })

  it("drops stale callbacks whose runId no longer owns the job", async () => {
    await expect(
      applyEnrichmentCallback({
        jobId: "job-1",
        engine: "mastra",
        runId: "old-run",
        sequence: 1,
        status: "running",
        step: "translation",
      }),
    ).resolves.toEqual({ ok: true, action: "dropped", reason: "stale_run" })

    expect(updateStepStatusMock).not.toHaveBeenCalled()
  })

  it("rejects unsupported artifact keys", async () => {
    await expect(
      applyEnrichmentCallback({
        jobId: "job-1",
        engine: "mastra",
        runId: "run-1",
        sequence: 2,
        status: "completed",
        step: "translation",
        artifactsDelta: ["https://evil.test/not-an-artifact"],
      }),
    ).resolves.toMatchObject({ ok: false, status: 400 })
  })

  it("does not regress a terminal completed step back to running", async () => {
    await expect(
      applyEnrichmentCallback({
        jobId: "job-1",
        engine: "mastra",
        runId: "run-1",
        sequence: 3,
        status: "running",
        step: "chapters",
      }),
    ).resolves.toEqual({ ok: true, action: "dropped", reason: "stale_status" })
  })

  it("drops same-step callbacks older than the stored sequence", async () => {
    getJobLookupMock.mockResolvedValueOnce({
      status: "found",
      job: job({
        options: {
          engine: "mastra",
          currentRunId: "run-1",
          callbackSequences: { translation: 5 },
        },
      }),
    })

    await expect(
      applyEnrichmentCallback({
        jobId: "job-1",
        engine: "mastra",
        runId: "run-1",
        sequence: 4,
        status: "completed",
        step: "translation",
      }),
    ).resolves.toEqual({
      ok: true,
      action: "dropped",
      reason: "stale_sequence",
    })

    expect(updateStepStatusMock).not.toHaveBeenCalled()
    expect(updateJobMock).not.toHaveBeenCalled()
  })
})
