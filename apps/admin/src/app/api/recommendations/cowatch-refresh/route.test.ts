import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  authorize: vi.fn(),
  disable: vi.fn(),
  inspect: vi.fn(),
}))
vi.mock("@/auth/session", () => ({
  resolveAdminSessionFromRequest: mocks.session,
}))
vi.mock("@/config/env", () => ({
  env: { ADMIN_BASE_URL: "https://admin.example.test" },
}))
vi.mock("@/db/client", () => ({ prisma: {} }))
vi.mock("@/services/recommendations/cowatch/refresh.service", () => ({
  RecommendationCowatchRefreshService: class {
    authorize = mocks.authorize
    disable = mocks.disable
    inspect = mocks.inspect
  },
}))

const operationId = "00000000-0000-4000-8000-000000000001"
const budget = {
  publicationLimits: {
    rawSourceCount: 50000,
    sourceCount: 50000,
    attemptedPairCount: 250000,
    contributionCount: 250000,
    edgeCount: 250000,
    publicationRowCount: 550001,
    graphRowJsonBytes: {
      sources: { maximum: 10000, total: 1000000 },
      contributions: { maximum: 10000, total: 1000000 },
      edges: { maximum: 10000, total: 1000000 },
    },
  },
  publicationReserveBytes: 100000000,
  maxRetainedGraphBytes: 4000000000,
  maxRetainedGenerations: 62,
  maxDatabaseBytes: 40000000000,
}
const authorization = {
  action: "authorize",
  operationId,
  expectedPointerGeneration: 7,
  budget,
}
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request(
    "https://internal.railway.test/api/recommendations/cowatch-refresh",
    {
      method: "POST",
      headers: {
        origin: "https://admin.example.test",
        "content-type": "application/json",
        "x-forge-csrf": "recommendation-cowatch-refresh-v1",
        ...headers,
      },
      body: JSON.stringify(body),
    },
  )
}

describe("owner co-watch refresh endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.session.mockResolvedValue({
      principal: { id: "admin-1", role: "ADMIN" },
      authenticatedAt: new Date(),
    })
    mocks.inspect.mockResolvedValue({ status: "disabled", grant: null })
    mocks.authorize.mockResolvedValue({
      status: "enabled",
      grant: { id: operationId },
    })
    mocks.disable.mockResolvedValue({
      status: "disabled",
      grant: { id: operationId },
    })
  })

  it("requires canonical-origin CSRF proof before resolving a session", async () => {
    const { POST } = await import("./route")
    const result = await POST(
      request(authorization, { origin: "https://attacker.test" }),
    )
    expect(result.status).toBe(403)
    expect(mocks.session).not.toHaveBeenCalled()
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it("accepts the canonical origin behind a proxy and binds the exact reviewed budget", async () => {
    const { POST } = await import("./route")
    const result = await POST(request(authorization))
    expect(result.status).toBe(200)
    expect(mocks.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId,
        expectedPointerGeneration: 7,
        budget,
        actor: { id: "admin-1", role: "ADMIN" },
      }),
    )
    expect(result.headers.get("cache-control")).toBe("no-store")
  })

  it.each([null, { id: "viewer-1", role: "VIEWER" }])(
    "denies unauthorized access (%j)",
    async (principal) => {
      mocks.session.mockResolvedValue(
        principal ? { principal, authenticatedAt: new Date() } : null,
      )
      const { POST, GET } = await import("./route")
      expect((await POST(request(authorization))).status).toBe(
        principal ? 403 : 401,
      )
      expect(
        (
          await GET(
            new Request(
              "https://admin.example.test/api/recommendations/cowatch-refresh",
            ),
          )
        ).status,
      ).toBe(principal ? 403 : 401)
      expect(mocks.authorize).not.toHaveBeenCalled()
      expect(mocks.inspect).not.toHaveBeenCalled()
    },
  )

  it("requires recent human authentication to enable but permits an older operator session to stop", async () => {
    mocks.session.mockResolvedValue({
      principal: { id: "admin-1", role: "ADMIN" },
      authenticatedAt: new Date(0),
    })
    const { POST } = await import("./route")
    expect((await POST(request(authorization))).status).toBe(401)
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect(
      (await POST(request({ action: "disable", grantId: operationId }))).status,
    ).toBe(200)
    expect(mocks.disable).toHaveBeenCalledWith({
      actor: { id: "admin-1", role: "ADMIN" },
      grantId: operationId,
    })
  })

  it("rejects missing capacity, widened source bounds and unknown policy overrides", async () => {
    const { POST } = await import("./route")
    for (const body of [
      { ...authorization, budget: {} },
      { ...authorization, cadenceMinutes: 1 },
      {
        ...authorization,
        budget: {
          ...budget,
          publicationLimits: {
            ...budget.publicationLimits,
            rawSourceCount: 50001,
          },
        },
      },
    ])
      expect((await POST(request(body))).status).toBe(400)
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it("reconciles the original authorization identity without a mutation", async () => {
    const { GET } = await import("./route")
    expect(
      (
        await GET(
          new Request(
            `https://admin.example.test/api/recommendations/cowatch-refresh?operationId=${operationId}`,
          ),
        )
      ).status,
    ).toBe(200)
    expect(mocks.inspect).toHaveBeenCalledWith({ operationId })
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it("reports uncertain acknowledgement without returning internal errors", async () => {
    mocks.authorize.mockRejectedValue(new Error("private failure"))
    const { POST } = await import("./route")
    const result = await POST(request(authorization))
    expect(result.status).toBe(503)
    expect(await result.json()).toEqual({
      ok: false,
      error: "acknowledgement_unknown_reconcile_status",
    })
  })
})
