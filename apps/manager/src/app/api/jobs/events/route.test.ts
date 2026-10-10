import { beforeEach, describe, expect, it, vi } from "vitest"
import type { JobRecord } from "@/types/job"

const {
  authenticateRequestMock,
  listJobSummariesMock,
  subscribeToAllJobEventsMock,
} = vi.hoisted(() => ({
  authenticateRequestMock: vi.fn(),
  listJobSummariesMock: vi.fn(),
  subscribeToAllJobEventsMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: authenticateRequestMock,
}))

vi.mock("@/lib/state", () => ({
  listJobSummaries: listJobSummariesMock,
}))

vi.mock("@/lib/job-events", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/job-events")>("@/lib/job-events")

  return {
    ...actual,
    subscribeToAllJobEvents: subscribeToAllJobEventsMock,
  }
})

import { GET } from "@/app/api/jobs/events/route"

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

describe("GET /api/jobs/events", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset()
    listJobSummariesMock.mockReset()
    subscribeToAllJobEventsMock.mockReset()

    authenticateRequestMock.mockResolvedValue(null)
    listJobSummariesMock.mockResolvedValue([buildJob("job-1")])
    subscribeToAllJobEventsMock.mockReturnValue(vi.fn())
  })

  it("rejects unauthorized callers", async () => {
    authenticateRequestMock.mockResolvedValue(
      Response.json({ error: "Authentication required" }, { status: 401 }),
    )

    const response = await GET(
      new Request("http://example.test/api/jobs/events"),
    )

    expect(response.status).toBe(401)
    expect(listJobSummariesMock).not.toHaveBeenCalled()
  })

  it("returns an SSE stream with the initial jobs snapshot", async () => {
    const abortController = new AbortController()
    const response = await GET(
      new Request("http://example.test/api/jobs/events", {
        signal: abortController.signal,
      }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    expect(response.headers.get("cache-control")).toContain("no-cache")
    expect(response.headers.get("x-accel-buffering")).toBe("no")
    expect(response.headers.get("connection")).toBe("keep-alive")

    const chunk = await readFirstChunk(response)

    expect(chunk).toContain("event: snapshot\n")
    expect(chunk).toContain('"type":"snapshot"')
    expect(chunk).toContain('"jobs":[{"id":"job-1"')
    expect(listJobSummariesMock).toHaveBeenCalledTimes(1)
    expect(subscribeToAllJobEventsMock).toHaveBeenCalledTimes(1)

    abortController.abort()
  })

  it("unsubscribes the listener when the request aborts", async () => {
    const abortController = new AbortController()
    const unsubscribe = vi.fn()
    subscribeToAllJobEventsMock.mockReturnValue(unsubscribe)

    const response = await GET(
      new Request("http://example.test/api/jobs/events", {
        signal: abortController.signal,
      }),
    )

    expect(response.status).toBe(200)

    abortController.abort()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
