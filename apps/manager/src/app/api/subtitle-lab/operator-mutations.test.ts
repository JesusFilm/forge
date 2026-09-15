import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  appendNarrativeMock,
  approveCorpusMock,
  assignSpecialistMock,
  createComparisonMock,
  dispositionReferenceIssueMock,
  getCorpusMock,
  operatorAuthMock,
  readBodyMock,
} = vi.hoisted(() => ({
  appendNarrativeMock: vi.fn(),
  approveCorpusMock: vi.fn(),
  assignSpecialistMock: vi.fn(),
  createComparisonMock: vi.fn(),
  dispositionReferenceIssueMock: vi.fn(),
  getCorpusMock: vi.fn(),
  operatorAuthMock: vi.fn(),
  readBodyMock: vi.fn(),
}))

vi.mock("@/features/subtitle-lab/subtitle-lab-admin-client", () => ({
  SubtitleLabAdminClient: {
    configured: vi.fn(async () => ({
      appendNarrative: appendNarrativeMock,
      approveCorpus: approveCorpusMock,
      assignSpecialist: assignSpecialistMock,
      createComparison: createComparisonMock,
      dispositionReferenceIssue: dispositionReferenceIssueMock,
      getCorpusVersion: getCorpusMock,
    })),
  },
}))
vi.mock("@/features/subtitle-lab/subtitle-lab-route", () => ({
  guardSubtitleLabMutation: vi.fn(() => null),
  privateNoStoreJson: (value: unknown, init?: ResponseInit) =>
    Response.json(value, {
      ...init,
      headers: { "cache-control": "private, no-store", ...init?.headers },
    }),
  readBoundedSubtitleLabJson: readBodyMock,
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

import { POST as approveCorpus } from "./corpus/[corpusVersionId]/approve/route"
import { POST as createComparison } from "./comparisons/route"
import { POST as appendNarrative } from "./comparisons/[comparisonId]/narratives/route"
import { POST as dispositionReferenceIssue } from "./reference-issues/[issueId]/disposition/route"
import { POST as assignSpecialist } from "./assignments/[assignmentId]/specialist/route"

const request = new Request("https://manager.example/api/subtitle-lab/action", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin: "https://manager.example",
  },
  body: "{}",
})

describe("Subtitle Lab operator mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    operatorAuthMock.mockResolvedValue({
      id: "operator-1",
      subject: "subject-1",
    })
    getCorpusMock.mockResolvedValue({
      id: "corpus-1",
      authority: "server-curator-authority",
      cells: [
        { sourceSnapshotDigest: "source-1" },
        { sourceSnapshotDigest: "source-1" },
        { sourceSnapshotDigest: "source-2" },
      ],
    })
    const result = { id: "result-1", status: "READY", replayed: false }
    approveCorpusMock.mockResolvedValue(result)
    createComparisonMock.mockResolvedValue(result)
    appendNarrativeMock.mockResolvedValue(result)
    dispositionReferenceIssueMock.mockResolvedValue(result)
    assignSpecialistMock.mockResolvedValue(result)
  })

  it("derives corpus identity and evidence counts server-side after curator proof", async () => {
    readBodyMock.mockResolvedValueOnce({
      reason: "Curator verified exact source and reference tracks.",
      certification: {
        schemaVersion: 1,
        authority: "human-curator",
        sourceTracksVerified: 5,
        referenceTracksVerified: 20,
        humanAuthorshipConfirmed: true,
        languageIdentityConfirmed: true,
        certifiedAt: "2026-08-20T14:30",
        notes: null,
      },
    })

    const response = await approveCorpus(request, {
      params: Promise.resolve({ corpusVersionId: "corpus-1" }),
    })

    expect(response.status).toBe(200)
    expect(approveCorpusMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "operator-1" }),
      expect.objectContaining({
        corpusVersionId: "corpus-1",
        certification: expect.objectContaining({
          authority: "server-curator-authority",
          sourceTracksVerified: 3,
          referenceTracksVerified: 3,
        }),
      }),
    )
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })

  it("hides operator mutations from a non-operator session", async () => {
    operatorAuthMock.mockResolvedValueOnce(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    )

    const response = await createComparison(request)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "Not found" })
    expect(readBodyMock).not.toHaveBeenCalled()
    expect(createComparisonMock).not.toHaveBeenCalled()
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })

  it("rejects corpus approval when human authorship was not affirmed", async () => {
    readBodyMock.mockResolvedValueOnce({
      reason: "Incomplete proof",
      certification: {
        schemaVersion: 1,
        authority: "human-curator",
        sourceTracksVerified: 5,
        referenceTracksVerified: 20,
        humanAuthorshipConfirmed: false,
        languageIdentityConfirmed: true,
        certifiedAt: "2026-08-20T14:30",
        notes: null,
      },
    })

    const response = await approveCorpus(request, {
      params: Promise.resolve({ corpusVersionId: "corpus-1" }),
    })

    expect(response.status).toBe(400)
    expect(approveCorpusMock).not.toHaveBeenCalled()
  })

  it("creates a comparison only for two distinct immutable report identities", async () => {
    readBodyMock.mockResolvedValueOnce({
      idempotencyKey: "comparison-action-1",
      baselineReportId: "report-a",
      candidateReportId: "report-b",
      changedAxis: "PROMPT_POLICY",
    })

    const response = await createComparison(request)

    expect(response.status).toBe(201)
    expect(createComparisonMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "operator-1" }),
      {
        idempotencyKey: "comparison-action-1",
        baselineReportId: "report-a",
        candidateReportId: "report-b",
        changedAxis: "PROMPT_POLICY",
      },
    )
  })

  it("rejects a self-comparison before calling Admin", async () => {
    readBodyMock.mockResolvedValueOnce({
      idempotencyKey: "comparison-action-1",
      baselineReportId: "report-a",
      candidateReportId: "report-a",
      changedAxis: "MODEL",
    })

    const response = await createComparison(request)

    expect(response.status).toBe(400)
    expect(createComparisonMock).not.toHaveBeenCalled()
  })

  it("binds an append-only narrative to the route comparison", async () => {
    readBodyMock.mockResolvedValueOnce({
      hypothesis: "Meaning accuracy improves without timing regression.",
      conclusion: null,
      rationale: null,
      followUpAction: "Collect another review round.",
    })

    const response = await appendNarrative(request, {
      params: Promise.resolve({ comparisonId: "comparison-1" }),
    })

    expect(response.status).toBe(201)
    expect(appendNarrativeMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "operator-1" }),
      expect.objectContaining({ comparisonId: "comparison-1" }),
    )
  })

  it("requires a superseding corpus for an accepted reference correction", async () => {
    readBodyMock.mockResolvedValueOnce({
      disposition: "ACCEPTED",
      reason: "The human subtitle uses the wrong proper name.",
      correctedCorpusVersionId: null,
    })

    const response = await dispositionReferenceIssue(request, {
      params: Promise.resolve({ issueId: "issue-1" }),
    })

    expect(response.status).toBe(400)
    expect(dispositionReferenceIssueMock).not.toHaveBeenCalled()
  })

  it("assigns a specialist using the route-owned pending assignment identity", async () => {
    readBodyMock.mockResolvedValueOnce({ reviewerMembershipId: "member-2" })

    const response = await assignSpecialist(request, {
      params: Promise.resolve({ assignmentId: "assignment-1" }),
    })

    expect(response.status).toBe(201)
    expect(assignSpecialistMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "operator-1" }),
      {
        assignmentId: "assignment-1",
        reviewerMembershipId: "member-2",
      },
    )
  })
})
