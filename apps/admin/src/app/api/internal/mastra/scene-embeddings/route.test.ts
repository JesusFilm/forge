import { beforeEach, describe, expect, it, vi } from "vitest"

const isValidBearerMock = vi.fn()
const ingestMock = vi.fn()

vi.mock("@/auth/mastra-ingest-bearer", () => ({
  isValidMastraSceneIngestBearer: isValidBearerMock,
}))

vi.mock("@/db/client", () => ({ prisma: {} }))

vi.mock("@/services/scene-embedding-ingest.service", async (original) => {
  const actual =
    await original<typeof import("@/services/scene-embedding-ingest.service")>()
  return {
    ...actual,
    ingestSceneEmbeddings: ingestMock,
  }
})

const { POST, GET } = await import("./route")
const { SceneEmbeddingIngestError } =
  await import("@/services/scene-embedding-ingest.service")

function request(body: unknown, headers: HeadersInit = {}) {
  return new Request("http://admin.test/api/internal/mastra/scene-embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

describe("POST /api/internal/mastra/scene-embeddings", () => {
  beforeEach(() => {
    isValidBearerMock.mockReset()
    ingestMock.mockReset()
    isValidBearerMock.mockReturnValue(true)
    ingestMock.mockResolvedValue({
      status: "created",
      target: {
        videoId: "video-1",
        videoEditionId: "edition-1",
        coreId: "core-1",
        locale: "en",
      },
      scenes: 1,
      model: "openai/text-embedding-3-small",
      dimensions: 1536,
      mastraRunId: "run-1",
    })
  })

  it("accepts a valid scene ingest bearer and returns a safe ingest result", async () => {
    const response = await POST(
      request({ ok: true }, { authorization: "Bearer scene-key" }),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({
      result: {
        status: "created",
        target: {
          videoId: "video-1",
          videoEditionId: "edition-1",
          coreId: "core-1",
          locale: "en",
        },
        scenes: 1,
        model: "openai/text-embedding-3-small",
        dimensions: 1536,
        mastraRunId: "run-1",
      },
    })
    expect(isValidBearerMock).toHaveBeenCalledWith("Bearer scene-key")
    expect(ingestMock).toHaveBeenCalledWith({}, { ok: true })
    expect(JSON.stringify(body)).not.toContain('"embedding":')
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
      new SceneEmbeddingIngestError(
        "scene_invalid",
        "raw scene text should not leak",
      ),
    )

    const response = await POST(request({ bad: true }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "Scene embedding ingest failed",
      reason: "scene_invalid",
      retryable: false,
    })
    expect(warn.mock.calls[0]![0]).toContain("code=scene_invalid")
    expect(warn.mock.calls[0]![0]).not.toContain("raw scene text")
    warn.mockRestore()
  })

  it("returns 409 for idempotent rejected outcomes and 502 for write failures", async () => {
    ingestMock.mockResolvedValueOnce({
      status: "rejected",
      reason: "existing_scene_differs",
      target: {
        videoId: "video-1",
        videoEditionId: "edition-1",
        coreId: "core-1",
        locale: "en",
      },
      scenes: 1,
      model: "openai/text-embedding-3-small",
      dimensions: 1536,
      mastraRunId: "run-1",
    })

    expect((await POST(request({ ok: true }))).status).toBe(409)

    ingestMock.mockRejectedValueOnce(
      new SceneEmbeddingIngestError("write_failed", "database failed"),
    )

    const response = await POST(request({ ok: true }))
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({
      reason: "write_failed",
      retryable: true,
    })
  })

  it("GET returns 401", async () => {
    const response = await GET()
    expect(response.status).toBe(401)
  })
})
