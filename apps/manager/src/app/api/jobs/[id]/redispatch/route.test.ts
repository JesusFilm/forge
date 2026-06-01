import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  authenticateRequestMock,
  getJobMock,
  isAudioCleanupConfiguredMock,
  launchVideoEnrichmentMock,
  updateJobMock,
} = vi.hoisted(() => ({
  authenticateRequestMock: vi.fn(),
  getJobMock: vi.fn(),
  isAudioCleanupConfiguredMock: vi.fn(),
  launchVideoEnrichmentMock: vi.fn(),
  updateJobMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: authenticateRequestMock,
}))

vi.mock("@/lib/state", () => ({
  getJob: getJobMock,
  updateJob: updateJobMock,
}))

vi.mock("@/services/audioCleanup", () => ({
  isAudioCleanupConfigured: isAudioCleanupConfiguredMock,
}))

vi.mock("@/workflows/launchVideoEnrichment", () => ({
  launchVideoEnrichment: launchVideoEnrichmentMock,
}))

import { POST } from "@/app/api/jobs/[id]/redispatch/route"

const request = new Request("https://manager.test/api/jobs/job-1/redispatch", {
  method: "POST",
})

function mastraJob(
  overrides: {
    status?: "pending" | "running" | "completed" | "failed"
    options?: Record<string, unknown>
  } = {},
) {
  return {
    id: "job-1",
    muxAssetId: "mux-1",
    muxPlaybackId: "play-1",
    languages: ["fr"],
    sourceLanguageCode: "en",
    videoDocumentId: "video-1",
    status: "failed",
    retries: 0,
    createdAt: "",
    updatedAt: "",
    artifacts: {},
    steps: [],
    errors: [],
    ...overrides,
    options: {
      engine: "mastra",
      currentRunId: "old-run",
      ...overrides.options,
    },
  }
}

describe("POST /api/jobs/[id]/redispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authenticateRequestMock.mockResolvedValue(null)
    getJobMock.mockResolvedValue(mastraJob())
    isAudioCleanupConfiguredMock.mockReturnValue(true)
    launchVideoEnrichmentMock.mockResolvedValue({ ok: true, runId: "run-2" })
    updateJobMock.mockResolvedValue(mastraJob())
  })

  it("redispatches a mastra-stamped job through the shared launcher", async () => {
    const response = await POST(request, {
      params: Promise.resolve({ id: "job-1" }),
    })

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({
      jobId: "job-1",
      dispatch: { ok: true, runId: "run-2" },
    })
    expect(launchVideoEnrichmentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        muxAssetId: "mux-1",
        translateTo: ["fr"],
        runAudioCleanup: true,
      }),
    )
  })

  it("rejects workflow-stamped jobs", async () => {
    getJobMock.mockResolvedValueOnce({
      ...mastraJob(),
      options: { engine: "workflow" },
    })

    const response = await POST(request, {
      params: Promise.resolve({ id: "job-1" }),
    })

    expect(response.status).toBe(409)
    expect(launchVideoEnrichmentMock).not.toHaveBeenCalled()
  })

  it("rejects redispatch while the previous Mastra run is still active", async () => {
    getJobMock.mockResolvedValueOnce(mastraJob({ status: "running" }))

    const response = await POST(request, {
      params: Promise.resolve({ id: "job-1" }),
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: "Job already has an active Mastra run",
      currentRunId: "old-run",
    })
    expect(launchVideoEnrichmentMock).not.toHaveBeenCalled()
  })

  it("marks the job failed if redispatch cannot be accepted", async () => {
    launchVideoEnrichmentMock.mockRejectedValueOnce(new Error("mastra down"))

    const response = await POST(request, {
      params: Promise.resolve({ id: "job-1" }),
    })

    expect(response.status).toBe(502)
    expect(updateJobMock).toHaveBeenCalledWith("job-1", {
      status: "failed",
      currentStep: undefined,
    })
  })
})
