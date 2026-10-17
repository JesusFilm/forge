import { beforeEach, describe, expect, it, vi } from "vitest"
import { recommendationTraceActorDigest } from "@/services/recommendations/admin-ops/shared"
import type { CowatchInspection } from "@/services/recommendations/cowatch/inspection.service"

const mocks = vi.hoisted(() => ({ session: vi.fn(), inspect: vi.fn() }))
vi.mock("@/auth/session", () => ({
  resolveAdminSessionFromRequest: mocks.session,
}))
vi.mock("@/db/client", () => ({ prisma: {} }))
vi.mock("@/config/env", () => ({
  env: { ADMIN_SESSION_SECRET: "native-cowatch-route-test-secret" },
}))
vi.mock("@/services/recommendations/cowatch/inspection.service", () => ({
  loadCowatchInspection: mocks.inspect,
}))
import { GET } from "./route"

const generationId = "a".repeat(64)
const inspection: CowatchInspection = {
  shadowEvaluation: null,
  generation: generationId,
  publishedAt: new Date("2026-09-29T00:00:00Z"),
  sourceWindow: {
    version: "episode-event-window-v1",
    windowStart: new Date("2026-09-21T00:00:00Z"),
    windowEnd: new Date("2026-09-28T00:00:00Z"),
    evaluationAsOf: new Date("2026-09-29T00:00:00Z"),
  },
  rawSourceCount: 15,
  attemptedPairCount: 5,
  sourceCount: 15,
  contributionCount: 5,
  edgeCount: 2,
  distinctViewerCount: 10,
  state: "current",
  staleReasons: [],
  terminalDecision: "no_promotion",
  decisionReason: "controlled_evaluation_required_feat_505",
  anchors: [],
  selectedEdges: [],
  reverseEdges: [],
  candidates: [],
  overlapMediaIds: [],
  candidateDecision: "live_baseline_fallback",
}
function request(query = `generationId=${generationId}`) {
  return new Request(
    `http://localhost:3003/api/recommendations/cowatch?${query}`,
  )
}

describe("authenticated exact co-watch inspection API", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.session.mockResolvedValue({
      principal: { id: "admin-1", role: "ADMIN" },
      authenticatedAt: new Date(),
    })
    mocks.inspect.mockResolvedValue(inspection)
  })

  it("requires authentication and aggregate permission before inspecting", async () => {
    mocks.session.mockResolvedValue(null)
    const anonymous = await GET(request())
    expect(anonymous.status).toBe(401)
    expect(anonymous.headers.get("cache-control")).toBe("no-store")
    mocks.session.mockResolvedValue({
      principal: { id: "viewer", role: "VIEWER" },
    })
    expect((await GET(request())).status).toBe(403)
    expect(mocks.inspect).not.toHaveBeenCalled()
  })

  it("allows aggregate-only inspection with an exact pin and no request identity", async () => {
    mocks.session.mockResolvedValue({
      principal: { id: "editor", role: "EDITOR" },
    })
    const response = await GET(
      request(`generationId=${generationId}&anchor=video-A`),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({
      ok: true,
      result: JSON.parse(JSON.stringify(inspection)),
    })
    expect(mocks.inspect).toHaveBeenCalledExactlyOnceWith(
      {},
      {
        now: expect.any(Date),
        generationId,
        sourceMediaId: "video-A",
        requestId: undefined,
        actorDigest: null,
      },
    )
  })

  it.each([
    { id: "editor", role: "EDITOR" },
    { id: null, role: "ADMIN" },
  ])(
    "refuses request inspection without trace permission and an auditable actor: %j",
    async (principal) => {
      mocks.session.mockResolvedValue({ principal })
      expect(
        (await GET(request(`generationId=${generationId}&request=request-1`)))
          .status,
      ).toBe(403)
      expect(mocks.inspect).not.toHaveBeenCalled()
    },
  )

  it("passes the authenticated HMAC actor into the existing transactional trace audit path", async () => {
    const response = await GET(
      request(`generationId=${generationId}&anchor=video-A&request=request-1`),
    )
    expect(response.status).toBe(200)
    expect(mocks.inspect).toHaveBeenCalledExactlyOnceWith(
      {},
      {
        now: expect.any(Date),
        generationId,
        sourceMediaId: "video-A",
        requestId: "request-1",
        actorDigest: recommendationTraceActorDigest(
          "admin-1",
          "native-cowatch-route-test-secret",
        ),
      },
    )
    const body = await response.text()
    expect(body).not.toContain("admin-1")
    expect(body).not.toContain("request-1")
    expect(body).not.toContain("actorDigest")
  })

  it.each([
    "",
    "generationId=latest",
    `generationId=${"A".repeat(64)}`,
    `generationId=${"a".repeat(65)}`,
    `generationId=${generationId}&generationId=${"b".repeat(64)}`,
    `generationId=${generationId}&anchor=a&anchor=b`,
    `generationId=${generationId}&request=one&request=two`,
    `generationId=${generationId}&actorDigest=${"c".repeat(64)}`,
    `generationId=${generationId}&anchor=${"v".repeat(192)}`,
    `generationId=${generationId}&request=${"r".repeat(192)}`,
    `generationId=${generationId}&anchor=`,
    `generationId=${generationId}&request=`,
    `generationId=${generationId}&request=%00`,
    `generationId=${generationId}&anchor=${"v".repeat(2048)}`,
  ])(
    "rejects invalid, duplicate or unsupported query input: %s",
    async (query) => {
      const response = await GET(request(query))
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        ok: false,
        error: "invalid_input",
      })
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect(mocks.inspect).not.toHaveBeenCalled()
    },
  )

  it("preserves unavailable exact identity without substituting the latest generation", async () => {
    mocks.inspect.mockResolvedValue({
      ...inspection,
      generation: null,
      state: "unavailable",
    })
    const response = await GET(request())
    expect((await response.json()).result).toMatchObject({
      generation: null,
      state: "unavailable",
    })
    expect(mocks.inspect).toHaveBeenCalledOnce()
    expect(mocks.inspect.mock.calls[0]?.[1].generationId).toBe(generationId)
  })

  it("sanitizes service and authentication failures", async () => {
    mocks.inspect.mockRejectedValue(
      new Error("private source identity and database error"),
    )
    const response = await GET(request())
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      ok: false,
      error: "cowatch_inspection_failed",
    })
    expect(response.headers.get("cache-control")).toBe("no-store")
    mocks.session.mockRejectedValue(new Error("session secret"))
    expect((await GET(request())).status).toBe(500)
    expect(mocks.inspect).toHaveBeenCalledOnce()
  })
})
