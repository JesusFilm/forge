import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  dispatchMastraVideoEnrichmentMock,
  getJobMock,
  markEnrichmentDispatchedMock,
  runVideoEnrichmentMock,
  startMock,
} = vi.hoisted(() => ({
  dispatchMastraVideoEnrichmentMock: vi.fn(),
  getJobMock: vi.fn(),
  markEnrichmentDispatchedMock: vi.fn(),
  runVideoEnrichmentMock: vi.fn(),
  startMock: vi.fn(),
}))

vi.mock("workflow/api", () => ({
  start: startMock,
}))

vi.mock("@/lib/state", () => ({
  getJob: getJobMock,
  markEnrichmentDispatched: markEnrichmentDispatchedMock,
}))

vi.mock("@/services/mastra-enrichment", () => ({
  dispatchMastraVideoEnrichment: dispatchMastraVideoEnrichmentMock,
}))

vi.mock("@/workflows/videoEnrichment", () => ({
  runVideoEnrichment: runVideoEnrichmentMock,
}))

import { launchVideoEnrichment } from "@/workflows/launchVideoEnrichment"
import { runVideoEnrichment } from "@/workflows/videoEnrichment"

const input = {
  jobId: "job-1",
  assetId: "asset-1",
  muxAssetId: "mux-1",
}

describe("launchVideoEnrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("uses the existing workflow engine for unstamped jobs", async () => {
    getJobMock.mockResolvedValue({ options: {} })
    startMock.mockResolvedValue("workflow-result")

    await expect(launchVideoEnrichment(input)).resolves.toBe("workflow-result")

    expect(startMock).toHaveBeenCalledWith(runVideoEnrichment, [input])
    expect(dispatchMastraVideoEnrichmentMock).not.toHaveBeenCalled()
  })

  it("does not fall back to workflow when the job cannot be read", async () => {
    getJobMock.mockResolvedValue(null)

    await expect(launchVideoEnrichment(input)).rejects.toMatchObject({
      name: "EnrichmentLaunchError",
      jobId: "job-1",
    })
    expect(startMock).not.toHaveBeenCalled()
    expect(dispatchMastraVideoEnrichmentMock).not.toHaveBeenCalled()
  })

  it("dispatches through Mastra and persists run visibility for mastra-stamped jobs", async () => {
    getJobMock.mockResolvedValue({ options: { engine: "mastra" } })
    dispatchMastraVideoEnrichmentMock.mockResolvedValue({
      ok: true,
      runId: "run-1",
    })
    markEnrichmentDispatchedMock.mockResolvedValue({ id: "job-1" })

    await expect(launchVideoEnrichment(input)).resolves.toEqual({
      ok: true,
      runId: "run-1",
    })

    expect(dispatchMastraVideoEnrichmentMock).toHaveBeenCalledWith(input)
    expect(markEnrichmentDispatchedMock).toHaveBeenCalledWith("job-1", "run-1")
    expect(startMock).not.toHaveBeenCalled()
  })

  it("throws when Mastra run visibility cannot be persisted", async () => {
    getJobMock.mockResolvedValue({ options: { engine: "mastra" } })
    dispatchMastraVideoEnrichmentMock.mockResolvedValue({
      ok: true,
      runId: "run-1",
    })
    markEnrichmentDispatchedMock.mockResolvedValue(null)

    await expect(launchVideoEnrichment(input)).rejects.toMatchObject({
      name: "EnrichmentLaunchError",
      jobId: "job-1",
      message: "Mastra enrichment dispatch visibility failed for job job-1",
    })
  })

  it("throws when Mastra rejects the dispatch", async () => {
    getJobMock.mockResolvedValue({ options: { engine: "mastra" } })
    dispatchMastraVideoEnrichmentMock.mockResolvedValue({
      ok: false,
      reason: "auth_failed",
    })

    await expect(launchVideoEnrichment(input)).rejects.toMatchObject({
      name: "EnrichmentLaunchError",
      jobId: "job-1",
      message: "Mastra enrichment dispatch failed for job job-1: auth_failed",
    })
    expect(markEnrichmentDispatchedMock).not.toHaveBeenCalled()
  })
})
