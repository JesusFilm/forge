import { beforeEach, describe, expect, it, vi } from "vitest"

const { authenticateRequestMock } = vi.hoisted(() => ({
  authenticateRequestMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: authenticateRequestMock,
}))

const { POST } = await import("./route")

describe("POST /api/admin-embeds/scene", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset()
    authenticateRequestMock.mockResolvedValue(null)
  })

  it("keeps the auth gate before returning a retired tombstone", async () => {
    const request = new Request("http://manager.test/api/admin-embeds/scene", {
      method: "POST",
    })

    const response = await POST(request)

    expect(authenticateRequestMock).toHaveBeenCalledWith(request)
    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toEqual({
      error: "Legacy scene embedding backfill has been retired",
      reason: "legacy_scene_embedding_pipeline_removed",
      retryable: false,
      replacement:
        "Search uses transcript embeddings; historical scene data is retained for feat-199.",
    })
  })

  it("returns auth failures before the retired response", async () => {
    authenticateRequestMock.mockResolvedValueOnce(
      Response.json({ error: "Authentication required" }, { status: 401 }),
    )
    const request = new Request("http://manager.test/api/admin-embeds/scene", {
      method: "POST",
    })

    const response = await POST(request)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: "Authentication required",
    })
  })
})
