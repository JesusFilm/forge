import { beforeEach, describe, expect, it, vi } from "vitest"

const isValidManagerServiceToken = vi.fn()
const resolveOperatorTrackObject = vi.fn()

vi.mock("@/auth/manager-service-token", () => ({
  isValidManagerServiceToken: (...args: unknown[]) =>
    isValidManagerServiceToken(...args),
}))
vi.mock("@/services/subtitle-eval.service", () => ({
  SubtitleEvalService: class {
    resolveOperatorTrackObject(...args: unknown[]) {
      return resolveOperatorTrackObject(...args)
    }
  },
}))
vi.mock("@/db/client", () => ({ prisma: {} }))

describe("POST Manager operator track locator", () => {
  beforeEach(() => {
    isValidManagerServiceToken.mockReset().mockResolvedValue(true)
    resolveOperatorTrackObject.mockReset().mockResolvedValue({
      objectKey: "private/operator-track.vtt",
      mediaType: "text/vtt",
      byteLength: 10n,
      sha256: "b".repeat(64),
    })
  })

  it("requires service OAuth and returns a bounded server-only locator", async () => {
    const { POST } = await import("./route")
    isValidManagerServiceToken.mockResolvedValueOnce(false)
    expect((await POST(request())).status).toBe(403)
    expect(resolveOperatorTrackObject).not.toHaveBeenCalled()

    isValidManagerServiceToken.mockResolvedValueOnce(true)
    const response = await POST(request())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      locator: {
        objectKey: "private/operator-track.vtt",
        mediaType: "text/vtt",
        byteLength: "10",
        sha256: "b".repeat(64),
      },
    })
    expect(resolveOperatorTrackObject).toHaveBeenCalledWith({
      user: { id: null, role: "MANAGER_BACKEND" },
      assignmentId: "assignment-1",
      contentId: "a".repeat(64),
    })
  })

  it("does not disclose invalid or unknown handles", async () => {
    const { POST } = await import("./route")
    expect(
      (
        await POST(
          new Request(
            "http://localhost:3003/api/manager/subtitle-eval/operator-track",
            {
              method: "POST",
              headers: {
                authorization: "Bearer manager-oauth-service-token",
                "content-type": "application/json",
              },
              body: JSON.stringify({
                assignmentId: "assignment-1",
                contentId: "not-a-digest",
              }),
            },
          ),
        )
      ).status,
    ).toBe(400)
    resolveOperatorTrackObject.mockRejectedValueOnce(new Error("missing"))
    expect((await POST(request())).status).toBe(404)
  })
})

function request() {
  return new Request(
    "http://localhost:3003/api/manager/subtitle-eval/operator-track",
    {
      method: "POST",
      headers: {
        authorization: "Bearer manager-oauth-service-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        assignmentId: "assignment-1",
        contentId: "a".repeat(64),
      }),
    },
  )
}
