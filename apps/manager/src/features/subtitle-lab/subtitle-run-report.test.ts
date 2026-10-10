import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import {
  providerCallEvidenceKey,
  SubtitleRunReport,
} from "./subtitle-run-report"
import type {
  SubtitleLabAssignmentProgress,
  SubtitleLabReviewerCandidate,
  SubtitleLabRun,
} from "./subtitle-lab-operator-types"

const run: SubtitleLabRun = {
  id: "run-1",
  status: "PARTIAL",
  corpusVersionId: "corpus-1",
  requestedProvider: "openrouter",
  requestedModel: "google/gemini-2.5-flash",
  promptPolicyId: "subtitle-enrichment-production-v1",
  workflowPolicyDigest: "a".repeat(64),
  codeRevision: "revision-1",
  concurrency: 2,
  timeoutSeconds: 300,
  maxAttempts: 2,
  estimatedSpendMicros: "100000",
  createdAt: "2026-08-20T10:00:00.000Z",
  terminalAt: "2026-08-20T10:05:00.000Z",
  cells: [
    {
      id: "run-cell-1",
      status: "COMPLETED",
      attemptCount: 1,
      leaseGeneration: 1,
      errorCode: null,
      errorRetryable: null,
      resultDigest: "b".repeat(64),
      caseId: "jesus-film-1",
      collectionKey: "Jesus Film",
      videoId: "video-1",
      targetLanguageId: "language-es",
      targetLanguageSlug: "spanish",
      machineMetrics: { timing: { meanIoU: 0.81 } },
      providerRequestId: "req-1",
      providerResponseId: "resp-1",
      assessmentDigest: "c".repeat(64),
      resolvedModel: "google/gemini-2.5-flash-2026-08",
      artifactDigests: ["d".repeat(64)],
      assignmentCount: 1,
    },
    {
      id: "run-cell-2",
      status: "FAILED",
      attemptCount: 2,
      leaseGeneration: 2,
      errorCode: "provider_timeout",
      errorRetryable: true,
      resultDigest: null,
      caseId: "short-1",
      collectionKey: "Shorts",
      videoId: "video-2",
      targetLanguageId: "language-fr",
      targetLanguageSlug: "french",
      machineMetrics: null,
      providerRequestId: null,
      providerResponseId: null,
      assessmentDigest: null,
      resolvedModel: null,
      artifactDigests: [],
      assignmentCount: 0,
    },
  ],
  terminalReport: {
    id: "report-1",
    status: "PARTIAL",
    reportDigest: "e".repeat(64),
    reportArtifactDigest: "f".repeat(64),
    corpusIdentityDigest: "1".repeat(64),
    sourceReferenceDigests: [],
    providerIdentities: {
      requestedProvider: "openrouter",
      requestedModel: "google/gemini-2.5-flash",
      cells: [
        {
          caseId: "jesus-film-1",
          targetLanguageId: "language-es",
          calls: [
            {
              leaseGeneration: 1,
              callSequence: 1,
              operation: "TRANSLATION",
              operationAttempt: 1,
              status: "SUCCEEDED",
              requestDigest: "9".repeat(64),
              providerRequestId: "req-1",
              providerResponseId: "resp-1",
              requestedModel: "google/gemini-2.5-flash",
              resolvedModel: "google/gemini-2.5-flash-2026-08",
            },
          ],
        },
        {
          caseId: "jesus-film-1",
          targetLanguageId: "language-fr",
          calls: [
            {
              leaseGeneration: 1,
              callSequence: 1,
              operation: "TRANSLATION",
              operationAttempt: 1,
              status: "SUCCEEDED",
              requestDigest: "8".repeat(64),
              providerRequestId: "req-2",
              providerResponseId: "resp-2",
              requestedModel: "google/gemini-2.5-flash",
              resolvedModel: "google/gemini-2.5-flash-2026-08",
            },
          ],
        },
      ],
    },
    runtimeIdentity: {
      promptPolicyId: "subtitle-enrichment-production-v1",
      codeRevision: "revision-1",
    },
    usage: [],
    languageMetrics: [
      {
        key: "language-es",
        sampleCount: 1,
        metrics: [{ metric: "timing.meanIoU", mean: 0.81 }],
      },
    ],
    collectionMetrics: [
      {
        key: "Jesus Film",
        sampleCount: 1,
        metrics: [{ metric: "timing.meanIoU", mean: 0.81 }],
      },
    ],
    artifactInventory: [],
    reproducibilityLimits: ["Automatic metrics are diagnostic."],
    partialFailures: [
      {
        caseId: "short-1",
        targetLanguageId: "language-fr",
        errorCode: "provider_timeout",
      },
    ],
    completedAt: "2026-08-20T10:05:00.000Z",
  },
}

const assignments: SubtitleLabAssignmentProgress[] = [
  {
    id: "assignment-1",
    runCellId: "run-cell-1",
    status: "SUBMITTED",
    kind: "STANDARD",
    round: 1,
    reviewerMembershipId: "membership-1",
    reviewerDisplayName: "María Reviewer",
    reviewerEmail: "maria@example.com",
    assignedAt: "2026-08-20T10:06:00.000Z",
    submittedAt: "2026-08-20T10:20:00.000Z",
    latestVerdict: "NEEDS_CHANGES",
    specialistDimension: null,
  },
]

const candidates: SubtitleLabReviewerCandidate[] = [
  {
    membershipId: "membership-1",
    displayName: "María Reviewer",
    email: "maria@example.com",
    targetLanguageId: "language-es",
    targetLanguageSlug: "spanish",
    qualificationVersion: 1,
    rubricDimensions: ["MEANING_ACCURACY", "NATURALNESS", "TIMING_READABILITY"],
    specialistCapabilities: [],
    activeAssignmentCount: 1,
  },
]

describe("SubtitleRunReport", () => {
  it("keys same-case provider calls by exact target language", () => {
    const base = {
      caseId: "jesus-film-1",
      leaseGeneration: 1,
      callSequence: 1,
    }
    expect(
      providerCallEvidenceKey({ ...base, targetLanguageId: "language-es" }),
    ).not.toBe(
      providerCallEvidenceKey({ ...base, targetLanguageId: "language-fr" }),
    )
  })

  it("separates immutable machine evidence from human progress and assignments", () => {
    const markup = renderToStaticMarkup(
      React.createElement(SubtitleRunReport, {
        assignments,
        reviewerCandidates: candidates,
        run,
      }),
    )

    expect(markup).toContain("Immutable terminal report")
    expect(markup).toContain("Machine evidence")
    expect(markup).toContain("Human review progress")
    expect(markup).toContain("does not count as human approval")
    expect(markup).toContain("Per-language metrics")
    expect(markup).toContain("Per-collection metrics")
    expect(markup).toContain("Provider call evidence")
    expect(markup).toContain("req-1")
    expect(markup).toContain("resp-1")
    expect(markup).toContain("language-fr")
    expect(markup).toContain("resp-2")
    expect(markup).toContain("provider_timeout")
    expect(markup).toContain("María Reviewer")
    expect(markup).toContain("Qualification v1")
    expect(markup).toContain("Open review evidence")
    expect(markup).not.toMatch(/>\s*(Publish|Activate prompt|Deploy)\s*</i)
  })
})
