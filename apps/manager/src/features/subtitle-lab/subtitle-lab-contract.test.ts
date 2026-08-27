import { describe, expect, it } from "vitest"

import {
  assignmentRequestSchema,
  buildSourceReferenceDigestVector,
  canonicalDigest,
  canonicalReviewSubmissionDigest,
  normalizeReviewSubmission,
  resolveCreateRunRequest,
  reviewSubmissionSchema,
} from "./subtitle-lab-contract"

describe("Subtitle Lab Admin canonical contracts", () => {
  it("normalizes GraphQL-null review optionals before body binding", () => {
    const semantic = {
      idempotencyKey: "review-1",
      assignmentId: "assignment-1",
      rubricVersion: 1,
      trackAssessments: {
        trackA: {
          meaningAccuracyScore: 5,
          naturalnessScore: 4,
          timingReadabilityScore: 3,
          issueCodes: [],
          criticalMeaningLoss: false,
          criticalHarmful: false,
          criticalScriptureRisk: false,
        },
        trackB: {
          meaningAccuracyScore: 3,
          naturalnessScore: 5,
          timingReadabilityScore: 4,
          issueCodes: ["NATURALNESS" as const],
          criticalMeaningLoss: false,
          criticalHarmful: false,
          criticalScriptureRisk: false,
        },
      },
      verdict: "PASS" as const,
      corrections: [],
    }
    expect(normalizeReviewSubmission(semantic)).toMatchObject({
      trackAssessments: {
        trackA: { scriptureTheologyScore: null },
        trackB: { scriptureTheologyScore: null },
      },
      questionableTrack: null,
      notes: null,
      supersedesReviewId: null,
    })
    expect(canonicalReviewSubmissionDigest(semantic)).toBe(
      canonicalDigest({
        ...semantic,
        trackAssessments: {
          trackA: {
            ...semantic.trackAssessments.trackA,
            scriptureTheologyScore: null,
          },
          trackB: {
            ...semantic.trackAssessments.trackB,
            scriptureTheologyScore: null,
          },
        },
        questionableTrack: null,
        notes: null,
        supersedesReviewId: null,
      }),
    )
    expect(
      canonicalReviewSubmissionDigest({
        ...semantic,
        trackAssessments: {
          ...semantic.trackAssessments,
          trackB: {
            ...semantic.trackAssessments.trackB,
            meaningAccuracyScore: 2,
          },
        },
      }),
    ).not.toBe(canonicalReviewSubmissionDigest(semantic))
  })

  it("requires a questionable blind track iff the verdict questions the comparison standard", () => {
    const semantic = {
      idempotencyKey: "review-1",
      assignmentId: "assignment-1",
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
          timingReadabilityScore: 4,
          scriptureTheologyScore: null,
          issueCodes: ["REFERENCE_ERROR" as const],
          criticalMeaningLoss: false,
          criticalHarmful: false,
          criticalScriptureRisk: false,
        },
      },
      corrections: [],
    }

    expect(() =>
      normalizeReviewSubmission({
        ...semantic,
        verdict: "REFERENCE_QUESTIONABLE",
      }),
    ).toThrow(/questionableTrack/)
    expect(() =>
      normalizeReviewSubmission({
        ...semantic,
        verdict: "PASS",
        questionableTrack: "B",
      }),
    ).toThrow(/questionableTrack/)
    expect(
      normalizeReviewSubmission({
        ...semantic,
        verdict: "REFERENCE_QUESTIONABLE",
        questionableTrack: "B",
      }),
    ).toMatchObject({ questionableTrack: "B" })
  })

  it("rejects caller-controlled presentation identity from the blind review contract", () => {
    const result = normalizeReviewSubmission({
      idempotencyKey: "review-1",
      assignmentId: "assignment-1",
      rubricVersion: 1,
      trackAssessments: {
        trackA: {
          meaningAccuracyScore: 5,
          naturalnessScore: 4,
          timingReadabilityScore: 3,
          issueCodes: [],
          criticalMeaningLoss: false,
          criticalHarmful: false,
          criticalScriptureRisk: false,
        },
        trackB: {
          meaningAccuracyScore: 3,
          naturalnessScore: 5,
          timingReadabilityScore: 4,
          issueCodes: [],
          criticalMeaningLoss: false,
          criticalHarmful: false,
          criticalScriptureRisk: false,
        },
      },
      verdict: "PASS",
      corrections: [],
    })

    expect(JSON.stringify(result)).not.toMatch(
      /presentationSeed|referenceTrack|candidateTrack|provenance/i,
    )
    expect(
      reviewSubmissionSchema.safeParse({
        ...result,
        presentationSeed: "forged",
      }).success,
    ).toBe(false)
    expect(
      reviewSubmissionSchema.safeParse({
        ...result,
        trackAssessments: undefined,
        meaningAccuracyScore: 5,
        naturalnessScore: 4,
        timingReadabilityScore: 3,
        issueCodes: [],
        criticalMeaningLoss: false,
        criticalHarmful: false,
        criticalScriptureRisk: false,
      }).success,
    ).toBe(false)
  })

  it("mirrors the complete Admin source/reference finalization vector", () => {
    const vector = buildSourceReferenceDigestVector({
      corpusCells: [
        {
          id: "corpus-2",
          caseId: "case-b",
          targetLanguageId: "language-fr",
          targetLanguageSlug: "french",
          sourceTrackIdentity: "source-b",
          referenceTrackIdentity: "reference-b",
          sourceSnapshotDigest: "1".repeat(64),
          sourceSnapshotRawDigest: "2".repeat(64),
          sourceSnapshotClippedDigest: null,
          referenceSnapshotDigest: "3".repeat(64),
          referenceSnapshotRawDigest: "4".repeat(64),
          referenceSnapshotClippedDigest: "5".repeat(64),
        },
        {
          id: "corpus-1",
          caseId: "case-a",
          targetLanguageId: "language-es",
          targetLanguageSlug: "spanish",
          sourceTrackIdentity: "source-a",
          referenceTrackIdentity: "reference-a",
          sourceSnapshotDigest: "6".repeat(64),
          sourceSnapshotRawDigest: "7".repeat(64),
          sourceSnapshotClippedDigest: "8".repeat(64),
          referenceSnapshotDigest: "9".repeat(64),
          referenceSnapshotRawDigest: "a".repeat(64),
          referenceSnapshotClippedDigest: null,
        },
      ],
      runCells: [
        {
          caseId: "case-a",
          targetLanguageId: "language-es",
          targetLanguageSlug: "spanish",
        },
        {
          caseId: "case-b",
          targetLanguageId: "language-fr",
          targetLanguageSlug: "french",
        },
      ],
    })
    expect(vector.map((cell) => cell.caseId)).toEqual(["case-a", "case-b"])
    expect(vector[0]).toMatchObject({
      targetLanguageSlug: "spanish",
      sourceTrackIdentity: "source-a",
      referenceTrackIdentity: "reference-a",
      sourceSnapshot: { clippedSha256: "8".repeat(64) },
      referenceSnapshot: { clippedSha256: null },
    })
    expect(vector[1]).toMatchObject({
      sourceSnapshot: { clippedSha256: null },
      referenceSnapshot: { clippedSha256: "5".repeat(64) },
    })
  })

  it.each([
    { concurrency: 4 },
    { timeoutSeconds: 601 },
    { maxAttempts: 3 },
    { estimatedSpendMicros: "1".repeat(19) },
    { requestedModel: "unregistered/model" },
  ])("rejects a run outside a registered budget or policy", (override) => {
    expect(() =>
      resolveCreateRunRequest(
        {
          idempotencyKey: "launch-1",
          corpusVersionId: "corpus-1",
          corpusCellIds: ["cell-1"],
          requestedProvider: "openrouter",
          requestedModel: "google/gemini-2.5-flash",
          promptPolicyId: "subtitle-enrichment-production-v1",
          workflowPolicyDigest:
            "12ed5350c47fee269ba8a8bdaec70b635e177691238f9749071cb4b50412a22d",
          determinism: { temperature: 0, providerSeed: null },
          concurrency: 1,
          timeoutSeconds: 60,
          maxAttempts: 2,
          ...override,
        },
        "revision-1",
      ),
    ).toThrow()
  })

  it("requires a caller-stable assignment idempotency key", () => {
    const request = {
      idempotencyKey: "assignment-request-1",
      runCellId: "run-cell-1",
      reviewerMembershipId: "membership-1",
      kind: "STANDARD" as const,
    }
    expect(assignmentRequestSchema.parse(request)).toEqual(request)
    expect(
      assignmentRequestSchema.safeParse({
        ...request,
        idempotencyKey: undefined,
      }).success,
    ).toBe(false)
    expect(
      assignmentRequestSchema.safeParse({
        ...request,
        presentationSeed: "caller-controlled",
      }).success,
    ).toBe(false)
  })
})
