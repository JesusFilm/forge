import { beforeEach, describe, expect, it, vi } from "vitest"

const { readBodyMock, submitReviewMock } = vi.hoisted(() => ({
  readBodyMock: vi.fn(),
  submitReviewMock: vi.fn(),
}))

vi.mock("@/features/subtitle-lab/subtitle-lab-admin-client", () => ({
  SubtitleLabAdminClient: {
    configured: vi.fn(async () => ({ submitReview: submitReviewMock })),
  },
}))
vi.mock("@/features/subtitle-lab/subtitle-lab-route", () => ({
  guardSubtitleLabMutation: vi.fn(() => null),
  requireSubtitleLabReviewer: vi.fn(async () => ({
    id: "reviewer-1",
    managerRole: "REVIEWER",
  })),
  readBoundedSubtitleLabJson: readBodyMock,
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

import { POST } from "./route"

const request = new Request(
  "https://manager.example/api/subtitle-lab/reviews",
  {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://manager.example",
    },
    body: "{}",
  },
)

const blindReview = {
  idempotencyKey: "stable-review-key",
  assignmentId: "assignment-private",
  rubricVersion: 1,
  trackAssessments: {
    trackA: {
      meaningAccuracyScore: 5,
      naturalnessScore: 4,
      timingReadabilityScore: 3,
      scriptureTheologyScore: null,
      issueCodes: [],
      criticalMeaningLoss: false,
      criticalHarmful: false,
      criticalScriptureRisk: false,
    },
    trackB: {
      meaningAccuracyScore: 3,
      naturalnessScore: 5,
      timingReadabilityScore: 2,
      scriptureTheologyScore: null,
      issueCodes: ["TIMING"],
      criticalMeaningLoss: false,
      criticalHarmful: false,
      criticalScriptureRisk: false,
    },
  },
  verdict: "NEEDS_CHANGES",
  questionableTrack: null,
  notes: null,
  corrections: [],
  supersedesReviewId: null,
}

describe("reviewer submission BFF", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readBodyMock.mockResolvedValue(blindReview)
    submitReviewMock.mockResolvedValue({
      id: "review-1",
      status: "SUBMITTED",
      digest: "d".repeat(64),
      replayed: false,
    })
  })

  it("forwards both blind assessments without presentation identity", async () => {
    const response = await POST(request)

    expect(response.status).toBe(201)
    expect(readBodyMock).toHaveBeenCalledWith(request, 256 * 1024)
    expect(submitReviewMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "reviewer-1" }),
      blindReview,
    )
    expect(JSON.stringify(submitReviewMock.mock.calls[0]?.[1])).not.toMatch(
      /presentationSeed|referenceTrack|candidateTrack|provenance/i,
    )
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })

  it("returns 200 for an idempotent replay of the same review", async () => {
    submitReviewMock.mockResolvedValueOnce({
      id: "review-1",
      status: "SUBMITTED",
      digest: "d".repeat(64),
      replayed: true,
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(submitReviewMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ idempotencyKey: "stable-review-key" }),
    )
  })

  it("keeps contract and assignment denials non-disclosing", async () => {
    submitReviewMock.mockRejectedValueOnce(new Error("invalid blind review"))

    const response = await POST(request)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "Not found" })
  })
})
