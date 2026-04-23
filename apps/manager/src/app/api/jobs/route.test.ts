import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  authenticateRequestMock,
  countJobsMock,
  createJobMock,
  createMuxAssetMock,
  getCmsGatewayMock,
  isAudioCleanupConfiguredMock,
  listJobSummariesMock,
  listJobsMock,
  runVideoEnrichmentMock,
  startMock,
  updateJobMock,
} = vi.hoisted(() => ({
  authenticateRequestMock: vi.fn(),
  countJobsMock: vi.fn(),
  createJobMock: vi.fn(),
  createMuxAssetMock: vi.fn(),
  getCmsGatewayMock: vi.fn(),
  isAudioCleanupConfiguredMock: vi.fn(),
  listJobSummariesMock: vi.fn(),
  listJobsMock: vi.fn(),
  runVideoEnrichmentMock: vi.fn(),
  startMock: vi.fn(),
  updateJobMock: vi.fn(),
}))

vi.mock("workflow/api", () => ({
  start: startMock,
}))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: authenticateRequestMock,
}))

vi.mock("@/cms/gateway", async () => {
  const actual =
    await vi.importActual<typeof import("@/cms/gateway")>("@/cms/gateway")
  return {
    ...actual,
    getCmsGateway: getCmsGatewayMock,
  }
})

vi.mock("@/lib/state", () => ({
  countJobs: countJobsMock,
  createJob: createJobMock,
  listJobSummaries: listJobSummariesMock,
  listJobs: listJobsMock,
  updateJob: updateJobMock,
}))

vi.mock("@/services/mux", () => ({
  createMuxAsset: createMuxAssetMock,
}))

vi.mock("@/services/audioCleanup", () => ({
  isAudioCleanupConfigured: isAudioCleanupConfiguredMock,
}))

vi.mock("@/workflows/videoEnrichment", () => ({
  runVideoEnrichment: runVideoEnrichmentMock,
}))

import { POST } from "@/app/api/jobs/route"
import { wrapStartSpy } from "@/test-helpers/workflow-dispatch"
import { runVideoEnrichment } from "@/workflows/videoEnrichment"

describe("POST /api/jobs", () => {
  const dispatch = wrapStartSpy(startMock)

  beforeEach(() => {
    vi.clearAllMocks()

    authenticateRequestMock.mockResolvedValue(null)
    getCmsGatewayMock.mockReturnValue({ mode: "live" })
    isAudioCleanupConfiguredMock.mockReturnValue(true)
    createMuxAssetMock.mockResolvedValue({
      assetId: "mux-asset-1",
      playbackId: "mux-playback-1",
    })
    createJobMock.mockResolvedValue({
      id: "job-1",
      muxAssetId: "mux-asset-1",
      muxPlaybackId: "mux-playback-1",
      languages: ["fr"],
      options: {},
      status: "pending",
      retries: 0,
      createdAt: "",
      updatedAt: "",
      artifacts: {
        transcriptionRouting: {
          kind: "metadata",
          data: {
            attempts: [],
            sourceInputUrl: "https://cdn.example.com/video.mp4",
          },
        },
      },
      steps: [],
      errors: [],
    })
    updateJobMock.mockResolvedValue(null)
    dispatch.mockReturnValue({
      assetId: "mux-asset-1",
      transcript: "Transcript",
      language: "en",
      chapters: [],
      tags: [],
    })
  })

  it("creates a demo job in mock mode without Mux ingestion or workflow dispatch", async () => {
    getCmsGatewayMock.mockReturnValueOnce({ mode: "mock" })
    createJobMock.mockResolvedValueOnce({
      id: "mock-job-3",
      muxAssetId: "mock-upload-asset",
      muxPlaybackId: "mock-upload-playback",
      languages: ["6414"],
      options: {},
      status: "pending",
      retries: 0,
      createdAt: "2026-04-22T16:00:00.000Z",
      updatedAt: "2026-04-22T16:00:00.000Z",
      artifacts: {},
      steps: [],
      errors: [],
    })

    const response = await POST(
      new Request("https://manager.test/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputUrl: "https://example.test/video.mp4",
          translateTo: ["6414"],
        }),
      }),
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      jobId: "mock-job-3",
      note: "Created in mock mode without Mux ingestion or workflow dispatch.",
    })
    expect(createMuxAssetMock).not.toHaveBeenCalled()
    dispatch.expectNotDispatched()
    expect(runVideoEnrichment).not.toHaveBeenCalled()
  })

  it("rejects unauthorized requests before dispatch", async () => {
    authenticateRequestMock.mockResolvedValueOnce(
      Response.json({ error: "Unauthorized" }, { status: 401 }),
    )

    const response = await POST(
      new Request("https://manager.test/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputUrl: "https://cdn.example.com/video.mp4",
        }),
      }),
    )

    expect(response.status).toBe(401)
    dispatch.expectNotDispatched()
    expect(createMuxAssetMock).not.toHaveBeenCalled()
  })

  it("returns 400 for invalid payloads without dispatching", async () => {
    const response = await POST(
      new Request("https://manager.test/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputUrl: "http://cdn.example.com/video.mp4",
        }),
      }),
    )

    expect(response.status).toBe(400)
    dispatch.expectNotDispatched()
    expect(createMuxAssetMock).not.toHaveBeenCalled()
  })

  it("dispatches enrichment through workflow start()", async () => {
    const response = await POST(
      new Request("https://manager.test/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputUrl: "https://cdn.example.com/video.mp4",
          language: "en",
          translateTo: ["fr"],
        }),
      }),
    )

    expect(response.status).toBe(201)
    dispatch.expectDispatched(runVideoEnrichment, [
      expect.objectContaining({
        jobId: "job-1",
        assetId: "mux-asset-1",
        muxAssetId: "mux-asset-1",
        playbackId: "mux-playback-1",
        language: "en",
        translateTo: ["fr"],
        runAudioCleanup: true,
        initialArtifacts: expect.objectContaining({
          transcriptionRouting: expect.any(Object),
        }),
        requestedTranscriptionProvider: "automatic",
      }),
    ])
    expect(dispatch.spy).toHaveBeenCalledTimes(1)
    expect(runVideoEnrichment).not.toHaveBeenCalled()
  })

  it("returns a launch failure response when workflow dispatch fails", async () => {
    startMock.mockReset()
    startMock.mockRejectedValueOnce(new Error("workflow offline"))

    const response = await POST(
      new Request("https://manager.test/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputUrl: "https://cdn.example.com/video.mp4",
          language: "en",
          translateTo: ["fr"],
        }),
      }),
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({
      error: "Failed to launch enrichment workflow.",
      code: "workflow_launch_failed",
      details: "workflow offline",
    })
    expect(updateJobMock).toHaveBeenCalledWith("job-1", { status: "failed" })
    expect(startMock).toHaveBeenCalledTimes(1)
    expect(runVideoEnrichment).not.toHaveBeenCalled()
  })
})
