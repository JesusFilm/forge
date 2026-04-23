import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  authenticateRequestMock,
  createJobMock,
  createMuxAssetMock,
  getCmsGatewayMock,
  runVideoEnrichmentMock,
} = vi.hoisted(() => ({
  authenticateRequestMock: vi.fn(),
  createJobMock: vi.fn(),
  createMuxAssetMock: vi.fn(),
  getCmsGatewayMock: vi.fn(),
  runVideoEnrichmentMock: vi.fn(),
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
  countJobs: vi.fn(),
  createJob: createJobMock,
  listJobSummaries: vi.fn(),
  listJobs: vi.fn(),
  updateJob: vi.fn(),
}))

vi.mock("@/services/mux", () => ({
  createMuxAsset: createMuxAssetMock,
}))

vi.mock("@/workflows/videoEnrichment", () => ({
  runVideoEnrichment: runVideoEnrichmentMock,
}))

import { POST } from "./route"

describe("POST /api/jobs in mock mode", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset()
    createJobMock.mockReset()
    createMuxAssetMock.mockReset()
    getCmsGatewayMock.mockReset()
    runVideoEnrichmentMock.mockReset()
    authenticateRequestMock.mockResolvedValue(null)
    getCmsGatewayMock.mockReturnValue({ mode: "mock" })
  })

  it("creates a demo job without Mux ingestion or workflow dispatch", async () => {
    createJobMock.mockResolvedValue({
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
      new Request("http://example.test/api/jobs", {
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
    expect(runVideoEnrichmentMock).not.toHaveBeenCalled()
  })
})
