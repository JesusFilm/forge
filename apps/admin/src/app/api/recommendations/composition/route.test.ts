import { beforeEach, describe, expect, it, vi } from "vitest"
import { ForbiddenError } from "@/services/errors"
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  prepare: vi.fn(),
  decide: vi.fn(),
  calibrate: vi.fn(),
  inspect: vi.fn(),
}))
vi.mock("@/auth/session", () => ({
  resolveAdminSessionFromRequest: mocks.session,
}))
vi.mock("@/db/client", () => ({ prisma: {} }))
vi.mock(
  "@/services/recommendations/composition/service",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/services/recommendations/composition/service")
    >()),
    prepareCompositionProtocol: mocks.prepare,
    decideCompositionProtocol: mocks.decide,
    recordCompositionCalibration: mocks.calibrate,
    inspectComposition: mocks.inspect,
  }),
)
import { GET, POST } from "./route"
const protocolId = "11111111-1111-4111-8111-111111111111"
function request(body: unknown, origin = "http://localhost:3003") {
  return new Request("http://localhost:3003/api/recommendations/composition", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "x-forge-csrf": "recommendation-composition-v1",
    },
    body: JSON.stringify(body),
  })
}
describe("composition operator API", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.session.mockResolvedValue({
      principal: { id: "admin", role: "ADMIN" },
      authenticatedAt: new Date(),
    })
    mocks.decide.mockResolvedValue({ decision: "inconclusive" })
  })
  it("rejects cross-origin writes and anonymous reads", async () => {
    expect(
      (
        await POST(
          request({ action: "decide", protocolId }, "https://other.example"),
        )
      ).status,
    ).toBe(403)
    expect(mocks.decide).not.toHaveBeenCalled()
    mocks.session.mockResolvedValue(null)
    expect(
      (
        await GET(
          new Request(
            `http://localhost:3003/api/recommendations/composition?protocolId=${protocolId}`,
          ),
        )
      ).status,
    ).toBe(401)
  })
  it("bounds body bytes before parsing or invoking an operator", async () => {
    const result = await POST(
      request({
        action: "calibrate",
        protocolId,
        rationale: "x".repeat(65_537),
      }),
    )
    expect(result.status).toBe(413)
    expect(await result.json()).toEqual({ ok: false, error: "body_too_large" })
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(mocks.decide).not.toHaveBeenCalled()
    expect(mocks.calibrate).not.toHaveBeenCalled()
  })
  it("passes the trusted session to service authorization and preserves forbidden errors", async () => {
    mocks.decide.mockRejectedValue(new ForbiddenError("recent auth required"))
    expect((await POST(request({ action: "decide", protocolId }))).status).toBe(
      403,
    )
    expect(mocks.decide.mock.calls[0]?.[1]).toMatchObject({
      actor: { id: "admin", role: "ADMIN" },
      authenticatedAt: expect.any(Date),
    })
  })
  it("passes the exact optional graph pin through strict preparation", async () => {
    const body = {
      action: "prepare",
      protocolId,
      shadowEvaluationId: protocolId,
      sourceManifestId: "bundle",
      challengerManifestId: "bundle",
      generatorVersion: "generator",
      cowatchGenerationId: "a".repeat(64),
      thresholds: {
        minimumRuns: 1,
        maxFallbackRate: 0,
        maxMissingInputRate: 0,
        maxLatencyMs: 200,
        minimumFillRate: 1,
      },
    }
    mocks.prepare.mockResolvedValue({ id: protocolId })
    expect((await POST(request(body))).status).toBe(200)
    expect(mocks.prepare.mock.calls[0]?.[2]).toMatchObject({
      cowatchGenerationId: "a".repeat(64),
    })
    expect(
      (await POST(request({ ...body, cowatchGenerationId: "latest" }))).status,
    ).toBe(400)
  })
  it("rejects client approval claims and returns uncached exact decisions", async () => {
    expect(
      (await POST(request({ action: "decide", protocolId, approved: true })))
        .status,
    ).toBe(400)
    const response = await POST(request({ action: "decide", protocolId }))
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({
      ok: true,
      result: { decision: "inconclusive" },
    })
  })
})
