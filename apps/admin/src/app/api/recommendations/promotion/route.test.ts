import { beforeEach, describe, expect, it, vi } from "vitest"

const resolveAdminSessionFromRequest = vi.hoisted(() => vi.fn())
const approveBoundedStage = vi.hoisted(() => vi.fn())
const dispatchRecommendationPromotion = vi.hoisted(() => vi.fn())
const setKillSwitch = vi.hoisted(() => vi.fn())
const prepareOwnerRelease = vi.hoisted(() => vi.fn())
const activateOwnerRelease = vi.hoisted(() => vi.fn())
const reconcileOwnerRelease = vi.hoisted(() => vi.fn())
const prisma = vi.hoisted(() => ({
  recommendationPromotionPointer: { findUnique: vi.fn() },
  recommendationPromotionRun: { findUnique: vi.fn() },
}))

vi.mock("@/auth/session", () => ({ resolveAdminSessionFromRequest }))
vi.mock("@/services/recommendations/promotion/service", () => ({
  createRecommendationPromotionService: () => ({
    approveBoundedStage,
    setKillSwitch,
    prepareOwnerRelease,
    activateOwnerRelease,
    reconcileOwnerRelease,
  }),
}))
vi.mock("@/services/recommendations/promotion/job", () => ({
  dispatchRecommendationPromotion,
}))
vi.mock("@/db/client", () => ({ prisma }))

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3003/api/recommendations/promotion", {
    method: "POST",
    headers: {
      origin: "http://localhost:3003",
      "content-type": "application/json",
      "x-forge-csrf": "recommendation-promotion-v1",
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

describe("recommendation promotion mutation endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveAdminSessionFromRequest.mockResolvedValue({
      principal: { id: "admin-1", role: "ADMIN" },
      authenticatedAt: new Date("2026-08-26T00:00:00.000Z"),
    })
    approveBoundedStage.mockResolvedValue({ id: "approval-1" })
    dispatchRecommendationPromotion.mockResolvedValue({
      queued: true,
      runId: "run-1",
    })
    setKillSwitch.mockResolvedValue({ enabled: true, generation: 3 })
    vi.setSystemTime(new Date("2026-08-26T00:05:00.000Z"))
  })

  it("rejects missing same-origin CSRF proof before mutation", async () => {
    const { POST } = await import("./route")
    const response = await POST(
      request(
        {
          action: "approve_bounded",
          manifestId: "manifest-1",
          maxExposureBps: 500,
        },
        { origin: "https://attacker.example" },
      ),
    )
    expect(response.status).toBe(403)
    expect(approveBoundedStage).not.toHaveBeenCalled()
  })

  it("denies viewer sessions", async () => {
    resolveAdminSessionFromRequest.mockResolvedValue({
      principal: { id: "viewer-1", role: "VIEWER" },
      authenticatedAt: new Date(),
    })
    const { POST } = await import("./route")
    const response = await POST(
      request({
        action: "approve_bounded",
        manifestId: "semantic-experiment-aa-v1",
        maxExposureBps: 5_000,
      }),
    )
    expect(response.status).toBe(403)
  })
  it("returns bounded durable status for the exact dispatched operation", async () => {
    const { GET } = await import("./route")
    const id = "00000000-0000-4000-8000-000000000001"
    prisma.recommendationPromotionRun.findUnique.mockResolvedValue({
      id,
      state: "PENDING",
    })
    const result = await GET(
      new Request(
        `http://localhost:3003/api/recommendations/promotion?operationId=${id}`,
      ),
    )
    expect(result.headers.get("cache-control")).toBe("no-store")
    expect(await result.json()).toMatchObject({ run: { id, state: "PENDING" } })
    expect(prisma.recommendationPromotionRun.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id } }),
    )
    resolveAdminSessionFromRequest.mockResolvedValue(null)
    expect(
      (
        await GET(
          new Request("http://localhost:3003/api/recommendations/promotion"),
        )
      ).status,
    ).toBe(401)
  })

  it("requires a recent session for permanent-default confirmation", async () => {
    resolveAdminSessionFromRequest.mockResolvedValue({
      principal: { id: "admin-1", role: "ADMIN" },
      authenticatedAt: new Date("2026-08-25T00:00:00.000Z"),
    })
    const { POST } = await import("./route")
    const response = await POST(
      request({
        action: "confirm_permanent",
        expectedPointerGeneration: 2,
        targetManifestId: "semantic-experiment-aa-v1",
        approvalId: "approval-1",
        evaluationId: "evaluation-1",
        exposureCeilingBps: 10_000,
      }),
    )
    expect(response.status).toBe(401)
    expect(dispatchRecommendationPromotion).not.toHaveBeenCalled()
  })

  it("records exact approval and dispatches activation instead of invoking the transition directly", async () => {
    const { POST } = await import("./route")
    await expect(
      POST(
        request({
          action: "approve_bounded",
          manifestId: "semantic-experiment-aa-v1",
          maxExposureBps: 5_000,
        }),
      ),
    ).resolves.toMatchObject({ status: 201 })
    expect(approveBoundedStage).toHaveBeenCalledWith({
      actor: { id: "admin-1", role: "ADMIN" },
      manifestId: "semantic-experiment-aa-v1",
      maxExposureBps: 5_000,
    })

    const response = await POST(
      request({
        action: "activate_bounded",
        expectedPointerGeneration: 1,
        targetManifestId: "semantic-experiment-aa-v1",
        approvalId: "approval-1",
        evaluationId: "evaluation-1",
        exposureCeilingBps: 5_000,
      }),
    )
    expect(response.status).toBe(202)
    expect(dispatchRecommendationPromotion).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { id: "admin-1", role: "ADMIN" },
        action: "activate_bounded",
        recentAuthentication: true,
      }),
    )
  })

  it("applies an emergency kill switch through the authenticated mutation boundary", async () => {
    const { POST } = await import("./route")
    const response = await POST(
      request({
        action: "set_kill_switch",
        expectedPointerGeneration: 2,
        enabled: true,
        reason: "operator_incident",
      }),
    )
    expect(response.status).toBe(202)
    expect(setKillSwitch).toHaveBeenCalledWith({
      actor: { id: "admin-1", role: "ADMIN" },
      expectedPointerGeneration: 2,
      enabled: true,
      reason: "operator_incident",
    })
  })
})

const directInput = {
  action: "prepare_owner_release",
  operationId: "00000000-0000-4000-8000-000000000001",
  expectedPointerGeneration: 1,
  graphGenerationId: "a".repeat(64),
}
describe("direct owner release endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.setSystemTime(new Date("2026-09-30T02:00:00Z"))
    resolveAdminSessionFromRequest.mockResolvedValue({
      principal: { id: "admin-1", role: "ADMIN" },
      authenticatedAt: new Date(),
    })
    prepareOwnerRelease.mockResolvedValue({
      status: "prepared",
      bindingDigest: "b".repeat(64),
    })
    activateOwnerRelease.mockResolvedValue({
      status: "active",
      operationId: directInput.operationId,
    })
    reconcileOwnerRelease.mockResolvedValue({
      status: "active",
      operationId: directInput.operationId,
    })
  })
  it.each([true, false])(
    "bounds the body before parsing with a length header: %s",
    async (declaredLength) => {
      const { POST } = await import("./route")
      const headers = request(directInput).headers
      if (declaredLength) headers.set("content-length", "70000")
      const cancel = vi.fn()
      let chunks = 0
      const input = new Request(
        "http://localhost:3003/api/recommendations/promotion",
        {
          method: "POST",
          headers,
          body: new ReadableStream({
            pull(controller) {
              chunks++
              controller.enqueue(new Uint8Array(32768))
            },
            cancel,
          }),
          duplex: "half",
        } as RequestInit,
      )
      const response = await POST(input)
      expect(response.status).toBe(413)
      expect(await response.json()).toMatchObject({ error: "body_too_large" })
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(chunks).toBeLessThanOrEqual(4)
      expect(prepareOwnerRelease).not.toHaveBeenCalled()
      expect(activateOwnerRelease).not.toHaveBeenCalled()
    },
  )
  it("accepts only the narrow server-authorized tuple and activates synchronously", async () => {
    const { POST } = await import("./route")
    expect(
      (await POST(request({ ...directInput, approved: true }))).status,
    ).toBe(400)
    expect((await POST(request(directInput))).status).toBe(200)
    expect(prepareOwnerRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { id: "admin-1", role: "ADMIN" },
        authenticatedAt: new Date(),
        graphGenerationId: directInput.graphGenerationId,
      }),
    )
    const activated = await POST(
      request({
        ...directInput,
        action: "activate_owner_release",
        bindingDigest: "b".repeat(64),
      }),
    )
    expect(activated.status).toBe(200)
    expect(activated.headers.get("cache-control")).toBe("no-store")
    expect(dispatchRecommendationPromotion).not.toHaveBeenCalled()
  })
  it("requires same-origin CSRF and recent authorized mutation sessions", async () => {
    const { POST } = await import("./route")
    expect(
      (await POST(request(directInput, { "x-forge-csrf": "" }))).status,
    ).toBe(403)
    resolveAdminSessionFromRequest.mockResolvedValue({
      principal: { id: "viewer", role: "VIEWER" },
      authenticatedAt: new Date(),
    })
    expect((await POST(request(directInput))).status).toBe(403)
    resolveAdminSessionFromRequest.mockResolvedValue({
      principal: { id: "admin", role: "ADMIN" },
      authenticatedAt: new Date(Date.now() - 900_001),
    })
    expect((await POST(request(directInput))).status).toBe(401)
    expect(prepareOwnerRelease).not.toHaveBeenCalled()
  })
  it("returns unknown acknowledgement and permits exact reconciliation after session freshness expires", async () => {
    const { POST, GET } = await import("./route")
    activateOwnerRelease.mockRejectedValueOnce(new Error("transport failed"))
    const response = await POST(
      request({
        ...directInput,
        action: "activate_owner_release",
        bindingDigest: "b".repeat(64),
      }),
    )
    expect(await response.json()).toMatchObject({
      error: "acknowledgement_unknown_reconcile_status",
    })
    resolveAdminSessionFromRequest.mockResolvedValue({
      principal: { id: "admin", role: "ADMIN" },
      authenticatedAt: null,
    })
    const status = await GET(
      new Request(
        `http://localhost:3003/api/recommendations/promotion?ownerOperationId=${directInput.operationId}`,
      ),
    )
    expect(status.status).toBe(200)
    expect(await status.json()).toMatchObject({
      ownerRelease: { status: "active", operationId: directInput.operationId },
    })
  })
})
