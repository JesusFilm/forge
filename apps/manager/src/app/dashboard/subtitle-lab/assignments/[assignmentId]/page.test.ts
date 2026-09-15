import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

const { assignmentMock, evidenceMock, notFoundMock, requireAuthMock } =
  vi.hoisted(() => ({
    assignmentMock: vi.fn(),
    evidenceMock: vi.fn(() => null),
    notFoundMock: vi.fn(() => {
      throw new Error("NEXT_NOT_FOUND")
    }),
    requireAuthMock: vi.fn(),
  }))

vi.mock("next/navigation", () => ({ notFound: notFoundMock }))
vi.mock("@/features/subtitle-lab/subtitle-lab-admin-client", () => ({
  SubtitleLabAdminClient: {
    configured: vi.fn(async () => ({ getOperatorAssignment: assignmentMock })),
  },
}))
vi.mock("@/lib/require-auth", () => ({ requireAuth: requireAuthMock }))
vi.mock("./operator-assignment-evidence", () => ({
  OperatorAssignmentEvidence: evidenceMock,
}))

import SubtitleLabOperatorAssignmentPage, {
  OperatorReviewCard,
  presentOperatorReviewEvidence,
} from "./page"

const assignment = {
  id: "assignment-1",
  status: "SUBMITTED",
  kind: "STANDARD",
  round: 1,
  specialistDimension: null,
  targetLanguageId: "language-es",
  targetLanguageSlug: "spanish",
  reviewerMembershipId: "member-1",
  reviewerDisplayName: "Reviewer",
  reviewerEmail: "reviewer@example.com",
  caseId: "jesus-film-1",
  collectionKey: "Jesus Film",
  videoId: "video-1",
  editionIdentity: "edition-1",
  clipStartSeconds: 10,
  clipEndSeconds: 20,
  referenceTrackLabel: "A",
  candidateTrackLabel: "B",
  machineAssessment: null,
  reviews: [
    {
      id: "review-1",
      verdict: "REFERENCE_QUESTIONABLE",
      questionableTrack: "A",
      trackAssessments: {
        trackA: {
          meaningAccuracyScore: 2,
          naturalnessScore: 3,
          timingReadabilityScore: 4,
          scriptureTheologyScore: null,
          issueCodes: ["REFERENCE_ERROR"],
          criticalMeaningLoss: false,
          criticalHarmful: false,
          criticalScriptureRisk: true,
        },
        trackB: {
          meaningAccuracyScore: 5,
          naturalnessScore: 4,
          timingReadabilityScore: 4,
          scriptureTheologyScore: null,
          issueCodes: [],
          criticalMeaningLoss: false,
          criticalHarmful: false,
          criticalScriptureRisk: false,
        },
      },
      meaningAccuracyScore: 5,
      naturalnessScore: 4,
      timingReadabilityScore: 4,
      scriptureTheologyScore: null,
      issueCodes: ["TIMING"],
      criticalMeaningLoss: false,
      criticalHarmful: true,
      criticalScriptureRisk: false,
      notes: "The reference wording needs a native-speaker check.",
      corrections: [
        { segmentId: "segment-0001", track: "A", text: "Corrected wording" },
      ],
      submittedAt: "2026-08-20T15:00:00.000Z",
    },
  ],
}

describe("Subtitle Lab operator assignment page", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    assignmentMock.mockResolvedValue(assignment)
    requireAuthMock.mockResolvedValue({ id: "operator-1" })
  })

  it("loads named operator evidence without impersonating the reviewer", async () => {
    const element = await SubtitleLabOperatorAssignmentPage({
      params: Promise.resolve({ assignmentId: "assignment-1" }),
    })

    expect(requireAuthMock).toHaveBeenCalledOnce()
    expect(assignmentMock).toHaveBeenCalledWith("assignment-1")
    const evidence = element.props.children.find(
      (child: { type?: unknown }) => child?.type === evidenceMock,
    )
    expect(evidence.props.assignmentId).toBe("assignment-1")
  })

  it("keeps raw blind A/B assessments distinct from the candidate-derived scalar projection", () => {
    const evidence = presentOperatorReviewEvidence(assignment)

    expect(evidence[0]).toMatchObject({
      referenceTrackLabel: "A",
      candidateTrackLabel: "B",
      questionableTrack: "A",
      questionableRole: "HUMAN_REFERENCE",
      trackA: expect.objectContaining({ meaningAccuracyScore: 2 }),
      trackB: expect.objectContaining({ meaningAccuracyScore: 5 }),
      candidateProjection: expect.objectContaining({
        meaningAccuracyScore: 5,
        issueCodes: ["TIMING"],
        criticalHarmful: true,
      }),
      notes: "The reference wording needs a native-speaker check.",
      corrections: [
        { segmentId: "segment-0001", track: "A", text: "Corrected wording" },
      ],
    })

    const markup = renderToStaticMarkup(
      OperatorReviewCard({ review: evidence[0]! }),
    )
    expect(markup).toContain("REFERENCE_ERROR")
    expect(markup).toContain("Critical scripture risk")
    expect(markup).toContain("TIMING")
    expect(markup).toContain("Critical harmful content")
    expect(markup).toContain(
      "The reference wording needs a native-speaker check.",
    )
    expect(markup).toContain("segment-0001")
    expect(markup).toContain("Corrected wording")
  })
})
