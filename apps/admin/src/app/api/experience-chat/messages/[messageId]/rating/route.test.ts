import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/auth/rate-limit", () => ({
  rateLimitAuthRoute: vi.fn(),
}))
vi.mock("@/auth/session", () => ({
  resolvePrincipalFromRequest: vi.fn(),
}))
vi.mock("@/db/client", () => ({ prisma: {} }))
vi.mock("@/mastra", () => ({ getMastra: vi.fn() }))

const { submitRatingMock, clearRatingMock } = vi.hoisted(() => ({
  submitRatingMock: vi.fn(),
  clearRatingMock: vi.fn(),
}))
vi.mock("@/services/chat-rating.service", async () => {
  const actual = await vi.importActual<
    typeof import("@/services/chat-rating.service")
  >("@/services/chat-rating.service")
  return {
    ...actual,
    submitRating: submitRatingMock,
    clearRating: clearRatingMock,
  }
})

import { rateLimitAuthRoute } from "@/auth/rate-limit"
import { resolvePrincipalFromRequest } from "@/auth/session"
import {
  CommentTooLongError,
  ForbiddenError,
  MessageNotFoundError,
  NotRatableError,
  ScoresStoreUnavailableError,
} from "@/services/chat-rating.service"
import { POST, DELETE } from "./route"

function postJson(messageId: string, body: unknown): Request {
  return new Request(
    `http://localhost/api/experience-chat/messages/${messageId}/rating`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  )
}

function deleteReq(messageId: string): Request {
  return new Request(
    `http://localhost/api/experience-chat/messages/${messageId}/rating`,
    { method: "DELETE" },
  )
}

function ctx(messageId: string) {
  return { params: { messageId } }
}

function allow() {
  vi.mocked(rateLimitAuthRoute).mockResolvedValue({
    allowed: true,
    source: "local",
  })
}
function deny() {
  vi.mocked(rateLimitAuthRoute).mockResolvedValue({
    allowed: false,
    source: "local",
  })
}
function asEditor() {
  vi.mocked(resolvePrincipalFromRequest).mockResolvedValue({
    id: "editor-1",
    role: "EDITOR",
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  allow()
  asEditor()
  submitRatingMock.mockReset()
  clearRatingMock.mockReset()
})

describe("POST /api/experience-chat/messages/[messageId]/rating", () => {
  it("returns 429 when rate-limited", async () => {
    deny()
    const res = await POST(postJson("m1", { score: 1 }), ctx("m1"))
    expect(res.status).toBe(429)
  })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolvePrincipalFromRequest).mockResolvedValueOnce(null)
    const res = await POST(postJson("m1", { score: 1 }), ctx("m1"))
    expect(res.status).toBe(401)
  })

  it("returns 403 when principal lacks write:experiences", async () => {
    vi.mocked(resolvePrincipalFromRequest).mockResolvedValueOnce({
      id: "viewer-1",
      role: "VIEWER",
    })
    const res = await POST(postJson("m1", { score: 1 }), ctx("m1"))
    expect(res.status).toBe(403)
  })

  it("returns 400 for an invalid body (score must be 0 or 1)", async () => {
    const res = await POST(postJson("m1", { score: 2 }), ctx("m1"))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Invalid request body")
    expect(body.issues).toBeDefined()
  })

  it("returns 200 with the new state on happy-path submit", async () => {
    submitRatingMock.mockResolvedValueOnce({
      score: 1,
      comment: "great",
      updatedAt: "2026-05-25T10:00:00.000Z",
    })
    const res = await POST(
      postJson("m1", { score: 1, comment: "great" }),
      ctx("m1"),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rating.score).toBe(1)
    expect(body.rating.comment).toBe("great")
    expect(submitRatingMock).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: "m1", score: 1, comment: "great" }),
      expect.any(Object),
    )
  })

  it("maps NotRatableError → 422 with code='not_ratable'", async () => {
    submitRatingMock.mockRejectedValueOnce(new NotRatableError("m1", null))
    const res = await POST(postJson("m1", { score: 1 }), ctx("m1"))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe("not_ratable")
  })

  it("maps MessageNotFoundError → 404", async () => {
    submitRatingMock.mockRejectedValueOnce(new MessageNotFoundError("m1"))
    const res = await POST(postJson("m1", { score: 1 }), ctx("m1"))
    expect(res.status).toBe(404)
  })

  it("maps ForbiddenError → 403", async () => {
    submitRatingMock.mockRejectedValueOnce(new ForbiddenError())
    const res = await POST(postJson("m1", { score: 1 }), ctx("m1"))
    expect(res.status).toBe(403)
  })

  it("maps CommentTooLongError → 400 with code='comment_too_long'", async () => {
    submitRatingMock.mockRejectedValueOnce(new CommentTooLongError(9999))
    const res = await POST(postJson("m1", { score: 1 }), ctx("m1"))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe("comment_too_long")
  })

  it("maps ScoresStoreUnavailableError → 500", async () => {
    submitRatingMock.mockRejectedValueOnce(new ScoresStoreUnavailableError())
    const res = await POST(postJson("m1", { score: 1 }), ctx("m1"))
    expect(res.status).toBe(500)
  })
})

describe("DELETE /api/experience-chat/messages/[messageId]/rating", () => {
  it("returns 200 with cleared state on happy path", async () => {
    clearRatingMock.mockResolvedValueOnce(null)
    const res = await DELETE(deleteReq("m1"), ctx("m1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rating).toBeNull()
  })

  it("maps NotRatableError → 422", async () => {
    clearRatingMock.mockRejectedValueOnce(new NotRatableError("m1", null))
    const res = await DELETE(deleteReq("m1"), ctx("m1"))
    expect(res.status).toBe(422)
  })
})
