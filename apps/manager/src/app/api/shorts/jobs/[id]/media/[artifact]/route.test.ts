import { beforeEach, describe, expect, it, vi } from "vitest"
import type { JobRecord } from "@/types/job"

const {
  authenticateRequestMock,
  getJobMock,
  openArtifactStreamMock,
  statArtifactMock,
  readArtifactMock,
} = vi.hoisted(() => ({
  authenticateRequestMock: vi.fn(),
  getJobMock: vi.fn(),
  openArtifactStreamMock: vi.fn(),
  statArtifactMock: vi.fn(),
  readArtifactMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: authenticateRequestMock,
}))

vi.mock("@/lib/state", () => ({
  getJob: getJobMock,
}))

vi.mock("@/services/storage", () => {
  // Same class identities the route's instanceof checks see (the route also
  // falls back to error.name matching).
  class ArtifactNotFoundError extends Error {
    constructor(key = "") {
      super(`Artifact not found: ${key}`)
      this.name = "ArtifactNotFoundError"
    }
  }
  class ArtifactRangeNotSatisfiableError extends Error {
    constructor(readonly totalSize: number) {
      super(`Requested range is not satisfiable (object size ${totalSize})`)
      this.name = "ArtifactRangeNotSatisfiableError"
    }
  }
  return {
    ArtifactNotFoundError,
    ArtifactRangeNotSatisfiableError,
    openArtifactStream: openArtifactStreamMock,
    statArtifact: statArtifactMock,
    readArtifact: readArtifactMock,
  }
})

const storage = await import("@/services/storage")
const { clearShortsMediaPrefixCache } =
  await import("@/lib/shorts-media-prefix")
const { GET, HEAD } =
  await import("@/app/api/shorts/jobs/[id]/media/[artifact]/route")

const TOTAL_SIZE = 1000

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

function buildShortsJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    muxAssetId: "mux-1",
    muxPlaybackId: "pbpublic",
    languages: [],
    options: {
      shorts: {
        assetId: "mux-1-short-abcd1234",
        sourceMuxAssetId: "mux-1",
        sourcePlaybackId: "pbpublic",
        clip: { startSec: 10, endSec: 40 },
        language: { bcp47: "en", whisper: "en" },
      },
    },
    status: "completed",
    retries: 0,
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
    artifacts: {},
    steps: [],
    errors: [],
    ...overrides,
  }
}

function getRequest(range?: string): Request {
  return new Request("http://example.test/api/shorts/jobs/job-1/media/clip", {
    headers: range !== undefined ? { range } : {},
  })
}

function routeParams(artifact = "clip", id = "job-1") {
  return { params: Promise.resolve({ id, artifact }) }
}

beforeEach(() => {
  authenticateRequestMock.mockReset()
  getJobMock.mockReset()
  openArtifactStreamMock.mockReset()
  statArtifactMock.mockReset()
  readArtifactMock.mockReset()
  clearShortsMediaPrefixCache()

  authenticateRequestMock.mockResolvedValue(null)
  getJobMock.mockResolvedValue(buildShortsJob())
  openArtifactStreamMock.mockImplementation(
    async (options: {
      range?: { start?: number; end?: number; suffix?: number }
    }) => {
      const range = options.range
      const start =
        range?.suffix !== undefined
          ? TOTAL_SIZE - range.suffix
          : (range?.start ?? 0)
      const end = range?.end ?? TOTAL_SIZE - 1
      return {
        body: streamOf(new Uint8Array(8)),
        contentLength: end - start + 1,
        totalSize: TOTAL_SIZE,
        rangeStart: start,
        rangeEnd: end,
        etag: '"etag-123"',
        contentType: "video/mp4",
      }
    },
  )
  statArtifactMock.mockResolvedValue({
    size: TOTAL_SIZE,
    etag: '"etag-123"',
    contentType: "video/mp4",
  })
})

describe("GET /api/shorts/jobs/[id]/media/[artifact]", () => {
  it("rejects unauthorized callers", async () => {
    authenticateRequestMock.mockResolvedValue(
      Response.json({ error: "Authentication required" }, { status: 401 }),
    )

    const response = await GET(getRequest(), routeParams())
    expect(response.status).toBe(401)
    expect(openArtifactStreamMock).not.toHaveBeenCalled()
  })

  it("404s unknown artifact literals without touching storage", async () => {
    const response = await GET(
      getRequest(),
      routeParams("shorts-render-props-v1"),
    )
    expect(response.status).toBe(404)
    expect(openArtifactStreamMock).not.toHaveBeenCalled()
    expect(statArtifactMock).not.toHaveBeenCalled()
    expect(getJobMock).not.toHaveBeenCalled()
  })

  it("404s unknown jobs and non-shorts jobs", async () => {
    getJobMock.mockResolvedValue(null)
    const missing = await GET(getRequest(), routeParams())
    expect(missing.status).toBe(404)

    clearShortsMediaPrefixCache()
    getJobMock.mockResolvedValue(buildShortsJob({ options: {} }))
    const nonShorts = await GET(getRequest(), routeParams())
    expect(nonShorts.status).toBe(404)
    expect(openArtifactStreamMock).not.toHaveBeenCalled()
  })

  it("404s when the resolved prefix fails the safe-key pattern (defense in depth)", async () => {
    getJobMock.mockResolvedValue(
      buildShortsJob({
        options: {
          shorts: {
            assetId: "../../etc/passwd",
            sourceMuxAssetId: "mux-1",
            sourcePlaybackId: "pbpublic",
            clip: { startSec: 10, endSec: 40 },
            language: { bcp47: "en", whisper: "en" },
          },
        },
      }),
    )

    const response = await GET(getRequest(), routeParams())
    expect(response.status).toBe(404)
    expect(openArtifactStreamMock).not.toHaveBeenCalled()
  })

  it("streams the full object with 200 when no Range header is present", async () => {
    const response = await GET(getRequest(), routeParams())
    expect(response.status).toBe(200)
    expect(response.headers.get("accept-ranges")).toBe("bytes")
    expect(response.headers.get("cache-control")).toBe("private, max-age=3600")
    expect(response.headers.get("content-type")).toBe("video/mp4")
    expect(response.headers.get("content-length")).toBe(String(TOTAL_SIZE))
    expect(response.headers.get("etag")).toBe('"etag-123"')
    expect(response.headers.get("content-range")).toBeNull()

    // Streamed, never buffered: the body is a ReadableStream and the
    // buffering reader is never invoked.
    expect(response.body).toBeInstanceOf(ReadableStream)
    expect(readArtifactMock).not.toHaveBeenCalled()
    expect(openArtifactStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "mux-1-short-abcd1234",
        artifactType: "shorts-clip-v1",
        ext: "mp4",
      }),
    )
    expect(openArtifactStreamMock.mock.calls[0]?.[0]).not.toHaveProperty(
      "range",
    )
  })

  it("serves the output literal from the output artifact type", async () => {
    const response = await GET(getRequest(), routeParams("output"))
    expect(response.status).toBe(200)
    expect(openArtifactStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({ artifactType: "shorts-output-v1" }),
    )
  })

  it("returns 206 with Content-Range for a bounded range", async () => {
    const response = await GET(getRequest("bytes=0-99"), routeParams())
    expect(response.status).toBe(206)
    expect(response.headers.get("content-range")).toBe(
      `bytes 0-99/${TOTAL_SIZE}`,
    )
    expect(response.headers.get("content-length")).toBe("100")
    expect(response.body).toBeInstanceOf(ReadableStream)
    expect(openArtifactStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({ range: { start: 0, end: 99 } }),
    )
  })

  it("returns 206 for an open-ended range", async () => {
    const response = await GET(getRequest("bytes=900-"), routeParams())
    expect(response.status).toBe(206)
    expect(response.headers.get("content-range")).toBe(
      `bytes 900-999/${TOTAL_SIZE}`,
    )
    expect(openArtifactStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({ range: { start: 900 } }),
    )
  })

  it("returns 206 for a suffix range", async () => {
    const response = await GET(getRequest("bytes=-100"), routeParams())
    expect(response.status).toBe(206)
    expect(response.headers.get("content-range")).toBe(
      `bytes 900-999/${TOTAL_SIZE}`,
    )
    expect(response.headers.get("content-length")).toBe("100")
    expect(openArtifactStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({ range: { suffix: 100 } }),
    )
  })

  it("rejects multi-range requests with 416 and the object size", async () => {
    const response = await GET(getRequest("bytes=0-99,200-299"), routeParams())
    expect(response.status).toBe(416)
    expect(response.headers.get("content-range")).toBe(`bytes */${TOTAL_SIZE}`)
    expect(openArtifactStreamMock).not.toHaveBeenCalled()
  })

  it("rejects syntactically invalid ranges with 416", async () => {
    for (const header of [
      "bytes=abc",
      "bytes=50-10",
      "items=0-99",
      "bytes=-",
    ]) {
      const response = await GET(getRequest(header), routeParams())
      expect(response.status, header).toBe(416)
      expect(response.headers.get("content-range")).toBe(
        `bytes */${TOTAL_SIZE}`,
      )
    }
    expect(openArtifactStreamMock).not.toHaveBeenCalled()
  })

  it("maps an unsatisfiable range to 416 with the size from the typed error", async () => {
    openArtifactStreamMock.mockRejectedValue(
      new storage.ArtifactRangeNotSatisfiableError(TOTAL_SIZE),
    )

    const response = await GET(getRequest("bytes=5000-"), routeParams())
    expect(response.status).toBe(416)
    expect(response.headers.get("content-range")).toBe(`bytes */${TOTAL_SIZE}`)
  })

  it("404s a missing artifact via the typed not-found error", async () => {
    openArtifactStreamMock.mockRejectedValue(
      new storage.ArtifactNotFoundError(
        "mux-1-short-abcd1234/shorts-clip-v1.mp4",
      ),
    )

    const response = await GET(getRequest(), routeParams())
    expect(response.status).toBe(404)
  })

  it("404s a missing artifact on the invalid-range stat path too", async () => {
    statArtifactMock.mockRejectedValue(new storage.ArtifactNotFoundError("k"))

    const response = await GET(getRequest("bytes=bogus"), routeParams())
    expect(response.status).toBe(404)
  })

  it("caches the jobId → prefix resolution across Range requests", async () => {
    const first = await GET(getRequest("bytes=0-99"), routeParams())
    expect(first.status).toBe(206)
    const second = await GET(getRequest("bytes=100-199"), routeParams())
    expect(second.status).toBe(206)

    expect(getJobMock).toHaveBeenCalledTimes(1)
    expect(openArtifactStreamMock).toHaveBeenCalledTimes(2)
  })
})

describe("HEAD /api/shorts/jobs/[id]/media/[artifact]", () => {
  it("returns the same headers with no body", async () => {
    const response = await HEAD(getRequest(), routeParams())
    expect(response.status).toBe(200)
    expect(response.headers.get("accept-ranges")).toBe("bytes")
    expect(response.headers.get("cache-control")).toBe("private, max-age=3600")
    expect(response.headers.get("content-type")).toBe("video/mp4")
    expect(response.headers.get("content-length")).toBe(String(TOTAL_SIZE))
    expect(response.headers.get("etag")).toBe('"etag-123"')
    expect(response.body).toBeNull()
    expect(openArtifactStreamMock).not.toHaveBeenCalled()
  })

  it("404s missing artifacts and bad literals without a body", async () => {
    statArtifactMock.mockRejectedValue(new storage.ArtifactNotFoundError("k"))
    const missing = await HEAD(getRequest(), routeParams())
    expect(missing.status).toBe(404)
    expect(missing.body).toBeNull()

    const badLiteral = await HEAD(getRequest(), routeParams("nope"))
    expect(badLiteral.status).toBe(404)
  })

  it("rejects unauthorized callers", async () => {
    authenticateRequestMock.mockResolvedValue(
      Response.json({ error: "Authentication required" }, { status: 401 }),
    )

    const response = await HEAD(getRequest(), routeParams())
    expect(response.status).toBe(401)
  })
})
