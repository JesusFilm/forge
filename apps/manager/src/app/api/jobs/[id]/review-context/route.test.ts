import { beforeEach, describe, expect, it, vi } from "vitest"

const { authenticateRequestMock, getJobMock, loadJobReviewContextMock } =
  vi.hoisted(() => ({
    authenticateRequestMock: vi.fn(),
    getJobMock: vi.fn(),
    loadJobReviewContextMock: vi.fn(),
  }))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: authenticateRequestMock,
}))

vi.mock("@/lib/state", () => ({
  getJob: getJobMock,
}))

vi.mock("@/features/jobs/review-player/load-job-review-context", () => ({
  loadJobReviewContext: loadJobReviewContextMock,
}))

import { GET } from "@/app/api/jobs/[id]/review-context/route"

function buildJob() {
  return {
    id: "job-1",
    muxAssetId: "asset-1",
    muxPlaybackId: "playback-1",
    languages: [],
    options: {},
    status: "completed",
    retries: 0,
    createdAt: "2026-04-12T00:00:00.000Z",
    updatedAt: "2026-04-12T00:01:00.000Z",
    artifacts: {},
    steps: [],
    errors: [],
  }
}

describe("GET /api/jobs/[id]/review-context", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset()
    getJobMock.mockReset()
    loadJobReviewContextMock.mockReset()
  })

  it("rejects unauthorized callers", async () => {
    authenticateRequestMock.mockResolvedValue(
      Response.json({ error: "forbidden" }, { status: 403 }),
    )

    const response = await GET(new Request("http://example.test"), {
      params: Promise.resolve({ id: "job-1" }),
    })

    expect(response.status).toBe(403)
  })

  it("returns 404 when the job does not exist", async () => {
    authenticateRequestMock.mockResolvedValue(null)
    getJobMock.mockResolvedValue(null)

    const response = await GET(new Request("http://example.test"), {
      params: Promise.resolve({ id: "job-1" }),
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: "Job not found",
    })
  })

  it("returns the normalized review context payload for an existing job", async () => {
    authenticateRequestMock.mockResolvedValue(null)
    getJobMock.mockResolvedValue(buildJob())
    loadJobReviewContextMock.mockResolvedValue({
      status: "ready",
      context: {
        playbackUrl: "https://stream.mux.com/playback-1.m3u8",
        before: {
          subtitles: { status: "unavailable", reason: "missing" },
          metadata: { status: "unavailable", reason: "missing" },
          chapters: { status: "unavailable", reason: "missing" },
        },
        after: {
          subtitles: { status: "unavailable", reason: "missing" },
          metadata: { status: "unavailable", reason: "missing" },
          chapters: { status: "unavailable", reason: "missing" },
        },
        compare: {},
      },
    })

    const response = await GET(new Request("http://example.test"), {
      params: Promise.resolve({ id: "job-1" }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      reviewContext: {
        status: "ready",
      },
    })
    expect(loadJobReviewContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "job-1",
      }),
    )
  })
})
