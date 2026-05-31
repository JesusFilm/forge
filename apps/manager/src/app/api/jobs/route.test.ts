import { beforeEach, describe, expect, it, vi } from "vitest"
import type { JobRecord } from "@/types/job"

const {
  authenticateRequestMock,
  countJobsMock,
  createJobMock,
  createMuxAssetMock,
  getJobMock,
  getCmsGatewayMock,
  isAudioCleanupConfiguredMock,
  listJobSummariesMock,
  listJobsMock,
  markEnrichmentDispatchedMock,
  resolveEnrichmentEngineMock,
  runVideoEnrichmentMock,
  startMock,
  updateJobMock,
} = vi.hoisted(() => ({
  authenticateRequestMock: vi.fn(),
  countJobsMock: vi.fn(),
  createJobMock: vi.fn(),
  createMuxAssetMock: vi.fn(),
  getJobMock: vi.fn(),
  getCmsGatewayMock: vi.fn(),
  isAudioCleanupConfiguredMock: vi.fn(),
  listJobSummariesMock: vi.fn(),
  listJobsMock: vi.fn(),
  markEnrichmentDispatchedMock: vi.fn(),
  resolveEnrichmentEngineMock: vi.fn(),
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
  getJob: getJobMock,
  listJobSummaries: listJobSummariesMock,
  listJobs: listJobsMock,
  markEnrichmentDispatched: markEnrichmentDispatchedMock,
  updateJob: updateJobMock,
}))

vi.mock("@/lib/enrichment-engine", () => ({
  resolveEnrichmentEngine: resolveEnrichmentEngineMock,
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

import { GET, POST } from "@/app/api/jobs/route"
import { wrapStartSpy } from "@/test-helpers/workflow-dispatch"
import { runVideoEnrichment } from "@/workflows/videoEnrichment"

function buildJob(id: string): JobRecord {
  return {
    id,
    muxAssetId: `asset-${id}`,
    muxPlaybackId: `playback-${id}`,
    languages: ["fr"],
    options: {},
    status: "running",
    retries: 0,
    createdAt: "2026-04-22T00:00:00.000Z",
    updatedAt: "2026-04-22T00:01:00.000Z",
    artifacts: {},
    steps: [],
    errors: [],
  }
}

describe("GET /api/jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    authenticateRequestMock.mockResolvedValue(null)
    listJobSummariesMock.mockResolvedValue([
      buildJob("job-1"),
      buildJob("job-2"),
    ])
    countJobsMock.mockResolvedValue(2)
  })

  it("rejects unauthorized callers", async () => {
    authenticateRequestMock.mockResolvedValueOnce(
      Response.json({ error: "Authentication required" }, { status: 401 }),
    )

    const response = await GET(new Request("http://example.test/api/jobs"))

    expect(response.status).toBe(401)
  })

  it("returns the summary envelope by default", async () => {
    const response = await GET(new Request("http://example.test/api/jobs"))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      jobs: expect.arrayContaining([expect.objectContaining({ id: "job-1" })]),
      total: 2,
    })
    expect(listJobSummariesMock).toHaveBeenCalledTimes(1)
    expect(listJobSummariesMock).toHaveBeenCalledWith({
      limit: 50,
      offset: 0,
    })
    expect(countJobsMock).toHaveBeenCalledTimes(1)
  })

  it("preserves limit, offset, and total semantics for summary pages", async () => {
    listJobSummariesMock.mockResolvedValueOnce([buildJob("job-3")])
    countJobsMock.mockResolvedValueOnce(300)

    const response = await GET(
      new Request("http://example.test/api/jobs?limit=25&offset=100"),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      jobs: [expect.objectContaining({ id: "job-3" })],
      total: 300,
    })
    expect(listJobSummariesMock).toHaveBeenCalledWith({
      limit: 25,
      offset: 100,
    })
  })

  it("returns the count envelope when requested", async () => {
    const response = await GET(
      new Request("http://example.test/api/jobs?view=count"),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ total: 2 })
    expect(countJobsMock).toHaveBeenCalledTimes(1)
    expect(listJobSummariesMock).not.toHaveBeenCalled()
  })

  it("returns 502 when the job list cannot be loaded", async () => {
    listJobSummariesMock.mockRejectedValueOnce(new Error("admin down"))

    const response = await GET(new Request("http://example.test/api/jobs"))

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      error: "Failed to load jobs",
    })
  })

  it("returns 502 when the job count cannot be loaded", async () => {
    countJobsMock.mockRejectedValueOnce(new Error("admin down"))

    const response = await GET(
      new Request("http://example.test/api/jobs?view=count"),
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      error: "Failed to load jobs",
    })
  })
})

describe("POST /api/jobs", () => {
  const dispatch = wrapStartSpy(startMock)

  beforeEach(() => {
    vi.clearAllMocks()

    authenticateRequestMock.mockResolvedValue(null)
    getCmsGatewayMock.mockReturnValue({ mode: "live" })
    isAudioCleanupConfiguredMock.mockReturnValue(true)
    resolveEnrichmentEngineMock.mockResolvedValue("workflow")
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
    getJobMock.mockResolvedValue({
      id: "job-1",
      muxAssetId: "mux-asset-1",
      muxPlaybackId: "mux-playback-1",
      languages: ["fr"],
      options: { engine: "workflow" },
      status: "pending",
      retries: 0,
      createdAt: "",
      updatedAt: "",
      artifacts: {},
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
