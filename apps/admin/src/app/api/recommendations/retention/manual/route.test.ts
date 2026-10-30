import { beforeEach, describe, expect, it, vi } from "vitest"

const resolveAdminSessionFromRequest = vi.hoisted(() => vi.fn())
const dispatchManualRecommendationRetention = vi.hoisted(() => vi.fn())

vi.mock("@/auth/session", () => ({ resolveAdminSessionFromRequest }))
vi.mock("@/services/recommendations/retention/job", () => ({
  dispatchManualRecommendationRetention,
}))

function request(headers: Record<string, string> = {}) {
  return new Request(
    "https://admin.example/api/recommendations/retention/manual",
    {
      method: "POST",
      headers: {
        origin: "https://admin.example",
        "content-type": "application/json",
        "x-forge-csrf": "recommendation-retention-manual-v1",
        ...headers,
      },
      body: JSON.stringify({
        operationId: "123e4567-e89b-42d3-a456-426614174000",
      }),
    },
  )
}

describe("manual recommendation retention route", () => {
  beforeEach(() => vi.clearAllMocks())

  it.each<[string, string]>([
    ["origin", "https://another.example"],
    ["x-forge-csrf", "wrong"],
    ["content-type", "text/plain"],
  ])("rejects missing same-origin CSRF proof", async (name, value) => {
    const { POST } = await import("./route")
    expect((await POST(request({ [name]: value }))).status).toBe(403)
    expect(dispatchManualRecommendationRetention).not.toHaveBeenCalled()
  })

  it("requires an authenticated admin", async () => {
    const { POST } = await import("./route")
    resolveAdminSessionFromRequest.mockResolvedValueOnce(null)
    expect((await POST(request())).status).toBe(401)
    resolveAdminSessionFromRequest.mockResolvedValueOnce({
      principal: { id: "viewer", role: "VIEWER" },
    })
    expect((await POST(request())).status).toBe(403)
    expect(dispatchManualRecommendationRetention).not.toHaveBeenCalled()
  })

  it("queues exactly one bounded pass for an admin", async () => {
    resolveAdminSessionFromRequest.mockResolvedValueOnce({
      principal: { id: "admin", role: "ADMIN" },
    })
    dispatchManualRecommendationRetention.mockResolvedValueOnce({
      ledgerRunId: "ledger-1",
      runtimeRunId: "runtime-1",
      state: "queued",
    })
    const { POST } = await import("./route")
    const result = await POST(request())
    expect(result.status).toBe(202)
    expect(dispatchManualRecommendationRetention).toHaveBeenCalledWith(
      "admin",
      "123e4567-e89b-42d3-a456-426614174000",
    )
    await expect(result.json()).resolves.toEqual({
      ok: true,
      dispatch: {
        ledgerRunId: "ledger-1",
        runtimeRunId: "runtime-1",
        state: "queued",
      },
    })
  })

  it("returns the reserved receipt when dispatch is uncertain", async () => {
    resolveAdminSessionFromRequest.mockResolvedValueOnce({
      principal: { id: "admin", role: "ADMIN" },
    })
    dispatchManualRecommendationRetention.mockResolvedValueOnce({
      ledgerRunId: "ledger-1",
      runtimeRunId: null,
      state: "uncertain",
    })
    const { POST } = await import("./route")
    const result = await POST(request())
    expect(result.status).toBe(409)
    await expect(result.json()).resolves.toMatchObject({
      error: "dispatch_outcome_uncertain",
      dispatch: { ledgerRunId: "ledger-1" },
    })
  })
})
