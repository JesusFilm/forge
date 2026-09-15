import { beforeEach, describe, expect, it, vi } from "vitest"

const isValidManagerServiceToken = vi.fn()
const verifySubtitleReviewAssertion = vi.fn()
const resolveReviewerTrackObject = vi.fn()

vi.mock("@/auth/manager-service-token", () => ({
  isValidManagerServiceToken: (...args: unknown[]) =>
    isValidManagerServiceToken(...args),
}))
vi.mock("@/auth/subtitle-review-assertion", () => ({
  verifySubtitleReviewAssertion: (...args: unknown[]) =>
    verifySubtitleReviewAssertion(...args),
}))
vi.mock("@/services/subtitle-eval.service", () => ({
  SubtitleEvalService: class {
    resolveReviewerTrackObject(...args: unknown[]) {
      return resolveReviewerTrackObject(...args)
    }
  },
}))
vi.mock("@/db/client", () => ({ prisma: {} }))

describe("POST Manager reviewer track locator", () => {
  beforeEach(() => {
    isValidManagerServiceToken.mockReset().mockResolvedValue(true)
    verifySubtitleReviewAssertion.mockReset().mockResolvedValue({
      actorId: "user-1",
      assignmentId: "assignment-1",
      method: "GET",
    })
    resolveReviewerTrackObject.mockReset().mockResolvedValue({
      objectKey: "private/reviewer-track.vtt",
      mediaType: "text/vtt",
      byteLength: 10n,
      sha256: "b".repeat(64),
    })
  })

  it("requires the Manager OAuth service credential", async () => {
    isValidManagerServiceToken.mockResolvedValue(false)
    const { POST } = await import("./route")
    const response = await POST(request())
    expect(response.status).toBe(403)
    expect(resolveReviewerTrackObject).not.toHaveBeenCalled()
  })

  it("rejects a declared body over the Manager route ceiling before parsing", async () => {
    const { POST } = await import("./route")
    const oversized = request()
    oversized.headers.set("content-length", String(32 * 1024 + 1))
    const response = await POST(oversized)
    expect(response.status).toBe(400)
    expect(resolveReviewerTrackObject).not.toHaveBeenCalled()
  })

  it("does not resolve an opaque handle under a different assignment", async () => {
    verifySubtitleReviewAssertion.mockResolvedValue({
      actorId: "user-1",
      assignmentId: "assignment-other",
      method: "GET",
    })
    const { POST } = await import("./route")
    const response = await POST(request())
    expect(response.status).toBe(404)
    expect(resolveReviewerTrackObject).not.toHaveBeenCalled()
  })

  it("returns not-found for an unknown assignment-scoped opaque handle", async () => {
    resolveReviewerTrackObject.mockRejectedValue(
      new Error("opaque handle missing"),
    )
    const { POST } = await import("./route")
    const response = await POST(request())
    expect(response.status).toBe(404)
  })

  it("returns a locator only to the authenticated Manager BFF", async () => {
    const { POST } = await import("./route")
    const response = await POST(request())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      locator: {
        objectKey: "private/reviewer-track.vtt",
        mediaType: "text/vtt",
        byteLength: "10",
        sha256: "b".repeat(64),
      },
    })
    expect(resolveReviewerTrackObject).toHaveBeenCalledWith({
      assertion: expect.objectContaining({ assignmentId: "assignment-1" }),
      contentId: "a".repeat(64),
    })
    expect(isValidManagerServiceToken).toHaveBeenCalledWith(
      "Bearer manager-oauth-service-token",
      "admin:manager-backend",
    )
  })
})

function request() {
  return new Request(
    "http://localhost:3003/api/manager/subtitle-eval/reviewer-track",
    {
      method: "POST",
      headers: {
        authorization: "Bearer manager-oauth-service-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        assignmentId: "assignment-1",
        contentId: "a".repeat(64),
        assertion: "review-assertion",
      }),
    },
  )
}
