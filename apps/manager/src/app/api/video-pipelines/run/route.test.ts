import { NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { authenticateRequestMock } = vi.hoisted(() => ({
  authenticateRequestMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: authenticateRequestMock,
}))

import { POST } from "./route"

function postRequest(body: unknown) {
  return new Request("http://example.test/api/video-pipelines/run", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

describe("POST /api/video-pipelines/run", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset()
    authenticateRequestMock.mockResolvedValue(null)
  })

  it("acknowledges 1-100 valid ids with a created count and no failures", async () => {
    const response = await POST(
      postRequest({ videoIds: ["devotion-2026-08-01", "devotion-2026-08-02"] }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ created: 2, failed: 0 })
  })

  it("returns whatever authenticateRequest returns when unauthenticated", async () => {
    authenticateRequestMock.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    )

    const response = await POST(
      postRequest({ videoIds: ["devotion-2026-08-01"] }),
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" })
  })

  it("rejects an empty videoIds array with a 400", async () => {
    const response = await POST(postRequest({ videoIds: [] }))

    expect(response.status).toBe(400)
  })

  it("rejects more than 100 videoIds with a 400", async () => {
    const tooMany = Array.from({ length: 101 }, (_, index) => `video-${index}`)
    const response = await POST(postRequest({ videoIds: tooMany }))

    expect(response.status).toBe(400)
  })

  it("rejects a non-array videoIds field with a 400", async () => {
    const response = await POST(postRequest({ videoIds: "not-an-array" }))

    expect(response.status).toBe(400)
  })

  it("rejects invalid JSON bodies with a 400", async () => {
    const request = new Request("http://example.test/api/video-pipelines/run", {
      method: "POST",
      body: "not json",
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
  })
})
