import { beforeEach, describe, expect, it, vi } from "vitest"
import type { JobRecord } from "@/types/job"

const { authenticateRequestMock, getJobLookupMock } = vi.hoisted(() => ({
  authenticateRequestMock: vi.fn(),
  getJobLookupMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: authenticateRequestMock,
}))

vi.mock("@/lib/state", () => ({
  getJobLookup: getJobLookupMock,
}))

import { GET } from "@/app/api/jobs/[id]/route"

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

describe("GET /api/jobs/[id]", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset()
    getJobLookupMock.mockReset()

    authenticateRequestMock.mockResolvedValue(null)
    getJobLookupMock.mockResolvedValue({
      status: "found",
      job: buildJob("job-1"),
    })
  })

  it("rejects unauthorized callers", async () => {
    authenticateRequestMock.mockResolvedValue(
      Response.json({ error: "Authentication required" }, { status: 401 }),
    )

    const response = await GET(
      new Request("http://example.test/api/jobs/job-1"),
      {
        params: Promise.resolve({ id: "job-1" }),
      },
    )

    expect(response.status).toBe(401)
  })

  it("returns 404 when the job does not exist", async () => {
    getJobLookupMock.mockResolvedValue({ status: "not-found" })

    const response = await GET(
      new Request("http://example.test/api/jobs/job-1"),
      {
        params: Promise.resolve({ id: "job-1" }),
      },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: "Job not found",
    })
  })

  it("returns 502 when the job lookup fails", async () => {
    getJobLookupMock.mockResolvedValue({
      status: "error",
      error: new Error("cms down"),
    })

    const response = await GET(
      new Request("http://example.test/api/jobs/job-1"),
      {
        params: Promise.resolve({ id: "job-1" }),
      },
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({
      error: "Failed to load job",
    })
  })

  it("returns the normalized job payload when the job exists", async () => {
    const response = await GET(
      new Request("http://example.test/api/jobs/job-1"),
      {
        params: Promise.resolve({ id: "job-1" }),
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      job: expect.objectContaining({ id: "job-1" }),
    })
    expect(getJobLookupMock).toHaveBeenCalledWith("job-1")
  })
})
