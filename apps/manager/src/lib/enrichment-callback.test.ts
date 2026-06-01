import { beforeEach, describe, expect, it, vi } from "vitest"

const { applyJobCallbackUpdateMock } = vi.hoisted(() => ({
  applyJobCallbackUpdateMock: vi.fn(),
}))

vi.mock("@/lib/state", () => ({
  applyJobCallbackUpdate: applyJobCallbackUpdateMock,
}))

import { applyEnrichmentCallback } from "@/lib/enrichment-callback"

describe("applyEnrichmentCallback", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    applyJobCallbackUpdateMock.mockResolvedValue({ status: "applied" })
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

    expect(applyJobCallbackUpdateMock).toHaveBeenCalledWith({
      jobId: "job-1",
      runId: "run-1",
      sequence: 2,
      step: "translation",
      status: "completed",
      jobStatus: undefined,
      error: undefined,
      details: { languageResults: [{ lang: "fr", status: "completed" }] },
      artifactsDelta: ["subtitles-fr", "translation-fr"],
    })
  })

  it("drops stale callbacks whose runId no longer owns the job", async () => {
    applyJobCallbackUpdateMock.mockResolvedValueOnce({
      status: "dropped",
      reason: "stale_run",
    })

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
  })

  it("rejects unsupported artifact keys", async () => {
    applyJobCallbackUpdateMock.mockResolvedValueOnce({
      status: "invalid",
      error: "Unsupported artifact keys for translation: metadata",
    })

    await expect(
      applyEnrichmentCallback({
        jobId: "job-1",
        engine: "mastra",
        runId: "run-1",
        sequence: 2,
        status: "completed",
        step: "translation",
        artifactsDelta: ["metadata"],
      }),
    ).resolves.toMatchObject({ ok: false, status: 400 })
  })

  it("does not regress a terminal completed step back to running", async () => {
    applyJobCallbackUpdateMock.mockResolvedValueOnce({
      status: "dropped",
      reason: "stale_status",
    })

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
    applyJobCallbackUpdateMock.mockResolvedValueOnce({
      status: "dropped",
      reason: "stale_sequence",
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
  })

  it("returns retryable failure when the state update cannot complete", async () => {
    applyJobCallbackUpdateMock.mockResolvedValueOnce({
      status: "error",
      error: new Error("admin down"),
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
      ok: false,
      status: 503,
      error: "Callback job update failed; retry later",
    })
  })
})
