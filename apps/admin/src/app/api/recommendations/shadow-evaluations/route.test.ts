import { beforeEach, describe, expect, it, vi } from "vitest"

const resolveAdminSessionFromRequest = vi.hoisted(() => vi.fn())
const startExactHybridShadowEvaluation = vi.hoisted(() => vi.fn())

vi.mock("@/auth/session", () => ({ resolveAdminSessionFromRequest }))
vi.mock("@/services/recommendations/shadow-evaluation/operator", () => ({
  startExactHybridShadowEvaluation,
}))
vi.mock("@/db/client", () => ({ prisma: {} }))

const BODY = {
  action: "start_exact_hybrid_shadow",
  evaluationId: "11111111-1111-4111-8111-111111111111",
  windowStart: "2026-08-29T00:00:00.000Z",
  windowEnd: "2026-08-30T00:00:00.000Z",
  requestedSampleSize: 500,
  minimumRuns: 200,
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request(
    "http://localhost:3003/api/recommendations/shadow-evaluations",
    {
      method: "POST",
      headers: {
        origin: "http://localhost:3003",
        "content-type": "application/json",
        "x-forge-csrf": "recommendation-shadow-evaluation-v1",
        ...headers,
      },
      body: JSON.stringify(body),
    },
  )
}

describe("exact hybrid shadow evaluation operator endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveAdminSessionFromRequest.mockResolvedValue({
      principal: { id: "admin-1", role: "ADMIN" },
      authenticatedAt: new Date("2026-08-30T00:00:00.000Z"),
    })
    startExactHybridShadowEvaluation.mockResolvedValue({
      status: "queued",
      evaluationId: BODY.evaluationId,
      generation: 1,
      created: true,
      dispatch: { queued: true, ledgerRunId: "ledger-1", runId: "runtime-1" },
    })
  })

  it("rejects missing same-origin CSRF proof before reading operator input", async () => {
    const { POST } = await import("./route")
    const response = await POST(
      request(BODY, { origin: "https://attacker.example" }),
    )

    expect(response.status).toBe(403)
    expect(startExactHybridShadowEvaluation).not.toHaveBeenCalled()
  })

  it("requires experiment-operation permission", async () => {
    resolveAdminSessionFromRequest.mockResolvedValue({
      principal: { id: "viewer-1", role: "VIEWER" },
      authenticatedAt: new Date(),
    })
    const { POST } = await import("./route")
    const response = await POST(request(BODY))

    expect(response.status).toBe(403)
    expect(startExactHybridShadowEvaluation).not.toHaveBeenCalled()
  })

  it("parses the closed event window and launches only the exact hybrid seam", async () => {
    const { POST } = await import("./route")
    const response = await POST(request(BODY))

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      status: "queued",
      evaluationId: BODY.evaluationId,
    })
    expect(startExactHybridShadowEvaluation).toHaveBeenCalledWith(
      {},
      {
        evaluationId: BODY.evaluationId,
        windowStart: new Date(BODY.windowStart),
        windowEnd: new Date(BODY.windowEnd),
        requestedSampleSize: 500,
        minimumRuns: 200,
        actorId: "admin-1",
      },
    )
  })

  it("fails closed on unknown fields and conflicting immutable retries", async () => {
    const { POST } = await import("./route")
    const invalid = await POST(request({ ...BODY, generatorKey: "other" }))
    expect(invalid.status).toBe(400)

    const { RecommendationConflictError } =
      await import("@/services/recommendations/errors")
    startExactHybridShadowEvaluation.mockRejectedValueOnce(
      new RecommendationConflictError("does not match"),
    )
    const conflict = await POST(request(BODY))
    expect(conflict.status).toBe(409)
  })
})
