import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import {
  assertSubtitleEvalLaunchBounds,
  canonicalReviewerSubmissionDigest,
  comparisonCoverageLabel,
  CreateSubtitleEvalRunInput,
  deriveSubtitleEvalTerminalStatus,
  FinalizeSubtitleEvalCellInput,
  resolveSubtitleEvalAdmissionPolicy,
  reviewerRequestBodyDigest,
  reviewerReferenceTrackLabel,
  subtitleEvalAssignmentRequestDigest,
  subtitleEvalCanonicalReportDigest,
  subtitleEvalComparisonRequestDigest,
  subtitleEvalRunRequestDigest,
  SUBTITLE_EVAL_SOURCE_CEILINGS,
  SubtitleEvalService,
} from "./subtitle-eval.service"

const managerBackend = { id: null, role: "MANAGER_BACKEND" } as const

function withTransaction(tx: Record<string, unknown>) {
  const transaction = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "locked-run" }]),
    ...tx,
  }
  return new SubtitleEvalService({
    $transaction: vi.fn(async (callback) => callback(transaction)),
  } as never)
}

function reviewInput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const semantic = {
    idempotencyKey: "review-request-1",
    assignmentId: "assignment-1",
    rubricVersion: 1,
    trackAssessments: {
      trackA: {
        meaningAccuracyScore: 4,
        naturalnessScore: 4,
        timingReadabilityScore: 4,
        scriptureTheologyScore: null,
        issueCodes: [],
        criticalMeaningLoss: false,
        criticalHarmful: false,
        criticalScriptureRisk: false,
      },
      trackB: {
        meaningAccuracyScore: 4,
        naturalnessScore: 4,
        timingReadabilityScore: 4,
        scriptureTheologyScore: null,
        issueCodes: [],
        criticalMeaningLoss: false,
        criticalHarmful: false,
        criticalScriptureRisk: false,
      },
    },
    verdict: "PASS",
    questionableTrack: null,
    notes: null,
    corrections: [],
    supersedesReviewId: null,
    ...overrides,
  }
  return {
    ...semantic,
    bodyDigest: canonicalReviewerSubmissionDigest(semantic as never),
  }
}

function activeAssignment(status = "ASSIGNED") {
  return {
    id: "assignment-1",
    reviewerMembershipId: "membership-1",
    targetLanguageId: "language-es",
    targetLanguageSlug: "spanish",
    qualificationVersion: 2,
    status,
    kind: "STANDARD",
    presentationSeed: "review-seed",
    reviewerMembership: {
      reviewerLanguageGrants: [
        {
          languageId: "language-es",
          qualificationVersion: 2,
          permittedRubricDimensions: [
            "MEANING_ACCURACY",
            "NATURALNESS",
            "TIMING_READABILITY",
          ],
          scriptureSpecialist: false,
          theologySpecialist: false,
          language: { slug: "spanish", deletedAt: null },
        },
      ],
    },
  }
}

function providerCallInput(overrides: Record<string, unknown> = {}) {
  return {
    callSequence: 1,
    operation: "TRANSLATION" as const,
    chunkIndex: 0,
    operationAttempt: 0,
    status: "SUCCEEDED" as const,
    requestDigest: "d".repeat(64),
    providerRequestId: null,
    providerResponseId: "generation-1",
    requestedModel: "model-1",
    resolvedModel: "provider/model-1",
    usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
    ...overrides,
  }
}

function assignableRunCell(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-cell-1",
    targetLanguageId: "language-es",
    targetLanguageSlug: "spanish",
    status: "COMPLETED",
    resultDigest: "a".repeat(64),
    artifacts: [{ id: "candidate-artifact-1" }],
    machineAssessment: { id: "assessment-1" },
    ...overrides,
  }
}

function completeArtifactInputs() {
  return [
    {
      kind: "CANDIDATE_VTT" as const,
      sha256: "1".repeat(64),
      objectKey: "subtitle-eval/candidate.vtt",
      byteLength: 100n,
      mediaType: "text/vtt",
    },
    {
      kind: "REVIEW_EVIDENCE" as const,
      sha256: "2".repeat(64),
      objectKey: "subtitle-eval/review-evidence.json",
      byteLength: 200n,
      mediaType: "application/json",
    },
    {
      kind: "CELL_REPORT" as const,
      sha256: "a".repeat(64),
      objectKey: "subtitle-eval/cell-report.json",
      byteLength: 300n,
      mediaType: "application/json",
    },
  ]
}

function reviewTx(overrides: Record<string, unknown> = {}) {
  return {
    subtitleEvalAssignment: {
      findFirst: vi.fn().mockResolvedValue(activeAssignment()),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        runCell: { corpusCellId: "corpus-cell-1" },
      }),
      aggregate: vi.fn().mockResolvedValue({ _max: { round: 1 } }),
      create: vi.fn().mockResolvedValue({ id: "specialist-round-1" }),
    },
    subtitleEvalAssertionNonce: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    subtitleEvalHumanReview: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue({ id: "review-previous" }),
      create: vi
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: "review-1", ...data }),
        ),
    },
    subtitleEvalRubricVersion: {
      findUnique: vi.fn().mockResolvedValue({ id: "rubric-1" }),
    },
    subtitleEvalReferenceIssue: { create: vi.fn().mockResolvedValue({}) },
    subtitleEvalAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    ...overrides,
  }
}

describe("subtitle evaluation ledger policy", () => {
  it("uses Admin-owned admission budgets, fails closed in production, and applies safe source bounds", () => {
    expect(SUBTITLE_EVAL_SOURCE_CEILINGS.maxProviderCallsPerCellAttempt).toBe(
      64,
    )
    expect(
      SUBTITLE_EVAL_SOURCE_CEILINGS.minReservationPerCellAttemptMicros,
    ).toBe(
      BigInt(SUBTITLE_EVAL_SOURCE_CEILINGS.maxProviderCallsPerCellAttempt) *
        SUBTITLE_EVAL_SOURCE_CEILINGS.reservationPerProviderCallMicros,
    )
    expect(() =>
      resolveSubtitleEvalAdmissionPolicy({ nodeEnv: "production", env: {} }),
    ).toThrow(/configuration/i)

    expect(
      resolveSubtitleEvalAdmissionPolicy({
        nodeEnv: "production",
        env: {
          maxPerRunMicros: "999999999999",
          maxRolling24HourMicros: "999999999999",
          reservationPerCellAttemptMicros: "999999999999",
          maxActiveRunsPerOperator: "99",
          maxActiveRunsGlobal: "99",
        },
      }),
    ).toEqual({
      maxPerRunMicros: 64_000_000n,
      maxRolling24HourMicros: 256_000_000n,
      reservationPerCellAttemptMicros: 999_999_999_999n,
      maxActiveRunsPerOperator: 2,
      maxActiveRunsGlobal: 4,
    })

    expect(
      resolveSubtitleEvalAdmissionPolicy({
        nodeEnv: "production",
        env: {
          maxPerRunMicros: "1000000",
          maxRolling24HourMicros: "10000000",
          reservationPerCellAttemptMicros: "1",
          maxActiveRunsPerOperator: "1",
          maxActiveRunsGlobal: "2",
        },
      }).reservationPerCellAttemptMicros,
    ).toBe(1_600_000n)
  })

  it("derives terminal status and canonical digest from ledger truth", () => {
    expect(deriveSubtitleEvalTerminalStatus(["COMPLETED", "COMPLETED"])).toBe(
      "COMPLETED",
    )
    expect(deriveSubtitleEvalTerminalStatus(["FAILED", "FAILED"])).toBe(
      "FAILED",
    )
    expect(deriveSubtitleEvalTerminalStatus(["COMPLETED", "FAILED"])).toBe(
      "PARTIAL",
    )
    expect(() =>
      deriveSubtitleEvalTerminalStatus(["COMPLETED", "RUNNING"]),
    ).toThrow(/non_terminal/i)

    const report = { status: "COMPLETED", cells: [{ id: "cell-1" }] }
    expect(subtitleEvalCanonicalReportDigest(report)).toBe(
      createHash("sha256")
        .update('{"cells":[{"id":"cell-1"}],"status":"COMPLETED"}')
        .digest("hex"),
    )
  })

  it("rejects source-ceiling violations before a run can be admitted", () => {
    expect(() =>
      assertSubtitleEvalLaunchBounds({
        cellCount: 21,
        concurrency: 3,
        timeoutSeconds: 600,
        maxAttempts: 2,
      }),
    ).toThrow(/cell/i)
    expect(() =>
      assertSubtitleEvalLaunchBounds({
        cellCount: 1,
        concurrency: 4,
        timeoutSeconds: 600,
        maxAttempts: 2,
      }),
    ).toThrow(/concurrency/i)
  })

  it("binds reviewer assertions to the canonical request bytes", () => {
    const body = '{"assignmentId":"assignment-1","verdict":"PASS"}'
    expect(reviewerRequestBodyDigest(body)).toBe(
      createHash("sha256").update(body).digest("hex"),
    )
    expect(reviewerRequestBodyDigest(`${body}\n`)).not.toBe(
      reviewerRequestBodyDigest(body),
    )
  })

  it("marks small or narrow comparisons as insufficient evidence", () => {
    expect(comparisonCoverageLabel(5, 3)).toBe("SUFFICIENT")
    expect(comparisonCoverageLabel(4, 3)).toBe("INSUFFICIENT_EVIDENCE")
    expect(comparisonCoverageLabel(8, 2)).toBe("INSUFFICIENT_EVIDENCE")
  })

  it("replays an idempotent corpus import without rewriting snapshots", async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: "corpus-1", cells: [] })
    const tx = { subtitleEvalCorpusVersion: { findUnique } }
    const result = await withTransaction(tx).importCorpus({
      user: managerBackend,
      importedById: "operator-1",
      input: {
        manifestDigest: "a".repeat(64),
        lockDigest: "b".repeat(64),
        authority: "Human subtitle benchmark",
        cells: [
          {
            caseId: "case-1",
            collectionKey: "jesus-film",
            videoId: "video-1",
            editionIdentity: "edition-1",
            sourceLanguageId: "language-en",
            sourceLanguageSlug: "english",
            sourceTrackIdentity: "source-track-1",
            targetLanguageId: "language-es",
            targetLanguageSlug: "spanish",
            referenceTrackIdentity: "reference-track-1",
            sourceSnapshot: {
              kind: "SOURCE",
              sha256: "c".repeat(64),
              rawSha256: "c".repeat(64),
              objectKey: "subtitle-eval/c/source.vtt",
              byteLength: 10n,
              mediaType: "text/vtt",
            },
            referenceSnapshot: {
              kind: "REFERENCE",
              sha256: "d".repeat(64),
              rawSha256: "d".repeat(64),
              objectKey: "subtitle-eval/d/reference.vtt",
              byteLength: 20n,
              mediaType: "text/vtt",
            },
          },
        ],
      },
    })
    expect(result.replayed).toBe(true)
    expect(findUnique).toHaveBeenCalledOnce()
  })

  it("audits a delegated corpus import as the exact human operator", async () => {
    const snapshot = <T extends "SOURCE" | "REFERENCE">(kind: T) => ({
      kind,
      sha256: kind === "SOURCE" ? "c".repeat(64) : "d".repeat(64),
      rawSha256: kind === "SOURCE" ? "c".repeat(64) : "d".repeat(64),
      clippedSha256: null,
      objectKey: `subtitle-eval/${kind.toLowerCase()}.vtt`,
      byteLength: 10n,
      mediaType: "text/vtt" as const,
    })
    const tx = {
      subtitleEvalCorpusVersion: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "corpus-1" }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "corpus-1",
          cells: [],
        }),
      },
      language: {
        findMany: vi.fn().mockResolvedValue([
          { id: "language-en", slug: "english" },
          { id: "language-es", slug: "spanish" },
        ]),
      },
      subtitleEvalCorpusSnapshot: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({
            id: "source-snapshot-1",
            ...snapshot("SOURCE"),
          })
          .mockResolvedValueOnce({
            id: "reference-snapshot-1",
            ...snapshot("REFERENCE"),
          }),
      },
      subtitleEvalCorpusCell: { create: vi.fn().mockResolvedValue({}) },
      subtitleEvalAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    }
    await withTransaction(tx).importCorpus({
      user: managerBackend,
      importedById: "operator-human-1",
      requestId: "request-1",
      input: {
        manifestDigest: "a".repeat(64),
        lockDigest: "b".repeat(64),
        authority: "Human subtitle benchmark",
        cells: [
          {
            caseId: "case-1",
            collectionKey: "jesus-film",
            videoId: "video-1",
            editionIdentity: "edition-1",
            sourceLanguageId: "language-en",
            sourceLanguageSlug: "english",
            sourceTrackIdentity: "source-track-1",
            targetLanguageId: "language-es",
            targetLanguageSlug: "spanish",
            referenceTrackIdentity: "reference-track-1",
            sourceSnapshot: snapshot("SOURCE"),
            referenceSnapshot: snapshot("REFERENCE"),
          },
        ],
      },
    })
    expect(tx.subtitleEvalAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorId: "operator-human-1" }),
      }),
    )
  })

  it("allows only an exact corpus approval replay and rejects changed evidence", async () => {
    const tx = {
      subtitleEvalCorpusVersion: {
        findUnique: vi.fn().mockResolvedValue({
          id: "corpus-1",
          status: "APPROVED",
          approvalDigest: "not-the-request-digest",
          authority: "Human benchmark authority",
          cells: [{ id: "cell-1" }],
        }),
      },
    }
    await expect(
      withTransaction(tx).approveCorpusVersion({
        user: managerBackend,
        input: {
          corpusVersionId: "corpus-1",
          approvedById: "operator-1",
          reason: "Certified source evidence.",
          requestId: "request-1",
          certification: {
            schemaVersion: 1,
            authority: "Human benchmark authority",
            sourceTracksVerified: 1,
            referenceTracksVerified: 1,
            humanAuthorshipConfirmed: true,
            languageIdentityConfirmed: true,
            certifiedAt: new Date(),
          },
        },
      }),
    ).rejects.toMatchObject({ reason: "corpus_approval_mismatch" })
  })

  it("rejects a raced corpus approval unless the winning evidence is identical", async () => {
    const tx = {
      subtitleEvalCorpusVersion: {
        findUnique: vi.fn().mockResolvedValue({
          id: "corpus-1",
          status: "PROVISIONAL",
          approvalDigest: null,
          authority: "Human benchmark authority",
          cells: [{ id: "cell-1" }],
          supersedesVersionId: null,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "corpus-1",
          status: "APPROVED",
          approvalDigest: "different-winner",
        }),
      },
      subtitleEvalReferenceIssue: { count: vi.fn().mockResolvedValue(0) },
    }
    await expect(
      withTransaction(tx).approveCorpusVersion({
        user: managerBackend,
        input: {
          corpusVersionId: "corpus-1",
          approvedById: "operator-1",
          reason: "Certified source evidence.",
          requestId: "request-1",
          certification: {
            schemaVersion: 1,
            authority: "Human benchmark authority",
            sourceTracksVerified: 1,
            referenceTracksVerified: 1,
            humanAuthorshipConfirmed: true,
            languageIdentityConfirmed: true,
            certifiedAt: new Date(),
          },
        },
      }),
    ).rejects.toMatchObject({ reason: "corpus_approval_raced" })
  })

  it("projects an approved corpus as ineffective while any non-rejected reference issue exists", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: "corpus-1",
      status: "APPROVED",
      cells: [{ id: "cell-1", referenceIssues: [{ id: "issue-1" }] }],
    })
    const service = new SubtitleEvalService({
      subtitleEvalCorpusVersion: {
        findUnique,
      },
    } as never)
    await expect(
      service.getCorpusVersion({ user: managerBackend, id: "corpus-1" }),
    ).resolves.toMatchObject({ effectiveApproved: false })
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          cells: expect.objectContaining({
            include: expect.objectContaining({
              referenceIssues: expect.objectContaining({
                where: { status: { not: "REJECTED" } },
              }),
            }),
          }),
        }),
      }),
    )
  })

  it("replays a run idempotency key before consuming admission capacity", async () => {
    const request = {
      idempotencyKey: "run-request-1",
      operatorId: "operator-1",
      corpusVersionId: "corpus-1",
      corpusCellIds: ["cell-1"],
      requestedProvider: "openrouter",
      requestedModel: "model-1",
      promptPolicyId: "prompt-1",
      workflowPolicyDigest: "e".repeat(64),
      codeRevision: "revision-1",
      determinism: {},
      concurrency: 1,
      timeoutSeconds: 60,
      maxAttempts: 2,
    }
    const tx = {
      subtitleEvalRun: {
        findUnique: vi.fn().mockResolvedValue({
          id: "run-1",
          cells: [],
          requestDigest: subtitleEvalRunRequestDigest(request),
        }),
        count: vi.fn(),
      },
    }
    const result = await withTransaction(tx).createRun({
      user: managerBackend,
      input: request,
    })
    expect(result.replayed).toBe(true)
    expect(tx.subtitleEvalRun.count).not.toHaveBeenCalled()
  })

  it("rejects a reused run idempotency key when any immutable request identity changes", async () => {
    const original = {
      idempotencyKey: "run-request-1",
      operatorId: "operator-1",
      corpusVersionId: "corpus-1",
      corpusCellIds: ["cell-1"],
      requestedProvider: "openrouter",
      requestedModel: "model-1",
      promptPolicyId: "prompt-1",
      workflowPolicyDigest: "e".repeat(64),
      codeRevision: "revision-1",
      determinism: {},
      concurrency: 1,
      timeoutSeconds: 60,
      maxAttempts: 2,
    }
    const mutations = [
      { ...original, operatorId: "operator-2" },
      { ...original, corpusVersionId: "corpus-2" },
      { ...original, corpusCellIds: ["cell-2"] },
      { ...original, requestedProvider: "provider-2" },
      { ...original, requestedModel: "model-2" },
      { ...original, promptPolicyId: "prompt-2" },
      { ...original, workflowPolicyDigest: "f".repeat(64) },
      { ...original, codeRevision: "revision-2" },
      { ...original, determinism: { seed: 2 } },
      { ...original, concurrency: 2 },
      { ...original, timeoutSeconds: 61 },
      { ...original, maxAttempts: 1 },
    ]
    for (const request of mutations) {
      const tx = {
        subtitleEvalRun: {
          findUnique: vi.fn().mockResolvedValue({
            id: "run-1",
            cells: [],
            requestDigest: subtitleEvalRunRequestDigest(original),
          }),
        },
      }
      await expect(
        withTransaction(tx).createRun({ user: managerBackend, input: request }),
      ).rejects.toMatchObject({ reason: "run_idempotency_mismatch" })
    }
  })

  it("transactionally rejects an operator at the active-run ceiling", async () => {
    const tx = {
      subtitleEvalRun: {
        findUnique: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(2),
        aggregate: vi.fn().mockResolvedValue({
          _sum: { estimatedSpendMicros: 0n },
        }),
      },
      subtitleEvalCorpusCell: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "cell-1",
            caseId: "case-1",
            targetLanguageId: "language-es",
            targetLanguageSlug: "spanish",
          },
        ]),
      },
      subtitleEvalCorpusVersion: {
        findUnique: vi.fn().mockResolvedValue({ status: "APPROVED" }),
      },
      subtitleEvalReferenceIssue: {
        count: vi.fn().mockResolvedValue(0),
      },
    }
    await expect(
      withTransaction(tx).createRun({
        user: managerBackend,
        input: {
          idempotencyKey: "run-request-1",
          operatorId: "operator-1",
          corpusVersionId: "corpus-1",
          corpusCellIds: ["cell-1"],
          requestedProvider: "openrouter",
          requestedModel: "model-1",
          promptPolicyId: "prompt-1",
          workflowPolicyDigest: "e".repeat(64),
          codeRevision: "revision-1",
          concurrency: 1,
          timeoutSeconds: 60,
          maxAttempts: 2,
        },
      }),
    ).rejects.toMatchObject({ reason: "operator_active_run_ceiling" })
  })

  it("derives a positive spend reservation inside Admin and excludes caller spend from the request contract", async () => {
    const input = {
      idempotencyKey: "run-request-reservation",
      operatorId: "operator-1",
      corpusVersionId: "corpus-1",
      corpusCellIds: ["cell-1", "cell-2"],
      requestedProvider: "openrouter",
      requestedModel: "model-1",
      promptPolicyId: "prompt-1",
      workflowPolicyDigest: "e".repeat(64),
      codeRevision: "revision-1",
      determinism: {},
      concurrency: 1,
      timeoutSeconds: 60,
      maxAttempts: 2,
    }
    expect(
      CreateSubtitleEvalRunInput.safeParse({
        ...input,
        estimatedSpendMicros: "0",
      }).success,
    ).toBe(false)

    const cells = input.corpusCellIds.map((id, index) => ({
      id,
      caseId: `case-${index + 1}`,
      targetLanguageId: "language-es",
      targetLanguageSlug: "spanish",
    }))
    const tx = {
      subtitleEvalRun: {
        findUnique: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi
          .fn()
          .mockResolvedValue({ _sum: { estimatedSpendMicros: 0n } }),
        create: vi.fn().mockImplementation(async ({ data }) => ({
          id: "run-1",
          ...data,
          cells: [],
        })),
      },
      subtitleEvalCorpusCell: { findMany: vi.fn().mockResolvedValue(cells) },
      subtitleEvalCorpusVersion: {
        findUnique: vi.fn().mockResolvedValue({ status: "APPROVED" }),
      },
      subtitleEvalReferenceIssue: { count: vi.fn().mockResolvedValue(0) },
      subtitleEvalAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    }
    await withTransaction(tx).createRun({ user: managerBackend, input })
    const policy = resolveSubtitleEvalAdmissionPolicy()
    expect(tx.subtitleEvalRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          estimatedSpendMicros:
            policy.reservationPerCellAttemptMicros * 2n * 2n,
        }),
      }),
    )
  })

  it("counts Admin-derived reservations against the rolling spend ceiling", async () => {
    const policy = resolveSubtitleEvalAdmissionPolicy()
    const reservation = policy.reservationPerCellAttemptMicros * 2n
    const tx = {
      subtitleEvalRun: {
        findUnique: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({
          _sum: {
            estimatedSpendMicros:
              policy.maxRolling24HourMicros - reservation + 1n,
          },
        }),
      },
      subtitleEvalCorpusCell: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "cell-1",
            caseId: "case-1",
            targetLanguageId: "language-es",
            targetLanguageSlug: "spanish",
          },
        ]),
      },
      subtitleEvalCorpusVersion: {
        findUnique: vi.fn().mockResolvedValue({ status: "APPROVED" }),
      },
      subtitleEvalReferenceIssue: { count: vi.fn().mockResolvedValue(0) },
    }
    await expect(
      withTransaction(tx).createRun({
        user: managerBackend,
        input: {
          idempotencyKey: "run-request-rolling",
          operatorId: "operator-1",
          corpusVersionId: "corpus-1",
          corpusCellIds: ["cell-1"],
          requestedProvider: "openrouter",
          requestedModel: "model-1",
          promptPolicyId: "prompt-1",
          workflowPolicyDigest: "e".repeat(64),
          codeRevision: "revision-1",
          determinism: {},
          concurrency: 1,
          timeoutSeconds: 60,
          maxAttempts: 2,
        },
      }),
    ).rejects.toMatchObject({ reason: "rolling_spend_ceiling" })
  })

  it("transitions a queued run to running on the first successful cell claim", async () => {
    const now = new Date("2026-08-20T18:00:00.000Z")
    vi.useFakeTimers()
    vi.setSystemTime(now)
    try {
      const tx = {
        subtitleEvalRunCell: {
          findUnique: vi.fn().mockResolvedValue({
            id: "cell-1",
            runId: "run-1",
            status: "QUEUED",
            attemptCount: 0,
            leaseGeneration: 0,
            leaseExpiresAt: null,
            startedAt: null,
            run: {
              id: "run-1",
              status: "QUEUED",
              startedAt: null,
              maxAttempts: 2,
            },
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: vi.fn().mockResolvedValue({
            id: "cell-1",
            status: "RUNNING",
            leaseGeneration: 1,
          }),
        },
        subtitleEvalRun: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        subtitleEvalProviderCall: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      }

      const claimed = await withTransaction(tx).claimRunCell({
        runCellId: "cell-1",
        leaseSeconds: 60,
      })

      expect(claimed.executionClaim).toMatchObject({ executionAttempt: 1 })
      expect(tx.subtitleEvalRun.updateMany).toHaveBeenCalledWith({
        where: { id: "run-1", status: "QUEUED" },
        data: { status: "RUNNING", startedAt: now, updatedAt: now },
      })
      expect(tx.subtitleEvalProviderCall.findMany).toHaveBeenCalledWith({
        where: { runCellId: "cell-1" },
        distinct: ["leaseGeneration"],
        select: { leaseGeneration: true },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not classify a run with a live cell lease as stale solely by run age", async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const service = new SubtitleEvalService({
      subtitleEvalRun: { findMany },
    } as never)
    const staleBefore = new Date("2026-08-20T17:55:00.000Z")

    await service.listStaleRuns({
      user: managerBackend,
      staleBefore,
    })

    const fallback = findMany.mock.calls[0]![0].where.OR.find(
      (candidate: Record<string, unknown>) => "updatedAt" in candidate,
    )
    expect(fallback).toEqual({
      leaseTokenHash: null,
      updatedAt: { lte: staleBefore },
      cells: {
        none: {
          status: "RUNNING",
          leaseExpiresAt: { gt: staleBefore },
        },
      },
    })
  })

  it("rejects completion from an older fenced worker", async () => {
    const tx = {
      subtitleEvalRunCell: {
        findUnique: vi.fn().mockResolvedValue({
          id: "cell-1",
          status: "RUNNING",
          resultDigest: null,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }
    await expect(
      withTransaction(tx).finalizeRunCell({
        runCellId: "cell-1",
        leaseGeneration: 1,
        leaseToken: "stale-worker-token",
        resultDigest: "a".repeat(64),
        artifacts: completeArtifactInputs(),
        providerCalls: [],
        machineAssessment: {
          schemaVersion: 1,
          metrics: {},
          assessmentDigest: "b".repeat(64),
          reproducibilityLimits: [],
        },
      }),
    ).rejects.toMatchObject({ reason: "cell_fence_lost" })
  })

  it("persists bounded provider-call evidence under the successful lease generation", async () => {
    const tx = {
      subtitleEvalRunCell: {
        findUnique: vi.fn().mockResolvedValue({
          id: "cell-1",
          status: "RUNNING",
          resultDigest: null,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue({ id: "cell-1", status: "COMPLETED" }),
      },
      subtitleEvalProviderCall: {
        findMany: vi.fn().mockResolvedValue([]),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      subtitleEvalMachineAssessment: {
        create: vi.fn().mockResolvedValue({}),
      },
      subtitleEvalArtifact: { create: vi.fn().mockResolvedValue({}) },
    }
    await withTransaction(tx).finalizeRunCell({
      runCellId: "cell-1",
      leaseGeneration: 2,
      leaseToken: "worker-token",
      resultDigest: "a".repeat(64),
      artifacts: completeArtifactInputs(),
      providerCalls: [providerCallInput()],
      machineAssessment: {
        schemaVersion: 1,
        metrics: {},
        assessmentDigest: "b".repeat(64),
        reproducibilityLimits: [],
      },
    })
    expect(tx.subtitleEvalProviderCall.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          runCellId: "cell-1",
          leaseGeneration: 2,
          callSequence: 1,
          providerRequestId: null,
          providerResponseId: "generation-1",
        }),
      ],
    })
    expect(tx.subtitleEvalArtifact.create).toHaveBeenCalledTimes(3)
  })

  it("rejects provider-call drift when a terminal cell completion is replayed", async () => {
    const tx = {
      subtitleEvalRunCell: {
        findUnique: vi.fn().mockResolvedValue({
          id: "cell-1",
          status: "COMPLETED",
          resultDigest: "a".repeat(64),
          artifacts: completeArtifactInputs(),
          machineAssessment: { assessmentDigest: "b".repeat(64) },
        }),
      },
      subtitleEvalProviderCall: {
        findMany: vi.fn().mockResolvedValue([
          {
            leaseGeneration: 2,
            ...providerCallInput({ providerResponseId: "generation-original" }),
          },
        ]),
      },
    }
    await expect(
      withTransaction(tx).finalizeRunCell({
        runCellId: "cell-1",
        leaseGeneration: 2,
        leaseToken: "worker-token",
        resultDigest: "a".repeat(64),
        artifacts: completeArtifactInputs(),
        providerCalls: [
          providerCallInput({ providerResponseId: "generation-changed" }),
        ],
        machineAssessment: {
          schemaVersion: 1,
          metrics: {},
          assessmentDigest: "b".repeat(64),
          reproducibilityLimits: [],
        },
      }),
    ).rejects.toMatchObject({ reason: "provider_call_replay_mismatch" })
  })

  it("never appends missing provider calls when a completed cell is replayed", async () => {
    const tx = {
      subtitleEvalRunCell: {
        findUnique: vi.fn().mockResolvedValue({
          id: "cell-1",
          status: "COMPLETED",
          resultDigest: "a".repeat(64),
          artifacts: completeArtifactInputs(),
          machineAssessment: { assessmentDigest: "b".repeat(64) },
        }),
      },
      subtitleEvalProviderCall: {
        findMany: vi.fn().mockResolvedValue([]),
        createMany: vi.fn(),
      },
    }
    await expect(
      withTransaction(tx).finalizeRunCell({
        runCellId: "cell-1",
        leaseGeneration: 2,
        leaseToken: "worker-token",
        resultDigest: "a".repeat(64),
        artifacts: completeArtifactInputs(),
        providerCalls: [providerCallInput()],
        machineAssessment: {
          schemaVersion: 1,
          metrics: {},
          assessmentDigest: "b".repeat(64),
          reproducibilityLimits: [],
        },
      }),
    ).rejects.toMatchObject({ reason: "provider_call_replay_mismatch" })
    expect(tx.subtitleEvalProviderCall.createMany).not.toHaveBeenCalled()
  })

  it("persists provider-call evidence from a retryable failed attempt before requeue", async () => {
    const tx = {
      subtitleEvalRunCell: {
        findUnique: vi.fn().mockResolvedValue({
          id: "cell-1",
          status: "RUNNING",
          attemptCount: 1,
          run: { maxAttempts: 2 },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue({ id: "cell-1", status: "QUEUED" }),
      },
      subtitleEvalProviderCall: {
        findMany: vi.fn().mockResolvedValue([]),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }
    await withTransaction(tx).failRunCell({
      runCellId: "cell-1",
      leaseGeneration: 1,
      leaseToken: "worker-token",
      errorCode: "provider_failed",
      retryable: true,
      providerCalls: [
        providerCallInput({ status: "FAILED", providerResponseId: null }),
      ],
    })
    expect(tx.subtitleEvalProviderCall.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          leaseGeneration: 1,
          status: "FAILED",
          providerResponseId: null,
        }),
      ],
    })
  })

  it("rejects provider-call drift when a failed lease generation is replayed", async () => {
    const tx = {
      subtitleEvalRunCell: {
        findUnique: vi.fn().mockResolvedValue({
          id: "cell-1",
          status: "QUEUED",
          leaseGeneration: 1,
          attemptCount: 1,
          errorCode: "provider_failed",
          errorRetryable: true,
          run: { maxAttempts: 2 },
        }),
      },
      subtitleEvalProviderCall: {
        findMany: vi.fn().mockResolvedValue([
          {
            leaseGeneration: 1,
            ...providerCallInput({ providerResponseId: "generation-original" }),
          },
        ]),
      },
    }
    await expect(
      withTransaction(tx).failRunCell({
        runCellId: "cell-1",
        leaseGeneration: 1,
        leaseToken: "worker-token",
        errorCode: "provider_failed",
        retryable: true,
        providerCalls: [
          providerCallInput({ providerResponseId: "generation-changed" }),
        ],
      }),
    ).rejects.toMatchObject({ reason: "provider_call_replay_mismatch" })
  })

  it("rejects non-string, oversized, or unbounded advisory risk flags", () => {
    const base = {
      runCellId: "cell-1",
      leaseGeneration: 1,
      leaseToken: "worker-token",
      resultDigest: "a".repeat(64),
      artifacts: completeArtifactInputs(),
      providerCalls: [],
      machineAssessment: {
        schemaVersion: 1,
        metrics: {},
        assessmentDigest: "b".repeat(64),
        reproducibilityLimits: [],
      },
    }
    for (const advisoryRiskFlags of [
      [123],
      ["x".repeat(192)],
      Array.from({ length: 101 }, () => "RISK"),
    ]) {
      expect(
        FinalizeSubtitleEvalCellInput.safeParse({
          ...base,
          machineAssessment: {
            ...base.machineAssessment,
            advisoryRiskFlags,
          },
        }).success,
      ).toBe(false)
    }
  })

  it("requires the complete unique artifact bundle with exact media types before terminalizing a cell", async () => {
    const complete = completeArtifactInputs()
    const malformedBundles = [
      [],
      complete.slice(0, 2),
      [
        complete[0]!,
        { ...complete[0]!, objectKey: "duplicate.vtt" },
        complete[2]!,
      ],
      complete.map((artifact) =>
        artifact.kind === "CANDIDATE_VTT"
          ? { ...artifact, mediaType: "application/json" }
          : artifact,
      ),
    ]
    const base = {
      runCellId: "cell-1",
      leaseGeneration: 1,
      leaseToken: "worker-token",
      resultDigest: "a".repeat(64),
      providerCalls: [],
      machineAssessment: {
        schemaVersion: 1,
        metrics: {},
        assessmentDigest: "b".repeat(64),
        reproducibilityLimits: [],
      },
    }
    for (const artifacts of malformedBundles) {
      expect(
        FinalizeSubtitleEvalCellInput.safeParse({ ...base, artifacts }).success,
      ).toBe(false)
    }

    const updateMany = vi.fn()
    await expect(
      withTransaction({
        subtitleEvalRunCell: { updateMany },
      }).finalizeRunCell({ ...base, artifacts: [] }),
    ).rejects.toThrow()
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("binds the result digest to the CELL_REPORT artifact before status mutation", async () => {
    const updateMany = vi.fn()
    const artifacts = completeArtifactInputs().map((artifact) =>
      artifact.kind === "CELL_REPORT"
        ? { ...artifact, sha256: "c".repeat(64) }
        : artifact,
    )
    await expect(
      withTransaction({
        subtitleEvalRunCell: { updateMany },
      }).finalizeRunCell({
        runCellId: "cell-1",
        leaseGeneration: 1,
        leaseToken: "worker-token",
        resultDigest: "a".repeat(64),
        artifacts,
        providerCalls: [],
        machineAssessment: {
          schemaVersion: 1,
          metrics: {},
          assessmentDigest: "b".repeat(64),
          reproducibilityLimits: [],
        },
      }),
    ).rejects.toThrow(/CELL_REPORT artifact digest/)
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("rejects artifact or machine-assessment drift on a completed-cell replay", async () => {
    const storedArtifacts = completeArtifactInputs()
    for (const replay of [
      {
        artifacts: storedArtifacts.map((artifact) =>
          artifact.kind === "CANDIDATE_VTT"
            ? { ...artifact, objectKey: "subtitle-eval/changed-candidate.vtt" }
            : artifact,
        ),
        assessmentDigest: "b".repeat(64),
      },
      {
        artifacts: storedArtifacts,
        assessmentDigest: "c".repeat(64),
      },
    ]) {
      const providerFindMany = vi.fn()
      const tx = {
        subtitleEvalRunCell: {
          findUnique: vi.fn().mockResolvedValue({
            id: "cell-1",
            status: "COMPLETED",
            resultDigest: "a".repeat(64),
            artifacts: storedArtifacts,
            machineAssessment: { assessmentDigest: "b".repeat(64) },
          }),
        },
        subtitleEvalProviderCall: { findMany: providerFindMany },
      }
      await expect(
        withTransaction(tx).finalizeRunCell({
          runCellId: "cell-1",
          leaseGeneration: 2,
          leaseToken: "worker-token",
          resultDigest: "a".repeat(64),
          artifacts: replay.artifacts,
          providerCalls: [],
          machineAssessment: {
            schemaVersion: 1,
            metrics: {},
            assessmentDigest: replay.assessmentDigest,
            reproducibilityLimits: [],
          },
        }),
      ).rejects.toMatchObject({ reason: "terminal_cell_evidence_mismatch" })
      expect(providerFindMany).not.toHaveBeenCalled()
    }
  })

  it("rejects a 65th provider call at the Admin finalization boundary", () => {
    const providerCalls = Array.from({ length: 65 }, (_, index) =>
      providerCallInput({ callSequence: index + 1 }),
    )
    expect(
      FinalizeSubtitleEvalCellInput.safeParse({
        runCellId: "cell-1",
        leaseGeneration: 1,
        leaseToken: "worker-token",
        resultDigest: "a".repeat(64),
        artifacts: completeArtifactInputs(),
        providerCalls,
        machineAssessment: {
          schemaVersion: 1,
          metrics: {},
          assessmentDigest: "b".repeat(64),
          reproducibilityLimits: [],
        },
      }).success,
    ).toBe(false)
  })

  it("persists the effective retry decision when the last attempt is exhausted", async () => {
    const tx = {
      subtitleEvalRunCell: {
        findUnique: vi.fn().mockResolvedValue({
          id: "cell-1",
          status: "RUNNING",
          attemptCount: 2,
          run: { maxAttempts: 2 },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "cell-1",
          status: "FAILED",
        }),
      },
    }
    await withTransaction(tx).failRunCell({
      runCellId: "cell-1",
      leaseGeneration: 2,
      leaseToken: "worker-token",
      errorCode: "provider_timeout",
      retryable: true,
      providerCalls: [],
    })
    expect(tx.subtitleEvalRunCell.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ errorRetryable: false }),
      }),
    )
  })

  it("requeues reconciliation without consuming a paid attempt", async () => {
    const tx = {
      subtitleEvalRunCell: {
        findUnique: vi.fn().mockResolvedValue({
          id: "cell-1",
          status: "RUNNING",
          attemptCount: 2,
          leaseGeneration: 2,
          run: { maxAttempts: 2 },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "cell-1",
          status: "QUEUED",
        }),
      },
      subtitleEvalProviderCall: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    }
    await withTransaction(tx).failRunCell({
      runCellId: "cell-1",
      leaseGeneration: 2,
      leaseToken: "worker-token",
      errorCode: "execution_in_progress",
      retryable: true,
      providerCalls: [],
    })
    expect(tx.subtitleEvalRunCell.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "QUEUED",
          errorRetryable: true,
          attemptCount: { decrement: 1 },
        }),
      }),
    )
  })

  it("terminalizes reconciliation after the durable lease budget", async () => {
    const tx = {
      subtitleEvalRunCell: {
        findUnique: vi.fn().mockResolvedValue({
          id: "cell-1",
          status: "RUNNING",
          attemptCount: 1,
          leaseGeneration: 6,
          run: { maxAttempts: 2 },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "cell-1",
          status: "FAILED",
        }),
      },
      subtitleEvalProviderCall: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    }
    await withTransaction(tx).failRunCell({
      runCellId: "cell-1",
      leaseGeneration: 6,
      leaseToken: "worker-token",
      errorCode: "execution_in_progress",
      retryable: true,
      providerCalls: [],
    })
    expect(tx.subtitleEvalRunCell.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          errorCode: "ambiguous_execution_unresolved",
          errorRetryable: false,
        }),
      }),
    )
    expect(
      tx.subtitleEvalRunCell.updateMany.mock.calls[0]![0].data,
    ).not.toHaveProperty("attemptCount")
  })

  it("rejects a non-terminal report status even though the run enum is shared", async () => {
    await expect(
      withTransaction({}).finalizeRun({
        runId: "run-1",
        expectedStatus: "QUEUED" as never,
        expectedCorpusIdentityDigest: "b".repeat(64),
        expectedSourceReferenceDigest: "c".repeat(64),
      }),
    ).rejects.toThrow()
  })

  it("locks the parent run before reading terminal evidence", async () => {
    const queryRaw = vi.fn().mockResolvedValue([])
    const findUnique = vi.fn()
    await expect(
      withTransaction({
        $queryRaw: queryRaw,
        subtitleEvalRun: { findUnique },
      }).finalizeRun({
        runId: "run-1",
        expectedStatus: "COMPLETED",
        expectedCorpusIdentityDigest: "b".repeat(64),
        expectedSourceReferenceDigest: "c".repeat(64),
      }),
    ).rejects.toMatchObject({
      name: "NotFoundError",
      message: "SubtitleEvalRun not found: run-1",
    })
    expect(queryRaw).toHaveBeenCalledOnce()
    const statement = queryRaw.mock.calls[0]![0] as { strings: string[] }
    expect(statement.strings.join(" ")).toContain("FOR UPDATE")
    expect(findUnique).not.toHaveBeenCalled()
  })

  it("does not rewrite a terminal report with a different frozen identity", async () => {
    const tx = {
      subtitleEvalRun: {
        findUnique: vi.fn().mockResolvedValue({
          id: "run-1",
          cells: [],
          terminalReport: {
            reportDigest: "a".repeat(64),
            status: "COMPLETED",
            corpusIdentityDigest: "c".repeat(64),
            sourceReferenceDigests: {},
            reportArtifactDigest: null,
          },
        }),
      },
    }
    await expect(
      withTransaction(tx).finalizeRun({
        runId: "run-1",
        expectedStatus: "COMPLETED",
        expectedCorpusIdentityDigest: "d".repeat(64),
        expectedSourceReferenceDigest: subtitleEvalCanonicalReportDigest({}),
      }),
    ).rejects.toMatchObject({ reason: "terminal_report_mismatch" })
  })

  it("requires exact canonical reproducibility limits on terminal replay", async () => {
    const terminalReport = {
      reportDigest: "a".repeat(64),
      status: "COMPLETED",
      corpusIdentityDigest: "c".repeat(64),
      sourceReferenceDigests: [],
      reportArtifactDigest: null,
      reproducibilityLimits: ["Provider seed unavailable."],
    }
    const tx = {
      subtitleEvalRun: {
        findUnique: vi.fn().mockResolvedValue({
          id: "run-1",
          cells: [],
          terminalReport,
        }),
      },
    }
    const valid = {
      runId: "run-1",
      expectedStatus: "COMPLETED" as const,
      expectedCorpusIdentityDigest: "c".repeat(64),
      expectedSourceReferenceDigest: subtitleEvalCanonicalReportDigest([]),
      reproducibilityLimits: ["Provider seed unavailable."],
    }
    await expect(withTransaction(tx).finalizeRun(valid)).resolves.toEqual({
      report: terminalReport,
      replayed: true,
    })
    await expect(
      withTransaction(tx).finalizeRun({
        ...valid,
        reproducibilityLimits: ["Different limit."],
      }),
    ).rejects.toMatchObject({ reason: "terminal_report_mismatch" })
  })

  it("derives terminal evidence from frozen ledger rows and rejects every incorrect expectation", async () => {
    const sourceReferenceDigests = [
      {
        caseId: "case-1",
        targetLanguageId: "language-es",
        targetLanguageSlug: "spanish",
        sourceTrackIdentity: "source-track-1",
        referenceTrackIdentity: "reference-track-1",
        sourceSnapshot: {
          sha256: "1".repeat(64),
          rawSha256: "2".repeat(64),
          clippedSha256: null,
        },
        referenceSnapshot: {
          sha256: "3".repeat(64),
          rawSha256: "4".repeat(64),
          clippedSha256: null,
        },
      },
    ]
    const run = {
      id: "run-1",
      status: "RUNNING",
      requestedProvider: "openrouter",
      requestedModel: "model-1",
      promptPolicyId: "prompt-1",
      workflowPolicyDigest: "5".repeat(64),
      codeRevision: "revision-1",
      determinism: {},
      concurrency: 1,
      timeoutSeconds: 60,
      maxAttempts: 2,
      corpusVersion: { identityDigest: "6".repeat(64) },
      terminalReport: null,
      cells: [
        {
          id: "run-cell-1",
          status: "COMPLETED",
          targetLanguageId: "language-es",
          targetLanguageSlug: "spanish",
          attemptCount: 1,
          errorCode: null,
          errorRetryable: null,
          corpusCell: {
            caseId: "case-1",
            collectionKey: "jesus-film",
            sourceTrackIdentity: "source-track-1",
            referenceTrackIdentity: "reference-track-1",
            sourceSnapshot: {
              sha256: "1".repeat(64),
              rawSha256: "2".repeat(64),
              clippedSha256: null,
            },
            referenceSnapshot: {
              sha256: "3".repeat(64),
              rawSha256: "4".repeat(64),
              clippedSha256: null,
            },
          },
          artifacts: [],
          machineAssessment: {
            resolvedModel: "model-1",
            usage: {},
            metrics: { quality: 4 },
          },
        },
      ],
    }
    const valid = {
      runId: "run-1",
      expectedStatus: "COMPLETED" as const,
      expectedCorpusIdentityDigest: "6".repeat(64),
      expectedSourceReferenceDigest: subtitleEvalCanonicalReportDigest(
        sourceReferenceDigests,
      ),
    }
    for (const invalid of [
      { ...valid, expectedStatus: "FAILED" as const },
      { ...valid, expectedCorpusIdentityDigest: "7".repeat(64) },
      { ...valid, expectedSourceReferenceDigest: "8".repeat(64) },
    ]) {
      const tx = {
        subtitleEvalRun: { findUnique: vi.fn().mockResolvedValue(run) },
      }
      await expect(
        withTransaction(tx).finalizeRun(invalid),
      ).rejects.toMatchObject({
        reason: "terminal_report_expectation_mismatch",
      })
    }
  })

  it("canonicalizes artifact-bearing runs independently of Prisma relation order and surrogate IDs", async () => {
    const cell = (caseId: string, languageId: string, suffix: string) => ({
      id: `db-run-cell-${suffix}`,
      status: "COMPLETED",
      targetLanguageId: languageId,
      targetLanguageSlug: languageId,
      attemptCount: 1,
      errorCode: null,
      errorRetryable: null,
      corpusCell: {
        caseId,
        collectionKey: "collection-1",
        sourceTrackIdentity: `source-track-${suffix}`,
        referenceTrackIdentity: `reference-track-${suffix}`,
        sourceSnapshot: {
          sha256: suffix.repeat(64),
          rawSha256: suffix.repeat(64),
          clippedSha256: null,
        },
        referenceSnapshot: {
          sha256: (suffix === "a" ? "c" : "d").repeat(64),
          rawSha256: (suffix === "a" ? "c" : "d").repeat(64),
          clippedSha256: null,
        },
      },
      artifacts: [
        {
          id: `db-artifact-${suffix}`,
          kind: "CELL_REPORT",
          sha256: (suffix === "a" ? "e" : "f").repeat(64),
          byteLength: 100n,
          mediaType: "application/json",
        },
      ],
      providerCalls: [
        {
          id: `db-provider-call-${suffix}`,
          leaseGeneration: 1,
          ...providerCallInput({
            providerResponseId: `generation-${suffix}`,
            requestDigest: (suffix === "a" ? "6" : "7").repeat(64),
          }),
        },
      ],
      machineAssessment: {
        providerRequestId: `provider-request-${suffix}`,
        providerResponseId: `provider-response-${suffix}`,
        assessmentDigest: (suffix === "a" ? "1" : "2").repeat(64),
        resolvedModel: "model-1",
        usage: { tokens: 1 },
        metrics: { quality: 4 },
        reproducibilityLimits: [`limit-${suffix}`],
      },
    })
    const cells = [
      cell("case-1", "language-es", "a"),
      cell("case-2", "language-fr", "b"),
    ]
    const sourceReference = cells
      .map((row) => ({
        caseId: row.corpusCell.caseId,
        targetLanguageId: row.targetLanguageId,
        targetLanguageSlug: row.targetLanguageSlug,
        sourceTrackIdentity: row.corpusCell.sourceTrackIdentity,
        referenceTrackIdentity: row.corpusCell.referenceTrackIdentity,
        sourceSnapshot: row.corpusCell.sourceSnapshot,
        referenceSnapshot: row.corpusCell.referenceSnapshot,
      }))
      .sort((left, right) => left.caseId.localeCompare(right.caseId))
    const finalize = async (orderedCells: typeof cells) => {
      const create = vi
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: "report-1", ...data }),
        )
      const tx = {
        subtitleEvalRun: {
          findUnique: vi.fn().mockResolvedValue({
            id: "run-1",
            requestedProvider: "openrouter",
            requestedModel: "model-1",
            promptPolicyId: "prompt-1",
            workflowPolicyDigest: "3".repeat(64),
            codeRevision: "revision-1",
            determinism: {},
            concurrency: 1,
            timeoutSeconds: 60,
            maxAttempts: 2,
            corpusVersion: { identityDigest: "4".repeat(64) },
            terminalReport: null,
            cells: orderedCells,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        subtitleEvalTerminalReport: { create },
      }
      const result = await withTransaction(tx).finalizeRun({
        runId: "run-1",
        expectedStatus: "COMPLETED",
        expectedCorpusIdentityDigest: "4".repeat(64),
        expectedSourceReferenceDigest:
          subtitleEvalCanonicalReportDigest(sourceReference),
      })
      return result.report
    }
    const first = await finalize(cells)
    const reversed = await finalize([...cells].reverse())
    const changedProvider = await finalize([
      {
        ...cells[0]!,
        providerCalls: [
          {
            ...cells[0]!.providerCalls[0]!,
            providerResponseId: "generation-changed",
          },
        ],
      },
      cells[1]!,
    ])
    expect(first.reportDigest).toBe(reversed.reportDigest)
    expect(changedProvider.reportDigest).not.toBe(first.reportDigest)
    expect(first.artifactInventory).toEqual(reversed.artifactInventory)
    expect(first.reproducibilityLimits).toEqual(["limit-a", "limit-b"])
    expect(JSON.stringify(first.artifactInventory)).not.toMatch(
      /db-artifact|db-run-cell/,
    )
    expect(JSON.stringify(first.providerIdentities)).not.toMatch(
      /db-provider-call|db-run-cell/,
    )
    expect(first.providerIdentities).toMatchObject({
      cells: [
        expect.objectContaining({
          providerRequestId: "provider-request-a",
          providerResponseId: "provider-response-a",
          assessmentDigest: "1".repeat(64),
        }),
        expect.objectContaining({
          providerRequestId: "provider-request-b",
          providerResponseId: "provider-response-b",
          assessmentDigest: "2".repeat(64),
        }),
      ],
    })
  })

  it("uses a CAS lease so only one stale-run recoverer can claim work", async () => {
    const tx = {
      subtitleEvalRun: {
        findUnique: vi.fn().mockResolvedValue({
          id: "run-1",
          status: "RUNNING",
          leaseGeneration: 3,
          leaseExpiresAt: new Date(0),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }
    await expect(
      withTransaction(tx).claimRunRecovery({
        user: managerBackend,
        runId: "run-1",
        leaseSeconds: 30,
      }),
    ).rejects.toMatchObject({ reason: "run_recovery_fence_lost" })
  })

  it("terminalizes an expired final-attempt cell and persists nonretryable recovery evidence", async () => {
    const tx = {
      subtitleEvalRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: "run-1",
          maxAttempts: 2,
          cells: [
            {
              id: "run-cell-1",
              status: "RUNNING",
              attemptCount: 2,
              leaseGeneration: 2,
              leaseExpiresAt: new Date(0),
            },
          ],
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      subtitleEvalRunCell: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      subtitleEvalAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    }
    const result = await withTransaction(tx).recoverRun({
      user: managerBackend,
      input: {
        runId: "run-1",
        leaseGeneration: 4,
        leaseToken: "recovery-token",
        actorId: "operator-1",
      },
    })
    expect(result).toMatchObject({
      terminalizedCellCount: 1,
      readyToFinalize: true,
    })
    expect(tx.subtitleEvalRunCell.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          errorRetryable: false,
          errorCode: "lease_expired_attempts_exhausted",
        }),
      }),
    )
  })

  it("reserves scheduled recovery for Manager backend service identity and fixes audit attribution", async () => {
    for (const managerRole of ["OPERATOR", "REVIEWER"] as const) {
      await expect(
        withTransaction({}).claimMachineRunRecovery({
          user: { id: "human-1", role: "VIEWER", managerRole },
          runId: "run-1",
          leaseSeconds: 30,
        }),
      ).rejects.toThrow()
    }

    const tx = {
      subtitleEvalRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: "run-1",
          maxAttempts: 2,
          cells: [],
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      subtitleEvalAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    }
    await withTransaction(tx).recoverMachineRun({
      user: managerBackend,
      input: {
        runId: "run-1",
        leaseGeneration: 1,
        leaseToken: "machine-recovery-token",
        dispatchFailed: true,
      },
    })
    expect(tx.subtitleEvalAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: "subtitle-eval-recovery-scheduler",
          requestId: "scheduled-recovery:run-1:1",
        }),
      }),
    )
  })

  it("consumes a delegated actor assertion once after a fresh membership recheck", async () => {
    const tx = {
      managerMembership: {
        findUnique: vi.fn().mockResolvedValue({
          id: "membership-1",
          role: "OPERATOR",
          revokedAt: null,
        }),
      },
      subtitleEvalDelegationNonce: {
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }
    await expect(
      withTransaction(tx).consumeDelegation({
        assertion: {
          actorId: "user-1",
          managerRole: "OPERATOR",
          operation: "CREATE_RUN",
          method: "POST",
          bodyDigest: "a".repeat(64),
          requestId: "request-1",
          nonceHash: "b".repeat(64),
          expiresAt: new Date(Date.now() + 60_000),
        },
        operation: "CREATE_RUN",
        method: "POST",
        bodyDigest: "a".repeat(64),
      }),
    ).rejects.toMatchObject({ reason: "delegation_assertion_replayed" })
    expect(tx.managerMembership.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1" } }),
    )
  })

  it.each([
    [
      "QUEUED",
      assignableRunCell({ status: "QUEUED" }),
      "assignment_cell_not_completed",
    ],
    [
      "RUNNING",
      assignableRunCell({ status: "RUNNING" }),
      "assignment_cell_not_completed",
    ],
    [
      "FAILED",
      assignableRunCell({ status: "FAILED" }),
      "assignment_cell_not_completed",
    ],
    [
      "missing candidate",
      assignableRunCell({ artifacts: [] }),
      "assignment_cell_evidence_incomplete",
    ],
    [
      "missing assessment",
      assignableRunCell({ machineAssessment: null }),
      "assignment_cell_evidence_incomplete",
    ],
    [
      "missing result digest",
      assignableRunCell({ resultDigest: null }),
      "assignment_cell_evidence_incomplete",
    ],
  ])(
    "rejects %s cells before creating reviewer work",
    async (_, cell, reason) => {
      const tx = {
        subtitleEvalAssignment: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn(),
        },
        subtitleEvalRunCell: {
          findUnique: vi.fn().mockResolvedValue(cell),
        },
        managerMembership: { findUnique: vi.fn().mockResolvedValue(null) },
      }

      await expect(
        withTransaction(tx).createAssignment({
          user: managerBackend,
          input: {
            idempotencyKey: "assignment-request-ineligible-cell",
            runCellId: "run-cell-1",
            reviewerMembershipId: "membership-1",
            kind: "STANDARD",
            assignedById: "operator-1",
          },
        }),
      ).rejects.toMatchObject({ reason })
      expect(tx.subtitleEvalAssignment.create).not.toHaveBeenCalled()
      expect(tx.subtitleEvalRunCell.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            artifacts: {
              where: { kind: "CANDIDATE_VTT" },
              select: { id: true },
              take: 2,
            },
            machineAssessment: { select: { id: true } },
          },
        }),
      )
    },
  )

  it("requires the reviewer grant to match both language id and slug", async () => {
    const tx = {
      subtitleEvalAssignment: { findUnique: vi.fn().mockResolvedValue(null) },
      subtitleEvalRunCell: {
        findUnique: vi.fn().mockResolvedValue(assignableRunCell()),
      },
      managerMembership: {
        findUnique: vi.fn().mockResolvedValue({
          id: "membership-1",
          role: "REVIEWER",
          revokedAt: null,
          reviewerLanguageGrants: [
            {
              languageId: "language-es",
              qualificationVersion: 1,
              scriptureSpecialist: false,
              theologySpecialist: false,
              language: { slug: "castilian", deletedAt: null },
            },
          ],
        }),
      },
    }
    await expect(
      withTransaction(tx).createAssignment({
        user: managerBackend,
        input: {
          idempotencyKey: "assignment-request-1",
          runCellId: "run-cell-1",
          reviewerMembershipId: "membership-1",
          kind: "STANDARD",
          assignedById: "operator-1",
        },
      }),
    ).rejects.toMatchObject({ reason: "reviewer_language_grant_missing" })
  })

  it("rejects assignments whose language grant cannot submit every base rubric dimension", async () => {
    const tx = {
      subtitleEvalAssignment: { findUnique: vi.fn().mockResolvedValue(null) },
      subtitleEvalRunCell: {
        findUnique: vi.fn().mockResolvedValue(assignableRunCell()),
      },
      managerMembership: {
        findUnique: vi.fn().mockResolvedValue({
          id: "membership-1",
          role: "REVIEWER",
          revokedAt: null,
          reviewerLanguageGrants: [
            {
              languageId: "language-es",
              qualificationVersion: 1,
              permittedRubricDimensions: ["MEANING_ACCURACY", "NATURALNESS"],
              scriptureSpecialist: false,
              theologySpecialist: false,
              language: { slug: "spanish", deletedAt: null },
            },
          ],
        }),
      },
    }
    await expect(
      withTransaction(tx).createAssignment({
        user: managerBackend,
        input: {
          idempotencyKey: "assignment-request-1",
          runCellId: "run-cell-1",
          reviewerMembershipId: "membership-1",
          kind: "STANDARD",
          assignedById: "operator-1",
        },
      }),
    ).rejects.toMatchObject({ reason: "reviewer_base_rubric_missing" })
  })

  it("requires specialist permission and the matching specialist capability at assignment time", async () => {
    const tx = {
      subtitleEvalAssignment: { findUnique: vi.fn().mockResolvedValue(null) },
      subtitleEvalRunCell: {
        findUnique: vi.fn().mockResolvedValue(assignableRunCell()),
      },
      managerMembership: {
        findUnique: vi.fn().mockResolvedValue({
          id: "membership-1",
          role: "REVIEWER",
          revokedAt: null,
          reviewerLanguageGrants: [
            {
              languageId: "language-es",
              qualificationVersion: 1,
              permittedRubricDimensions: [
                "MEANING_ACCURACY",
                "NATURALNESS",
                "TIMING_READABILITY",
                "SCRIPTURE_THEOLOGY",
              ],
              scriptureSpecialist: false,
              theologySpecialist: true,
              language: { slug: "spanish", deletedAt: null },
            },
          ],
        }),
      },
    }
    await expect(
      withTransaction(tx).createAssignment({
        user: managerBackend,
        input: {
          idempotencyKey: "assignment-request-1",
          runCellId: "run-cell-1",
          reviewerMembershipId: "membership-1",
          kind: "SPECIALIST",
          specialistDimension: "SCRIPTURE",
          assignedById: "operator-1",
        },
      }),
    ).rejects.toMatchObject({ reason: "specialist_qualification_missing" })
  })

  it("owns specialist presentation seeds and safely replays the same reviewer", async () => {
    const pending = {
      id: "specialist-assignment-1",
      kind: "SPECIALIST",
      status: "BLOCKED",
      reviewerMembershipId: null,
      targetLanguageId: "language-es",
      targetLanguageSlug: "spanish",
      specialistDimension: "SCRIPTURE",
    }
    const assigned = {
      ...pending,
      status: "ASSIGNED",
      reviewerMembershipId: "membership-1",
      presentationSeed: "admin-secret-seed",
    }
    const tx = {
      subtitleEvalAssignment: {
        findUnique: vi.fn().mockResolvedValue(pending),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(assigned),
      },
      managerMembership: {
        findUnique: vi.fn().mockResolvedValue({
          id: "membership-1",
          role: "REVIEWER",
          revokedAt: null,
          reviewerLanguageGrants: [
            {
              languageId: "language-es",
              qualificationVersion: 2,
              permittedRubricDimensions: [
                "MEANING_ACCURACY",
                "NATURALNESS",
                "TIMING_READABILITY",
                "SCRIPTURE_THEOLOGY",
              ],
              scriptureSpecialist: true,
              theologySpecialist: false,
              language: { slug: "spanish", deletedAt: null },
            },
          ],
        }),
      },
      subtitleEvalAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    }
    const result = await withTransaction(tx).assignPendingSpecialist({
      user: managerBackend,
      input: {
        assignmentId: pending.id,
        reviewerMembershipId: "membership-1",
        assignedById: "operator-1",
      },
    })
    expect(result).toMatchObject({ assignment: assigned, replayed: false })
    expect(tx.subtitleEvalAssignment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          presentationSeed: expect.any(String),
        }),
      }),
    )

    const replayService = withTransaction({
      subtitleEvalAssignment: {
        findUnique: vi.fn().mockResolvedValue(assigned),
      },
    })
    await expect(
      replayService.assignPendingSpecialist({
        user: managerBackend,
        input: {
          assignmentId: pending.id,
          reviewerMembershipId: "membership-1",
          assignedById: "operator-1",
        },
      }),
    ).resolves.toMatchObject({ assignment: assigned, replayed: true })

    await expect(
      replayService.assignPendingSpecialist({
        user: managerBackend,
        input: {
          assignmentId: pending.id,
          reviewerMembershipId: "membership-2",
          assignedById: "operator-1",
        },
      }),
    ).rejects.toMatchObject({
      reason: "specialist_assignment_reviewer_conflict",
    })
  })

  it("CAS-protects a pending specialist round from a competing reviewer", async () => {
    const pending = {
      id: "specialist-assignment-1",
      kind: "SPECIALIST",
      status: "BLOCKED",
      reviewerMembershipId: null,
      targetLanguageId: "language-es",
      targetLanguageSlug: "spanish",
      specialistDimension: "SCRIPTURE",
    }
    const wonByAnother = {
      ...pending,
      status: "ASSIGNED",
      reviewerMembershipId: "membership-2",
      presentationSeed: "first-writer-seed",
    }
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(wonByAnother)
    const tx = {
      subtitleEvalAssignment: {
        findUnique,
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      managerMembership: {
        findUnique: vi.fn().mockResolvedValue({
          id: "membership-1",
          role: "REVIEWER",
          revokedAt: null,
          reviewerLanguageGrants: [
            {
              languageId: "language-es",
              qualificationVersion: 2,
              permittedRubricDimensions: [
                "MEANING_ACCURACY",
                "NATURALNESS",
                "TIMING_READABILITY",
                "SCRIPTURE_THEOLOGY",
              ],
              scriptureSpecialist: true,
              theologySpecialist: false,
              language: { slug: "spanish", deletedAt: null },
            },
          ],
        }),
      },
    }
    await expect(
      withTransaction(tx).assignPendingSpecialist({
        user: managerBackend,
        input: {
          assignmentId: pending.id,
          reviewerMembershipId: "membership-1",
          assignedById: "operator-1",
        },
      }),
    ).rejects.toMatchObject({
      reason: "specialist_assignment_reviewer_conflict",
    })
    expect(tx.subtitleEvalAssignment.updateMany).toHaveBeenCalledOnce()
    expect(wonByAnother.presentationSeed).toBe("first-writer-seed")
  })

  it("lists only active reviewers qualified for the exact language id and slug", async () => {
    const base = {
      id: "membership-qualified",
      role: "REVIEWER",
      revokedAt: null,
      user: { name: "María Reviewer", email: "maria@example.com" },
      reviewerLanguageGrants: [
        {
          languageId: "language-es",
          revokedAt: null,
          qualificationVersion: 3,
          permittedRubricDimensions: [
            "MEANING_ACCURACY",
            "NATURALNESS",
            "TIMING_READABILITY",
            "SCRIPTURE_THEOLOGY",
          ],
          scriptureSpecialist: true,
          theologySpecialist: false,
          language: { slug: "spanish", deletedAt: null },
        },
      ],
      _count: { subtitleEvalAssignments: 2 },
    }
    const findMany = vi.fn().mockResolvedValue([
      base,
      {
        ...base,
        id: "membership-wrong-slug",
        reviewerLanguageGrants: [
          {
            ...base.reviewerLanguageGrants[0],
            language: { slug: "castilian", deletedAt: null },
          },
        ],
      },
      { ...base, id: "membership-revoked", revokedAt: new Date() },
      {
        ...base,
        id: "membership-unqualified",
        reviewerLanguageGrants: [
          {
            ...base.reviewerLanguageGrants[0],
            permittedRubricDimensions: ["MEANING_ACCURACY", "NATURALNESS"],
          },
        ],
      },
    ])
    const service = new SubtitleEvalService({
      managerMembership: { findMany },
    } as never)
    await expect(
      service.listOperatorReviewerCandidates({
        user: managerBackend,
        targetLanguageId: "language-es",
        targetLanguageSlug: "spanish",
        specialistDimension: "SCRIPTURE",
      }),
    ).resolves.toMatchObject({
      nodes: [
        {
          membershipId: "membership-qualified",
          targetLanguageId: "language-es",
          targetLanguageSlug: "spanish",
          qualificationVersion: 3,
          specialistCapabilities: ["SCRIPTURE"],
          activeAssignmentCount: 2,
        },
      ],
    })
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: "REVIEWER",
          revokedAt: null,
          reviewerLanguageGrants: {
            some: expect.objectContaining({
              languageId: "language-es",
              revokedAt: null,
              language: { slug: "spanish", deletedAt: null },
            }),
          },
        }),
      }),
    )
  })

  it("hides reviewer queue metadata after a qualification downgrade", async () => {
    const service = new SubtitleEvalService({
      managerMembership: {
        findUnique: vi.fn().mockResolvedValue({
          id: "membership-1",
          role: "REVIEWER",
          revokedAt: null,
          reviewerLanguageGrants: [
            {
              languageId: "language-es",
              qualificationVersion: 1,
              permittedRubricDimensions: ["MEANING_ACCURACY", "NATURALNESS"],
              scriptureSpecialist: false,
              theologySpecialist: false,
              language: { slug: "spanish", deletedAt: null },
            },
          ],
        }),
      },
      subtitleEvalAssignment: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "assignment-1",
            status: "ASSIGNED",
            kind: "STANDARD",
            specialistDimension: null,
            qualificationVersion: 2,
            round: 1,
            targetLanguageId: "language-es",
            targetLanguageSlug: "spanish",
            assignedAt: new Date(),
            submittedAt: null,
            runCell: {
              corpusCell: {
                caseId: "case-1",
                collectionKey: "jesus-film",
                videoId: "video-1",
              },
            },
          },
        ]),
      },
    } as never)
    await expect(
      service.listReviewerAssignments({ actorId: "reviewer-1" }),
    ).resolves.toEqual({ nodes: [], nextCursor: null })
  })

  it("scans past an all-ineligible reviewer queue page without hiding later work", async () => {
    const row = (id: string, qualificationVersion: number) => ({
      id,
      status: "ASSIGNED",
      kind: "STANDARD",
      specialistDimension: null,
      qualificationVersion,
      round: 1,
      targetLanguageId: "language-es",
      targetLanguageSlug: "spanish",
      assignedAt: new Date(),
      submittedAt: null,
      runCell: {
        corpusCell: {
          caseId: id,
          collectionKey: "jesus-film",
          videoId: "video-1",
        },
      },
    })
    const firstPage = Array.from({ length: 25 }, (_, index) =>
      row(`z-ineligible-${String(index).padStart(2, "0")}`, 2),
    )
    const findMany = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([row("a-eligible", 1)])
    const service = new SubtitleEvalService({
      managerMembership: {
        findUnique: vi.fn().mockResolvedValue({
          id: "membership-1",
          role: "REVIEWER",
          revokedAt: null,
          reviewerLanguageGrants: [
            {
              languageId: "language-es",
              qualificationVersion: 1,
              permittedRubricDimensions: [
                "MEANING_ACCURACY",
                "NATURALNESS",
                "TIMING_READABILITY",
              ],
              scriptureSpecialist: false,
              theologySpecialist: false,
              language: { slug: "spanish", deletedAt: null },
            },
          ],
        }),
      },
      subtitleEvalAssignment: { findMany },
    } as never)
    await expect(
      service.listReviewerAssignments({ actorId: "reviewer-1", limit: 1 }),
    ).resolves.toMatchObject({
      nodes: [{ id: "a-eligible" }],
      nextCursor: null,
    })
    expect(findMany).toHaveBeenCalledTimes(2)
  })

  it("replays an exact assignment request and rejects idempotency drift before creating another round", async () => {
    const original = {
      idempotencyKey: "assignment-request-1",
      runCellId: "run-cell-1",
      reviewerMembershipId: "membership-1",
      kind: "STANDARD" as const,
      specialistDimension: null,
      assignedById: "operator-1",
    }
    const existing = {
      id: "assignment-1",
      status: "ASSIGNED",
      requestDigest: subtitleEvalAssignmentRequestDigest(original),
      presentationSeed: "persisted-secret-seed",
    }
    const exactService = withTransaction({
      subtitleEvalAssignment: {
        findUnique: vi.fn().mockResolvedValue(existing),
      },
    })
    await expect(
      exactService.createAssignment({ user: managerBackend, input: original }),
    ).resolves.toMatchObject({ assignment: existing, replayed: true })

    await expect(
      exactService.createAssignment({
        user: managerBackend,
        input: { ...original, reviewerMembershipId: "membership-2" },
      }),
    ).rejects.toMatchObject({ reason: "assignment_idempotency_mismatch" })
  })

  it("rejects body mismatch before an ordinary service caller can append human evidence", async () => {
    const input = reviewInput()
    await expect(
      withTransaction({}).submitReview({
        assertion: {
          actorId: "user-1",
          assignmentId: "assignment-1",
          method: "POST",
          bodyDigest: "f".repeat(64),
          nonceHash: "e".repeat(64),
          requestId: "request-1",
          expiresAt: new Date(Date.now() + 60_000),
        },
        input: input as never,
      }),
    ).rejects.toThrow()
  })

  it("rejects an assertion nonce replay and resolves actor to membership inside the write transaction", async () => {
    const tx = reviewTx()
    ;(
      tx.subtitleEvalAssertionNonce.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      nonceHash: "e".repeat(64),
    })
    const input = reviewInput()
    await expect(
      withTransaction(tx).submitReview({
        assertion: {
          actorId: "user-1",
          assignmentId: "assignment-1",
          method: "POST",
          bodyDigest: input.bodyDigest as string,
          nonceHash: "e".repeat(64),
          requestId: "request-1",
          expiresAt: new Date(Date.now() + 60_000),
        },
        input: input as never,
      }),
    ).rejects.toMatchObject({ reason: "review_assertion_replayed" })
    expect(tx.subtitleEvalAssignment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          reviewerMembership: expect.objectContaining({ userId: "user-1" }),
        }),
      }),
    )
  })

  it("consumes a body-bound GET assertion while rechecking the reviewer inside the transaction", async () => {
    const tx = {
      subtitleEvalAssignment: {
        findFirst: vi.fn().mockResolvedValue(activeAssignment()),
        findUniqueOrThrow: vi.fn(),
      },
      subtitleEvalAssertionNonce: {
        findUnique: vi.fn().mockResolvedValue({ nonceHash: "used" }),
        create: vi.fn(),
      },
    }
    const service = withTransaction(tx)
    await expect(
      service.getReviewerAssignment({
        assertion: {
          actorId: "user-1",
          assignmentId: "assignment-1",
          method: "GET",
          bodyDigest: reviewerRequestBodyDigest(""),
          nonceHash: "e".repeat(64),
          requestId: "request-1",
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ).rejects.toMatchObject({ reason: "review_assertion_replayed" })
    expect(tx.subtitleEvalAssignment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          reviewerMembership: expect.objectContaining({ userId: "user-1" }),
        }),
      }),
    )
    expect(tx.subtitleEvalAssignment.findUniqueOrThrow).not.toHaveBeenCalled()

    await expect(
      service.getReviewerAssignment({
        assertion: {
          actorId: "user-1",
          assignmentId: "assignment-1",
          method: "GET",
          bodyDigest: reviewerRequestBodyDigest("not-empty"),
          nonceHash: "f".repeat(64),
          requestId: "request-1",
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ).rejects.toThrow()
  })

  it("returns only assignment-scoped opaque reviewer track handles before submission", async () => {
    const tx = {
      subtitleEvalAssignment: {
        findFirst: vi.fn().mockResolvedValue(activeAssignment()),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "assignment-1",
          status: "ASSIGNED",
          kind: "STANDARD",
          round: 1,
          targetLanguageId: "language-es",
          targetLanguageSlug: "spanish",
          presentationSeed: "secret-presentation-seed",
          reviews: [],
          runCell: {
            corpusCell: {
              caseId: "case-1",
              collectionKey: "jesus-film",
              videoId: "video-1",
              editionIdentity: "edition-core-1",
              sourceSnapshot: {
                id: "source-object-1",
                sha256: "a".repeat(64),
                byteLength: 10n,
                mediaType: "text/vtt",
              },
              referenceSnapshot: {
                id: "reference-object-1",
                sha256: "b".repeat(64),
                byteLength: 20n,
                mediaType: "text/vtt",
              },
            },
            artifacts: [
              {
                id: "candidate-object-1",
                kind: "CANDIDATE_VTT",
                sha256: "c".repeat(64),
                byteLength: 30n,
                mediaType: "text/vtt",
              },
            ],
          },
        }),
      },
      subtitleEvalAssertionNonce: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
    }
    const result = await withTransaction(tx).getReviewerAssignment({
      assertion: {
        actorId: "user-1",
        assignmentId: "assignment-1",
        method: "GET",
        bodyDigest: reviewerRequestBodyDigest(""),
        requestId: "request-1",
        nonceHash: "a".repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    expect(result).toMatchObject({
      sourceTrack: { label: "SOURCE", mediaType: "text/vtt" },
      trackA: { label: "A", mediaType: "text/vtt" },
      trackB: { label: "B", mediaType: "text/vtt" },
      editionIdentity: "edition-core-1",
      postSubmitReceipt: null,
    })
    for (const track of [result.sourceTrack, result.trackA, result.trackB]) {
      expect(Object.keys(track).sort()).toEqual([
        "contentId",
        "label",
        "mediaType",
      ])
    }
  })

  it.each([
    ["seed-0", "A", "B"],
    ["seed-1", "B", "A"],
  ])(
    "reveals reference/candidate provenance only after a stored review for seed %s",
    async (presentationSeed, referenceTrackLabel, candidateTrackLabel) => {
      const submittedAt = new Date("2026-08-20T12:00:00.000Z")
      const tx = {
        subtitleEvalAssignment: {
          findFirst: vi.fn().mockResolvedValue(activeAssignment("SUBMITTED")),
          findUniqueOrThrow: vi.fn().mockResolvedValue({
            id: "assignment-1",
            status: "SUBMITTED",
            kind: "STANDARD",
            round: 1,
            targetLanguageId: "language-es",
            targetLanguageSlug: "spanish",
            presentationSeed,
            reviews: [
              {
                id: "review-1",
                verdict: "PASS",
                submittedAt,
              },
            ],
            runCell: {
              corpusCell: {
                caseId: "case-1",
                collectionKey: "jesus-film",
                videoId: "video-1",
                editionIdentity: "edition-core-1",
                sourceSnapshot: {
                  id: "source-object-1",
                  mediaType: "text/vtt",
                },
                referenceSnapshot: {
                  id: "reference-object-1",
                  mediaType: "text/vtt",
                },
              },
              artifacts: [
                {
                  id: "candidate-object-1",
                  kind: "CANDIDATE_VTT",
                  mediaType: "text/vtt",
                },
              ],
              machineAssessment: {
                advisoryRiskFlags: ["SCRIPTURE_REFERENCE"],
                resolvedModel: "provider/model-1",
                assessmentDigest: "d".repeat(64),
              },
            },
          }),
        },
        subtitleEvalAssertionNonce: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({}),
        },
      }
      const result = await withTransaction(tx).getReviewerAssignment({
        assertion: {
          actorId: "user-1",
          assignmentId: "assignment-1",
          method: "GET",
          bodyDigest: reviewerRequestBodyDigest(""),
          requestId: "request-1",
          nonceHash: presentationSeed.repeat(12).slice(0, 64),
          expiresAt: new Date(Date.now() + 60_000),
        },
      })
      expect(result.postSubmitReceipt).toEqual({
        reviewId: "review-1",
        submittedAt,
        referenceTrackLabel,
        candidateTrackLabel,
        machineAdvisoryRiskFlags: ["SCRIPTURE_REFERENCE"],
        resolvedModel: "provider/model-1",
        assessmentDigest: "d".repeat(64),
      })
    },
  )

  it("does not disclose post-submit provenance for revoked or cross-assignment reviewer access", async () => {
    const tx = {
      subtitleEvalAssignment: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUniqueOrThrow: vi.fn(),
      },
      subtitleEvalAssertionNonce: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
    }
    await expect(
      withTransaction(tx).getReviewerAssignment({
        assertion: {
          actorId: "revoked-or-other-user",
          assignmentId: "assignment-1",
          method: "GET",
          bodyDigest: reviewerRequestBodyDigest(""),
          requestId: "request-1",
          nonceHash: "9".repeat(64),
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ).rejects.toThrow()
    expect(tx.subtitleEvalAssignment.findUniqueOrThrow).not.toHaveBeenCalled()
  })

  it("returns bounded playback context only for the exact frozen video edition", async () => {
    await expect(
      new SubtitleEvalService({} as never).getVideoContext({
        user: { id: "operator-1", role: "VIEWER", managerRole: "OPERATOR" },
        videoId: "video-core-1",
        editionIdentity: "edition-core-1",
      }),
    ).rejects.toThrow()
    const video = {
      coreId: "video-core-1",
      publishedAt: new Date(),
      deletedAt: null,
      restrictViewPlatforms: [],
      dubs: [
        {
          id: "wrong-edition-dub",
          published: true,
          deletedAt: null,
          duration: 70,
          lengthInMilliseconds: 70_000n,
          videoEdition: {
            coreId: "edition-other",
            deletedAt: null,
          },
          muxVideo: {
            assetId: "muxAssetWrong",
            playbackId: "muxPlaybackWrong",
            deletedAt: null,
          },
        },
        {
          id: "exact-edition-dub",
          published: true,
          deletedAt: null,
          duration: 61,
          lengthInMilliseconds: 61_000n,
          videoEdition: {
            coreId: "edition-core-1",
            deletedAt: null,
          },
          muxVideo: {
            assetId: "muxAssetExact",
            playbackId: "muxPlaybackExact",
            deletedAt: null,
          },
        },
      ],
    }
    const tx = { video: { findFirst: vi.fn().mockResolvedValue(video) } }
    await expect(
      new SubtitleEvalService(tx as never).getVideoContext({
        user: managerBackend,
        videoId: "video-core-1",
        editionIdentity: "edition-core-1",
      }),
    ).resolves.toEqual({
      muxAssetId: "muxAssetExact",
      playbackId: "muxPlaybackExact",
      durationSeconds: 61,
    })
    expect(tx.video.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ coreId: "video-core-1" }),
      }),
    )
  })

  it("returns null for wrong video/edition and unavailable playback context", async () => {
    const unavailable = {
      coreId: "video-core-1",
      publishedAt: new Date(),
      deletedAt: null,
      restrictViewPlatforms: [],
      dubs: [
        {
          id: "private-or-unavailable-dub",
          published: true,
          deletedAt: null,
          duration: 61,
          lengthInMilliseconds: 61_000n,
          videoEdition: {
            coreId: "edition-core-1",
            deletedAt: null,
          },
          muxVideo: {
            assetId: "muxAssetPrivate",
            playbackId: null,
            deletedAt: null,
          },
        },
      ],
    }
    for (const row of [
      null,
      { ...unavailable, coreId: "video-other" },
      unavailable,
    ]) {
      const tx = { video: { findFirst: vi.fn().mockResolvedValue(row) } }
      await expect(
        new SubtitleEvalService(tx as never).getVideoContext({
          user: managerBackend,
          videoId: "video-core-1",
          editionIdentity: "edition-core-1",
        }),
      ).resolves.toBeNull()
    }
  })

  it("appends a superseding review without updating the previous review", async () => {
    const tx = reviewTx()
    ;(
      tx.subtitleEvalAssignment.findFirst as ReturnType<typeof vi.fn>
    ).mockResolvedValue(activeAssignment("SUBMITTED"))
    const input = reviewInput({
      idempotencyKey: "review-request-2",
      supersedesReviewId: "review-previous",
    })
    await withTransaction(tx).submitReview({
      assertion: {
        actorId: "user-1",
        assignmentId: "assignment-1",
        method: "POST",
        bodyDigest: input.bodyDigest as string,
        nonceHash: "e".repeat(64),
        requestId: "request-1",
        expiresAt: new Date(Date.now() + 60_000),
      },
      input: input as never,
    })
    expect(tx.subtitleEvalHumanReview.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reviewerMembershipId: "membership-1",
          supersedesReviewId: "review-previous",
        }),
      }),
    )
    expect(
      (tx.subtitleEvalHumanReview as Record<string, unknown>).update,
    ).toBeUndefined()
    expect(tx.subtitleEvalAssignment.updateMany).toHaveBeenCalledWith({
      where: {
        escalatedFromReviewId: "review-previous",
        kind: "SPECIALIST",
        status: "BLOCKED",
        reviewerMembershipId: null,
      },
      data: {
        status: "CANCELLED",
        blockedReason: "Superseded by a newer source review.",
      },
    })
  })

  it("replaces a superseded specialist escalation with one linked to the new review", async () => {
    const tx = reviewTx()
    ;(
      tx.subtitleEvalAssignment.findFirst as ReturnType<typeof vi.fn>
    ).mockResolvedValue(activeAssignment("SUBMITTED"))
    const input = reviewInput({
      idempotencyKey: "review-request-2",
      supersedesReviewId: "review-previous",
      verdict: "SPECIALIST_REVIEW",
    })
    await withTransaction(tx).submitReview({
      assertion: {
        actorId: "user-1",
        assignmentId: "assignment-1",
        method: "POST",
        bodyDigest: input.bodyDigest as string,
        nonceHash: "f".repeat(64),
        requestId: "request-1",
        expiresAt: new Date(Date.now() + 60_000),
      },
      input: input as never,
    })
    expect(tx.subtitleEvalAssignment.updateMany).toHaveBeenCalledOnce()
    expect(tx.subtitleEvalAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "BLOCKED",
          escalatedFromReviewId: "review-1",
        }),
      }),
    )
  })

  it("creates reference issues and unassigned specialist rounds as separate effects", async () => {
    const referenceTx = reviewTx()
    const referenceInput = reviewInput({
      verdict: "REFERENCE_QUESTIONABLE",
      questionableTrack: reviewerReferenceTrackLabel(
        "review-seed",
        "assignment-1",
      ),
    })
    await withTransaction(referenceTx).submitReview({
      assertion: {
        actorId: "user-1",
        assignmentId: "assignment-1",
        method: "POST",
        bodyDigest: referenceInput.bodyDigest as string,
        nonceHash: "d".repeat(64),
        requestId: "request-1",
        expiresAt: new Date(Date.now() + 60_000),
      },
      input: referenceInput as never,
    })
    expect(referenceTx.subtitleEvalReferenceIssue.create).toHaveBeenCalledOnce()

    const specialistTx = reviewTx()
    const specialistInput = reviewInput({ verdict: "SPECIALIST_REVIEW" })
    await withTransaction(specialistTx).submitReview({
      assertion: {
        actorId: "user-1",
        assignmentId: "assignment-1",
        method: "POST",
        bodyDigest: specialistInput.bodyDigest as string,
        nonceHash: "c".repeat(64),
        requestId: "request-1",
        expiresAt: new Date(Date.now() + 60_000),
      },
      input: specialistInput as never,
    })
    expect(specialistTx.subtitleEvalAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "SPECIALIST",
          status: "BLOCKED",
          reviewerMembershipId: null,
          escalatedFromReviewId: "review-1",
        }),
      }),
    )
  })

  it("rejects recursive escalation from an existing specialist round", async () => {
    const tx = reviewTx()
    ;(
      tx.subtitleEvalAssignment.findFirst as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      ...activeAssignment(),
      kind: "SPECIALIST",
      specialistDimension: "SCRIPTURE_THEOLOGY",
      reviewerMembership: {
        reviewerLanguageGrants: [
          {
            ...activeAssignment().reviewerMembership.reviewerLanguageGrants[0],
            scriptureSpecialist: true,
            permittedRubricDimensions: [
              "MEANING_ACCURACY",
              "NATURALNESS",
              "TIMING_READABILITY",
              "SCRIPTURE_THEOLOGY",
            ],
          },
        ],
      },
    })
    const input = reviewInput({ verdict: "SPECIALIST_REVIEW" })
    await expect(
      withTransaction(tx).submitReview({
        assertion: {
          actorId: "user-1",
          assignmentId: "assignment-1",
          method: "POST",
          bodyDigest: input.bodyDigest as string,
          nonceHash: "b".repeat(64),
          requestId: "request-1",
          expiresAt: new Date(Date.now() + 60_000),
        },
        input: input as never,
      }),
    ).rejects.toMatchObject({
      reason: "specialist_assignment_cannot_reescalate",
    })
    expect(tx.subtitleEvalAssignment.create).not.toHaveBeenCalled()
  })

  it("uses an OPEN-status CAS so a competing reference disposition cannot overwrite evidence", async () => {
    const tx = {
      subtitleEvalReferenceIssue: {
        findUnique: vi.fn().mockResolvedValue({
          id: "issue-1",
          status: "OPEN",
          corpusCellId: "corpus-cell-1",
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUniqueOrThrow: vi.fn(),
      },
      subtitleEvalAuditEvent: { create: vi.fn() },
    }
    await expect(
      withTransaction(tx).dispositionReferenceIssue({
        user: managerBackend,
        input: {
          issueId: "issue-1",
          disposition: "REJECTED",
          reason: "Reference remains valid.",
          actorId: "operator-1",
        },
      }),
    ).rejects.toMatchObject({ reason: "reference_issue_already_disposed" })
    expect(tx.subtitleEvalReferenceIssue.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "issue-1", status: "OPEN" } }),
    )
    expect(tx.subtitleEvalAuditEvent.create).not.toHaveBeenCalled()
  })

  it("keeps an accepted source reference issue non-launchable until and after its corrected version is approved", async () => {
    const sourceCell = {
      corpusVersionId: "corpus-source",
      caseId: "jesus-film-1",
      targetLanguageId: "language-es",
      targetLanguageSlug: "spanish",
      referenceTrackIdentity: "track-reference-old",
      referenceSnapshot: { sha256: "a".repeat(64) },
    }
    const issueTx = {
      subtitleEvalReferenceIssue: {
        findUnique: vi.fn().mockResolvedValue({
          id: "issue-1",
          status: "OPEN",
          corpusCellId: "cell-source",
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "issue-1",
          status: "ACCEPTED",
          correctedCorpusVersionId: "corpus-corrected",
        }),
      },
      subtitleEvalCorpusCell: {
        findUnique: vi.fn().mockResolvedValue(sourceCell),
      },
      subtitleEvalCorpusVersion: {
        findUnique: vi.fn().mockResolvedValue({
          id: "corpus-corrected",
          status: "PROVISIONAL",
          supersedesVersionId: "corpus-source",
          cells: [
            {
              referenceTrackIdentity: "track-reference-corrected",
              referenceSnapshot: { sha256: "b".repeat(64) },
            },
          ],
        }),
      },
      subtitleEvalAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    }
    await withTransaction(issueTx).dispositionReferenceIssue({
      user: managerBackend,
      input: {
        issueId: "issue-1",
        disposition: "ACCEPTED",
        reason: "The human reference is wrong.",
        actorId: "operator-1",
        correctedCorpusVersionId: "corpus-corrected",
      },
    })
    expect(issueTx.subtitleEvalReferenceIssue.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "ACCEPTED" }),
      }),
    )
    expect(issueTx.subtitleEvalCorpusVersion.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          cells: expect.objectContaining({
            where: {
              caseId: "jesus-film-1",
              targetLanguageId: "language-es",
              targetLanguageSlug: "spanish",
            },
          }),
        }),
      }),
    )

    const input = {
      idempotencyKey: "run-after-accepted-issue",
      operatorId: "operator-1",
      corpusVersionId: "corpus-source",
      corpusCellIds: ["cell-source"],
      requestedProvider: "openrouter",
      requestedModel: "model-1",
      promptPolicyId: "prompt-1",
      workflowPolicyDigest: "e".repeat(64),
      codeRevision: "revision-1",
      concurrency: 1,
      timeoutSeconds: 60,
      maxAttempts: 2,
    }
    const acceptedIssueCount = vi.fn().mockResolvedValue(1)
    const runTx = {
      subtitleEvalRun: {
        findUnique: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({
          _sum: { estimatedSpendMicros: 0n },
        }),
        create: vi.fn(),
      },
      subtitleEvalCorpusCell: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "cell-source",
            caseId: "jesus-film-1",
            targetLanguageId: "language-es",
            targetLanguageSlug: "spanish",
          },
        ]),
      },
      subtitleEvalCorpusVersion: {
        findUnique: vi.fn().mockResolvedValue({ status: "APPROVED" }),
      },
      subtitleEvalReferenceIssue: { count: acceptedIssueCount },
    }
    await expect(
      withTransaction(runTx).createRun({ user: managerBackend, input }),
    ).rejects.toMatchObject({ reason: "corpus_not_effectively_approved" })
    expect(acceptedIssueCount).toHaveBeenCalledWith({
      where: {
        status: { not: "REJECTED" },
        corpusCell: { corpusVersionId: "corpus-source" },
      },
    })
    expect(runTx.subtitleEvalRun.create).not.toHaveBeenCalled()
  })

  it("rejects unrelated or unchanged corpus versions as reference corrections", async () => {
    const sourceCell = {
      corpusVersionId: "corpus-source",
      caseId: "jesus-film-1",
      targetLanguageId: "language-es",
      targetLanguageSlug: "spanish",
      referenceTrackIdentity: "track-reference-old",
      referenceSnapshot: { sha256: "a".repeat(64) },
    }
    for (const cells of [
      [],
      [
        {
          referenceTrackIdentity: sourceCell.referenceTrackIdentity,
          referenceSnapshot: { sha256: sourceCell.referenceSnapshot.sha256 },
        },
      ],
    ]) {
      const tx = {
        subtitleEvalReferenceIssue: {
          findUnique: vi.fn().mockResolvedValue({
            id: "issue-1",
            status: "OPEN",
            corpusCellId: "cell-source",
          }),
          updateMany: vi.fn(),
        },
        subtitleEvalCorpusCell: {
          findUnique: vi.fn().mockResolvedValue(sourceCell),
        },
        subtitleEvalCorpusVersion: {
          findUnique: vi.fn().mockResolvedValue({
            id: "corpus-corrected",
            status: "PROVISIONAL",
            supersedesVersionId: "corpus-source",
            cells,
          }),
        },
      }
      await expect(
        withTransaction(tx).dispositionReferenceIssue({
          user: managerBackend,
          input: {
            issueId: "issue-1",
            disposition: "ACCEPTED",
            reason: "The human reference is wrong.",
            actorId: "operator-1",
            correctedCorpusVersionId: "corpus-corrected",
          },
        }),
      ).rejects.toMatchObject({ reason: "invalid_corrected_corpus_version" })
      expect(tx.subtitleEvalReferenceIssue.updateMany).not.toHaveBeenCalled()
    }
  })

  it("derives candidate scores across both blind permutations and quarantines only the mapped reference", async () => {
    const seeds: string[] = []
    for (let index = 0; seeds.length < 2; index += 1) {
      const seed = `blind-seed-${index}`
      const label = reviewerReferenceTrackLabel(seed, "assignment-1")
      if (
        !seeds.some(
          (candidate) =>
            reviewerReferenceTrackLabel(candidate, "assignment-1") === label,
        )
      ) {
        seeds.push(seed)
      }
    }
    expect(
      seeds.map((seed) => reviewerReferenceTrackLabel(seed, "assignment-1")),
    ).toEqual(expect.arrayContaining(["A", "B"]))

    const assessment = (score: number) => ({
      meaningAccuracyScore: score,
      naturalnessScore: score,
      timingReadabilityScore: score,
      scriptureTheologyScore: null,
      issueCodes: score === 2 ? ["MISTRANSLATION"] : [],
      criticalMeaningLoss: score === 2,
      criticalHarmful: false,
      criticalScriptureRisk: false,
    })
    for (const seed of seeds) {
      const referenceTrack = reviewerReferenceTrackLabel(seed, "assignment-1")
      const candidateTrack = referenceTrack === "A" ? "B" : "A"
      for (const questionableTrack of [referenceTrack, candidateTrack]) {
        const tx = reviewTx()
        ;(
          tx.subtitleEvalAssignment.findFirst as ReturnType<typeof vi.fn>
        ).mockResolvedValue({ ...activeAssignment(), presentationSeed: seed })
        const input = reviewInput({
          idempotencyKey: `review-${seed}-${questionableTrack}`,
          verdict: "REFERENCE_QUESTIONABLE",
          questionableTrack,
          trackAssessments: {
            trackA: assessment(candidateTrack === "A" ? 2 : 5),
            trackB: assessment(candidateTrack === "B" ? 2 : 5),
          },
        })
        await withTransaction(tx).submitReview({
          assertion: {
            actorId: "user-1",
            assignmentId: "assignment-1",
            method: "POST",
            bodyDigest: input.bodyDigest as string,
            nonceHash: createHash("sha256")
              .update(`${seed}:${questionableTrack}`)
              .digest("hex"),
            requestId: `request-${seed}-${questionableTrack}`,
            expiresAt: new Date(Date.now() + 60_000),
          },
          input: input as never,
        })
        expect(tx.subtitleEvalHumanReview.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              meaningAccuracyScore: 2,
              naturalnessScore: 2,
              timingReadabilityScore: 2,
              issueCodes: ["MISTRANSLATION"],
              criticalMeaningLoss: true,
              questionableTrack,
            }),
          }),
        )
        expect(tx.subtitleEvalReferenceIssue.create).toHaveBeenCalledTimes(
          questionableTrack === referenceTrack ? 1 : 0,
        )
      }
    }
  })

  it("projects bounded reviewer notes and corrections into operator-only evidence", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: "assignment-1",
      presentationSeed: "operator-evidence-seed",
      status: "SUBMITTED",
      kind: "STANDARD",
      round: 1,
      specialistDimension: null,
      targetLanguageId: "language-es",
      targetLanguageSlug: "spanish",
      reviewerMembershipId: "membership-1",
      reviewerMembership: {
        user: { name: "Language reviewer", email: "reviewer@example.com" },
      },
      reviews: [
        {
          id: "review-1",
          rubricVersion: { version: 1 },
          meaningAccuracyScore: 4,
          naturalnessScore: 4,
          timingReadabilityScore: 3,
          scriptureTheologyScore: null,
          verdict: "NEEDS_CHANGES",
          issueCodes: ["TIMING"],
          criticalMeaningLoss: false,
          criticalHarmful: false,
          criticalScriptureRisk: false,
          trackAssessments: { trackA: {}, trackB: {} },
          questionableTrack: null,
          notes: "Timing needs a native-speaker pass.",
          corrections: [
            {
              segmentId: "segment-0001",
              track: "B",
              text: "Shorter subtitle",
            },
          ],
          submittedAt: new Date("2026-08-20T15:00:00.000Z"),
        },
      ],
      runCell: {
        corpusCell: {
          caseId: "jesus-film-1",
          collectionKey: "Jesus Film",
          videoId: "video-1",
          editionIdentity: "edition-1",
          metadata: {},
          sourceSnapshot: { id: "source-snapshot-1", mediaType: "text/vtt" },
          referenceSnapshot: {
            id: "reference-snapshot-1",
            mediaType: "text/vtt",
          },
        },
        machineAssessment: null,
        artifacts: [{ id: "candidate-artifact-1", mediaType: "text/vtt" }],
      },
    })
    const service = new SubtitleEvalService({
      subtitleEvalAssignment: { findUnique },
    } as never)

    const result = await service.getOperatorAssignment({
      user: managerBackend,
      assignmentId: "assignment-1",
    })

    expect(result?.reviews[0]).toMatchObject({
      notes: "Timing needs a native-speaker pass.",
      corrections: [
        {
          segmentId: "segment-0001",
          track: "B",
          text: "Shorter subtitle",
        },
      ],
      issueCodes: ["TIMING"],
    })
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          reviews: expect.objectContaining({
            select: expect.objectContaining({ notes: true, corrections: true }),
          }),
        }),
      }),
    )
  })

  it("computes deltas only for matched cells and lists unmatched cells", async () => {
    const report = (id: string, model: string, cells: unknown[]) => ({
      id,
      run: {
        corpusVersionId: "corpus-1",
        requestedProvider: "openrouter",
        requestedModel: model,
        promptPolicyId: "prompt-1",
        workflowPolicyDigest: "a".repeat(64),
        codeRevision: "revision-1",
        determinism: {},
        concurrency: 1,
        timeoutSeconds: 60,
        maxAttempts: 2,
        cells,
      },
    })
    const cell = (
      caseId: string,
      languageId: string,
      collectionKey: string,
      score: number,
    ) => ({
      status: "COMPLETED",
      targetLanguageId: languageId,
      corpusCell: { caseId, collectionKey },
      machineAssessment: { metrics: { quality: { score } } },
    })
    const create = vi
      .fn()
      .mockImplementation(({ data }) =>
        Promise.resolve({ id: "comparison-1", ...data }),
      )
    const tx = {
      subtitleEvalComparison: {
        findUnique: vi.fn().mockResolvedValue(null),
        create,
      },
      subtitleEvalAuditEvent: { create: vi.fn().mockResolvedValue({}) },
      subtitleEvalTerminalReport: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(
            report("report-a", "model-a", [
              cell("case-1", "language-es", "jesus-film", 1),
              cell("case-2", "language-fr", "lumo", 2),
            ]),
          )
          .mockResolvedValueOnce(
            report("report-b", "model-b", [
              cell("case-1", "language-es", "jesus-film", 3),
              cell("case-3", "language-de", "shorts", 4),
            ]),
          ),
      },
    }
    await withTransaction(tx).createComparison({
      user: managerBackend,
      input: {
        idempotencyKey: "comparison-request-1",
        baselineReportId: "report-a",
        candidateReportId: "report-b",
        changedAxis: "MODEL",
        createdById: "operator-1",
      },
    })
    const data = create.mock.calls[0]![0].data
    expect(data.matchedCellCount).toBe(1)
    expect(data.unmatchedCells).toEqual([
      { side: "baseline", key: "case-2:language-fr" },
      { side: "candidate", key: "case-3:language-de" },
    ])
    expect(data.descriptiveDeltas.cells[0].metrics).toEqual([
      { metric: "quality.score", baseline: 1, candidate: 3, delta: 2 },
    ])
  })

  it("projects live reviewed, pending, and unmatched human comparison evidence", async () => {
    const review = (
      verdict: "PASS" | "NEEDS_CHANGES" | "SPECIALIST_REVIEW",
      score: number,
    ) => ({
      id: `${verdict}-${score}`,
      verdict,
      meaningAccuracyScore: score,
      naturalnessScore: score,
      timingReadabilityScore: score,
      scriptureTheologyScore: null,
      submittedAt: new Date("2026-08-20T12:00:00.000Z"),
    })
    const cell = (
      caseId: string,
      reviews: ReturnType<typeof review>[],
      languageId = "language-es",
      specialistPending = false,
    ) => ({
      targetLanguageId: languageId,
      corpusCell: { caseId, collectionKey: "jesus-film" },
      assignments: [
        {
          kind: "STANDARD",
          round: 1,
          status: reviews.length > 0 ? "SUBMITTED" : "ASSIGNED",
          reviews: reviews.slice(0, 1),
        },
        ...(specialistPending
          ? [
              {
                kind: "SPECIALIST",
                round: 2,
                status: "BLOCKED",
                reviews: [],
              },
            ]
          : []),
      ],
    })
    const comparison = {
      id: "comparison-1",
      narratives: [],
      baselineReport: {
        run: {
          cells: [
            cell("reviewed", [review("NEEDS_CHANGES", 2)]),
            cell("pending", []),
            cell("escalated", [review("PASS", 4)]),
            cell("baseline-only", [review("PASS", 4)]),
          ],
        },
      },
      candidateReport: {
        run: {
          cells: [
            cell("reviewed", [review("PASS", 4)]),
            cell("pending", [review("PASS", 3)]),
            cell(
              "escalated",
              [review("SPECIALIST_REVIEW", 3)],
              undefined,
              true,
            ),
            cell("candidate-only", [review("PASS", 5)], "language-fr"),
          ],
        },
      },
    }
    const service = new SubtitleEvalService({
      subtitleEvalComparison: {
        findUnique: vi.fn().mockResolvedValue(comparison),
      },
    } as never)
    const result = await service.getComparison({
      user: managerBackend,
      id: "comparison-1",
    })
    expect(result?.humanEvidence).toMatchObject({
      mode: "LIVE_LATEST_NON_SUPERSEDED",
      reviewedPairCount: 1,
      pendingPairCount: 2,
      unmatchedPairCount: 2,
      cells: expect.arrayContaining([
        expect.objectContaining({
          key: "reviewed:language-es",
          status: "REVIEWED",
          verdictChanged: true,
          scoreDeltas: expect.arrayContaining([
            expect.objectContaining({
              metric: "meaningAccuracyScore",
              delta: 2,
            }),
          ]),
        }),
        expect.objectContaining({
          key: "pending:language-es",
          status: "PENDING",
        }),
        expect.objectContaining({
          key: "escalated:language-es",
          status: "PENDING",
          candidate: expect.objectContaining({
            status: "PENDING",
            reviewCount: 1,
            verdictCounts: { SPECIALIST_REVIEW: 1 },
          }),
        }),
      ]),
    })
  })

  it("rejects comparisons across different frozen corpus identities", async () => {
    const report = (id: string, corpusVersionId: string, identity: string) => ({
      id,
      corpusIdentityDigest: identity,
      run: {
        corpusVersionId,
        requestedProvider: "openrouter",
        requestedModel: id,
        promptPolicyId: "prompt-1",
        workflowPolicyDigest: "a".repeat(64),
        codeRevision: "revision-1",
        determinism: {},
        concurrency: 1,
        timeoutSeconds: 60,
        maxAttempts: 2,
        cells: [],
      },
    })
    const tx = {
      subtitleEvalComparison: { findUnique: vi.fn().mockResolvedValue(null) },
      subtitleEvalTerminalReport: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(report("report-a", "corpus-a", "a".repeat(64)))
          .mockResolvedValueOnce(
            report("report-b", "corpus-b", "b".repeat(64)),
          ),
      },
    }
    await expect(
      withTransaction(tx).createComparison({
        user: managerBackend,
        input: {
          idempotencyKey: "comparison-request-1",
          baselineReportId: "report-a",
          candidateReportId: "report-b",
          changedAxis: "MODEL",
          createdById: "operator-1",
        },
      }),
    ).rejects.toMatchObject({ reason: "comparison_corpus_identity_mismatch" })
  })

  it("rejects a reused comparison idempotency key when reports, axis, or author changes", async () => {
    const original = {
      idempotencyKey: "comparison-request-1",
      baselineReportId: "report-a",
      candidateReportId: "report-b",
      changedAxis: "MODEL" as const,
      createdById: "operator-1",
    }
    const mutations = [
      { ...original, baselineReportId: "report-c" },
      { ...original, candidateReportId: "report-c" },
      { ...original, changedAxis: "PROMPT_POLICY" as const },
      { ...original, createdById: "operator-2" },
    ]
    for (const request of mutations) {
      const tx = {
        subtitleEvalComparison: {
          findUnique: vi.fn().mockResolvedValue({
            id: "comparison-1",
            requestDigest: subtitleEvalComparisonRequestDigest(original),
          }),
        },
      }
      await expect(
        withTransaction(tx).createComparison({
          user: managerBackend,
          input: request,
        }),
      ).rejects.toMatchObject({ reason: "comparison_idempotency_mismatch" })
    }
  })

  it("keeps matching failed or unassessed cells out of comparison sufficiency", async () => {
    const run = (model: string) => ({
      corpusVersionId: "corpus-1",
      requestedProvider: "openrouter",
      requestedModel: model,
      promptPolicyId: "prompt-1",
      workflowPolicyDigest: "a".repeat(64),
      codeRevision: "revision-1",
      determinism: {},
      concurrency: 1,
      timeoutSeconds: 60,
      maxAttempts: 2,
      cells: Array.from({ length: 6 }, (_, index) => ({
        status: "FAILED",
        targetLanguageId: "language-es",
        corpusCell: {
          caseId: `case-${index}`,
          collectionKey: `collection-${index % 3}`,
        },
        machineAssessment: null,
      })),
    })
    const create = vi
      .fn()
      .mockImplementation(({ data }) =>
        Promise.resolve({ id: "comparison-1", ...data }),
      )
    const tx = {
      subtitleEvalComparison: {
        findUnique: vi.fn().mockResolvedValue(null),
        create,
      },
      subtitleEvalTerminalReport: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ id: "report-a", run: run("model-a") })
          .mockResolvedValueOnce({ id: "report-b", run: run("model-b") }),
      },
      subtitleEvalAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    }
    await withTransaction(tx).createComparison({
      user: managerBackend,
      input: {
        idempotencyKey: "comparison-request-failed",
        baselineReportId: "report-a",
        candidateReportId: "report-b",
        changedAxis: "MODEL",
        createdById: "operator-1",
      },
    })
    const data = create.mock.calls[0]![0].data
    expect(data.matchedCellCount).toBe(0)
    expect(data.matchedCollectionCount).toBe(0)
    expect(data.coverageLabel).toBe("INSUFFICIENT_EVIDENCE")
    expect(data.unmatchedCells).toHaveLength(6)
  })
})
