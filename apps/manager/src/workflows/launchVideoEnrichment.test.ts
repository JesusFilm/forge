import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  dispatchMastraVideoEnrichmentMock,
  getJobMock,
  prepareNamespaceMock,
  markEnrichmentDispatchedMock,
  runVideoEnrichmentMock,
  scheduleMastraFirstCallbackWatchdogMock,
  startMastraVideoEnrichmentMock,
  startMock,
} = vi.hoisted(() => ({
  dispatchMastraVideoEnrichmentMock: vi.fn(),
  getJobMock: vi.fn(),
  prepareNamespaceMock: vi.fn(),
  markEnrichmentDispatchedMock: vi.fn(),
  runVideoEnrichmentMock: vi.fn(),
  scheduleMastraFirstCallbackWatchdogMock: vi.fn(),
  startMastraVideoEnrichmentMock: vi.fn(),
  startMock: vi.fn(),
}))

vi.mock("@/lib/enrichment-artifact-namespace", () => ({
  prepareEnrichmentArtifactNamespace: prepareNamespaceMock,
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
  startMastraVideoEnrichment: startMastraVideoEnrichmentMock,
}))

vi.mock("@/workflows/videoEnrichment", () => ({
  runVideoEnrichment: runVideoEnrichmentMock,
}))

vi.mock("@/workflows/mastraEnrichmentWatchdog", () => ({
  scheduleMastraFirstCallbackWatchdog: scheduleMastraFirstCallbackWatchdogMock,
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
    prepareNamespaceMock.mockResolvedValue({
      id: "job-1",
      muxAssetId: "mux-1",
      artifacts: {},
      options: {
        engine: "mastra",
        enrichmentArtifacts: {
          assetId: "owned-namespace",
          status: "ready",
          sourceVerified: false,
        },
      },
    })
  })

  it("uses the existing workflow engine for unstamped jobs", async () => {
    getJobMock.mockResolvedValue({ muxAssetId: "asset-1", options: {} })
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
    startMastraVideoEnrichmentMock.mockResolvedValue({
      ok: true,
      runId: "run-1",
    })

    await expect(launchVideoEnrichment(input)).resolves.toEqual({
      ok: true,
      runId: "run-1",
    })

    expect(dispatchMastraVideoEnrichmentMock).toHaveBeenCalledWith({
      ...input,
      assetId: "owned-namespace",
      initialArtifacts: {},
    })
    expect(markEnrichmentDispatchedMock).toHaveBeenCalledWith("job-1", "run-1")
    expect(startMastraVideoEnrichmentMock).toHaveBeenCalledWith(
      { ...input, assetId: "owned-namespace", initialArtifacts: {} },
      "run-1",
    )
    expect(scheduleMastraFirstCallbackWatchdogMock).toHaveBeenCalledWith(
      "job-1",
      "run-1",
    )
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
    expect(startMastraVideoEnrichmentMock).not.toHaveBeenCalled()
  })

  it("throws when Mastra cannot start after run visibility is persisted", async () => {
    getJobMock.mockResolvedValue({ options: { engine: "mastra" } })
    dispatchMastraVideoEnrichmentMock.mockResolvedValue({
      ok: true,
      runId: "run-1",
    })
    markEnrichmentDispatchedMock.mockResolvedValue({ id: "job-1" })
    startMastraVideoEnrichmentMock.mockResolvedValue({
      ok: false,
      reason: "network_error",
    })

    await expect(launchVideoEnrichment(input)).rejects.toMatchObject({
      name: "EnrichmentLaunchError",
      jobId: "job-1",
      message: "Mastra enrichment start failed for job job-1: network_error",
    })
    expect(scheduleMastraFirstCallbackWatchdogMock).not.toHaveBeenCalled()
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
    expect(startMastraVideoEnrichmentMock).not.toHaveBeenCalled()
    expect(scheduleMastraFirstCallbackWatchdogMock).not.toHaveBeenCalled()
  })
})

it("does not dispatch until artifact preparation is durably ready", async () => {
  vi.clearAllMocks()
  getJobMock.mockResolvedValue({ options: { engine: "mastra" } })
  prepareNamespaceMock.mockRejectedValueOnce(
    new Error("preparation needs reconciliation"),
  )
  await expect(launchVideoEnrichment(input)).rejects.toThrow("reconciliation")
  expect(dispatchMastraVideoEnrichmentMock).not.toHaveBeenCalled()
  expect(startMastraVideoEnrichmentMock).not.toHaveBeenCalled()
})

it.each([false, true])(
  "dispatches verified owned source only when reusable (verified=%s)",
  async (sourceVerified) => {
    vi.clearAllMocks()
    getJobMock.mockResolvedValue({ options: { engine: "mastra" } })
    prepareNamespaceMock.mockResolvedValue({
      muxAssetId: "mux-1",
      artifacts: {
        transcript: { kind: "downloadable" },
        subtitles: { kind: "downloadable" },
      },
      options: {
        enrichmentArtifacts: {
          assetId: "owned-namespace",
          status: "ready",
          sourceVerified,
        },
      },
    })
    dispatchMastraVideoEnrichmentMock.mockResolvedValue({
      ok: true,
      runId: "run-1",
    })
    markEnrichmentDispatchedMock.mockResolvedValue({ id: "job-1" })
    startMastraVideoEnrichmentMock.mockResolvedValue({
      ok: true,
      runId: "run-1",
    })
    await launchVideoEnrichment(input)
    expect(
      dispatchMastraVideoEnrichmentMock.mock.calls[0][0].initialArtifacts,
    ).toEqual(
      sourceVerified
        ? {
            transcript: { kind: "downloadable" },
            subtitles: { kind: "downloadable" },
          }
        : {},
    )
    expect(prepareNamespaceMock.mock.invocationCallOrder[0]).toBeLessThan(
      dispatchMastraVideoEnrichmentMock.mock.invocationCallOrder[0],
    )
    await launchVideoEnrichment({
      ...input,
      requestedTranscriptionProvider: "mux",
    })
    expect(
      dispatchMastraVideoEnrichmentMock.mock.calls[1][0].initialArtifacts,
    ).toEqual({})
  },
)

it("retains a ready job namespace when rolling back to the legacy engine", async () => {
  vi.clearAllMocks()
  getJobMock.mockResolvedValue({
    muxAssetId: "mux-1",
    options: { engine: "workflow", enrichmentArtifacts: { status: "ready" } },
  })
  prepareNamespaceMock.mockResolvedValue({
    muxAssetId: "mux-1",
    options: {
      engine: "workflow",
      enrichmentArtifacts: {
        assetId: "owned-namespace",
        status: "ready",
        sourceVerified: true,
      },
    },
  })
  await launchVideoEnrichment(input)
  expect(prepareNamespaceMock).toHaveBeenCalledWith("job-1")
  expect(startMock).toHaveBeenCalledWith(runVideoEnrichment, [
    { ...input, assetId: "owned-namespace" },
  ])
})

it("does not bypass incomplete artifact preparation after an engine rollback", async () => {
  vi.clearAllMocks()
  getJobMock.mockResolvedValue({
    muxAssetId: "mux-1",
    options: {
      engine: "workflow",
      enrichmentArtifacts: { status: "preparing" },
    },
  })
  prepareNamespaceMock.mockRejectedValueOnce(
    new Error("preparation needs reconciliation"),
  )
  await expect(launchVideoEnrichment(input)).rejects.toThrow("reconciliation")
  expect(startMock).not.toHaveBeenCalled()
})
