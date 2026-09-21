import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  canonicalDigest,
  canonicalJson,
  sha256Bytes,
} from "@/features/subtitle-lab/subtitle-lab-contract"
import { parseLeaseDigest } from "@/features/subtitle-lab/subtitle-lab-admin-client"
import {
  executeSubtitleEvalCell,
  finalizeSubtitleEvalRun,
  type SubtitleEvalCellExecutionDeps,
  type SubtitleEvalWorkflowCell,
  type SubtitleEvalWorkflowInput,
} from "./subtitleEval"

const sourceBody = "WEBVTT\n"
const sourceDigest = sha256Bytes(sourceBody)
const run: SubtitleEvalWorkflowInput = {
  runId: "run-1",
  corpusIdentityDigest: "9".repeat(64),
  manifestDigest: "a".repeat(64),
  lockDigest: "b".repeat(64),
  requestedProvider: "openrouter",
  requestedModel: "google/gemini-2.5-flash",
  promptPolicyId: "subtitle-enrichment-production-v1",
  workflowPolicyDigest: "c".repeat(64),
  codeRevision: "revision-1",
  timeoutSeconds: 60,
  maxAttempts: 2,
  concurrency: 1,
  cells: [],
}
const cell: SubtitleEvalWorkflowCell = {
  runCellId: "cell-1",
  corpusCellId: "corpus-cell-1",
  caseId: "case-1",
  collectionKey: "collection-1",
  targetLanguageId: "admin-es",
  targetLanguageSlug: "spanish",
  targetBcp47: "es",
  source: snapshot("source", "en", "source-id"),
  reference: snapshot("reference", "es", "reference-id"),
}

describe("subtitle evaluation fenced cell workflow", () => {
  let deps: SubtitleEvalCellExecutionDeps
  let failCell: ReturnType<typeof vi.fn>
  let finalizeCell: ReturnType<typeof vi.fn>

  beforeEach(() => {
    failCell = vi.fn(async () => ({ status: "FAILED" }))
    finalizeCell = vi.fn(async () => ({ status: "COMPLETED" }))
    deps = {
      claimCell: vi.fn(async () => ({
        status: "RUNNING",
        digest: "1:lease-token:2026-08-20T12:00:00.000Z",
        replayed: false,
      })),
      failCell,
      finalizeCell,
      readArtifact: vi.fn(async () => new TextEncoder().encode(sourceBody)),
      runMastra: vi.fn(async () => successResult()),
      writeArtifact: vi.fn(async (input) => ({
        objectKey: `subtitle-eval/v1/${input.kind}/${sha256Bytes(input.body)}.${
          input.mediaType === "text/vtt" ? "vtt" : "json"
        }`,
        sha256: sha256Bytes(input.body),
        byteLength: new TextEncoder().encode(input.body).byteLength,
        mediaType: input.mediaType,
      })),
      canonicalDigest,
      canonicalJson,
      parseLeaseDigest,
      waitForRetry: vi.fn(async () => undefined),
    }
  })

  it("persists three immutable artifacts before fenced completion", async () => {
    await expect(executeSubtitleEvalCell(run, cell, deps)).resolves.toEqual({
      runCellId: "cell-1",
      status: "COMPLETED",
    })
    expect(deps.writeArtifact).toHaveBeenCalledTimes(3)
    expect(deps.runMastra).toHaveBeenCalledWith(
      expect.objectContaining({ codeRevision: run.codeRevision }),
    )
    expect(finalizeCell).toHaveBeenCalledWith(
      expect.objectContaining({
        runCellId: "cell-1",
        leaseGeneration: 1,
        leaseToken: "lease-token",
        artifacts: expect.arrayContaining([
          expect.objectContaining({ kind: "CANDIDATE_VTT" }),
          expect.objectContaining({ kind: "REVIEW_EVIDENCE" }),
          expect.objectContaining({ kind: "CELL_REPORT" }),
        ]),
      }),
    )
    expect(failCell).not.toHaveBeenCalled()
  })

  it("reclaims one retryable provider failure with a higher fence", async () => {
    vi.mocked(deps.claimCell)
      .mockResolvedValueOnce({
        status: "RUNNING",
        digest: "1:first:2026-08-20T12:00:00.000Z#1",
        replayed: false,
      })
      .mockResolvedValueOnce({
        status: "RUNNING",
        digest: "2:second:2026-08-20T12:01:00.000Z#2",
        replayed: false,
      })
    vi.mocked(deps.runMastra)
      .mockResolvedValueOnce({
        ok: false,
        cellId: "cell-1",
        reason: "provider_failed",
        failureClass: "retryable",
        retryable: true,
        message: "retry",
        providerCalls: [providerCall],
      })
      .mockResolvedValueOnce(successResult() as never)
    failCell.mockResolvedValueOnce({ status: "QUEUED" })
    await expect(
      executeSubtitleEvalCell(run, cell, deps),
    ).resolves.toMatchObject({
      status: "COMPLETED",
    })
    expect(failCell).toHaveBeenCalledWith(
      expect.objectContaining({
        leaseGeneration: 1,
        leaseToken: "first",
        retryable: true,
      }),
    )
    expect(finalizeCell).toHaveBeenCalledWith(
      expect.objectContaining({ leaseGeneration: 2, leaseToken: "second" }),
    )
    expect(deps.runMastra).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ executionAttempt: 1 }),
    )
    expect(deps.runMastra).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ executionAttempt: 2 }),
    )
  })

  it("keeps the execution key stable across an ambiguous transport retry", async () => {
    vi.mocked(deps.claimCell)
      .mockResolvedValueOnce({
        status: "RUNNING",
        digest: "1:first:2026-08-20T12:00:00.000Z#1",
        replayed: false,
      })
      .mockResolvedValueOnce({
        status: "RUNNING",
        digest: "2:second:2026-08-20T12:01:00.000Z#1",
        replayed: false,
      })
    vi.mocked(deps.runMastra)
      .mockResolvedValueOnce({
        ok: false,
        cellId: "cell-1",
        reason: "execution_in_progress",
        failureClass: "retryable",
        retryable: true,
        message: "response unavailable",
        providerCalls: [],
      })
      .mockResolvedValueOnce(successResult() as never)
    failCell.mockResolvedValueOnce({ status: "QUEUED" })

    await expect(
      executeSubtitleEvalCell(run, cell, deps),
    ).resolves.toMatchObject({ status: "COMPLETED" })
    expect(deps.runMastra).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ executionAttempt: 1 }),
    )
    expect(deps.runMastra).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ executionAttempt: 1 }),
    )
    expect(deps.waitForRetry).toHaveBeenCalledWith(1_000)
  })

  it("terminalizes artifact failures instead of leaving a running cell", async () => {
    vi.mocked(deps.runMastra).mockResolvedValueOnce({
      ...successResult(),
      providerCalls: [providerCall],
    })
    vi.mocked(deps.writeArtifact).mockRejectedValueOnce(
      Object.assign(new Error("collision"), {
        name: "SubtitleEvalArtifactCollisionError",
      }),
    )
    await expect(
      executeSubtitleEvalCell(run, cell, deps),
    ).resolves.toMatchObject({
      status: "FAILED",
    })
    expect(failCell).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "artifact_integrity_failed",
        retryable: false,
        providerCalls: [
          expect.objectContaining({
            operation: "TRANSLATION",
            providerResponseId: "generation-1",
          }),
        ],
      }),
    )
    expect(finalizeCell).not.toHaveBeenCalled()
  })

  it("rejects wrong-language provider attestation under the active fence", async () => {
    vi.mocked(deps.runMastra).mockResolvedValueOnce({
      ...successResult(),
      identityAttestation: {
        ...successResult().identityAttestation,
        targetLanguage: "fr",
      },
    } as never)
    await expect(
      executeSubtitleEvalCell(run, cell, deps),
    ).resolves.toMatchObject({
      status: "FAILED",
    })
    expect(failCell).toHaveBeenCalledWith(
      expect.objectContaining({ retryable: false }),
    )
  })

  it.each([
    ["code revision", { build: { codeRevision: "other", buildId: "build-1" } }],
    [
      "runtime timeout",
      { runtime: { timeoutMs: 59_999, concurrency: 1 as const } },
    ],
  ])("rejects a mismatched %s attestation", async (_label, override) => {
    vi.mocked(deps.runMastra).mockResolvedValueOnce({
      ...successResult(),
      ...override,
    } as never)

    await expect(
      executeSubtitleEvalCell(run, cell, deps),
    ).resolves.toMatchObject({
      status: "FAILED",
    })
    expect(deps.writeArtifact).not.toHaveBeenCalled()
    expect(failCell).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "manager_cell_failed" }),
    )
  })

  it.each(["candidateVtt", "reviewEvidence"] as const)(
    "rejects a false %s byte-length claim before storage",
    async (artifactName) => {
      const result = successResult()
      result.artifacts[artifactName].byteLength += 1
      vi.mocked(deps.runMastra).mockResolvedValueOnce(result as never)

      await expect(
        executeSubtitleEvalCell(run, cell, deps),
      ).resolves.toMatchObject({
        status: "FAILED",
      })
      expect(deps.writeArtifact).not.toHaveBeenCalled()
    },
  )

  it("rejects review evidence whose serialized projection differs", async () => {
    const result = successResult()
    result.artifacts.reviewEvidence.body = "{}"
    result.artifacts.reviewEvidence.sha256 = sha256Bytes("{}")
    result.artifacts.reviewEvidence.byteLength = 2
    vi.mocked(deps.runMastra).mockResolvedValueOnce(result as never)

    await expect(
      executeSubtitleEvalCell(run, cell, deps),
    ).resolves.toMatchObject({
      status: "FAILED",
    })
    expect(deps.writeArtifact).not.toHaveBeenCalled()
  })

  it("leaves an unclaimed cell recoverable when the Admin claim call throws", async () => {
    vi.mocked(deps.claimCell).mockRejectedValueOnce(
      new Error("admin unavailable"),
    )

    await expect(executeSubtitleEvalCell(run, cell, deps)).rejects.toThrow(
      /admin unavailable/i,
    )
    expect(failCell).not.toHaveBeenCalled()
  })

  it("leaves the active lease recoverable when Admin failure recording throws", async () => {
    vi.mocked(deps.runMastra).mockRejectedValueOnce(
      new Error("provider transport"),
    )
    failCell.mockRejectedValueOnce(new Error("admin unavailable"))

    await expect(executeSubtitleEvalCell(run, cell, deps)).rejects.toThrow(
      /admin unavailable/i,
    )
  })

  it("terminalizes under the same fence when Admin completion throws", async () => {
    vi.mocked(deps.runMastra).mockResolvedValueOnce({
      ...successResult(),
      providerCalls: [providerCall],
    })
    finalizeCell.mockRejectedValueOnce(
      new Error("admin completion unavailable"),
    )

    await expect(executeSubtitleEvalCell(run, cell, deps)).resolves.toEqual({
      runCellId: "cell-1",
      status: "FAILED",
    })
    expect(failCell).toHaveBeenCalledWith(
      expect.objectContaining({
        leaseGeneration: 1,
        leaseToken: "lease-token",
        providerCalls: [
          expect.objectContaining({ providerResponseId: "generation-1" }),
        ],
      }),
    )
  })

  describe("run terminal report", () => {
    const corpus = {
      identityDigest: "8".repeat(64),
      cells: [
        {
          id: "corpus-cell-1",
          caseId: "case-1",
          targetLanguageId: "admin-es",
          targetLanguageSlug: "spanish",
          sourceTrackIdentity: "source-id",
          referenceTrackIdentity: "reference-id",
          sourceSnapshotDigest: "1".repeat(64),
          sourceSnapshotRawDigest: "2".repeat(64),
          sourceSnapshotClippedDigest: null,
          referenceSnapshotDigest: "3".repeat(64),
          referenceSnapshotRawDigest: "4".repeat(64),
          referenceSnapshotClippedDigest: "5".repeat(64),
        },
      ],
    }

    it.each([
      [
        [{ id: "cell", corpusCellId: "corpus-cell-1", status: "COMPLETED" }],
        "COMPLETED",
      ],
      [
        [{ id: "cell", corpusCellId: "corpus-cell-1", status: "FAILED" }],
        "FAILED",
      ],
      [
        [
          { id: "cell", corpusCellId: "corpus-cell-1", status: "COMPLETED" },
          { id: "cell-2", corpusCellId: "corpus-cell-2", status: "FAILED" },
        ],
        "PARTIAL",
      ],
    ] as const)(
      "finalizes terminal cells as %s",
      async (cells, expectedStatus) => {
        const corpusForRun =
          cells.length === 1
            ? corpus
            : {
                ...corpus,
                cells: [
                  corpus.cells[0],
                  { ...corpus.cells[0], id: "corpus-cell-2", caseId: "case-2" },
                ],
              }
        const finalizeRun = vi.fn(async () => ({ status: expectedStatus }))
        await finalizeSubtitleEvalRun(run, {
          getRun: vi.fn(async () => ({
            id: run.runId,
            corpusVersionId: "corpus-1",
            terminalReport: null,
            cells: cells.map((runCell, index) => ({
              ...runCell,
              caseId: index === 0 ? "case-1" : "case-2",
              targetLanguageId: "admin-es",
              targetLanguageSlug: "spanish",
              reproducibilityLimits: [],
            })),
          })),
          getCorpusVersion: vi.fn(async () => corpusForRun),
          finalizeRun,
          canonicalDigest,
        })

        expect(finalizeRun).toHaveBeenCalledWith(
          expect.objectContaining({ expectedStatus }),
        )
      },
    )

    it.each([
      [
        { schemaVersion: 1 },
        [{ id: "cell", corpusCellId: "corpus-cell-1", status: "COMPLETED" }],
      ],
      [
        null,
        [{ id: "cell", corpusCellId: "corpus-cell-1", status: "RUNNING" }],
      ],
    ])(
      "does not replay or prematurely write a terminal report",
      async (terminalReport, cells) => {
        const finalizeRun = vi.fn()
        await finalizeSubtitleEvalRun(run, {
          getRun: vi.fn(async () => ({
            id: run.runId,
            corpusVersionId: "corpus-1",
            terminalReport,
            cells: cells.map((runCell) => ({
              ...runCell,
              caseId: "case-1",
              targetLanguageId: "admin-es",
              targetLanguageSlug: "spanish",
              reproducibilityLimits: [],
            })),
          })),
          getCorpusVersion: vi.fn(async () => corpus),
          finalizeRun,
          canonicalDigest,
        })

        expect(finalizeRun).not.toHaveBeenCalled()
      },
    )
  })
})

function snapshot(
  role: "source" | "reference",
  language: string,
  subtitleId: string,
) {
  return {
    objectKey: `subtitle-eval/v1/${role}/${sourceDigest}.vtt`,
    sha256: sourceDigest,
    rawSha256: sourceDigest,
    clippedSha256: sourceDigest,
    byteLength: 7,
    track: {
      role,
      language,
      coreLanguageId: language,
      subtitleId,
      videoId: "video-1",
      edition: "base",
      coreVideoEditionId: "edition-1",
      cueCount: 1,
    },
  }
}

function successResult() {
  const operation = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    providerResponseCount: 0,
    unaccountedResponseCount: 0,
    accounting: "not_invoked" as const,
  }
  const candidateBody = "WEBVTT\n"
  const reviewEvidence = {
    schemaVersion: "subtitle-translation-review-evidence/v1" as const,
    alignment: "connected-time-overlap/v1" as const,
    diff: "intl-word-grapheme-safe/v1" as const,
    locale: "es",
    segments: [],
  }
  const evidenceBody = canonicalJson(reviewEvidence)
  return {
    ok: true as const,
    schemaVersion: "subtitle-translation-eval-cell-result/v1" as const,
    identityAttestation: {
      cellId: cell.runCellId,
      caseId: cell.caseId,
      manifestDigest: run.manifestDigest,
      lockDigest: run.lockDigest,
      targetLanguage: cell.targetBcp47,
      sourceSha256: cell.source.sha256,
      referenceSha256: cell.reference.sha256,
      sourceSubtitleId: cell.source.track.subtitleId,
      referenceSubtitleId: cell.reference.track.subtitleId,
    },
    provider: {
      name: "openrouter" as const,
      requestedModel: run.requestedModel,
      resolvedModel: null,
    },
    providerCalls: [],
    policy: {
      promptPolicyId: run.promptPolicyId,
      workflowPolicyDigest: run.workflowPolicyDigest,
      workflowPolicyFiles: ["file.ts"],
    },
    build: { codeRevision: run.codeRevision, buildId: "build-1" },
    determinism: {
      temperature: 0 as const,
      providerSeed: null,
      concurrency: 1 as const,
    },
    runtime: { timeoutMs: 60_000, concurrency: 1 as const },
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      retimeFallbackCount: 0,
      operations: {
        scriptureDetection: operation,
        translation: operation,
        retiming: operation,
        scriptureValidation: operation,
      },
      coverage: { status: "complete" as const, missingOperations: [] },
    },
    metrics: {
      structural: {
        passed: true,
        failures: [],
        warnings: [],
        sourceSpeechCoverage: 1,
      },
      text: {
        characterNgramFScore: 1,
        windowedCharacterNgramFScore: 1,
        generatedCharacterCount: 1,
        referenceCharacterCount: 1,
        lengthRatio: 1,
      },
      timing: {
        referenceOverlapPrecision: 1,
        referenceOverlapRecall: 1,
        boundaryMeanAbsoluteErrorSeconds: 0,
      },
      readability: {
        cueCount: 1,
        charactersPerSecondP50: 1,
        charactersPerSecondP95: 1,
        charactersPerSecondMax: 1,
        maximumLineLength: 1,
      },
    },
    reviewEvidence,
    artifacts: {
      candidateVtt: {
        sha256: sha256Bytes(candidateBody),
        byteLength: 7,
        mediaType: "text/vtt" as const,
        body: candidateBody,
      },
      reviewEvidence: {
        sha256: sha256Bytes(evidenceBody),
        byteLength: new TextEncoder().encode(evidenceBody).byteLength,
        mediaType: "application/json" as const,
        body: evidenceBody,
      },
    },
    reproducibilityLimits: [],
  }
}

const providerCall = {
  callSequence: 1,
  operation: "translation" as const,
  chunkIndex: 0,
  operationAttempt: 0,
  status: "SUCCEEDED" as const,
  requestDigest: "d".repeat(64),
  providerRequestId: null,
  providerResponseId: "generation-1",
  requestedModel: run.requestedModel,
  resolvedModel: "provider/resolved-model",
  usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
}
