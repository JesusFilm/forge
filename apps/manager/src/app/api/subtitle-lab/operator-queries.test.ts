import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  comparisonMock,
  referenceIssuesMock,
  reviewerCandidatesMock,
  assignmentsMock,
  operatorAuthMock,
} = vi.hoisted(() => ({
  comparisonMock: vi.fn(),
  referenceIssuesMock: vi.fn(),
  reviewerCandidatesMock: vi.fn(),
  assignmentsMock: vi.fn(),
  operatorAuthMock: vi.fn(),
}))

vi.mock("@/features/subtitle-lab/subtitle-lab-admin-client", () => ({
  SubtitleLabAdminClient: {
    configured: vi.fn(async () => ({
      getComparison: comparisonMock,
      listReferenceIssues: referenceIssuesMock,
      listOperatorReviewerCandidates: reviewerCandidatesMock,
      listOperatorAssignments: assignmentsMock,
    })),
  },
}))
vi.mock("@/features/subtitle-lab/subtitle-lab-route", () => ({
  privateNoStoreJson: (value: unknown, init?: ResponseInit) =>
    Response.json(value, {
      ...init,
      headers: { "cache-control": "private, no-store", ...init?.headers },
    }),
  requireSubtitleLabOperator: operatorAuthMock,
  subtitleLabNotFound: () =>
    Response.json(
      { error: "Not found" },
      { status: 404, headers: { "cache-control": "private, no-store" } },
    ),
  subtitleLabUpstreamUnavailable: () =>
    Response.json(
      { error: "Temporarily unavailable", retryable: true },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    ),
}))

import { NextResponse } from "next/server"

import { GET as getComparison } from "./comparisons/[comparisonId]/route"
import { GET as listReferenceIssues } from "./reference-issues/route"
import { GET as listReviewerCandidates } from "./reviewer-candidates/route"
import { GET as listAssignments } from "./runs/[runId]/assignments/route"

describe("Subtitle Lab operator queries", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    operatorAuthMock.mockResolvedValue({ id: "operator-1" })
    comparisonMock.mockResolvedValue({ id: "comparison-1" })
    referenceIssuesMock.mockResolvedValue({ nodes: [], nextCursor: null })
    reviewerCandidatesMock.mockResolvedValue({ nodes: [], nextCursor: null })
    assignmentsMock.mockResolvedValue({ nodes: [], nextCursor: null })
  })

  it("hides operator queries from a non-operator session", async () => {
    operatorAuthMock.mockResolvedValueOnce(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    )

    const response = await getComparison(
      new Request(
        "https://manager.example/api/subtitle-lab/comparisons/comparison-1",
      ),
      { params: Promise.resolve({ comparisonId: "comparison-1" }) },
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "Not found" })
    expect(comparisonMock).not.toHaveBeenCalled()
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })

  it("returns one private immutable comparison", async () => {
    const response = await getComparison(
      new Request(
        "https://manager.example/api/subtitle-lab/comparisons/comparison-1",
      ),
      { params: Promise.resolve({ comparisonId: "comparison-1" }) },
    )

    expect(response.status).toBe(200)
    expect(comparisonMock).toHaveBeenCalledWith("comparison-1")
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })

  it("uses a non-disclosing private 404 for an invalid comparison identity", async () => {
    const response = await getComparison(
      new Request("https://manager.example/api/subtitle-lab/comparisons/bad"),
      { params: Promise.resolve({ comparisonId: "" }) },
    )

    expect(response.status).toBe(404)
    expect(comparisonMock).not.toHaveBeenCalled()
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })

  it("passes only allowlisted status and bounded pagination to reference issues", async () => {
    const response = await listReferenceIssues(
      new Request(
        "https://manager.example/api/subtitle-lab/reference-issues?status=OPEN&limit=25&after=cursor-1",
      ),
    )

    expect(response.status).toBe(200)
    expect(referenceIssuesMock).toHaveBeenCalledWith("OPEN", 25, "cursor-1")
  })

  it("requires an exact Language.id plus Language.slug for reviewer candidates", async () => {
    const response = await listReviewerCandidates(
      new Request(
        "https://manager.example/api/subtitle-lab/reviewer-candidates?targetLanguageId=language-es&targetLanguageSlug=spanish&limit=20",
      ),
    )

    expect(response.status).toBe(200)
    expect(reviewerCandidatesMock).toHaveBeenCalledWith(
      "language-es",
      "spanish",
      undefined,
      20,
      undefined,
    )
  })

  it("rejects a reviewer candidate query missing the stable language slug", async () => {
    const response = await listReviewerCandidates(
      new Request(
        "https://manager.example/api/subtitle-lab/reviewer-candidates?targetLanguageId=language-es",
      ),
    )

    expect(response.status).toBe(400)
    expect(reviewerCandidatesMock).not.toHaveBeenCalled()
  })

  it("binds assignment progress to the route run identity", async () => {
    const response = await listAssignments(
      new Request(
        "https://manager.example/api/subtitle-lab/runs/run-1/assignments?runCellId=cell-1&limit=50",
      ),
      { params: Promise.resolve({ runId: "run-1" }) },
    )

    expect(response.status).toBe(200)
    expect(assignmentsMock).toHaveBeenCalledWith(
      "run-1",
      "cell-1",
      50,
      undefined,
    )
  })

  it("returns a sanitized private outage without upstream details", async () => {
    assignmentsMock.mockRejectedValueOnce(new Error("database secret"))
    const response = await listAssignments(
      new Request(
        "https://manager.example/api/subtitle-lab/runs/run-1/assignments",
      ),
      { params: Promise.resolve({ runId: "run-1" }) },
    )

    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain("database secret")
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })
})
