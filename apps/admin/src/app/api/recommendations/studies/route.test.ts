import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  RecommendationConflictError,
  RecommendationInputError,
} from "@/services/recommendations/errors"
const session = vi.hoisted(() => vi.fn())
const service = vi.hoisted(() => ({
  prepare: vi.fn(),
  recordEvidence: vi.fn(),
  activate: vi.fn(),
  evaluate: vi.fn(),
  status: vi.fn(),
}))
const prisma = vi.hoisted(() => ({
  recommendationPromotionPointer: { findUnique: vi.fn() },
  recommendationStrategyManifest: { findMany: vi.fn() },
  recommendationStudyEvidence: { findFirst: vi.fn() },
  recommendationStudyEvaluation: { findFirst: vi.fn() },
}))
vi.mock("@/auth/session", () => ({ resolveAdminSessionFromRequest: session }))
vi.mock("@/db/client", () => ({ prisma }))
vi.mock("@/services/recommendations/experiment/study-service", () => ({
  RecommendationStudyService: class {
    prepare = service.prepare
    recordEvidence = service.recordEvidence
    activate = service.activate
    evaluate = service.evaluate
    status = service.status
  },
}))
import { GET, POST } from "./route"
const request = (body: unknown, origin = "http://localhost:3003") =>
  new Request("http://localhost:3003/api/recommendations/studies", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "x-forge-csrf": "recommendation-study-v1",
    },
    body: JSON.stringify(body),
  })
const activation = {
  action: "activate",
  studyId: "study-1",
  protocolDigest: "a".repeat(64),
  operationId: "00000000-0000-4000-8000-000000000001",
  evidenceId: "00000000-0000-4000-8000-000000000002",
  expectedPointerGeneration: 1,
}
describe("authenticated study operator API", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    session.mockResolvedValue({
      principal: { id: "operator-1", role: "ADMIN" },
      authenticatedAt: new Date(),
    })
    service.status.mockResolvedValue([])
    prisma.recommendationStrategyManifest.findMany.mockResolvedValue([])
  })
  it("rejects cross-origin changes before consulting service", async () => {
    expect(
      (await POST(request(activation, "https://elsewhere.example"))).status,
    ).toBe(403)
    expect(session).not.toHaveBeenCalled()
  })
  it.each([
    null,
    { principal: { id: "reader", role: "VIEWER" } },
    { principal: { id: null, role: "SYSTEM" } },
  ])(
    "does not expose study authority to unauthorized principal %j",
    async (principal) => {
      session.mockResolvedValue(principal)
      expect(
        (
          await GET(
            new Request("http://localhost:3003/api/recommendations/studies"),
          )
        ).status,
      ).toBe(403)
      expect((await POST(request(activation))).status).toBe(403)
      expect(service.activate).not.toHaveBeenCalled()
    },
  )
  it("forwards exact operation identity and never accepts a caller PASS", async () => {
    expect((await POST(request({ ...activation, passed: true }))).status).toBe(
      400,
    )
    expect((await POST(request(activation))).status).toBe(200)
    expect(service.activate).toHaveBeenCalledWith(
      { id: "operator-1", role: "ADMIN" },
      activation,
    )
  })
  it.each([null, new Date(0), new Date(Date.now() + 120_000)])(
    "requires recent human authentication for every mutation (%s)",
    async (authenticatedAt) => {
      session.mockResolvedValue({
        principal: { id: "operator-1", role: "ADMIN" },
        authenticatedAt,
      })
      for (const body of [
        activation,
        { ...activation, action: "evaluate" },
        { action: "prepare", protocol: {} },
        {
          action: "evidence",
          studyId: "study-1",
          protocolDigest: activation.protocolDigest,
          evidenceId: activation.evidenceId,
          evidence: {},
        },
      ]) {
        const result = await POST(request(body))
        expect(result.status).toBe(401)
        expect(await result.json()).toMatchObject({
          error: "recent_authentication_required",
        })
      }
      expect(service.activate).not.toHaveBeenCalled()
      expect(service.evaluate).not.toHaveBeenCalled()
      expect(service.prepare).not.toHaveBeenCalled()
      expect(service.recordEvidence).not.toHaveBeenCalled()
    },
  )
  it("bounds uploaded evidence before invoking any mutation", async () => {
    expect(
      (await POST(request({ action: "prepare", protocol: "x".repeat(65_536) })))
        .status,
    ).toBe(413)
    expect(service.prepare).not.toHaveBeenCalled()
  })
  it("reconciles an exact older evidence operation independently of the bounded status list", async () => {
    prisma.recommendationStudyEvidence.findFirst.mockResolvedValue({
      id: activation.evidenceId,
    })
    const result = await GET(
      new Request(
        `http://localhost:3003/api/recommendations/studies?studyId=study-1&operationId=${activation.evidenceId}`,
      ),
    )
    expect(await result.json()).toMatchObject({
      operation: { evidence: { id: activation.evidenceId } },
    })
    expect(prisma.recommendationStudyEvidence.findFirst).toHaveBeenCalledWith({
      where: { studyId: "study-1", id: activation.evidenceId },
      select: { id: true },
    })
  })
  it.each([
    [new RecommendationConflictError("changed"), 409],
    [new RecommendationInputError("mature receipt required"), 400],
  ] as const)(
    "returns an explicit precommit refusal",
    async (error, status) => {
      service.activate.mockRejectedValue(error)
      expect((await POST(request(activation))).status).toBe(status)
    },
  )
  it("reports unknown acknowledgement and permits exact status reconciliation", async () => {
    service.activate.mockRejectedValue(new Error("response lost after commit"))
    const response = await POST(request(activation))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      error: "acknowledgement_unknown_reconcile_status",
    })
    service.status.mockResolvedValue([
      { experimentId: "study-1", activationId: activation.operationId },
    ])
    const result = await GET(
      new Request(
        "http://localhost:3003/api/recommendations/studies?studyId=study-1",
      ),
    )
    expect(result.headers.get("cache-control")).toBe("no-store")
    expect(await result.json()).toMatchObject({
      studies: [{ activationId: activation.operationId }],
    })
  })
})
