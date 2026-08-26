import { createHash } from "node:crypto"

import { z } from "zod"

export {
  SUBTITLE_EVAL_ALLOWED_MODELS,
  SUBTITLE_EVAL_ALLOWED_PROVIDER,
  SUBTITLE_EVAL_PROMPT_POLICY_ID,
  SUBTITLE_EVAL_WORKFLOW_POLICY_DIGEST,
} from "./subtitle-lab-policy"
import {
  SUBTITLE_EVAL_ALLOWED_MODELS,
  SUBTITLE_EVAL_ALLOWED_PROVIDER,
  SUBTITLE_EVAL_PROMPT_POLICY_ID,
  SUBTITLE_EVAL_WORKFLOW_POLICY_DIGEST,
} from "./subtitle-lab-policy"

export { buildSourceReferenceDigestVector } from "@/features/subtitle-lab/subtitle-eval-digest-vector"

export const SHA256 = z.string().regex(/^[a-f0-9]{64}$/)
export const BOUNDED_ID = z.string().trim().min(1).max(191)
export const subtitleLabPaginationSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(25),
    after: BOUNDED_ID.optional(),
  })
  .strict()

export const SUBTITLE_EVAL_MANIFEST_DIGEST =
  "e0b10ce064e93afc94c8bd6c549262b02abe032ef9098873f60ae2a03e37ced5"
export const SUBTITLE_EVAL_LOCK_DIGEST =
  "dc0a4fc55e00361b9e58b3c59699a5fe17ddcc0b74cd60646db4b7b4b9c195de"
export const subtitleEvalTrackSchema = z
  .object({
    caseId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    role: z.enum(["source", "reference"]),
    language: z.string().min(2).max(35),
    coreLanguageId: BOUNDED_ID,
    subtitleId: BOUNDED_ID,
    videoId: BOUNDED_ID,
    edition: BOUNDED_ID,
    coreVideoEditionId: BOUNDED_ID,
    primary: z.boolean(),
    sourceUrl: z.string().url(),
    sourceSha256: SHA256,
    clippedSha256: SHA256,
    cueCount: z.number().int().positive().max(1_000),
  })
  .strict()

export const subtitleEvalManifestSchema = z
  .object({
    schemaVersion: z.literal("subtitle-translation-eval/v1"),
    referenceAuthority: z.enum(["provisional", "approved"]),
    referenceNotes: z.string().min(1).max(500),
    sourceLanguage: z.string().min(2).max(35),
    targetLanguages: z.array(z.string().min(2).max(35)).min(1).max(20),
    languages: z
      .array(
        z
          .object({
            bcp47: z.string().min(2).max(35),
            coreLanguageId: BOUNDED_ID,
            label: z.string().min(1).max(80),
          })
          .strict(),
      )
      .min(2)
      .max(50),
    cases: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
            videoId: BOUNDED_ID,
            title: z.string().min(1).max(160),
            collection: z.string().min(1).max(160),
            edition: BOUNDED_ID,
            coreVideoEditionId: BOUNDED_ID,
            clip: z
              .object({
                startSeconds: z.number().nonnegative(),
                endSeconds: z.number().positive(),
              })
              .strict(),
            translationContext: z.record(z.string(), z.unknown()).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()

export const subtitleEvalLockSchema = z
  .object({
    schemaVersion: z.literal("subtitle-translation-eval-corpus-lock/v1"),
    manifestSha256: z.literal(SUBTITLE_EVAL_MANIFEST_DIGEST),
    resolvedAt: z.string().datetime(),
    tracks: z.array(subtitleEvalTrackSchema).min(1).max(100),
  })
  .strict()

export const languageIdentitySchema = z
  .object({
    bcp47: z.string().min(2).max(35),
    coreLanguageId: BOUNDED_ID,
    languageId: BOUNDED_ID,
    languageSlug: BOUNDED_ID,
  })
  .strict()

export const corpusActivationInputSchema = z
  .object({
    manifestJson: z.string().min(1).max(128_000),
    lockJson: z.string().min(1).max(256_000),
    languageIdentities: z.array(languageIdentitySchema).min(2).max(50),
    supersedesVersionId: BOUNDED_ID.optional(),
  })
  .strict()

export const createRunRequestSchema = z
  .object({
    idempotencyKey: BOUNDED_ID,
    corpusVersionId: BOUNDED_ID,
    corpusCellIds: z.array(BOUNDED_ID).min(1).max(20),
    requestedProvider: z.literal(SUBTITLE_EVAL_ALLOWED_PROVIDER),
    requestedModel: z.enum(SUBTITLE_EVAL_ALLOWED_MODELS),
    promptPolicyId: z.literal(SUBTITLE_EVAL_PROMPT_POLICY_ID),
    workflowPolicyDigest: z.literal(SUBTITLE_EVAL_WORKFLOW_POLICY_DIGEST),
    codeRevision: BOUNDED_ID.optional(),
    determinism: z
      .object({ temperature: z.literal(0), providerSeed: z.null() })
      .strict(),
    concurrency: z.number().int().min(1).max(3),
    timeoutSeconds: z.number().int().min(60).max(600),
    maxAttempts: z.number().int().min(1).max(2),
  })
  .strict()

export const assignmentRequestSchema = z
  .object({
    idempotencyKey: BOUNDED_ID,
    runCellId: BOUNDED_ID,
    reviewerMembershipId: BOUNDED_ID,
    kind: z.enum(["STANDARD", "SPECIALIST"]),
    specialistDimension: BOUNDED_ID.optional(),
  })
  .strict()

const reviewIssueCodeSchema = z.enum([
  "MISTRANSLATION",
  "OMISSION",
  "ADDITION",
  "TERMINOLOGY",
  "GRAMMAR",
  "NATURALNESS",
  "TONE_REGISTER",
  "TIMING",
  "LINE_BREAK",
  "READING_SPEED",
  "SCRIPTURE",
  "THEOLOGY",
  "REFERENCE_ERROR",
  "OTHER",
])

const blindTrackAssessmentSchema = z
  .object({
    meaningAccuracyScore: z.number().int().min(1).max(5),
    naturalnessScore: z.number().int().min(1).max(5),
    timingReadabilityScore: z.number().int().min(1).max(5),
    scriptureTheologyScore: z
      .number()
      .int()
      .min(1)
      .max(5)
      .nullable()
      .optional(),
    issueCodes: z.array(reviewIssueCodeSchema).max(14),
    criticalMeaningLoss: z.boolean(),
    criticalHarmful: z.boolean(),
    criticalScriptureRisk: z.boolean(),
  })
  .strict()

export const reviewSubmissionSchema = z
  .object({
    idempotencyKey: BOUNDED_ID,
    assignmentId: BOUNDED_ID,
    rubricVersion: z.number().int().positive().max(100),
    trackAssessments: z
      .object({
        trackA: blindTrackAssessmentSchema,
        trackB: blindTrackAssessmentSchema,
      })
      .strict(),
    verdict: z.enum([
      "PASS",
      "NEEDS_CHANGES",
      "REFERENCE_QUESTIONABLE",
      "SPECIALIST_REVIEW",
    ]),
    questionableTrack: z.enum(["A", "B"]).nullable().optional(),
    notes: z.string().max(4_000).nullable().optional(),
    corrections: z
      .array(
        z
          .object({
            segmentId: BOUNDED_ID,
            track: z.enum(["A", "B"]),
            text: z.string().max(1_000),
          })
          .strict(),
      )
      .max(100),
    supersedesReviewId: BOUNDED_ID.nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const requiresTrack = value.verdict === "REFERENCE_QUESTIONABLE"
    if (requiresTrack !== (value.questionableTrack != null)) {
      context.addIssue({
        code: "custom",
        path: ["questionableTrack"],
        message:
          "questionableTrack is required only for REFERENCE_QUESTIONABLE",
      })
    }
  })

export const operationResultSchema = z
  .object({
    id: BOUNDED_ID,
    status: z.string().min(1).max(64).nullable().optional(),
    digest: z.string().min(1).max(1_024).nullable().optional(),
    replayed: z.boolean(),
  })
  .strict()

export function resolveCreateRunRequest(
  value: unknown,
  deployedCodeRevision: string,
) {
  const parsed = createRunRequestSchema.parse(value)
  const revision = BOUNDED_ID.parse(deployedCodeRevision)
  if (parsed.codeRevision && parsed.codeRevision !== revision) {
    throw new Error("Run code revision did not match the deployed build.")
  }
  return { ...parsed, codeRevision: revision }
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`
  }
  if (typeof value === "bigint") return JSON.stringify(value.toString())
  return JSON.stringify(value)
}

export function sha256Bytes(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

export function canonicalDigest(value: unknown): string {
  return sha256Bytes(canonicalJson(value))
}

export function canonicalReviewSubmissionDigest(
  value: z.input<typeof reviewSubmissionSchema>,
): string {
  return canonicalDigest(normalizeReviewSubmission(value))
}

export function normalizeReviewSubmission(value: unknown) {
  const parsed = reviewSubmissionSchema.parse(value)
  return {
    ...parsed,
    trackAssessments: {
      trackA: {
        ...parsed.trackAssessments.trackA,
        scriptureTheologyScore:
          parsed.trackAssessments.trackA.scriptureTheologyScore ?? null,
      },
      trackB: {
        ...parsed.trackAssessments.trackB,
        scriptureTheologyScore:
          parsed.trackAssessments.trackB.scriptureTheologyScore ?? null,
      },
    },
    questionableTrack: parsed.questionableTrack ?? null,
    notes: parsed.notes ?? null,
    supersedesReviewId: parsed.supersedesReviewId ?? null,
  }
}
