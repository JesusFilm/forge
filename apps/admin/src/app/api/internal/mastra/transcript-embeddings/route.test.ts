import { beforeEach, describe, expect, it, vi } from "vitest"

const isValidBearerMock = vi.fn()
const ingestMock = vi.fn()

vi.mock("@/auth/mastra-ingest-bearer", () => ({
  isValidMastraTranscriptIngestBearer: isValidBearerMock,
}))

vi.mock("@/db/client", () => ({ prisma: {} }))

vi.mock("@/services/transcript-embedding-ingest.service", async (original) => {
  const actual =
    await original<
      typeof import("@/services/transcript-embedding-ingest.service")
    >()
  return {
    ...actual,
    ingestTranscriptEmbeddings: ingestMock,
  }
})

const { POST, GET } = await import("./route")
const { TranscriptEmbeddingIngestError } =
  await import("@/services/transcript-embedding-ingest.service")

function request(body: unknown, headers: HeadersInit = {}) {
  return new Request(
    "http://admin.test/api/internal/mastra/transcript-embeddings",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    },
  )
}

describe("POST /api/internal/mastra/transcript-embeddings", () => {
  beforeEach(() => {
    isValidBearerMock.mockReset()
    ingestMock.mockReset()
    isValidBearerMock.mockReturnValue(true)
    ingestMock.mockResolvedValue({
      status: "created",
      target: {
        videoId: "video-1",
        videoEditionId: "edition-1",
        language: "en",
      },
      chunks: 1,
      model: "openai/text-embedding-3-small",
      dimensions: 1536,
      mastraRunId: "run-1",
    })
  })

  it("accepts a valid bearer and returns the ingest result", async () => {
    const response = await POST(
      request({ ok: true }, { authorization: "Bearer mastra-key" }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      result: {
        status: "created",
        target: {
          videoId: "video-1",
          videoEditionId: "edition-1",
          language: "en",
        },
        chunks: 1,
        model: "openai/text-embedding-3-small",
        dimensions: 1536,
        mastraRunId: "run-1",
      },
    })
    expect(isValidBearerMock).toHaveBeenCalledWith("Bearer mastra-key")
    expect(ingestMock).toHaveBeenCalledWith({}, { ok: true })
  })

  it("rejects missing or invalid bearer without invoking ingest", async () => {
    isValidBearerMock.mockReturnValue(false)

    const response = await POST(request({ ok: true }))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: "Authorization required",
    })
    expect(ingestMock).not.toHaveBeenCalled()
  })

  it("maps payload errors to a safe 400 envelope", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    ingestMock.mockRejectedValueOnce(
      new TranscriptEmbeddingIngestError(
        "payload_invalid",
        "secret transcript text should not leak",
      ),
    )

    const response = await POST(request({ bad: true }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "Transcript embedding ingest failed",
      reason: "payload_invalid",
      retryable: false,
    })
    expect(warn.mock.calls[0]![0]).toContain("code=payload_invalid")
    expect(warn.mock.calls[0]![0]).not.toContain("secret transcript")
    warn.mockRestore()
  })

  it("returns 409 for service-level rejected outcomes", async () => {
    ingestMock.mockResolvedValueOnce({
      status: "rejected",
      reason: "existing_transcript_differs",
      target: {
        videoId: "video-1",
        videoEditionId: "edition-1",
        language: "en",
      },
      chunks: 1,
      model: "openai/text-embedding-3-small",
      dimensions: 1536,
      mastraRunId: "run-1",
    })

    const response = await POST(request({ ok: true }))

    expect(response.status).toBe(409)
  })

  it("GET returns 401", async () => {
    const response = await GET()
    expect(response.status).toBe(401)
  })
})
