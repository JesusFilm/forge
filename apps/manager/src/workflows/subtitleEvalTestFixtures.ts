const sourceDigest = "1".repeat(64)
const sourceRawDigest = "2".repeat(64)
export const sourceClippedDigest = "3".repeat(64)
const referenceDigest = "4".repeat(64)
const referenceRawDigest = "5".repeat(64)
export const referenceClippedDigest = "6".repeat(64)

export function runFixture() {
  return {
    id: "run-1",
    status: "RUNNING",
    corpusVersionId: "corpus-1",
    requestedProvider: "openrouter",
    requestedModel: "google/gemini-2.5-flash",
    promptPolicyId: "subtitle-enrichment-production-v1",
    workflowPolicyDigest:
      "52e1ed3fea0be2fb9165c2bb6f4fc1fb58f107f6fe1692dd828ffb95e3e7a601",
    codeRevision: "revision-1",
    concurrency: 1,
    timeoutSeconds: 60,
    maxAttempts: 2,
    estimatedSpendMicros: "1000",
    createdAt: "2026-08-20T12:00:00.000Z",
    terminalAt: null,
    terminalReport: null,
    cells: [
      {
        id: "run-cell-1",
        status: "COMPLETED",
        attemptCount: 1,
        leaseGeneration: 2,
        errorCode: null,
        errorRetryable: null,
        resultDigest: "8".repeat(64),
        caseId: "case-1",
        collectionKey: "collection-1",
        videoId: "video-1",
        targetLanguageId: "language-es",
        targetLanguageSlug: "spanish",
        machineMetrics: {},
        providerRequestId: null,
        providerResponseId: null,
        assessmentDigest: "9".repeat(64),
        resolvedModel: null,
        reproducibilityLimits: ["Provider seed unavailable."],
        artifactDigests: [],
        assignmentCount: 0,
      },
    ],
  }
}

export function corpusFixture() {
  return {
    id: "corpus-1",
    status: "ACTIVE",
    identityDigest: "a".repeat(64),
    manifestDigest: "b".repeat(64),
    lockDigest: "c".repeat(64),
    authority: "provisional",
    certification: {},
    supersedesVersionId: null,
    approvedById: null,
    approvedAt: null,
    createdAt: "2026-08-20T12:00:00.000Z",
    cells: [
      {
        id: "corpus-cell-1",
        caseId: "case-1",
        collectionKey: "collection-1",
        videoId: "video-1",
        editionIdentity: "edition-1",
        sourceLanguageId: "language-en",
        sourceLanguageSlug: "english",
        sourceTrackIdentity: "source-subtitle-1",
        targetLanguageId: "language-es",
        targetLanguageSlug: "spanish",
        referenceTrackIdentity: "reference-subtitle-1",
        sourceSnapshotDigest: sourceDigest,
        sourceSnapshotRawDigest: sourceRawDigest,
        sourceSnapshotClippedDigest: sourceClippedDigest,
        referenceSnapshotDigest: referenceDigest,
        referenceSnapshotRawDigest: referenceRawDigest,
        referenceSnapshotClippedDigest: referenceClippedDigest,
        metadata: {
          schemaVersion: "subtitle-eval-corpus-cell/v1",
          targetBcp47: "es",
          sourceBcp47: "en",
          case: { id: "case-1" },
          sourceByteLength: 7,
          referenceByteLength: 7,
          sourceTrack: track("source", "en", "source-subtitle-1"),
          referenceTrack: track("reference", "es", "reference-subtitle-1"),
        },
      },
    ],
  }
}

function track(
  role: "source" | "reference",
  language: string,
  subtitleId: string,
) {
  return {
    role,
    language,
    coreLanguageId: language,
    subtitleId,
    videoId: "video-1",
    edition: "base",
    coreVideoEditionId: "edition-1",
    cueCount: 1,
  }
}
