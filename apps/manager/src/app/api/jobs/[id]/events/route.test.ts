import { beforeEach, describe, expect, it, vi } from "vitest"
import type { JobRecord } from "@/types/job"

const { authenticateRequestMock, getJobLookupMock, subscribeToJobEventsMock } =
  vi.hoisted(() => ({
    authenticateRequestMock: vi.fn(),
    getJobLookupMock: vi.fn(),
    subscribeToJobEventsMock: vi.fn(),
  }))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: authenticateRequestMock,
}))

vi.mock("@/lib/state", () => ({
  getJobLookup: getJobLookupMock,
}))

vi.mock("@/lib/job-events", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/job-events")>("@/lib/job-events")

  return {
    ...actual,
    subscribeToJobEvents: subscribeToJobEventsMock,
  }
})

import { GET } from "@/app/api/jobs/[id]/events/route"

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

async function readFirstChunk(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error("Expected a readable response body")
  }

  const { value, done } = await reader.read()
  await reader.cancel()

  if (done || !value) {
    throw new Error("Expected the SSE stream to emit an initial chunk")
  }

  return new TextDecoder().decode(value)
}

describe("GET /api/jobs/[id]/events", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset()
    getJobLookupMock.mockReset()
    subscribeToJobEventsMock.mockReset()

    authenticateRequestMock.mockResolvedValue(null)
    getJobLookupMock.mockResolvedValue({
      status: "found",
      job: buildJob("job-1"),
    })
    subscribeToJobEventsMock.mockReturnValue(vi.fn())
  })

  it("rejects unauthorized callers", async () => {
    authenticateRequestMock.mockResolvedValue(
      Response.json({ error: "Authentication required" }, { status: 401 }),
    )

    const response = await GET(
      new Request("http://example.test/api/jobs/job-1/events"),
      { params: Promise.resolve({ id: "job-1" }) },
    )

    expect(response.status).toBe(401)
    expect(getJobLookupMock).not.toHaveBeenCalled()
  })

  it("returns 404 when the job does not exist", async () => {
    getJobLookupMock.mockResolvedValue({ status: "not-found" })

    const response = await GET(
      new Request("http://example.test/api/jobs/job-1/events"),
      { params: Promise.resolve({ id: "job-1" }) },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: "Job not found",
    })
    expect(subscribeToJobEventsMock).not.toHaveBeenCalled()
  })

  it("returns 502 when the job lookup fails", async () => {
    getJobLookupMock.mockResolvedValue({
      status: "error",
      error: new Error("cms down"),
    })

    const response = await GET(
      new Request("http://example.test/api/jobs/job-1/events"),
      { params: Promise.resolve({ id: "job-1" }) },
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({
      error: "Failed to load job",
    })
    expect(subscribeToJobEventsMock).not.toHaveBeenCalled()
  })

  it("returns an SSE stream with the initial job snapshot", async () => {
    const abortController = new AbortController()
    const response = await GET(
      new Request("http://example.test/api/jobs/job-1/events", {
        signal: abortController.signal,
      }),
      { params: Promise.resolve({ id: "job-1" }) },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    expect(response.headers.get("cache-control")).toContain("no-cache")
    expect(response.headers.get("x-accel-buffering")).toBe("no")
    expect(response.headers.get("connection")).toBe("keep-alive")

    const chunk = await readFirstChunk(response)

    expect(chunk).toContain("event: snapshot\n")
    expect(chunk).toContain('"type":"snapshot"')
    expect(chunk).toContain('"job":{"id":"job-1"')
    expect(getJobLookupMock).toHaveBeenCalledWith("job-1")
    expect(subscribeToJobEventsMock).toHaveBeenCalledWith(
      "job-1",
      expect.any(Function),
    )

    abortController.abort()
  })

  it("unsubscribes the listener when the request aborts", async () => {
    const abortController = new AbortController()
    const unsubscribe = vi.fn()
    subscribeToJobEventsMock.mockReturnValue(unsubscribe)

    const response = await GET(
      new Request("http://example.test/api/jobs/job-1/events", {
        signal: abortController.signal,
      }),
      { params: Promise.resolve({ id: "job-1" }) },
    )

    expect(response.status).toBe(200)

    abortController.abort()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
