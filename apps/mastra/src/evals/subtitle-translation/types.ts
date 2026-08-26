import { z } from "zod"

import { SubtitleTranslationContextSchema } from "../../services/subtitle-enrichment/types"

const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const CLOUD_CELL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/

export const SUBTITLE_EVAL_MAX_SNAPSHOT_BYTES = 512 * 1024
// Packaged gold tracks currently peak at 72 cues. This source-controlled cap
// limits both provider calls and the worst-case spend of one cloud cell.
export const SUBTITLE_EVAL_MAX_CUES_PER_TRACK = 80
export const SUBTITLE_EVAL_MAX_PROVIDER_CALLS_PER_CELL = 64
export const SUBTITLE_EVAL_MAX_CANDIDATE_BYTES = 1024 * 1024

export const SubtitleEvalLanguageSchema = z
  .object({
    bcp47: z.string().min(2).max(35),
    coreLanguageId: z.string().min(1),
    label: z.string().min(1).max(80),
  })
  .strict()

export const SubtitleEvalClipSchema = z
  .object({
    startSeconds: z.number().nonnegative(),
    endSeconds: z.number().positive(),
  })
  .strict()
  .refine((clip) => clip.endSeconds > clip.startSeconds, {
    message: "clip.endSeconds must be greater than clip.startSeconds",
  })

export const SubtitleEvalCaseSchema = z
  .object({
    id: z.string().regex(SAFE_ID_PATTERN),
    videoId: z.string().min(1),
    title: z.string().min(1).max(160),
    collection: z.string().min(1).max(160),
    edition: z.string().min(1),
    coreVideoEditionId: z.string().min(1),
    clip: SubtitleEvalClipSchema,
    translationContext: SubtitleTranslationContextSchema.optional(),
  })
  .strict()

export const SubtitleEvalManifestSchema = z
  .object({
    schemaVersion: z.literal("subtitle-translation-eval/v1"),
    referenceAuthority: z.enum(["provisional", "approved"]),
    referenceNotes: z.string().min(1).max(500),
    sourceLanguage: z.string().min(2).max(35),
    targetLanguages: z.array(z.string().min(2).max(35)).min(1),
    languages: z.array(SubtitleEvalLanguageSchema).min(2),
    cases: z.array(SubtitleEvalCaseSchema).min(1),
  })
  .strict()
  .superRefine((manifest, context) => {
    const languageCodes = manifest.languages.map((language) => language.bcp47)
    const duplicateLanguage = findDuplicate(languageCodes)
    if (duplicateLanguage) {
      context.addIssue({
        code: "custom",
        message: `Duplicate language definition: ${duplicateLanguage}`,
        path: ["languages"],
      })
    }

    const duplicateLanguageId = findDuplicate(
      manifest.languages.map((language) => language.coreLanguageId),
    )
    if (duplicateLanguageId) {
      context.addIssue({
        code: "custom",
        message: `Duplicate Core language id: ${duplicateLanguageId}`,
        path: ["languages"],
      })
    }

    if (!languageCodes.includes(manifest.sourceLanguage)) {
      context.addIssue({
        code: "custom",
        message: "sourceLanguage must have a language definition",
        path: ["sourceLanguage"],
      })
    }

    const duplicateTarget = findDuplicate(manifest.targetLanguages)
    if (duplicateTarget) {
      context.addIssue({
        code: "custom",
        message: `Duplicate target language: ${duplicateTarget}`,
        path: ["targetLanguages"],
      })
    }

    for (const target of manifest.targetLanguages) {
      if (target === manifest.sourceLanguage) {
        context.addIssue({
          code: "custom",
          message: "targetLanguages must not include sourceLanguage",
          path: ["targetLanguages"],
        })
      } else if (!languageCodes.includes(target)) {
        context.addIssue({
          code: "custom",
          message: `Missing language definition for target: ${target}`,
          path: ["targetLanguages"],
        })
      }
    }

    const duplicateCase = findDuplicate(manifest.cases.map((item) => item.id))
    if (duplicateCase) {
      context.addIssue({
        code: "custom",
        message: `Duplicate case id: ${duplicateCase}`,
        path: ["cases"],
      })
    }

    const duplicateVideoEdition = findDuplicate(
      manifest.cases.map(
        (item) => `${item.videoId}:${item.coreVideoEditionId}`,
      ),
    )
    if (duplicateVideoEdition) {
      context.addIssue({
        code: "custom",
        message: `Duplicate video edition: ${duplicateVideoEdition}`,
        path: ["cases"],
      })
    }
  })

export type SubtitleEvalManifest = z.infer<typeof SubtitleEvalManifestSchema>
export type SubtitleEvalCase = z.infer<typeof SubtitleEvalCaseSchema>

export const SubtitleEvalTrackLockSchema = z
  .object({
    caseId: z.string().regex(SAFE_ID_PATTERN),
    role: z.enum(["source", "reference"]),
    language: z.string().min(2).max(35),
    coreLanguageId: z.string().min(1),
    subtitleId: z.string().min(1),
    videoId: z.string().min(1),
    edition: z.string().min(1),
    coreVideoEditionId: z.string().min(1),
    primary: z.boolean(),
    updatedAt: z.string().min(1).optional(),
    sourceUrl: z.string().url(),
    sourceSha256: z.string().regex(SHA256_PATTERN),
    clippedSha256: z.string().regex(SHA256_PATTERN),
    cueCount: z.number().int().positive(),
    relativePath: z.string().regex(/^[a-z0-9][a-z0-9-]*\/[a-z0-9-]+\.vtt$/),
  })
  .strict()

export const SubtitleEvalCorpusLockSchema = z
  .object({
    schemaVersion: z.literal("subtitle-translation-eval-corpus-lock/v1"),
    manifestSha256: z.string().regex(SHA256_PATTERN),
    resolvedAt: z.string().datetime(),
    tracks: z.array(SubtitleEvalTrackLockSchema).min(1),
  })
  .strict()
  .superRefine((lock, context) => {
    const duplicateTrack = findDuplicate(
      lock.tracks.map((track) => `${track.caseId}:${track.language}`),
    )
    if (duplicateTrack) {
      context.addIssue({
        code: "custom",
        message: `Duplicate locked track: ${duplicateTrack}`,
        path: ["tracks"],
      })
    }
  })

export type SubtitleEvalCorpusLock = z.infer<
  typeof SubtitleEvalCorpusLockSchema
>
export type SubtitleEvalTrackLock = z.infer<typeof SubtitleEvalTrackLockSchema>

export type SubtitleEvalUsage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  retimeFallbackCount: number
}

export type SubtitleEvalAutomaticMetrics = {
  structural: {
    passed: boolean
    failures: string[]
    warnings: string[]
    sourceSpeechCoverage: number
  }
  text: {
    characterNgramFScore: number
    windowedCharacterNgramFScore: number
    generatedCharacterCount: number
    referenceCharacterCount: number
    lengthRatio: number | null
  }
  timing: {
    referenceOverlapPrecision: number
    referenceOverlapRecall: number
    boundaryMeanAbsoluteErrorSeconds: number | null
  }
  readability: {
    cueCount: number
    charactersPerSecondP50: number
    charactersPerSecondP95: number
    charactersPerSecondMax: number
    maximumLineLength: number
  }
}

export type SubtitleEvalCaseReport = {
  caseId: string
  title: string
  collection: string
  videoId: string
  edition: string
  targetLanguage: string
  status: "completed" | "failed"
  elapsedMs: number
  error?: string
  usage: SubtitleEvalUsage
  metrics?: SubtitleEvalAutomaticMetrics
  artifacts?: {
    generatedVtt: string
    humanReferenceVtt: string
  }
  humanReview: {
    status: "pending"
    rubricVersion: "subtitle-human-review/v1"
  }
}

export type SubtitleEvalReport = {
  schemaVersion: "subtitle-translation-eval-report/v1"
  runId: string
  createdAt: string
  manifestSha256: string
  corpusLockSha256: string
  referenceAuthority: "provisional" | "approved"
  model: string
  runtime: {
    sourceKind: "human_source_vtt"
    timeoutMs: number
    concurrency: number
  }
  codeRevision: string
  workingTreeDirty: boolean | null
  runtimePolicySha256: string
  selection: {
    caseIds: string[]
    targetLanguages: string[]
  }
  summary: {
    completed: number
    failed: number
    structuralPassed: number
    structuralFailed: number
    humanReviewPending: number
  }
  cases: SubtitleEvalCaseReport[]
}

export const SubtitleEvalUsageSchema = z
  .object({
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    retimeFallbackCount: z.number().int().nonnegative(),
  })
  .strict()

export const SubtitleEvalCloudUsageOperationSchema = z
  .object({
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    providerResponseCount: z.number().int().nonnegative().nullable(),
    unaccountedResponseCount: z.number().int().nonnegative(),
    accounting: z.enum([
      "instrumented",
      "reported",
      "not_invoked",
      "partial",
      "unavailable",
    ]),
  })
  .strict()

export const SubtitleEvalCloudProviderOperationSchema = z.enum([
  "scripture_detection",
  "translation",
  "retiming",
  "scripture_validation",
])

export const SubtitleEvalProviderCallSchema = z
  .object({
    callSequence: z.number().int().positive().max(1_000),
    operation: SubtitleEvalCloudProviderOperationSchema,
    chunkIndex: z.number().int().nonnegative().max(1_000).nullable(),
    operationAttempt: z.number().int().nonnegative().max(10),
    status: z.enum(["SUCCEEDED", "FAILED", "INVALID_OUTPUT"]),
    requestDigest: z.string().regex(SHA256_PATTERN),
    providerRequestId: z.string().min(1).max(191).nullable(),
    providerResponseId: z.string().min(1).max(191).nullable(),
    requestedModel: z.string().min(1).max(160),
    resolvedModel: z.string().min(1).max(160).nullable(),
    usage: z
      .object({
        promptTokens: z.number().int().nonnegative(),
        completionTokens: z.number().int().nonnegative(),
        totalTokens: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
  })
  .strict()

export type SubtitleEvalProviderCall = z.infer<
  typeof SubtitleEvalProviderCallSchema
>

export const SubtitleEvalCloudUsageSchema = SubtitleEvalUsageSchema.extend({
  operations: z
    .object({
      scriptureDetection: SubtitleEvalCloudUsageOperationSchema,
      translation: SubtitleEvalCloudUsageOperationSchema,
      retiming: SubtitleEvalCloudUsageOperationSchema,
      scriptureValidation: SubtitleEvalCloudUsageOperationSchema,
    })
    .strict(),
  coverage: z
    .object({
      status: z.enum(["complete", "partial"]),
      missingOperations: z.array(SubtitleEvalCloudProviderOperationSchema),
    })
    .strict(),
})
  .strict()
  .superRefine((usage, context) => {
    const operationEntries = [
      ["scripture_detection", usage.operations.scriptureDetection],
      ["translation", usage.operations.translation],
      ["retiming", usage.operations.retiming],
      ["scripture_validation", usage.operations.scriptureValidation],
    ] as const
    const totals = operationEntries.reduce(
      (sum, [, operation]) => ({
        promptTokens: sum.promptTokens + operation.promptTokens,
        completionTokens: sum.completionTokens + operation.completionTokens,
        totalTokens: sum.totalTokens + operation.totalTokens,
      }),
      { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    )
    if (
      usage.promptTokens !== totals.promptTokens ||
      usage.completionTokens !== totals.completionTokens ||
      usage.totalTokens !== totals.totalTokens
    ) {
      context.addIssue({
        code: "custom",
        path: ["operations"],
        message: "Cloud usage totals must equal per-operation totals",
      })
    }

    const missingOperations = operationEntries
      .filter(([, operation]) =>
        ["partial", "unavailable"].includes(operation.accounting),
      )
      .map(([operation]) => operation)
    if (
      usage.coverage.status !==
        (missingOperations.length === 0 ? "complete" : "partial") ||
      usage.coverage.missingOperations.join(",") !== missingOperations.join(",")
    ) {
      context.addIssue({
        code: "custom",
        path: ["coverage"],
        message: "Cloud usage coverage must match unavailable operations",
      })
    }
  })

export type SubtitleEvalCloudUsage = z.infer<
  typeof SubtitleEvalCloudUsageSchema
>

export const SubtitleEvalAutomaticMetricsSchema = z
  .object({
    structural: z
      .object({
        passed: z.boolean(),
        failures: z.array(z.string().min(1).max(120)).max(2_000),
        warnings: z.array(z.string().min(1).max(120)).max(2_000),
        sourceSpeechCoverage: z.number().finite(),
      })
      .strict(),
    text: z
      .object({
        characterNgramFScore: z.number().finite(),
        windowedCharacterNgramFScore: z.number().finite(),
        generatedCharacterCount: z.number().int().nonnegative(),
        referenceCharacterCount: z.number().int().nonnegative(),
        lengthRatio: z.number().finite().nullable(),
      })
      .strict(),
    timing: z
      .object({
        referenceOverlapPrecision: z.number().finite(),
        referenceOverlapRecall: z.number().finite(),
        boundaryMeanAbsoluteErrorSeconds: z.number().finite().nullable(),
      })
      .strict(),
    readability: z
      .object({
        cueCount: z.number().int().nonnegative(),
        charactersPerSecondP50: z.number().finite(),
        charactersPerSecondP95: z.number().finite(),
        charactersPerSecondMax: z.number().finite(),
        maximumLineLength: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()

export const SubtitleEvalCloudTrackIdentitySchema = z
  .object({
    role: z.enum(["source", "reference"]),
    language: z.string().min(2).max(35),
    coreLanguageId: z.string().min(1).max(128),
    subtitleId: z.string().min(1).max(128),
    videoId: z.string().min(1).max(128),
    edition: z.string().min(1).max(128),
    coreVideoEditionId: z.string().min(1).max(128),
    cueCount: z.number().int().positive().max(SUBTITLE_EVAL_MAX_CUES_PER_TRACK),
  })
  .strict()

export const SubtitleEvalCloudSnapshotSchema = z
  .object({
    body: z.string().min(1).max(SUBTITLE_EVAL_MAX_SNAPSHOT_BYTES),
    sha256: z.string().regex(SHA256_PATTERN),
    rawSha256: z.string().regex(SHA256_PATTERN),
    clippedSha256: z.string().regex(SHA256_PATTERN).optional(),
    byteLength: z
      .number()
      .int()
      .positive()
      .max(SUBTITLE_EVAL_MAX_SNAPSHOT_BYTES),
    mediaType: z.literal("text/vtt"),
    track: SubtitleEvalCloudTrackIdentitySchema,
  })
  .strict()

export const SubtitleEvalCloudCellRequestSchema = z
  .object({
    schemaVersion: z.literal("subtitle-translation-eval-cell-request/v1"),
    cellId: z.string().regex(CLOUD_CELL_ID_PATTERN),
    caseId: z.string().regex(SAFE_ID_PATTERN),
    manifestDigest: z.string().regex(SHA256_PATTERN),
    lockDigest: z.string().regex(SHA256_PATTERN),
    targetLanguage: z.string().min(2).max(35),
    provider: z.string().min(1).max(40),
    model: z.string().min(1).max(160),
    promptPolicyId: z.string().regex(SAFE_ID_PATTERN),
    workflowPolicyDigest: z.string().regex(SHA256_PATTERN),
    timeoutMs: z.number().int().min(60_000).max(600_000),
    concurrency: z.literal(1),
    source: SubtitleEvalCloudSnapshotSchema,
    reference: SubtitleEvalCloudSnapshotSchema,
  })
  .strict()

export type SubtitleEvalCloudCellRequest = z.infer<
  typeof SubtitleEvalCloudCellRequestSchema
>

export const SubtitleEvalReviewCueSchema = z
  .object({
    index: z.number().int().nonnegative(),
    start: z.number().finite().nonnegative(),
    end: z.number().finite().positive(),
    text: z.string().max(20_000),
  })
  .strict()

export const SubtitleEvalDiffOperationSchema = z
  .object({
    kind: z.enum(["equal", "insert", "delete"]),
    text: z.string().min(1).max(40_000),
  })
  .strict()

export const SubtitleEvalReviewSegmentSchema = z
  .object({
    id: z.string().regex(/^segment-[0-9]{4}$/),
    start: z.number().finite().nonnegative(),
    end: z.number().finite().positive(),
    source: z.array(SubtitleEvalReviewCueSchema).max(200),
    reference: z.array(SubtitleEvalReviewCueSchema).max(200),
    candidate: z.array(SubtitleEvalReviewCueSchema).max(200),
    lexicalDiff: z.array(SubtitleEvalDiffOperationSchema).max(4_096),
    timing: z
      .object({
        referenceStart: z.number().finite().nonnegative().nullable(),
        referenceEnd: z.number().finite().positive().nullable(),
        candidateStart: z.number().finite().nonnegative().nullable(),
        candidateEnd: z.number().finite().positive().nullable(),
        startDeltaSeconds: z.number().finite().nullable(),
        endDeltaSeconds: z.number().finite().nullable(),
      })
      .strict(),
    flags: z
      .array(
        z.enum([
          "text_diff",
          "timing_diff",
          "reference_only",
          "candidate_only",
        ]),
      )
      .max(4),
  })
  .strict()

export const SubtitleEvalReviewEvidenceSchema = z
  .object({
    schemaVersion: z.literal("subtitle-translation-review-evidence/v1"),
    alignment: z.literal("connected-time-overlap/v1"),
    diff: z.literal("intl-word-grapheme-safe/v1"),
    locale: z.string().min(2).max(35),
    segments: z
      .array(SubtitleEvalReviewSegmentSchema)
      .max(SUBTITLE_EVAL_MAX_CUES_PER_TRACK * 3),
  })
  .strict()

export type SubtitleEvalReviewEvidence = z.infer<
  typeof SubtitleEvalReviewEvidenceSchema
>

const ContentAddressedArtifactIdentitySchema = z
  .object({
    sha256: z.string().regex(SHA256_PATTERN),
    byteLength: z.number().int().nonnegative(),
  })
  .strict()

const ContentAddressedCandidateVttSchema =
  ContentAddressedArtifactIdentitySchema.extend({
    mediaType: z.literal("text/vtt"),
    body: z.string().max(SUBTITLE_EVAL_MAX_CANDIDATE_BYTES),
  }).strict()

const ContentAddressedReviewEvidenceSchema =
  ContentAddressedArtifactIdentitySchema.extend({
    mediaType: z.literal("application/json"),
    body: z.string().max(2 * 1024 * 1024),
  }).strict()

export const SubtitleEvalCloudFailureReasonSchema = z.enum([
  "invalid_input",
  "identity_mismatch",
  "unsupported_case",
  "unsupported_language",
  "unsupported_provider",
  "unsupported_model",
  "unsupported_prompt_policy",
  "unsupported_workflow_policy",
  "budget_exceeded",
  "payload_too_large",
  "provider_config_missing",
  "provider_auth_failed",
  "provider_failed",
  "provider_invalid_output",
  "scoring_failed",
  "serialization_failed",
  "execution_failed",
])

export const SubtitleEvalCloudFailureSchema = z
  .object({
    ok: z.literal(false),
    cellId: z.string().regex(CLOUD_CELL_ID_PATTERN).optional(),
    reason: SubtitleEvalCloudFailureReasonSchema,
    failureClass: z.enum(["deterministic", "retryable", "permanent"]),
    retryable: z.boolean(),
    message: z.string().min(1).max(200),
    providerCalls: z
      .array(SubtitleEvalProviderCallSchema)
      .max(SUBTITLE_EVAL_MAX_PROVIDER_CALLS_PER_CELL),
  })
  .strict()

export const SubtitleEvalCloudSuccessSchema = z
  .object({
    ok: z.literal(true),
    schemaVersion: z.literal("subtitle-translation-eval-cell-result/v1"),
    identityAttestation: z
      .object({
        cellId: z.string().regex(CLOUD_CELL_ID_PATTERN),
        caseId: z.string().regex(SAFE_ID_PATTERN),
        manifestDigest: z.string().regex(SHA256_PATTERN),
        lockDigest: z.string().regex(SHA256_PATTERN),
        targetLanguage: z.string().min(2).max(35),
        sourceSha256: z.string().regex(SHA256_PATTERN),
        referenceSha256: z.string().regex(SHA256_PATTERN),
        sourceSubtitleId: z.string().min(1).max(128),
        referenceSubtitleId: z.string().min(1).max(128),
      })
      .strict(),
    provider: z
      .object({
        name: z.literal("openrouter"),
        requestedModel: z.string().min(1).max(160),
        resolvedModel: z.string().min(1).max(160).nullable(),
      })
      .strict(),
    providerCalls: z
      .array(SubtitleEvalProviderCallSchema)
      .max(SUBTITLE_EVAL_MAX_PROVIDER_CALLS_PER_CELL),
    policy: z
      .object({
        promptPolicyId: z.string().regex(SAFE_ID_PATTERN),
        workflowPolicyDigest: z.string().regex(SHA256_PATTERN),
        workflowPolicyFiles: z.array(z.string().min(1).max(240)).min(1).max(40),
      })
      .strict(),
    build: z
      .object({
        codeRevision: z.string().min(1).max(128),
        buildId: z.string().min(1).max(128),
      })
      .strict(),
    determinism: z
      .object({
        temperature: z.literal(0),
        providerSeed: z.null(),
        concurrency: z.literal(1),
      })
      .strict(),
    runtime: z
      .object({ timeoutMs: z.number().int(), concurrency: z.literal(1) })
      .strict(),
    usage: SubtitleEvalCloudUsageSchema,
    metrics: SubtitleEvalAutomaticMetricsSchema,
    reviewEvidence: SubtitleEvalReviewEvidenceSchema,
    artifacts: z
      .object({
        candidateVtt: ContentAddressedCandidateVttSchema,
        reviewEvidence: ContentAddressedReviewEvidenceSchema,
      })
      .strict(),
    reproducibilityLimits: z.array(z.string().min(1).max(160)).max(10),
  })
  .strict()

export const SubtitleEvalCloudResultSchema = z.discriminatedUnion("ok", [
  SubtitleEvalCloudSuccessSchema,
  SubtitleEvalCloudFailureSchema,
])

export type SubtitleEvalCloudResult = z.infer<
  typeof SubtitleEvalCloudResultSchema
>

function findDuplicate(values: readonly string[]): string | undefined {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) return value
    seen.add(value)
  }
  return undefined
}
