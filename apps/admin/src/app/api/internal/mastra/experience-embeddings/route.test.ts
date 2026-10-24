import { beforeEach, describe, expect, it, vi } from "vitest"

const isValidBearerMock = vi.fn()
const ingestMock = vi.fn()

vi.mock("@/auth/mastra-ingest-bearer", () => ({
  isValidMastraExperienceIngestBearer: isValidBearerMock,
}))

vi.mock("@/db/client", () => ({ prisma: {} }))

vi.mock("@/services/experience-embedding-ingest.service", async (original) => {
  const actual =
    await original<
      typeof import("@/services/experience-embedding-ingest.service")
    >()
  return {
    ...actual,
    ingestExperienceEmbedding: ingestMock,
  }
})

const { POST, GET } = await import("./route")
const { ExperienceEmbeddingIngestError } =
  await import("@/services/experience-embedding-ingest.service")

function request(body: unknown, headers: HeadersInit = {}) {
  return new Request(
    "http://admin.test/api/internal/mastra/experience-embeddings",
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

describe("POST /api/internal/mastra/experience-embeddings", () => {
  beforeEach(() => {
    isValidBearerMock.mockReset()
    ingestMock.mockReset()
    isValidBearerMock.mockReturnValue(true)
    ingestMock.mockResolvedValue({
      status: "created",
      target: {
        experienceId: "exp-1",
        experienceLocaleId: "loc-1",
        locale: "en",
      },
      model: "openai/text-embedding-3-small",
      dimensions: 1536,
      mastraRunId: "run-1",
    })
  })

  it("accepts a valid experience ingest bearer and returns a safe ingest result", async () => {
    const response = await POST(
      request({ ok: true }, { authorization: "Bearer experience-key" }),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({
      result: {
        status: "created",
        target: {
          experienceId: "exp-1",
          experienceLocaleId: "loc-1",
          locale: "en",
        },
        model: "openai/text-embedding-3-small",
        dimensions: 1536,
        mastraRunId: "run-1",
      },
    })
    expect(isValidBearerMock).toHaveBeenCalledWith("Bearer experience-key")
    expect(ingestMock).toHaveBeenCalledWith({}, { ok: true })
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('"embedding":')
    expect(serialized).not.toContain("sourceContentHash")
  })

  it("rejects missing or invalid bearer before ingest", async () => {
    isValidBearerMock.mockReturnValue(false)

    const response = await POST(request({ ok: true }))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: "Authorization required",
    })
    expect(ingestMock).not.toHaveBeenCalled()
  })

  it("maps payload errors to a scrubbed 400 envelope", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    ingestMock.mockRejectedValueOnce(
      new ExperienceEmbeddingIngestError(
        "source_hash_mismatch",
        "raw source text should not leak",
      ),
    )

    const response = await POST(request({ bad: true }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "Experience embedding ingest failed",
      reason: "source_hash_mismatch",
      retryable: false,
    })
    expect(warn.mock.calls[0]![0]).toContain("code=source_hash_mismatch")
    expect(warn.mock.calls[0]![0]).not.toContain("raw source text")
    warn.mockRestore()
  })

  it("returns 409 for idempotent rejected outcomes and 502 for write failures", async () => {
    ingestMock.mockResolvedValueOnce({
      status: "rejected",
      reason: "existing_experience_embedding_differs",
      target: {
        experienceId: "exp-1",
        experienceLocaleId: "loc-1",
        locale: "en",
      },
      model: "openai/text-embedding-3-small",
      dimensions: 1536,
      mastraRunId: "run-1",
    })

    expect(await POST(request({ ok: true }))).toHaveProperty("status", 409)

    ingestMock.mockRejectedValueOnce(
      new ExperienceEmbeddingIngestError("write_failed", "db unavailable"),
    )
    expect(await POST(request({ ok: true }))).toHaveProperty("status", 502)
  })
})

describe("GET /api/internal/mastra/experience-embeddings", () => {
  it("does not expose anything without bearer auth", async () => {
    const response = await GET()

    expect(response.status).toBe(401)
  })
})
