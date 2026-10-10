import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/auth/rate-limit", () => ({
  rateLimitAuthRoute: vi.fn(),
}))
vi.mock("@/auth/session", () => ({
  resolvePrincipalFromRequest: vi.fn(),
}))
vi.mock("@/db/client", () => ({ prisma: {} }))
vi.mock("@/mastra", () => ({ getMastra: vi.fn() }))

const { listRatingsForThreadMock } = vi.hoisted(() => ({
  listRatingsForThreadMock: vi.fn(),
}))
vi.mock("@/services/chat-rating.service", async () => {
  const actual = await vi.importActual<
    typeof import("@/services/chat-rating.service")
  >("@/services/chat-rating.service")
  return {
    ...actual,
    listRatingsForThread: listRatingsForThreadMock,
  }
})

import { rateLimitAuthRoute } from "@/auth/rate-limit"
import { resolvePrincipalFromRequest } from "@/auth/session"
import { ForbiddenError } from "@/services/chat-rating.service"
import { GET } from "./route"

function get(threadId: string) {
  return new Request(
    `http://localhost/api/experience-chat/threads/${threadId}/ratings`,
    { method: "GET" },
  )
}
function ctx(threadId: string) {
  return { params: { threadId } }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(rateLimitAuthRoute).mockResolvedValue({
    allowed: true,
    source: "local",
  })
  vi.mocked(resolvePrincipalFromRequest).mockResolvedValue({
    id: "editor-1",
    role: "EDITOR",
  })
  listRatingsForThreadMock.mockReset()
})

describe("GET /api/experience-chat/threads/[threadId]/ratings", () => {
  it("returns 200 with the ratings map on happy path", async () => {
    listRatingsForThreadMock.mockResolvedValueOnce({
      "msg-1": { score: 1, comment: null, updatedAt: "2026-05-25T10:00:00Z" },
    })
    const res = await GET(get("t1"), ctx("t1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ratings["msg-1"].score).toBe(1)
  })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolvePrincipalFromRequest).mockResolvedValueOnce(null)
    const res = await GET(get("t1"), ctx("t1"))
    expect(res.status).toBe(401)
  })

  it("returns 403 when principal lacks write:experiences", async () => {
    vi.mocked(resolvePrincipalFromRequest).mockResolvedValueOnce({
      id: "viewer-1",
      role: "VIEWER",
    })
    const res = await GET(get("t1"), ctx("t1"))
    expect(res.status).toBe(403)
  })

  it("returns 429 when rate-limited", async () => {
    vi.mocked(rateLimitAuthRoute).mockResolvedValueOnce({
      allowed: false,
      source: "local",
    })
    const res = await GET(get("t1"), ctx("t1"))
    expect(res.status).toBe(429)
  })

  it("maps service ForbiddenError → 403", async () => {
    listRatingsForThreadMock.mockRejectedValueOnce(new ForbiddenError())
    const res = await GET(get("t1"), ctx("t1"))
    expect(res.status).toBe(403)
  })
})
