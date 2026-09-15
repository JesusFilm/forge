import { beforeEach, describe, expect, it, vi } from "vitest"

const { reviewerDetailMock, grantMock } = vi.hoisted(() => ({
  reviewerDetailMock: vi.fn(),
  grantMock: vi.fn(),
}))

vi.mock("@/features/subtitle-lab/subtitle-lab-admin-client", () => ({
  SubtitleLabAdminClient: {
    configured: vi.fn(async () => ({ reviewerDetail: reviewerDetailMock })),
  },
}))
vi.mock("@/features/subtitle-lab/subtitle-lab-route", () => ({
  requireSubtitleLabReviewer: vi.fn(async () => ({
    id: "reviewer-1",
    subject: "subject-1",
    email: "reviewer@example.com",
    managerRole: "REVIEWER",
    reviewerLanguageGrants: [],
  })),
  privateNoStoreJson: (value: unknown, init?: ResponseInit) =>
    Response.json(value, {
      ...init,
      headers: { "cache-control": "private, no-store", ...init?.headers },
    }),
  subtitleLabNotFound: () =>
    Response.json(
      { error: "Not found" },
      { status: 404, headers: { "cache-control": "private, no-store" } },
    ),
}))
vi.mock("@/lib/auth", () => ({ hasReviewerLanguageGrant: grantMock }))

import { GET } from "./route"

const detail = {
  id: "assignment-1",
  status: "ACTIVE",
  targetLanguageId: "language-es",
  targetLanguageSlug: "spanish",
  sourceTrack: { label: "SOURCE", contentId: "source", mediaType: "text/vtt" },
  trackA: { label: "A", contentId: "track-a", mediaType: "text/vtt" },
  trackB: { label: "B", contentId: "track-b", mediaType: "text/vtt" },
  postSubmitReceipt: null,
}

describe("reviewer assignment detail BFF", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reviewerDetailMock.mockReset()
    grantMock.mockReset()
    reviewerDetailMock.mockResolvedValue(detail)
    grantMock.mockReturnValue(true)
  })

  it("returns a fresh assignment-scoped detail without storage provenance", async () => {
    const response = await GET(new Request("https://manager.example/api"), {
      params: Promise.resolve({ assignmentId: "assignment-1" }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    const body = await response.json()
    expect(body).toMatchObject({ id: "assignment-1", postSubmitReceipt: null })
    expect(JSON.stringify(body)).not.toMatch(
      /objectKey|sha256|assertion|token/i,
    )
    expect(reviewerDetailMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "reviewer-1" }),
      "assignment-1",
    )
  })

  it.each([
    ["missing assignment", null, true],
    ["wrong language grant", detail, false],
  ])("uses the same 404 for %s", async (_label, adminDetail, allowed) => {
    reviewerDetailMock.mockResolvedValueOnce(adminDetail)
    grantMock.mockReturnValueOnce(allowed)
    const response = await GET(new Request("https://manager.example/api"), {
      params: Promise.resolve({ assignmentId: "assignment-1" }),
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "Not found" })
  })
})
