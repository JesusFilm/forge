import { createHash, createHmac, randomUUID } from "node:crypto"
import {
  Prisma,
  type PrismaClient,
  type SubtitleEvalAssignmentKind,
  type SubtitleEvalChangedAxis,
} from "@prisma/client"
import { z } from "zod"

import type { Principal } from "@/auth/principal"
import type { VerifiedSubtitleEvalDelegation } from "@/auth/subtitle-eval-delegation-assertion"
import type { VerifiedSubtitleReviewAssertion } from "@/auth/subtitle-review-assertion"
import { env } from "@/config/env"
import { ForbiddenError, NotFoundError } from "@/services/errors"

const Digest = z.string().regex(/^[a-f0-9]{64}$/)
const BoundedId = z.string().trim().min(1).max(191)
const BoundedText = z.string().trim().min(1).max(4_000)
const JsonValue = z.unknown()
const RunTerminalStatus = z.enum(["COMPLETED", "PARTIAL", "FAILED"])
const AssignmentKind = z.enum(["STANDARD", "SPECIALIST"])
const SpecialistDimension = z.enum([
  "SCRIPTURE",
  "THEOLOGY",
  "SCRIPTURE_THEOLOGY",
])
const BASE_REVIEW_DIMENSIONS = [
  "MEANING_ACCURACY",
  "NATURALNESS",
  "TIMING_READABILITY",
] as const
const ChangedAxis = z.enum([
  "MODEL",
  "PROMPT_POLICY",
  "WORKFLOW_POLICY",
  "CODE_REVISION",
  "RUNTIME",
])
const ReviewVerdict = z.enum([
  "PASS",
  "NEEDS_CHANGES",
  "REFERENCE_QUESTIONABLE",
  "SPECIALIST_REVIEW",
])
const IssueCode = z.enum([
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

export const SUBTITLE_EVAL_SOURCE_CEILINGS = Object.freeze({
  maxCells: 20,
  minConcurrency: 1,
  maxConcurrency: 3,
  minTimeoutSeconds: 60,
  maxTimeoutSeconds: 600,
  maxAttempts: 2,
  maxActiveRunsPerOperator: 2,
  maxActiveRunsGlobal: 4,
  maxProviderCallsPerCellAttempt: 64,
  reservationPerProviderCallMicros: 25_000n,
  maxPerRunMicros: 64_000_000n,
  maxRolling24HourMicros: 256_000_000n,
  minReservationPerCellAttemptMicros: 64n * 25_000n,
})

type SubtitleEvalAdmissionEnv = {
  maxPerRunMicros?: string
  maxRolling24HourMicros?: string
  reservationPerCellAttemptMicros?: string
  maxActiveRunsPerOperator?: string | number
  maxActiveRunsGlobal?: string | number
}

export function resolveSubtitleEvalAdmissionPolicy(input?: {
  nodeEnv?: string
  env?: SubtitleEvalAdmissionEnv
}) {
  const nodeEnv = input?.nodeEnv ?? env.NODE_ENV
  const configured =
    input?.env ??
    ({
      maxPerRunMicros: env.SUBTITLE_EVAL_MAX_PER_RUN_MICROS,
      maxRolling24HourMicros: env.SUBTITLE_EVAL_MAX_ROLLING_24H_MICROS,
      reservationPerCellAttemptMicros:
        env.SUBTITLE_EVAL_RESERVATION_PER_CELL_ATTEMPT_MICROS,
      maxActiveRunsPerOperator: env.SUBTITLE_EVAL_MAX_ACTIVE_RUNS_PER_OPERATOR,
      maxActiveRunsGlobal: env.SUBTITLE_EVAL_MAX_ACTIVE_RUNS_GLOBAL,
    } satisfies SubtitleEvalAdmissionEnv)
  const missing = [
    configured.maxPerRunMicros,
    configured.maxRolling24HourMicros,
    configured.reservationPerCellAttemptMicros,
    configured.maxActiveRunsPerOperator,
    configured.maxActiveRunsGlobal,
  ].some((value) => value == null || value === "")
  if (nodeEnv === "production" && missing) {
    throw new SubtitleEvalConflictError(
      "admission_budget_configuration_missing",
    )
  }
  const positiveBigInt = (value: string | undefined, fallback: bigint) => {
    const parsed = value == null ? fallback : BigInt(value)
    if (parsed <= 0n)
      throw new SubtitleEvalConflictError("invalid_admission_budget")
    return parsed
  }
  const positiveInt = (
    value: string | number | undefined,
    fallback: number,
  ) => {
    const parsed = value == null ? fallback : Number(value)
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new SubtitleEvalConflictError("invalid_admission_budget")
    }
    return parsed
  }
  return {
    maxPerRunMicros: minBigInt(
      positiveBigInt(configured.maxPerRunMicros, 32_000_000n),
      SUBTITLE_EVAL_SOURCE_CEILINGS.maxPerRunMicros,
    ),
    maxRolling24HourMicros: minBigInt(
      positiveBigInt(configured.maxRolling24HourMicros, 128_000_000n),
      SUBTITLE_EVAL_SOURCE_CEILINGS.maxRolling24HourMicros,
    ),
    reservationPerCellAttemptMicros: maxBigInt(
      positiveBigInt(configured.reservationPerCellAttemptMicros, 1_600_000n),
      SUBTITLE_EVAL_SOURCE_CEILINGS.minReservationPerCellAttemptMicros,
    ),
    maxActiveRunsPerOperator: Math.min(
      positiveInt(configured.maxActiveRunsPerOperator, 1),
      SUBTITLE_EVAL_SOURCE_CEILINGS.maxActiveRunsPerOperator,
    ),
    maxActiveRunsGlobal: Math.min(
      positiveInt(configured.maxActiveRunsGlobal, 2),
      SUBTITLE_EVAL_SOURCE_CEILINGS.maxActiveRunsGlobal,
    ),
  }
}

function minBigInt(left: bigint, right: bigint) {
  return left < right ? left : right
}

function maxBigInt(left: bigint, right: bigint) {
  return left > right ? left : right
}

export function deriveSubtitleEvalTerminalStatus(
  statuses: readonly string[],
): "COMPLETED" | "PARTIAL" | "FAILED" {
  if (
    statuses.length === 0 ||
    statuses.some((status) => status !== "COMPLETED" && status !== "FAILED")
  ) {
    throw new SubtitleEvalConflictError("run_has_non_terminal_cells")
  }
  const completed = statuses.filter((status) => status === "COMPLETED").length
  if (completed === statuses.length) return "COMPLETED"
  if (completed === 0) return "FAILED"
  return "PARTIAL"
}

export function subtitleEvalCanonicalReportDigest(report: unknown) {
  return digest(report)
}

export function reviewerRequestBodyDigest(rawBody: string | Uint8Array) {
  return createHash("sha256").update(rawBody).digest("hex")
}

export function reviewerTrackObjectRequestDigest(input: {
  assignmentId: string
  contentId: string
}) {
  return digest(input)
}

export function comparisonCoverageLabel(
  matchedCells: number,
  matchedCollections: number,
) {
  return matchedCells >= 5 && matchedCollections >= 3
    ? ("SUFFICIENT" as const)
    : ("INSUFFICIENT_EVIDENCE" as const)
}

export function assertSubtitleEvalLaunchBounds(input: {
  cellCount: number
  concurrency: number
  timeoutSeconds: number
  maxAttempts: number
}) {
  if (
    input.cellCount < 1 ||
    input.cellCount > SUBTITLE_EVAL_SOURCE_CEILINGS.maxCells
  ) {
    throw new SubtitleEvalConflictError("cell_count_out_of_bounds")
  }
  if (
    input.concurrency < SUBTITLE_EVAL_SOURCE_CEILINGS.minConcurrency ||
    input.concurrency > SUBTITLE_EVAL_SOURCE_CEILINGS.maxConcurrency
  ) {
    throw new SubtitleEvalConflictError("concurrency_out_of_bounds")
  }
  if (
    input.timeoutSeconds < SUBTITLE_EVAL_SOURCE_CEILINGS.minTimeoutSeconds ||
    input.timeoutSeconds > SUBTITLE_EVAL_SOURCE_CEILINGS.maxTimeoutSeconds
  ) {
    throw new SubtitleEvalConflictError("timeout_out_of_bounds")
  }
  if (
    input.maxAttempts < 1 ||
    input.maxAttempts > SUBTITLE_EVAL_SOURCE_CEILINGS.maxAttempts
  ) {
    throw new SubtitleEvalConflictError("attempt_count_out_of_bounds")
  }
}

const SnapshotInput = z
  .object({
    kind: z.enum(["SOURCE", "REFERENCE"]),
    sha256: Digest,
    rawSha256: Digest,
    clippedSha256: Digest.nullable().optional(),
    objectKey: z.string().trim().min(1).max(1_024),
    byteLength: z.coerce.bigint().nonnegative(),
    mediaType: z.literal("text/vtt").default("text/vtt"),
  })
  .strict()

const CorpusCellInput = z
  .object({
    caseId: BoundedId,
    collectionKey: BoundedId,
    videoId: BoundedId,
    editionIdentity: BoundedId,
    sourceLanguageId: BoundedId,
    sourceLanguageSlug: BoundedId,
    sourceTrackIdentity: BoundedId,
    targetLanguageId: BoundedId,
    targetLanguageSlug: BoundedId,
    referenceTrackIdentity: BoundedId,
    sourceSnapshot: SnapshotInput.extend({ kind: z.literal("SOURCE") }),
    referenceSnapshot: SnapshotInput.extend({ kind: z.literal("REFERENCE") }),
    metadata: JsonValue.default({}),
  })
  .strict()

export const ImportSubtitleEvalCorpusInput = z
  .object({
    manifestDigest: Digest,
    lockDigest: Digest,
    authority: BoundedText,
    certification: JsonValue.default({}),
    supersedesVersionId: BoundedId.nullable().optional(),
    cells: z.array(CorpusCellInput).min(1).max(100),
  })
  .strict()

export const CreateSubtitleEvalRunInput = z
  .object({
    idempotencyKey: BoundedId,
    operatorId: BoundedId,
    corpusVersionId: BoundedId,
    corpusCellIds: z.array(BoundedId).min(1).max(20),
    requestedProvider: BoundedId,
    requestedModel: BoundedId,
    promptPolicyId: BoundedId,
    workflowPolicyDigest: Digest,
    codeRevision: BoundedId,
    determinism: JsonValue.default({}),
    concurrency: z.number().int(),
    timeoutSeconds: z.number().int(),
    maxAttempts: z.number().int(),
  })
  .strict()

const SubtitleEvalArtifactInput = z
  .object({
    kind: z.enum(["CANDIDATE_VTT", "REVIEW_EVIDENCE", "CELL_REPORT"]),
    sha256: Digest,
    objectKey: z.string().trim().min(1).max(1_024),
    byteLength: z.coerce.bigint().nonnegative(),
    mediaType: z.string().trim().min(1).max(191),
  })
  .strict()

const REQUIRED_SUBTITLE_EVAL_ARTIFACT_MEDIA_TYPES = {
  CANDIDATE_VTT: "text/vtt",
  REVIEW_EVIDENCE: "application/json",
  CELL_REPORT: "application/json",
} as const

const SubtitleEvalArtifactsInput = z
  .array(SubtitleEvalArtifactInput)
  .length(3)
  .superRefine((artifacts, ctx) => {
    const seen = new Set<string>()
    for (const [index, artifact] of artifacts.entries()) {
      if (seen.has(artifact.kind)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "kind"],
          message: "subtitle evaluation artifact kinds must be unique",
        })
      }
      seen.add(artifact.kind)
      if (
        artifact.mediaType !==
        REQUIRED_SUBTITLE_EVAL_ARTIFACT_MEDIA_TYPES[artifact.kind]
      ) {
        ctx.addIssue({
          code: "custom",
          path: [index, "mediaType"],
          message: `invalid media type for ${artifact.kind}`,
        })
      }
    }
    for (const kind of Object.keys(
      REQUIRED_SUBTITLE_EVAL_ARTIFACT_MEDIA_TYPES,
    )) {
      if (!seen.has(kind)) {
        ctx.addIssue({
          code: "custom",
          path: ["artifacts"],
          message: `missing required subtitle evaluation artifact ${kind}`,
        })
      }
    }
  })

export const FinalizeSubtitleEvalCellInput = z
  .object({
    runCellId: BoundedId,
    leaseGeneration: z.number().int().positive(),
    leaseToken: BoundedId,
    resultDigest: Digest,
    artifacts: SubtitleEvalArtifactsInput,
    providerCalls: z
      .array(
        z
          .object({
            callSequence: z.number().int().positive().max(1_000),
            operation: z.enum([
              "SCRIPTURE_DETECTION",
              "TRANSLATION",
              "RETIMING",
              "SCRIPTURE_VALIDATION",
            ]),
            chunkIndex: z.number().int().nonnegative().max(1_000).nullable(),
            operationAttempt: z.number().int().nonnegative().max(10),
            status: z.enum(["SUCCEEDED", "FAILED", "INVALID_OUTPUT"]),
            requestDigest: Digest,
            providerRequestId: BoundedId.nullable(),
            providerResponseId: BoundedId.nullable(),
            requestedModel: z.string().trim().min(1).max(160),
            resolvedModel: z.string().trim().min(1).max(160).nullable(),
            usage: z
              .object({
                promptTokens: z.number().int().nonnegative(),
                completionTokens: z.number().int().nonnegative(),
                totalTokens: z.number().int().nonnegative(),
              })
              .strict()
              .nullable(),
          })
          .strict(),
      )
      .max(SUBTITLE_EVAL_SOURCE_CEILINGS.maxProviderCallsPerCellAttempt)
      .refine(
        (calls) =>
          calls.every((call, index) => call.callSequence === index + 1),
        "provider call sequence must be contiguous and ordered",
      ),
    machineAssessment: z
      .object({
        schemaVersion: z.number().int().positive().max(100),
        metrics: JsonValue,
        advisoryRiskFlags: z
          .array(z.string().trim().min(1).max(191))
          .max(100)
          .default([]),
        usage: JsonValue.default({}),
        reproducibilityLimits: z
          .array(z.string().trim().min(1).max(1_000))
          .max(100),
        providerRequestId: BoundedId.nullable().optional(),
        providerResponseId: BoundedId.nullable().optional(),
        resolvedModel: BoundedId.nullable().optional(),
        assessmentDigest: Digest,
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const cellReport = value.artifacts.find(
      (artifact) => artifact.kind === "CELL_REPORT",
    )
    if (cellReport && cellReport.sha256 !== value.resultDigest) {
      ctx.addIssue({
        code: "custom",
        path: ["resultDigest"],
        message: "result digest must match the CELL_REPORT artifact digest",
      })
    }
  })

export const SubtitleEvalProviderCallsInput =
  FinalizeSubtitleEvalCellInput.shape.providerCalls

export const FinalizeSubtitleEvalRunInput = z
  .object({
    runId: BoundedId,
    expectedStatus: RunTerminalStatus,
    expectedCorpusIdentityDigest: Digest,
    expectedSourceReferenceDigest: Digest,
    reproducibilityLimits: z.array(z.string().max(1_000)).max(100).default([]),
  })
  .strict()

export const SubtitleEvalCertification = z
  .object({
    schemaVersion: z.literal(1),
    authority: BoundedText,
    sourceTracksVerified: z.number().int().positive().max(100),
    referenceTracksVerified: z.number().int().positive().max(100),
    humanAuthorshipConfirmed: z.literal(true),
    languageIdentityConfirmed: z.literal(true),
    certifiedAt: z.coerce.date(),
    notes: z.string().trim().max(4_000).nullable().optional(),
  })
  .strict()

const Correction = z
  .object({
    segmentId: BoundedId,
    track: z.enum(["A", "B"]),
    text: z.string().max(1_000),
  })
  .strict()

const BlindTrackAssessment = z
  .object({
    meaningAccuracyScore: z.number().int().min(1).max(5),
    naturalnessScore: z.number().int().min(1).max(5),
    timingReadabilityScore: z.number().int().min(1).max(5),
    scriptureTheologyScore: z.number().int().min(1).max(5).nullable(),
    issueCodes: z.array(IssueCode).max(14).default([]),
    criticalMeaningLoss: z.boolean().default(false),
    criticalHarmful: z.boolean().default(false),
    criticalScriptureRisk: z.boolean().default(false),
  })
  .strict()

const SubtitleEvalReviewSemanticInput = z
  .object({
    idempotencyKey: BoundedId,
    assignmentId: BoundedId,
    rubricVersion: z.number().int().positive(),
    trackAssessments: z
      .object({
        trackA: BlindTrackAssessment,
        trackB: BlindTrackAssessment,
      })
      .strict(),
    verdict: ReviewVerdict,
    questionableTrack: z.enum(["A", "B"]).nullable().default(null),
    notes: z.string().max(4_000).nullable().optional(),
    corrections: z.array(Correction).max(100).default([]),
    supersedesReviewId: BoundedId.nullable().optional(),
  })
  .strict()

function validateQuestionableTrack(
  value: z.infer<typeof SubtitleEvalReviewSemanticInput>,
  ctx: z.RefinementCtx,
) {
  const requiresTrack = value.verdict === "REFERENCE_QUESTIONABLE"
  if (requiresTrack !== (value.questionableTrack != null)) {
    ctx.addIssue({
      code: "custom",
      path: ["questionableTrack"],
      message: "questionableTrack is required only for REFERENCE_QUESTIONABLE",
    })
  }
}

export const SubmitSubtitleEvalReviewInput =
  SubtitleEvalReviewSemanticInput.extend({ bodyDigest: Digest }).superRefine(
    (value, ctx) => {
      validateQuestionableTrack(value, ctx)
    },
  )

export function canonicalReviewerSubmissionDigest(
  input: Omit<z.input<typeof SubmitSubtitleEvalReviewInput>, "bodyDigest">,
) {
  return digest(
    SubtitleEvalReviewSemanticInput.superRefine(
      validateQuestionableTrack,
    ).parse(input),
  )
}

export class SubtitleEvalConflictError extends Error {
  constructor(public readonly reason: string) {
    super(`Subtitle evaluation conflict: ${reason}`)
    this.name = "SubtitleEvalConflictError"
  }
}

function inputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`
  }
  if (typeof value === "bigint") return JSON.stringify(value.toString())
  return JSON.stringify(value)
}

function digest(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex")
}

export function opaqueReviewerTrackId(
  presentationSeed: string,
  input: {
    assignmentId: string
    role: "SOURCE" | "REFERENCE" | "CANDIDATE"
    objectIdentity: string
  },
) {
  return createHmac("sha256", presentationSeed)
    .update(stableJson(input))
    .digest("hex")
}

export function reviewerReferenceTrackLabel(
  presentationSeed: string,
  assignmentId: string,
): "A" | "B" {
  return Number.parseInt(
    digest({ seed: presentationSeed, assignmentId }).slice(0, 2),
    16,
  ) %
    2 ===
    0
    ? "A"
    : "B"
}

export function subtitleEvalRunRequestDigest(input: {
  operatorId: string
  corpusVersionId: string
  corpusCellIds: readonly string[]
  requestedProvider: string
  requestedModel: string
  promptPolicyId: string
  workflowPolicyDigest: string
  codeRevision: string
  determinism?: unknown
  concurrency: number
  timeoutSeconds: number
  maxAttempts: number
}) {
  return digest({
    operatorId: input.operatorId,
    corpusVersionId: input.corpusVersionId,
    corpusCellIds: [...input.corpusCellIds].sort(),
    requestedProvider: input.requestedProvider,
    requestedModel: input.requestedModel,
    promptPolicyId: input.promptPolicyId,
    workflowPolicyDigest: input.workflowPolicyDigest,
    codeRevision: input.codeRevision,
    determinism: input.determinism ?? {},
    concurrency: input.concurrency,
    timeoutSeconds: input.timeoutSeconds,
    maxAttempts: input.maxAttempts,
  })
}

export function subtitleEvalAssignmentRequestDigest(input: {
  runCellId: string
  reviewerMembershipId: string
  kind: SubtitleEvalAssignmentKind
  specialistDimension?: string | null
  assignedById: string
}) {
  return digest({
    assignedById: input.assignedById,
    kind: input.kind,
    reviewerMembershipId: input.reviewerMembershipId,
    runCellId: input.runCellId,
    specialistDimension: input.specialistDimension ?? null,
  })
}

export function subtitleEvalComparisonRequestDigest(input: {
  baselineReportId: string
  candidateReportId: string
  changedAxis: string
  createdById: string
}) {
  return digest({
    baselineReportId: input.baselineReportId,
    candidateReportId: input.candidateReportId,
    changedAxis: input.changedAxis,
    createdById: input.createdById,
  })
}

function leaseTokenHash(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function assertOperatorOrManagerBackend(user: Principal | null) {
  if (
    user?.role !== "ADMIN" &&
    user?.role !== "MANAGER_BACKEND" &&
    user?.managerRole !== "OPERATOR"
  ) {
    throw new ForbiddenError()
  }
}

function assertManagerBackend(user: Principal | null) {
  if (user?.role !== "MANAGER_BACKEND") throw new ForbiddenError()
}

const ACTIVE_RUN_STATUSES = ["QUEUED", "RUNNING"] as const

export class SubtitleEvalService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Manager-BFF-only playback lookup bound to the corpus cell's frozen Core
   * video and edition identities. Mux policy is not stored in Admin, so U4
   * must re-fetch the returned asset and require a matching public playback id
   * before sending playback context to the browser.
   */
  async getVideoContext(input: {
    user: Principal | null
    videoId: string
    editionIdentity: string
  }) {
    assertManagerBackend(input.user)
    const videoId = BoundedId.parse(input.videoId)
    const editionIdentity = BoundedId.parse(input.editionIdentity)
    const video = await this.prisma.video.findFirst({
      where: {
        coreId: videoId,
        deletedAt: null,
        publishedAt: { not: null },
        NOT: { restrictViewPlatforms: { has: "watch" } },
      },
      select: {
        coreId: true,
        publishedAt: true,
        deletedAt: true,
        restrictViewPlatforms: true,
        dubs: {
          where: {
            published: true,
            deletedAt: null,
            videoEdition: {
              is: { coreId: editionIdentity, deletedAt: null },
            },
            muxVideo: {
              is: {
                deletedAt: null,
                assetId: { not: null },
                playbackId: { not: null },
              },
            },
          },
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          take: 20,
          select: {
            id: true,
            published: true,
            deletedAt: true,
            duration: true,
            lengthInMilliseconds: true,
            videoEdition: {
              select: { coreId: true, deletedAt: true },
            },
            muxVideo: {
              select: {
                assetId: true,
                playbackId: true,
                deletedAt: true,
              },
            },
          },
        },
      },
    })
    if (
      !video ||
      video.coreId !== videoId ||
      video.deletedAt ||
      !video.publishedAt ||
      video.restrictViewPlatforms.includes("watch")
    ) {
      return null
    }
    for (const dub of video.dubs) {
      const assetId = BoundedId.safeParse(dub.muxVideo?.assetId)
      const playbackId = BoundedId.safeParse(dub.muxVideo?.playbackId)
      if (
        !dub.published ||
        dub.deletedAt ||
        dub.videoEdition?.coreId !== editionIdentity ||
        dub.videoEdition.deletedAt ||
        dub.muxVideo?.deletedAt ||
        !assetId.success ||
        !playbackId.success
      ) {
        continue
      }
      const durationSeconds =
        dub.duration != null && dub.duration >= 0
          ? dub.duration
          : dub.lengthInMilliseconds != null && dub.lengthInMilliseconds >= 0n
            ? Number(dub.lengthInMilliseconds) / 1_000
            : null
      return {
        muxAssetId: assetId.data,
        playbackId: playbackId.data,
        durationSeconds,
      }
    }
    return null
  }

  async consumeDelegation(input: {
    assertion: VerifiedSubtitleEvalDelegation
    operation: VerifiedSubtitleEvalDelegation["operation"]
    method: string
    bodyDigest: string
  }) {
    const { assertion } = input
    if (
      assertion.operation !== input.operation ||
      assertion.method !== input.method ||
      assertion.bodyDigest !== input.bodyDigest ||
      assertion.expiresAt <= new Date()
    ) {
      throw new ForbiddenError()
    }
    return this.prisma.$transaction(async (tx) => {
      const membership = await tx.managerMembership.findUnique({
        where: { userId: assertion.actorId },
        select: { id: true, role: true, revokedAt: true },
      })
      if (
        !membership ||
        membership.revokedAt ||
        membership.role !== assertion.managerRole ||
        (assertion.operation === "REVIEWER_QUEUE"
          ? membership.role !== "REVIEWER"
          : membership.role !== "OPERATOR")
      ) {
        throw new ForbiddenError()
      }
      const consumed = await tx.subtitleEvalDelegationNonce.createMany({
        data: {
          nonceHash: assertion.nonceHash,
          actorId: assertion.actorId,
          operation: assertion.operation,
          expiresAt: assertion.expiresAt,
          consumedAt: new Date(),
        },
        skipDuplicates: true,
      })
      if (consumed.count !== 1) {
        throw new SubtitleEvalConflictError("delegation_assertion_replayed")
      }
      return {
        actorId: assertion.actorId,
        requestId: assertion.requestId,
        managerRole: membership.role,
      }
    })
  }

  async importCorpus({
    user,
    input,
    requestId,
    importedById,
  }: {
    user: Principal | null
    input: z.input<typeof ImportSubtitleEvalCorpusInput>
    requestId?: string
    importedById: string
  }) {
    assertOperatorOrManagerBackend(user)
    const parsed = ImportSubtitleEvalCorpusInput.parse(input)
    const actorId = BoundedId.parse(importedById)
    const identityDigest = digest({
      manifestDigest: parsed.manifestDigest,
      lockDigest: parsed.lockDigest,
      cells: parsed.cells
        .map((cell) => ({
          caseId: cell.caseId,
          sourceLanguageId: cell.sourceLanguageId,
          targetLanguageId: cell.targetLanguageId,
          sourceDigest: cell.sourceSnapshot.sha256,
          referenceDigest: cell.referenceSnapshot.sha256,
          sourceTrackIdentity: cell.sourceTrackIdentity,
          referenceTrackIdentity: cell.referenceTrackIdentity,
        }))
        .sort((a, b) =>
          `${a.caseId}:${a.targetLanguageId}`.localeCompare(
            `${b.caseId}:${b.targetLanguageId}`,
          ),
        ),
    })

    return this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.subtitleEvalCorpusVersion.findUnique({
          where: { identityDigest },
          include: { cells: true },
        })
        if (existing) return { ...existing, replayed: true }

        const languageIds = Array.from(
          new Set(
            parsed.cells.flatMap((cell) => [
              cell.sourceLanguageId,
              cell.targetLanguageId,
            ]),
          ),
        )
        const languages = await tx.language.findMany({
          where: { id: { in: languageIds }, deletedAt: null },
          select: { id: true, slug: true },
        })
        const slugById = new Map(languages.map((row) => [row.id, row.slug]))
        for (const cell of parsed.cells) {
          if (slugById.get(cell.sourceLanguageId) !== cell.sourceLanguageSlug) {
            throw new SubtitleEvalConflictError(
              "source_language_identity_mismatch",
            )
          }
          if (slugById.get(cell.targetLanguageId) !== cell.targetLanguageSlug) {
            throw new SubtitleEvalConflictError(
              "target_language_identity_mismatch",
            )
          }
        }

        const version = await tx.subtitleEvalCorpusVersion.create({
          data: {
            identityDigest,
            manifestDigest: parsed.manifestDigest,
            lockDigest: parsed.lockDigest,
            authority: parsed.authority,
            certification: inputJson(parsed.certification),
            supersedesVersionId: parsed.supersedesVersionId ?? null,
          },
        })

        for (const cell of parsed.cells) {
          const sourceSnapshot = await this.upsertSnapshot(
            tx,
            cell.sourceSnapshot,
          )
          const referenceSnapshot = await this.upsertSnapshot(
            tx,
            cell.referenceSnapshot,
          )
          await tx.subtitleEvalCorpusCell.create({
            data: {
              corpusVersionId: version.id,
              caseId: cell.caseId,
              collectionKey: cell.collectionKey,
              videoId: cell.videoId,
              editionIdentity: cell.editionIdentity,
              sourceLanguageId: cell.sourceLanguageId,
              sourceLanguageSlug: cell.sourceLanguageSlug,
              sourceTrackIdentity: cell.sourceTrackIdentity,
              targetLanguageId: cell.targetLanguageId,
              targetLanguageSlug: cell.targetLanguageSlug,
              referenceTrackIdentity: cell.referenceTrackIdentity,
              sourceSnapshotId: sourceSnapshot.id,
              referenceSnapshotId: referenceSnapshot.id,
              metadata: inputJson(cell.metadata),
            },
          })
        }
        await this.audit(tx, {
          eventType: "subtitle_eval_corpus_imported",
          actorId,
          entityType: "corpus_version",
          entityId: version.id,
          requestId,
          reason: "Frozen subtitle evaluation corpus imported.",
          metadata: { identityDigest, cellCount: parsed.cells.length },
        })
        return {
          ...(await tx.subtitleEvalCorpusVersion.findUniqueOrThrow({
            where: { id: version.id },
            include: { cells: true },
          })),
          replayed: false,
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  }

  private async upsertSnapshot(
    tx: Prisma.TransactionClient,
    snapshot: z.infer<typeof SnapshotInput>,
  ) {
    const existing = await tx.subtitleEvalCorpusSnapshot.findUnique({
      where: { kind_sha256: { kind: snapshot.kind, sha256: snapshot.sha256 } },
    })
    if (existing) {
      if (
        existing.objectKey !== snapshot.objectKey ||
        existing.rawSha256 !== snapshot.rawSha256 ||
        existing.clippedSha256 !== (snapshot.clippedSha256 ?? null) ||
        existing.byteLength !== snapshot.byteLength
      ) {
        throw new SubtitleEvalConflictError("snapshot_identity_collision")
      }
      return existing
    }
    return tx.subtitleEvalCorpusSnapshot.create({
      data: {
        ...snapshot,
        clippedSha256: snapshot.clippedSha256 ?? null,
      },
    })
  }

  async approveCorpusVersion({
    user,
    input,
  }: {
    user: Principal | null
    input: {
      corpusVersionId: string
      approvedById: string
      certification: z.input<typeof SubtitleEvalCertification>
      reason: string
      requestId: string
    }
  }) {
    assertOperatorOrManagerBackend(user)
    const certification = SubtitleEvalCertification.parse(input.certification)
    const approvedById = BoundedId.parse(input.approvedById)
    const reason = BoundedText.parse(input.reason)
    const requestId = BoundedId.parse(input.requestId)
    const approvalDigest = digest({ approvedById, certification, reason })
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.subtitleEvalCorpusVersion.findUnique({
        where: { id: BoundedId.parse(input.corpusVersionId) },
        include: { cells: { select: { id: true } } },
      })
      if (!version) {
        throw new NotFoundError(
          "SubtitleEvalCorpusVersion",
          input.corpusVersionId,
        )
      }
      if (version.status === "APPROVED") {
        if (version.approvalDigest !== approvalDigest) {
          throw new SubtitleEvalConflictError("corpus_approval_mismatch")
        }
        return { ...version, replayed: true }
      }
      if (version.status !== "PROVISIONAL") {
        throw new SubtitleEvalConflictError("corpus_not_provisional")
      }
      if (
        certification.authority !== version.authority ||
        certification.sourceTracksVerified !== version.cells.length ||
        certification.referenceTracksVerified !== version.cells.length
      ) {
        throw new SubtitleEvalConflictError("corpus_certification_mismatch")
      }
      const disqualifyingReferenceIssues =
        await tx.subtitleEvalReferenceIssue.count({
          where: {
            corpusCellId: { in: version.cells.map((cell) => cell.id) },
            status: { not: "REJECTED" },
          },
        })
      if (disqualifyingReferenceIssues > 0) {
        throw new SubtitleEvalConflictError("corpus_has_reference_issues")
      }
      const approved = await tx.subtitleEvalCorpusVersion.updateMany({
        where: { id: version.id, status: "PROVISIONAL" },
        data: {
          status: "APPROVED",
          approvalDigest,
          approvedById,
          approvedAt: new Date(),
          certification: inputJson(certification),
        },
      })
      if (approved.count !== 1) {
        const concurrent = await tx.subtitleEvalCorpusVersion.findUniqueOrThrow(
          {
            where: { id: version.id },
          },
        )
        if (
          concurrent.status === "APPROVED" &&
          concurrent.approvalDigest === approvalDigest
        ) {
          return { ...concurrent, replayed: true }
        }
        throw new SubtitleEvalConflictError("corpus_approval_raced")
      }
      const approvedVersion =
        await tx.subtitleEvalCorpusVersion.findUniqueOrThrow({
          where: { id: version.id },
        })
      if (version.supersedesVersionId) {
        await tx.subtitleEvalCorpusVersion.updateMany({
          where: { id: version.supersedesVersionId, status: "APPROVED" },
          data: { status: "SUPERSEDED" },
        })
      }
      await this.audit(tx, {
        eventType: "subtitle_eval_corpus_approved",
        actorId: approvedById,
        entityType: "corpus_version",
        entityId: version.id,
        requestId,
        reason,
        metadata: { identityDigest: version.identityDigest },
      })
      return { ...approvedVersion, replayed: false }
    })
  }

  async getCorpusVersion({ user, id }: { user: Principal | null; id: string }) {
    assertOperatorOrManagerBackend(user)
    const row = await this.prisma.subtitleEvalCorpusVersion.findUnique({
      where: { id: BoundedId.parse(id) },
      include: {
        cells: {
          include: {
            sourceSnapshot: true,
            referenceSnapshot: true,
            referenceIssues: {
              where: { status: { not: "REJECTED" } },
              select: { id: true },
            },
          },
          orderBy: { caseId: "asc" },
          take: 100,
        },
      },
    })
    if (!row) return null
    return {
      ...row,
      cells: row.cells.map((cell) => {
        const clip = reviewerClip(cell.metadata)
        return {
          ...cell,
          clipStartSeconds: clip?.startSeconds ?? null,
          clipEndSeconds: clip?.endSeconds ?? null,
        }
      }),
      effectiveApproved:
        row.status === "APPROVED" &&
        row.cells.every((cell) => cell.referenceIssues.length === 0),
    }
  }

  async dispositionReferenceIssue({
    user,
    input,
  }: {
    user: Principal | null
    input: {
      issueId: string
      disposition: "ACCEPTED" | "REJECTED"
      reason: string
      actorId: string
      requestId?: string
      correctedCorpusVersionId?: string | null
    }
  }) {
    assertOperatorOrManagerBackend(user)
    return this.prisma.$transaction(async (tx) => {
      const issue = await tx.subtitleEvalReferenceIssue.findUnique({
        where: { id: BoundedId.parse(input.issueId) },
      })
      if (!issue)
        throw new NotFoundError("SubtitleEvalReferenceIssue", input.issueId)
      if (issue.status !== "OPEN") {
        throw new SubtitleEvalConflictError("reference_issue_already_disposed")
      }
      if (input.disposition === "ACCEPTED") {
        if (!input.correctedCorpusVersionId) {
          throw new SubtitleEvalConflictError(
            "corrected_corpus_version_required",
          )
        }
        const sourceCell = await tx.subtitleEvalCorpusCell.findUnique({
          where: { id: issue.corpusCellId },
          select: {
            corpusVersionId: true,
            caseId: true,
            targetLanguageId: true,
            targetLanguageSlug: true,
            referenceTrackIdentity: true,
            referenceSnapshot: { select: { sha256: true } },
          },
        })
        if (!sourceCell) {
          throw new SubtitleEvalConflictError(
            "invalid_corrected_corpus_version",
          )
        }
        const corrected = await tx.subtitleEvalCorpusVersion.findUnique({
          where: { id: input.correctedCorpusVersionId },
          select: {
            id: true,
            status: true,
            supersedesVersionId: true,
            cells: {
              where: {
                caseId: sourceCell.caseId,
                targetLanguageId: sourceCell.targetLanguageId,
                targetLanguageSlug: sourceCell.targetLanguageSlug,
              },
              select: {
                referenceTrackIdentity: true,
                referenceSnapshot: { select: { sha256: true } },
              },
              take: 2,
            },
          },
        })
        const correctedCell = corrected?.cells[0]
        if (
          !corrected ||
          corrected.status === "SUPERSEDED" ||
          corrected.supersedesVersionId !== sourceCell.corpusVersionId ||
          corrected.cells.length !== 1 ||
          !correctedCell ||
          correctedCell.referenceTrackIdentity ===
            sourceCell.referenceTrackIdentity ||
          correctedCell.referenceSnapshot.sha256 ===
            sourceCell.referenceSnapshot.sha256
        ) {
          throw new SubtitleEvalConflictError(
            "invalid_corrected_corpus_version",
          )
        }
      }
      const disposedAt = new Date()
      const disposition = {
        status: input.disposition,
        dispositionReason: BoundedText.parse(input.reason),
        dispositionById: BoundedId.parse(input.actorId),
        dispositionAt: disposedAt,
        correctedCorpusVersionId: input.correctedCorpusVersionId ?? null,
      }
      const changed = await tx.subtitleEvalReferenceIssue.updateMany({
        where: { id: issue.id, status: "OPEN" },
        data: disposition,
      })
      if (changed.count !== 1) {
        throw new SubtitleEvalConflictError("reference_issue_already_disposed")
      }
      const disposed = await tx.subtitleEvalReferenceIssue.findUniqueOrThrow({
        where: { id: issue.id },
      })
      await this.audit(tx, {
        eventType: "subtitle_eval_reference_issue_disposed",
        actorId: input.actorId,
        entityType: "reference_issue",
        entityId: issue.id,
        requestId: input.requestId,
        reason: input.reason,
        metadata: { disposition: input.disposition },
      })
      return disposed
    })
  }

  async createRun({
    user,
    input,
    requestId,
  }: {
    user: Principal | null
    input: z.input<typeof CreateSubtitleEvalRunInput>
    requestId?: string
  }) {
    assertOperatorOrManagerBackend(user)
    const parsed = CreateSubtitleEvalRunInput.parse(input)
    const uniqueCellIds = Array.from(new Set(parsed.corpusCellIds))
    if (uniqueCellIds.length !== parsed.corpusCellIds.length) {
      throw new SubtitleEvalConflictError("duplicate_corpus_cell")
    }
    assertSubtitleEvalLaunchBounds({
      cellCount: uniqueCellIds.length,
      concurrency: parsed.concurrency,
      timeoutSeconds: parsed.timeoutSeconds,
      maxAttempts: parsed.maxAttempts,
    })
    const requestDigest = subtitleEvalRunRequestDigest({
      ...parsed,
      corpusCellIds: uniqueCellIds,
    })
    const admission = resolveSubtitleEvalAdmissionPolicy()
    const estimatedSpendMicros =
      admission.reservationPerCellAttemptMicros *
      BigInt(uniqueCellIds.length) *
      BigInt(parsed.maxAttempts)
    if (estimatedSpendMicros > admission.maxPerRunMicros) {
      throw new SubtitleEvalConflictError("per_run_spend_ceiling")
    }

    return this.prisma.$transaction(
      async (tx) => {
        const replay = await tx.subtitleEvalRun.findUnique({
          where: { idempotencyKey: parsed.idempotencyKey },
          include: { cells: true },
        })
        if (replay) {
          if (replay.requestDigest !== requestDigest) {
            throw new SubtitleEvalConflictError("run_idempotency_mismatch")
          }
          return { ...replay, replayed: true }
        }

        const [
          operatorActive,
          globalActive,
          rollingSpend,
          cells,
          corpusVersion,
          disqualifyingReferenceIssues,
        ] = await Promise.all([
          tx.subtitleEvalRun.count({
            where: {
              operatorId: parsed.operatorId,
              status: { in: [...ACTIVE_RUN_STATUSES] },
            },
          }),
          tx.subtitleEvalRun.count({
            where: { status: { in: [...ACTIVE_RUN_STATUSES] } },
          }),
          tx.subtitleEvalRun.aggregate({
            where: {
              createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1_000) },
            },
            _sum: { estimatedSpendMicros: true },
          }),
          tx.subtitleEvalCorpusCell.findMany({
            where: {
              id: { in: uniqueCellIds },
              corpusVersionId: parsed.corpusVersionId,
            },
            select: {
              id: true,
              caseId: true,
              targetLanguageId: true,
              targetLanguageSlug: true,
            },
          }),
          tx.subtitleEvalCorpusVersion.findUnique({
            where: { id: parsed.corpusVersionId },
            select: { status: true },
          }),
          tx.subtitleEvalReferenceIssue.count({
            where: {
              status: { not: "REJECTED" },
              corpusCell: { corpusVersionId: parsed.corpusVersionId },
            },
          }),
        ])
        if (operatorActive >= admission.maxActiveRunsPerOperator) {
          throw new SubtitleEvalConflictError("operator_active_run_ceiling")
        }
        if (globalActive >= admission.maxActiveRunsGlobal) {
          throw new SubtitleEvalConflictError("global_active_run_ceiling")
        }
        if (
          (rollingSpend._sum.estimatedSpendMicros ?? 0n) +
            estimatedSpendMicros >
          admission.maxRolling24HourMicros
        ) {
          throw new SubtitleEvalConflictError("rolling_spend_ceiling")
        }
        if (cells.length !== uniqueCellIds.length) {
          throw new SubtitleEvalConflictError("corpus_cell_not_in_version")
        }
        if (
          corpusVersion?.status !== "APPROVED" ||
          disqualifyingReferenceIssues > 0
        ) {
          throw new SubtitleEvalConflictError("corpus_not_effectively_approved")
        }

        const run = await tx.subtitleEvalRun.create({
          data: {
            idempotencyKey: parsed.idempotencyKey,
            requestDigest,
            operatorId: parsed.operatorId,
            corpusVersionId: parsed.corpusVersionId,
            requestedProvider: parsed.requestedProvider,
            requestedModel: parsed.requestedModel,
            promptPolicyId: parsed.promptPolicyId,
            workflowPolicyDigest: parsed.workflowPolicyDigest,
            codeRevision: parsed.codeRevision,
            determinism: inputJson(parsed.determinism),
            concurrency: parsed.concurrency,
            timeoutSeconds: parsed.timeoutSeconds,
            maxAttempts: parsed.maxAttempts,
            estimatedSpendMicros,
            cells: {
              create: cells.map((cell) => ({
                corpusCellId: cell.id,
                idempotencyKey: digest({
                  run: parsed.idempotencyKey,
                  case: cell.caseId,
                  languageId: cell.targetLanguageId,
                  model: parsed.requestedModel,
                  workflowPolicyDigest: parsed.workflowPolicyDigest,
                }),
                targetLanguageId: cell.targetLanguageId,
                targetLanguageSlug: cell.targetLanguageSlug,
              })),
            },
          },
          include: { cells: true },
        })
        await this.audit(tx, {
          eventType: "subtitle_eval_run_admitted",
          actorId: parsed.operatorId,
          entityType: "run",
          entityId: run.id,
          requestId,
          reason: "Bounded subtitle evaluation run admitted.",
          metadata: {
            cellCount: cells.length,
            estimatedSpendMicros: estimatedSpendMicros.toString(),
          },
        })
        return { ...run, replayed: false }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  }

  async claimRunCell(input: { runCellId: string; leaseSeconds: number }) {
    const runCellId = BoundedId.parse(input.runCellId)
    const leaseSeconds = z
      .number()
      .int()
      .min(30)
      .max(900)
      .parse(input.leaseSeconds)
    return this.prisma.$transaction(async (tx) => {
      const cell = await tx.subtitleEvalRunCell.findUnique({
        where: { id: runCellId },
        include: {
          run: {
            select: {
              id: true,
              status: true,
              startedAt: true,
              maxAttempts: true,
            },
          },
        },
      })
      if (!cell) throw new NotFoundError("SubtitleEvalRunCell", runCellId)
      if (cell.status === "COMPLETED" || cell.status === "FAILED") {
        return { cell, executionClaim: null, replayed: true }
      }
      const now = new Date()
      if (
        cell.status === "RUNNING" &&
        cell.leaseExpiresAt &&
        cell.leaseExpiresAt > now
      ) {
        throw new SubtitleEvalConflictError("cell_lease_active")
      }
      if (cell.attemptCount >= cell.run.maxAttempts) {
        throw new SubtitleEvalConflictError("cell_attempts_exhausted")
      }
      const token = randomUUID()
      const expiresAt = new Date(now.getTime() + leaseSeconds * 1_000)
      const claimed = await tx.subtitleEvalRunCell.updateMany({
        where: {
          id: cell.id,
          status: cell.status,
          leaseGeneration: cell.leaseGeneration,
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
        },
        data: {
          status: "RUNNING",
          attemptCount: { increment: 1 },
          leaseGeneration: { increment: 1 },
          leaseTokenHash: leaseTokenHash(token),
          leaseExpiresAt: expiresAt,
          startedAt: cell.startedAt ?? now,
        },
      })
      if (claimed.count !== 1)
        throw new SubtitleEvalConflictError("cell_lease_lost")
      if (cell.run.status === "QUEUED") {
        await tx.subtitleEvalRun.updateMany({
          where: { id: cell.run.id, status: "QUEUED" },
          data: {
            status: "RUNNING",
            startedAt: cell.run.startedAt ?? now,
            updatedAt: now,
          },
        })
      }
      const current = await tx.subtitleEvalRunCell.findUniqueOrThrow({
        where: { id: cell.id },
      })
      return {
        cell: current,
        executionClaim: {
          generation: current.leaseGeneration,
          token,
          expiresAt: expiresAt.toISOString(),
        },
        replayed: false,
      }
    })
  }

  async finalizeRunCell(input: z.input<typeof FinalizeSubtitleEvalCellInput>) {
    const parsed = FinalizeSubtitleEvalCellInput.parse(input)
    return this.prisma.$transaction(async (tx) => {
      const cell = await tx.subtitleEvalRunCell.findUnique({
        where: { id: parsed.runCellId },
        include: {
          artifacts: true,
          machineAssessment: { select: { assessmentDigest: true } },
        },
      })
      if (!cell)
        throw new NotFoundError("SubtitleEvalRunCell", parsed.runCellId)
      if (cell.status === "COMPLETED") {
        if (cell.resultDigest !== parsed.resultDigest) {
          throw new SubtitleEvalConflictError("terminal_cell_digest_mismatch")
        }
        const artifactIdentity = (
          artifacts: readonly {
            kind: string
            sha256: string
            objectKey: string
            byteLength: bigint
            mediaType: string
          }[],
        ) =>
          artifacts
            .map((artifact) => ({
              kind: artifact.kind,
              sha256: artifact.sha256,
              objectKey: artifact.objectKey,
              byteLength: artifact.byteLength.toString(),
              mediaType: artifact.mediaType,
            }))
            .sort((left, right) => left.kind.localeCompare(right.kind))
        if (
          digest(artifactIdentity(cell.artifacts)) !==
            digest(artifactIdentity(parsed.artifacts)) ||
          cell.machineAssessment?.assessmentDigest !==
            parsed.machineAssessment.assessmentDigest
        ) {
          throw new SubtitleEvalConflictError("terminal_cell_evidence_mismatch")
        }
        await assertProviderCallReplay(
          tx,
          cell.id,
          parsed.leaseGeneration,
          parsed.providerCalls,
        )
        return { cell, replayed: true }
      }
      const completed = await tx.subtitleEvalRunCell.updateMany({
        where: {
          id: cell.id,
          status: "RUNNING",
          leaseGeneration: parsed.leaseGeneration,
          leaseTokenHash: leaseTokenHash(parsed.leaseToken),
        },
        data: {
          status: "COMPLETED",
          resultDigest: parsed.resultDigest,
          leaseTokenHash: null,
          leaseExpiresAt: null,
          completedAt: new Date(),
        },
      })
      if (completed.count !== 1)
        throw new SubtitleEvalConflictError("cell_fence_lost")
      await persistProviderCalls(
        tx,
        cell.id,
        parsed.leaseGeneration,
        parsed.providerCalls,
      )
      for (const artifact of parsed.artifacts) {
        await tx.subtitleEvalArtifact.create({
          data: { ...artifact, runCellId: cell.id },
        })
      }
      await tx.subtitleEvalMachineAssessment.create({
        data: {
          runCellId: cell.id,
          schemaVersion: parsed.machineAssessment.schemaVersion,
          metrics: inputJson(parsed.machineAssessment.metrics),
          advisoryRiskFlags: inputJson(
            parsed.machineAssessment.advisoryRiskFlags,
          ),
          usage: inputJson(parsed.machineAssessment.usage),
          reproducibilityLimits: Array.from(
            new Set(parsed.machineAssessment.reproducibilityLimits),
          ).sort(),
          providerRequestId: parsed.machineAssessment.providerRequestId ?? null,
          providerResponseId:
            parsed.machineAssessment.providerResponseId ?? null,
          resolvedModel: parsed.machineAssessment.resolvedModel ?? null,
          assessmentDigest: parsed.machineAssessment.assessmentDigest,
        },
      })
      return {
        cell: await tx.subtitleEvalRunCell.findUniqueOrThrow({
          where: { id: cell.id },
        }),
        replayed: false,
      }
    })
  }

  async failRunCell(input: {
    runCellId: string
    leaseGeneration: number
    leaseToken: string
    errorCode: string
    retryable: boolean
    providerCalls: z.input<typeof SubtitleEvalProviderCallsInput>
  }) {
    const runCellId = BoundedId.parse(input.runCellId)
    const errorCode = BoundedId.parse(input.errorCode)
    const leaseGeneration = z
      .number()
      .int()
      .positive()
      .parse(input.leaseGeneration)
    const providerCalls = SubtitleEvalProviderCallsInput.parse(
      input.providerCalls,
    )
    return this.prisma.$transaction(async (tx) => {
      const cell = await tx.subtitleEvalRunCell.findUnique({
        where: { id: runCellId },
        include: { run: { select: { maxAttempts: true } } },
      })
      if (!cell) throw new NotFoundError("SubtitleEvalRunCell", runCellId)
      const retryable =
        input.retryable && cell.attemptCount < cell.run.maxAttempts
      if (
        cell.leaseGeneration === leaseGeneration &&
        (cell.status === "QUEUED" || cell.status === "FAILED") &&
        cell.errorCode === errorCode &&
        cell.errorRetryable === retryable
      ) {
        await assertProviderCallReplay(
          tx,
          runCellId,
          leaseGeneration,
          providerCalls,
        )
        return cell
      }
      const failed = await tx.subtitleEvalRunCell.updateMany({
        where: {
          id: runCellId,
          status: "RUNNING",
          leaseGeneration,
          leaseTokenHash: leaseTokenHash(BoundedId.parse(input.leaseToken)),
        },
        data: {
          status: retryable ? "QUEUED" : "FAILED",
          errorCode,
          errorRetryable: retryable,
          leaseTokenHash: null,
          leaseExpiresAt: null,
          completedAt: retryable ? null : new Date(),
        },
      })
      if (failed.count !== 1)
        throw new SubtitleEvalConflictError("cell_fence_lost")
      await persistProviderCalls(tx, runCellId, leaseGeneration, providerCalls)
      return tx.subtitleEvalRunCell.findUniqueOrThrow({
        where: { id: runCellId },
      })
    })
  }

  async finalizeRun(input: z.input<typeof FinalizeSubtitleEvalRunInput>) {
    const parsed = FinalizeSubtitleEvalRunInput.parse(input)
    return this.prisma.$transaction(async (tx) => {
      const lockedRun = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "subtitle_eval_run"
        WHERE "id" = ${parsed.runId}
        FOR UPDATE
      `)
      if (lockedRun.length === 0) {
        throw new NotFoundError("SubtitleEvalRun", parsed.runId)
      }
      const run = await tx.subtitleEvalRun.findUnique({
        where: { id: parsed.runId },
        include: {
          corpusVersion: { select: { identityDigest: true } },
          terminalReport: true,
          cells: {
            include: {
              corpusCell: {
                include: { sourceSnapshot: true, referenceSnapshot: true },
              },
              artifacts: true,
              machineAssessment: true,
              providerCalls: true,
            },
          },
        },
      })
      if (!run) throw new NotFoundError("SubtitleEvalRun", parsed.runId)
      const requestedReproducibilityLimits = Array.from(
        new Set([
          ...run.cells.flatMap(
            (cell) => cell.machineAssessment?.reproducibilityLimits ?? [],
          ),
          ...parsed.reproducibilityLimits,
        ]),
      ).sort()
      if (run.terminalReport) {
        if (
          run.terminalReport.status !== parsed.expectedStatus ||
          run.terminalReport.corpusIdentityDigest !==
            parsed.expectedCorpusIdentityDigest ||
          digest(run.terminalReport.sourceReferenceDigests) !==
            parsed.expectedSourceReferenceDigest ||
          digest(run.terminalReport.reproducibilityLimits) !==
            digest(requestedReproducibilityLimits)
        ) {
          throw new SubtitleEvalConflictError("terminal_report_mismatch")
        }
        return { report: run.terminalReport, replayed: true }
      }
      const status = deriveSubtitleEvalTerminalStatus(
        run.cells.map((cell) => cell.status),
      )
      const sourceReferenceDigests = run.cells
        .map((cell) => ({
          caseId: cell.corpusCell.caseId,
          targetLanguageId: cell.targetLanguageId,
          targetLanguageSlug: cell.targetLanguageSlug,
          sourceTrackIdentity: cell.corpusCell.sourceTrackIdentity,
          referenceTrackIdentity: cell.corpusCell.referenceTrackIdentity,
          sourceSnapshot: {
            sha256: cell.corpusCell.sourceSnapshot.sha256,
            rawSha256: cell.corpusCell.sourceSnapshot.rawSha256,
            clippedSha256: cell.corpusCell.sourceSnapshot.clippedSha256,
          },
          referenceSnapshot: {
            sha256: cell.corpusCell.referenceSnapshot.sha256,
            rawSha256: cell.corpusCell.referenceSnapshot.rawSha256,
            clippedSha256: cell.corpusCell.referenceSnapshot.clippedSha256,
          },
        }))
        .sort((left, right) =>
          `${left.caseId}:${left.targetLanguageId}`.localeCompare(
            `${right.caseId}:${right.targetLanguageId}`,
          ),
        )
      const providerIdentities = {
        requestedProvider: run.requestedProvider,
        requestedModel: run.requestedModel,
        cells: run.cells
          .filter(
            (cell) =>
              cell.machineAssessment || (cell.providerCalls?.length ?? 0) > 0,
          )
          .map((cell) => ({
            caseId: cell.corpusCell.caseId,
            targetLanguageId: cell.targetLanguageId,
            providerRequestId:
              cell.machineAssessment?.providerRequestId ?? null,
            providerResponseId:
              cell.machineAssessment?.providerResponseId ?? null,
            assessmentDigest: cell.machineAssessment?.assessmentDigest ?? null,
            resolvedModel: cell.machineAssessment?.resolvedModel ?? null,
            calls: (cell.providerCalls ?? [])
              .map(providerCallEvidence)
              .sort(
                (left, right) =>
                  left.leaseGeneration - right.leaseGeneration ||
                  left.callSequence - right.callSequence,
              ),
          }))
          .sort((left, right) =>
            `${left.caseId}:${left.targetLanguageId}`.localeCompare(
              `${right.caseId}:${right.targetLanguageId}`,
            ),
          ),
      }
      const runtimeIdentity = {
        promptPolicyId: run.promptPolicyId,
        workflowPolicyDigest: run.workflowPolicyDigest,
        codeRevision: run.codeRevision,
        determinism: run.determinism,
        concurrency: run.concurrency,
        timeoutSeconds: run.timeoutSeconds,
        maxAttempts: run.maxAttempts,
      }
      const assessedCells = run.cells
        .filter((cell) => cell.status === "COMPLETED" && cell.machineAssessment)
        .sort((left, right) =>
          `${left.corpusCell.caseId}:${left.targetLanguageId}`.localeCompare(
            `${right.corpusCell.caseId}:${right.targetLanguageId}`,
          ),
        )
      const usage = assessedCells.map((cell) => ({
        caseId: cell.corpusCell.caseId,
        targetLanguageId: cell.targetLanguageId,
        usage: cell.machineAssessment!.usage,
      }))
      const languageMetrics = aggregateAssessmentMetrics(
        assessedCells,
        (cell) => cell.targetLanguageId,
      )
      const collectionMetrics = aggregateAssessmentMetrics(
        assessedCells,
        (cell) => cell.corpusCell.collectionKey,
      )
      const artifactInventory = run.cells
        .flatMap((cell) =>
          cell.artifacts.map((artifact) => ({
            caseId: cell.corpusCell.caseId,
            targetLanguageId: cell.targetLanguageId,
            kind: artifact.kind,
            sha256: artifact.sha256,
            byteLength: artifact.byteLength.toString(),
            mediaType: artifact.mediaType,
          })),
        )
        .sort((left, right) =>
          `${left.caseId}:${left.targetLanguageId}:${left.kind}:${left.sha256}`.localeCompare(
            `${right.caseId}:${right.targetLanguageId}:${right.kind}:${right.sha256}`,
          ),
        )
      const reportArtifactIdentities = artifactInventory
        .filter((artifact) => artifact.kind === "CELL_REPORT")
        .map((artifact) => ({
          caseId: artifact.caseId,
          targetLanguageId: artifact.targetLanguageId,
          sha256: artifact.sha256,
          byteLength: artifact.byteLength,
          mediaType: artifact.mediaType,
        }))
        .sort((left, right) =>
          `${left.caseId}:${left.targetLanguageId}:${left.sha256}`.localeCompare(
            `${right.caseId}:${right.targetLanguageId}:${right.sha256}`,
          ),
        )
      const reportArtifactDigest =
        reportArtifactIdentities.length > 0
          ? digest(reportArtifactIdentities)
          : null
      const partialFailures = run.cells
        .filter((cell) => cell.status === "FAILED")
        .map((cell) => ({
          caseId: cell.corpusCell.caseId,
          targetLanguageId: cell.targetLanguageId,
          errorCode: cell.errorCode,
          errorRetryable: cell.errorRetryable ?? false,
          attemptCount: cell.attemptCount,
        }))
        .sort((left, right) =>
          `${left.caseId}:${left.targetLanguageId}`.localeCompare(
            `${right.caseId}:${right.targetLanguageId}`,
          ),
        )
      const reproducibilityLimits = requestedReproducibilityLimits
      const canonicalReport = {
        status,
        corpusIdentityDigest: run.corpusVersion.identityDigest,
        sourceReferenceDigests,
        providerIdentities,
        runtimeIdentity,
        usage,
        languageMetrics,
        collectionMetrics,
        artifactInventory,
        reproducibilityLimits,
        partialFailures,
      }
      const reportDigest = subtitleEvalCanonicalReportDigest(canonicalReport)
      if (
        parsed.expectedStatus !== status ||
        parsed.expectedCorpusIdentityDigest !==
          run.corpusVersion.identityDigest ||
        parsed.expectedSourceReferenceDigest !== digest(sourceReferenceDigests)
      ) {
        throw new SubtitleEvalConflictError(
          "terminal_report_expectation_mismatch",
        )
      }
      const completedAt = new Date()
      const report = await tx.subtitleEvalTerminalReport.create({
        data: {
          runId: run.id,
          status,
          reportDigest,
          reportArtifactDigest,
          corpusIdentityDigest: run.corpusVersion.identityDigest,
          sourceReferenceDigests: inputJson(sourceReferenceDigests),
          providerIdentities: inputJson(providerIdentities),
          runtimeIdentity: inputJson(runtimeIdentity),
          usage: inputJson(usage),
          languageMetrics: inputJson(languageMetrics),
          collectionMetrics: inputJson(collectionMetrics),
          artifactInventory: inputJson(artifactInventory),
          reproducibilityLimits,
          partialFailures: inputJson(partialFailures),
          completedAt,
        },
      })
      await tx.subtitleEvalRun.update({
        where: { id: run.id },
        data: {
          status,
          terminalAt: completedAt,
          leaseTokenHash: null,
          leaseExpiresAt: null,
        },
      })
      return { report, replayed: false }
    })
  }

  async ensureRubricV1({ user }: { user: Principal | null }) {
    assertOperatorOrManagerBackend(user)
    const definition = {
      dimensions: [
        "MEANING_ACCURACY",
        "NATURALNESS",
        "TIMING_READABILITY",
        "SCRIPTURE_THEOLOGY",
      ],
      scale: { minimum: 1, usableWithMaterialEdits: 3, publicationQuality: 5 },
      issueCodes: IssueCode.options,
    }
    const schemaDigest = digest(definition)
    return this.prisma.subtitleEvalRubricVersion.upsert({
      where: { version: 1 },
      update: {},
      create: {
        version: 1,
        schemaDigest,
        definition: inputJson(definition),
        createdById: user?.id ?? "manager-backend",
      },
    })
  }

  private reviewerGrantCanAcceptAssignment(
    grant: {
      permittedRubricDimensions: readonly string[]
      scriptureSpecialist: boolean
      theologySpecialist: boolean
    },
    kind: SubtitleEvalAssignmentKind,
    specialistDimension?: string | null,
  ) {
    if (
      BASE_REVIEW_DIMENSIONS.some(
        (dimension) => !grant.permittedRubricDimensions.includes(dimension),
      )
    ) {
      return { accepted: false, reason: "reviewer_base_rubric_missing" }
    }
    if (kind !== "SPECIALIST") return { accepted: true, reason: null }
    if (!grant.permittedRubricDimensions.includes("SCRIPTURE_THEOLOGY")) {
      return { accepted: false, reason: "specialist_qualification_missing" }
    }
    const dimension = SpecialistDimension.safeParse(specialistDimension)
    if (!dimension.success) {
      return { accepted: false, reason: "specialist_dimension_invalid" }
    }
    const qualified =
      dimension.data === "SCRIPTURE"
        ? grant.scriptureSpecialist
        : dimension.data === "THEOLOGY"
          ? grant.theologySpecialist
          : grant.scriptureSpecialist || grant.theologySpecialist
    return qualified
      ? { accepted: true, reason: null }
      : { accepted: false, reason: "specialist_qualification_missing" }
  }

  async createAssignment({
    user,
    input,
  }: {
    user: Principal | null
    input: {
      idempotencyKey: string
      runCellId: string
      reviewerMembershipId: string
      kind: SubtitleEvalAssignmentKind
      specialistDimension?: string | null
      assignedById: string
      requestId?: string
    }
  }) {
    assertOperatorOrManagerBackend(user)
    const kind = AssignmentKind.parse(input.kind)
    const idempotencyKey = BoundedId.parse(input.idempotencyKey)
    const runCellId = BoundedId.parse(input.runCellId)
    const reviewerMembershipId = BoundedId.parse(input.reviewerMembershipId)
    const assignedById = BoundedId.parse(input.assignedById)
    if (kind === "STANDARD" && input.specialistDimension != null) {
      throw new SubtitleEvalConflictError("specialist_dimension_unexpected")
    }
    const specialistDimension =
      kind === "SPECIALIST"
        ? SpecialistDimension.parse(input.specialistDimension)
        : null
    const requestDigest = subtitleEvalAssignmentRequestDigest({
      runCellId,
      reviewerMembershipId,
      kind,
      specialistDimension,
      assignedById,
    })
    return this.prisma.$transaction(async (tx) => {
      const replay = await tx.subtitleEvalAssignment.findUnique({
        where: { idempotencyKey },
      })
      if (replay) {
        if (replay.requestDigest !== requestDigest) {
          throw new SubtitleEvalConflictError("assignment_idempotency_mismatch")
        }
        return { assignment: replay, replayed: true }
      }
      const [cell, membership] = await Promise.all([
        tx.subtitleEvalRunCell.findUnique({
          where: { id: runCellId },
          include: {
            artifacts: {
              where: { kind: "CANDIDATE_VTT" },
              select: { id: true },
              take: 2,
            },
            machineAssessment: { select: { id: true } },
          },
        }),
        tx.managerMembership.findUnique({
          where: { id: reviewerMembershipId },
          include: {
            reviewerLanguageGrants: {
              where: { revokedAt: null },
              include: {
                language: { select: { slug: true, deletedAt: true } },
              },
            },
          },
        }),
      ])
      if (!cell) throw new NotFoundError("SubtitleEvalRunCell", input.runCellId)
      if (cell.status !== "COMPLETED") {
        throw new SubtitleEvalConflictError("assignment_cell_not_completed")
      }
      if (
        !cell.resultDigest ||
        cell.artifacts.length !== 1 ||
        !cell.machineAssessment
      ) {
        throw new SubtitleEvalConflictError(
          "assignment_cell_evidence_incomplete",
        )
      }
      if (
        !membership ||
        membership.revokedAt ||
        membership.role !== "REVIEWER"
      ) {
        throw new SubtitleEvalConflictError("reviewer_membership_inactive")
      }
      const grant = membership.reviewerLanguageGrants.find(
        (candidate) =>
          candidate.languageId === cell.targetLanguageId &&
          candidate.language.slug === cell.targetLanguageSlug &&
          !candidate.language.deletedAt,
      )
      if (!grant)
        throw new SubtitleEvalConflictError("reviewer_language_grant_missing")
      const qualification = this.reviewerGrantCanAcceptAssignment(
        grant,
        kind,
        specialistDimension,
      )
      if (!qualification.accepted) {
        throw new SubtitleEvalConflictError(qualification.reason!)
      }
      const aggregate = await tx.subtitleEvalAssignment.aggregate({
        where: { runCellId: cell.id },
        _max: { round: true },
      })
      const assignment = await tx.subtitleEvalAssignment.create({
        data: {
          idempotencyKey,
          requestDigest,
          runCellId: cell.id,
          reviewerMembershipId: membership.id,
          targetLanguageId: cell.targetLanguageId,
          targetLanguageSlug: cell.targetLanguageSlug,
          round: (aggregate._max.round ?? 0) + 1,
          kind,
          specialistDimension,
          presentationSeed: randomUUID(),
          qualificationVersion: grant.qualificationVersion,
          assignedById,
        },
      })
      await this.audit(tx, {
        eventType: "subtitle_eval_assignment_created",
        actorId: input.assignedById,
        entityType: "assignment",
        entityId: assignment.id,
        requestId: input.requestId,
        reason: "Subtitle review assignment created.",
        metadata: { kind, targetLanguageId: cell.targetLanguageId },
      })
      return { assignment, replayed: false }
    })
  }

  async assignPendingSpecialist({
    user,
    input,
  }: {
    user: Principal | null
    input: {
      assignmentId: string
      reviewerMembershipId: string
      assignedById: string
      requestId?: string
    }
  }) {
    assertOperatorOrManagerBackend(user)
    const assignmentId = BoundedId.parse(input.assignmentId)
    const reviewerMembershipId = BoundedId.parse(input.reviewerMembershipId)
    const assignedById = BoundedId.parse(input.assignedById)
    return this.prisma.$transaction(async (tx) => {
      const assignment = await tx.subtitleEvalAssignment.findUnique({
        where: { id: assignmentId },
      })
      if (
        assignment?.kind === "SPECIALIST" &&
        assignment.status === "ASSIGNED" &&
        assignment.reviewerMembershipId
      ) {
        if (assignment.reviewerMembershipId !== reviewerMembershipId) {
          throw new SubtitleEvalConflictError(
            "specialist_assignment_reviewer_conflict",
          )
        }
        return { assignment, replayed: true }
      }
      if (
        !assignment ||
        assignment.kind !== "SPECIALIST" ||
        assignment.status !== "BLOCKED" ||
        assignment.reviewerMembershipId
      ) {
        throw new SubtitleEvalConflictError("specialist_assignment_not_pending")
      }
      const membership = await tx.managerMembership.findUnique({
        where: { id: reviewerMembershipId },
        include: {
          reviewerLanguageGrants: {
            where: { languageId: assignment.targetLanguageId, revokedAt: null },
            include: { language: { select: { slug: true, deletedAt: true } } },
          },
        },
      })
      const grant = membership?.reviewerLanguageGrants.find(
        (candidate) =>
          candidate.language.slug === assignment.targetLanguageSlug &&
          !candidate.language.deletedAt,
      )
      const qualification = grant
        ? this.reviewerGrantCanAcceptAssignment(
            grant,
            "SPECIALIST",
            assignment.specialistDimension,
          )
        : { accepted: false }
      if (
        !membership ||
        membership.revokedAt ||
        membership.role !== "REVIEWER" ||
        !grant ||
        !qualification.accepted
      ) {
        throw new SubtitleEvalConflictError("specialist_qualification_missing")
      }
      const claimed = await tx.subtitleEvalAssignment.updateMany({
        where: {
          id: assignment.id,
          kind: "SPECIALIST",
          status: "BLOCKED",
          reviewerMembershipId: null,
        },
        data: {
          reviewerMembershipId: membership.id,
          status: "ASSIGNED",
          presentationSeed: randomUUID(),
          qualificationVersion: grant.qualificationVersion,
          assignedById,
          blockedReason: null,
          assignedAt: new Date(),
        },
      })
      if (claimed.count !== 1) {
        const concurrent = await tx.subtitleEvalAssignment.findUnique({
          where: { id: assignment.id },
        })
        if (
          concurrent?.kind === "SPECIALIST" &&
          concurrent.status === "ASSIGNED" &&
          concurrent.reviewerMembershipId === reviewerMembershipId
        ) {
          return { assignment: concurrent, replayed: true }
        }
        throw new SubtitleEvalConflictError(
          "specialist_assignment_reviewer_conflict",
        )
      }
      const assigned = await tx.subtitleEvalAssignment.findUniqueOrThrow({
        where: { id: assignment.id },
      })
      await this.audit(tx, {
        eventType: "subtitle_eval_specialist_assigned",
        actorId: input.assignedById,
        entityType: "assignment",
        entityId: assignment.id,
        requestId: input.requestId,
        reason: "Pending specialist round assigned to a qualified reviewer.",
        metadata: { reviewerMembershipId: membership.id },
      })
      return { assignment: assigned, replayed: false }
    })
  }

  async assertReviewerAssignmentAccess(
    input: {
      actorId: string
      assignmentId: string
      requireSpecialist?: boolean
    },
    store: Prisma.TransactionClient | PrismaClient = this.prisma,
  ) {
    return this.loadReviewerAssignmentAccess(store, input)
  }

  private async loadReviewerAssignmentAccess(
    store:
      | Pick<PrismaClient, "subtitleEvalAssignment">
      | Prisma.TransactionClient,
    input: {
      actorId: string
      assignmentId: string
      requireSpecialist?: boolean
    },
  ) {
    const assignment = await store.subtitleEvalAssignment.findFirst({
      where: {
        id: BoundedId.parse(input.assignmentId),
        reviewerMembership: {
          userId: BoundedId.parse(input.actorId),
          role: "REVIEWER",
          revokedAt: null,
        },
      },
      include: {
        reviewerMembership: {
          include: {
            reviewerLanguageGrants: {
              where: { revokedAt: null },
              include: {
                language: { select: { slug: true, deletedAt: true } },
              },
            },
          },
        },
      },
    })
    const grant = assignment?.reviewerMembership?.reviewerLanguageGrants.find(
      (candidate) =>
        candidate.languageId === assignment.targetLanguageId &&
        candidate.language.slug === assignment.targetLanguageSlug &&
        !candidate.language.deletedAt &&
        assignment.qualificationVersion != null &&
        candidate.qualificationVersion >= assignment.qualificationVersion,
    )
    const qualification =
      assignment && grant
        ? this.reviewerGrantCanAcceptAssignment(
            grant,
            assignment.kind,
            assignment.specialistDimension,
          )
        : { accepted: false }
    if (
      !assignment ||
      !grant ||
      !qualification.accepted ||
      assignment.status === "BLOCKED" ||
      assignment.status === "CANCELLED" ||
      ((input.requireSpecialist || assignment.kind === "SPECIALIST") &&
        !grant.scriptureSpecialist &&
        !grant.theologySpecialist)
    ) {
      throw new NotFoundError("SubtitleEvalAssignment", input.assignmentId)
    }
    return { assignment, grant }
  }

  async listOperatorReviewerCandidates({
    user,
    targetLanguageId,
    targetLanguageSlug,
    specialistDimension,
    limit = 25,
    after,
  }: {
    user: Principal | null
    targetLanguageId: string
    targetLanguageSlug: string
    specialistDimension?: string | null
    limit?: number
    after?: string | null
  }) {
    assertOperatorOrManagerBackend(user)
    const languageId = BoundedId.parse(targetLanguageId)
    const languageSlug = BoundedId.parse(targetLanguageSlug)
    const dimension = specialistDimension
      ? SpecialistDimension.parse(specialistDimension)
      : null
    const take = z.number().int().min(1).max(50).parse(limit)
    const memberships = await this.prisma.managerMembership.findMany({
      where: {
        role: "REVIEWER",
        revokedAt: null,
        ...(after ? { id: { lt: BoundedId.parse(after) } } : {}),
        reviewerLanguageGrants: {
          some: {
            languageId,
            revokedAt: null,
            language: { slug: languageSlug, deletedAt: null },
          },
        },
      },
      orderBy: { id: "desc" },
      take: take + 1,
      select: {
        id: true,
        role: true,
        revokedAt: true,
        user: { select: { name: true, email: true } },
        reviewerLanguageGrants: {
          where: { languageId, revokedAt: null },
          select: {
            languageId: true,
            revokedAt: true,
            qualificationVersion: true,
            permittedRubricDimensions: true,
            scriptureSpecialist: true,
            theologySpecialist: true,
            language: { select: { slug: true, deletedAt: true } },
          },
        },
        _count: {
          select: {
            subtitleEvalAssignments: {
              where: { status: { in: ["ASSIGNED", "IN_REVIEW"] } },
            },
          },
        },
      },
    })
    const qualified = memberships.flatMap((membership) => {
      if (membership.role !== "REVIEWER" || membership.revokedAt) return []
      const grant = membership.reviewerLanguageGrants.find(
        (candidate) =>
          candidate.languageId === languageId &&
          !candidate.revokedAt &&
          candidate.language.slug === languageSlug &&
          !candidate.language.deletedAt,
      )
      const qualification = grant
        ? this.reviewerGrantCanAcceptAssignment(
            grant,
            dimension ? "SPECIALIST" : "STANDARD",
            dimension,
          )
        : { accepted: false }
      if (!grant || !qualification.accepted) return []
      return [
        {
          membershipId: membership.id,
          displayName: membership.user.name,
          email: membership.user.email,
          targetLanguageId: languageId,
          targetLanguageSlug: languageSlug,
          qualificationVersion: grant.qualificationVersion,
          rubricDimensions: grant.permittedRubricDimensions,
          specialistCapabilities: [
            ...(grant.scriptureSpecialist ? ["SCRIPTURE" as const] : []),
            ...(grant.theologySpecialist ? ["THEOLOGY" as const] : []),
          ],
          activeAssignmentCount: membership._count.subtitleEvalAssignments,
        },
      ]
    })
    const hasMore = memberships.length > take
    return {
      nodes: qualified.slice(0, take),
      nextCursor: hasMore ? (memberships.at(take - 1)?.id ?? null) : null,
    }
  }

  async listOperatorAssignments({
    user,
    runId,
    runCellId,
    limit = 50,
    after,
  }: {
    user: Principal | null
    runId: string
    runCellId?: string | null
    limit?: number
    after?: string | null
  }) {
    assertOperatorOrManagerBackend(user)
    const take = z.number().int().min(1).max(100).parse(limit)
    const rows = await this.prisma.subtitleEvalAssignment.findMany({
      where: {
        runCell: { runId: BoundedId.parse(runId) },
        ...(runCellId ? { runCellId: BoundedId.parse(runCellId) } : {}),
        ...(after ? { id: { lt: BoundedId.parse(after) } } : {}),
      },
      orderBy: { id: "desc" },
      take: take + 1,
      select: {
        id: true,
        runCellId: true,
        status: true,
        kind: true,
        round: true,
        specialistDimension: true,
        reviewerMembershipId: true,
        assignedAt: true,
        submittedAt: true,
        reviewerMembership: {
          select: { user: { select: { name: true, email: true } } },
        },
        reviews: {
          orderBy: { submittedAt: "desc" },
          take: 1,
          select: { verdict: true },
        },
      },
    })
    const hasMore = rows.length > take
    const page = hasMore ? rows.slice(0, take) : rows
    return {
      nodes: page.map((row) => ({
        id: row.id,
        runCellId: row.runCellId,
        status: row.status,
        kind: row.kind,
        round: row.round,
        specialistDimension: row.specialistDimension,
        reviewerMembershipId: row.reviewerMembershipId,
        reviewerDisplayName: row.reviewerMembership?.user.name ?? null,
        reviewerEmail: row.reviewerMembership?.user.email ?? null,
        assignedAt: row.assignedAt,
        submittedAt: row.submittedAt,
        latestVerdict: row.reviews[0]?.verdict ?? null,
      })),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    }
  }

  async getOperatorAssignment({
    user,
    assignmentId,
  }: {
    user: Principal | null
    assignmentId: string
  }) {
    assertOperatorOrManagerBackend(user)
    const row = await this.prisma.subtitleEvalAssignment.findUnique({
      where: { id: BoundedId.parse(assignmentId) },
      include: {
        reviewerMembership: {
          select: { user: { select: { name: true, email: true } } },
        },
        reviews: {
          orderBy: { submittedAt: "asc" },
          take: 100,
          select: {
            id: true,
            rubricVersion: { select: { version: true } },
            meaningAccuracyScore: true,
            naturalnessScore: true,
            timingReadabilityScore: true,
            scriptureTheologyScore: true,
            verdict: true,
            issueCodes: true,
            criticalMeaningLoss: true,
            criticalHarmful: true,
            criticalScriptureRisk: true,
            trackAssessments: true,
            questionableTrack: true,
            notes: true,
            corrections: true,
            submittedAt: true,
          },
        },
        runCell: {
          include: {
            corpusCell: {
              include: { sourceSnapshot: true, referenceSnapshot: true },
            },
            machineAssessment: true,
            artifacts: { where: { kind: "CANDIDATE_VTT" } },
          },
        },
      },
    })
    const candidate = row?.runCell.artifacts[0]
    if (!row || !row.presentationSeed || !candidate) return null
    const referenceTrackLabel = reviewerReferenceTrackLabel(
      row.presentationSeed,
      row.id,
    )
    const candidateTrackLabel = referenceTrackLabel === "A" ? "B" : "A"
    const clip = reviewerClip(row.runCell.corpusCell.metadata)
    const track = (
      role: "SOURCE" | "REFERENCE" | "CANDIDATE",
      value: { id: string; mediaType: string },
    ) => ({
      label: role,
      contentId: opaqueReviewerTrackId(row.presentationSeed!, {
        assignmentId: row.id,
        role,
        objectIdentity: value.id,
      }),
      mediaType: value.mediaType,
    })
    return {
      id: row.id,
      status: row.status,
      kind: row.kind,
      round: row.round,
      specialistDimension: row.specialistDimension,
      targetLanguageId: row.targetLanguageId,
      targetLanguageSlug: row.targetLanguageSlug,
      reviewerMembershipId: row.reviewerMembershipId,
      reviewerDisplayName: row.reviewerMembership?.user.name ?? null,
      reviewerEmail: row.reviewerMembership?.user.email ?? null,
      caseId: row.runCell.corpusCell.caseId,
      collectionKey: row.runCell.corpusCell.collectionKey,
      videoId: row.runCell.corpusCell.videoId,
      editionIdentity: row.runCell.corpusCell.editionIdentity,
      clipStartSeconds: clip?.startSeconds ?? null,
      clipEndSeconds: clip?.endSeconds ?? null,
      sourceTrack: track("SOURCE", row.runCell.corpusCell.sourceSnapshot),
      referenceTrack: track(
        "REFERENCE",
        row.runCell.corpusCell.referenceSnapshot,
      ),
      candidateTrack: track("CANDIDATE", candidate),
      referenceTrackLabel,
      candidateTrackLabel,
      machineAssessment: row.runCell.machineAssessment
        ? {
            metrics: row.runCell.machineAssessment.metrics,
            advisoryRiskFlags: row.runCell.machineAssessment.advisoryRiskFlags,
            providerRequestId: row.runCell.machineAssessment.providerRequestId,
            providerResponseId:
              row.runCell.machineAssessment.providerResponseId,
            resolvedModel: row.runCell.machineAssessment.resolvedModel,
            assessmentDigest: row.runCell.machineAssessment.assessmentDigest,
          }
        : null,
      reviews: row.reviews.map((review) => ({
        id: review.id,
        rubricVersion: review.rubricVersion.version,
        meaningAccuracyScore: review.meaningAccuracyScore,
        naturalnessScore: review.naturalnessScore,
        timingReadabilityScore: review.timingReadabilityScore,
        scriptureTheologyScore: review.scriptureTheologyScore,
        verdict: review.verdict,
        issueCodes: review.issueCodes,
        criticalMeaningLoss: review.criticalMeaningLoss,
        criticalHarmful: review.criticalHarmful,
        criticalScriptureRisk: review.criticalScriptureRisk,
        trackAssessments: review.trackAssessments,
        questionableTrack: review.questionableTrack,
        notes: review.notes,
        corrections: review.corrections,
        submittedAt: review.submittedAt,
      })),
    }
  }

  async resolveOperatorTrackObject({
    user,
    assignmentId,
    contentId,
  }: {
    user: Principal | null
    assignmentId: string
    contentId: string
  }) {
    assertOperatorOrManagerBackend(user)
    const id = BoundedId.parse(assignmentId)
    const digestId = Digest.parse(contentId)
    const row = await this.prisma.subtitleEvalAssignment.findUnique({
      where: { id },
      select: {
        presentationSeed: true,
        runCell: {
          select: {
            corpusCell: {
              select: { sourceSnapshot: true, referenceSnapshot: true },
            },
            artifacts: { where: { kind: "CANDIDATE_VTT" } },
          },
        },
      },
    })
    if (!row?.presentationSeed) {
      throw new NotFoundError("SubtitleEvalOperatorTrackObject", digestId)
    }
    const candidates = [
      {
        role: "SOURCE" as const,
        object: row.runCell.corpusCell.sourceSnapshot,
      },
      {
        role: "REFERENCE" as const,
        object: row.runCell.corpusCell.referenceSnapshot,
      },
      ...row.runCell.artifacts.map((object) => ({
        role: "CANDIDATE" as const,
        object,
      })),
    ]
    const resolved = candidates.find(
      ({ role, object }) =>
        opaqueReviewerTrackId(row.presentationSeed!, {
          assignmentId: id,
          role,
          objectIdentity: object.id,
        }) === digestId,
    )
    if (!resolved) {
      throw new NotFoundError("SubtitleEvalOperatorTrackObject", digestId)
    }
    return {
      objectKey: resolved.object.objectKey,
      mediaType: resolved.object.mediaType,
      byteLength: resolved.object.byteLength,
      sha256: resolved.object.sha256,
    }
  }

  async listReviewerAssignments(input: {
    actorId: string
    limit?: number
    after?: string | null
  }) {
    const limit = z
      .number()
      .int()
      .min(1)
      .max(50)
      .parse(input.limit ?? 25)
    const membership = await this.prisma.managerMembership.findUnique({
      where: { userId: BoundedId.parse(input.actorId) },
      include: {
        reviewerLanguageGrants: {
          where: { revokedAt: null },
          include: { language: { select: { slug: true, deletedAt: true } } },
        },
      },
    })
    if (!membership || membership.revokedAt || membership.role !== "REVIEWER") {
      return { nodes: [], nextCursor: null }
    }
    const identities = membership.reviewerLanguageGrants
      .filter((grant) => !grant.language.deletedAt && grant.language.slug)
      .map((grant) => ({
        targetLanguageId: grant.languageId,
        targetLanguageSlug: grant.language.slug!,
      }))
    if (identities.length === 0) return { nodes: [], nextCursor: null }
    const batchSize = Math.min(100, Math.max(25, limit + 1))
    const maxBatches = 10
    let cursor = input.after ? BoundedId.parse(input.after) : null
    let exhausted = false
    const eligible: Array<{
      id: string
      status: string
      kind: SubtitleEvalAssignmentKind
      specialistDimension: string | null
      qualificationVersion: number | null
      round: number
      targetLanguageId: string
      targetLanguageSlug: string
      assignedAt: Date
      submittedAt: Date | null
      runCell: {
        corpusCell: {
          caseId: string
          collectionKey: string
          videoId: string
        }
      }
    }> = []
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const rows = await this.prisma.subtitleEvalAssignment.findMany({
        where: {
          reviewerMembershipId: membership.id,
          OR: identities,
          status: { in: ["ASSIGNED", "IN_REVIEW", "SUBMITTED"] },
          ...(cursor ? { id: { lt: cursor } } : {}),
        },
        orderBy: { id: "desc" },
        take: batchSize,
        select: {
          id: true,
          status: true,
          kind: true,
          specialistDimension: true,
          qualificationVersion: true,
          round: true,
          targetLanguageId: true,
          targetLanguageSlug: true,
          assignedAt: true,
          submittedAt: true,
          runCell: {
            select: {
              corpusCell: {
                select: { caseId: true, collectionKey: true, videoId: true },
              },
            },
          },
        },
      })
      for (const row of rows) {
        const grant = membership.reviewerLanguageGrants.find(
          (candidate) =>
            candidate.languageId === row.targetLanguageId &&
            candidate.language.slug === row.targetLanguageSlug &&
            !candidate.language.deletedAt &&
            row.qualificationVersion != null &&
            candidate.qualificationVersion >= row.qualificationVersion,
        )
        if (
          grant &&
          this.reviewerGrantCanAcceptAssignment(
            grant,
            row.kind,
            row.specialistDimension,
          ).accepted
        ) {
          eligible.push(row)
        }
      }
      cursor = rows.at(-1)?.id ?? cursor
      exhausted = rows.length < batchSize
      if (eligible.length > limit || exhausted) break
    }
    const hasMore = eligible.length > limit || !exhausted
    const page = eligible.slice(0, limit)
    const nodes = page.map(
      ({
        specialistDimension: _specialistDimension,
        qualificationVersion: _qualificationVersion,
        ...row
      }) => row,
    )
    return {
      nodes,
      nextCursor: hasMore ? (page.at(-1)?.id ?? cursor) : null,
    }
  }

  async getReviewerAssignment(input: {
    assertion: VerifiedSubtitleReviewAssertion
  }) {
    const { assertion } = input
    if (
      assertion.method !== "GET" ||
      assertion.bodyDigest !== reviewerRequestBodyDigest("")
    ) {
      throw new ForbiddenError()
    }
    return this.prisma.$transaction(async (tx) => {
      await this.loadReviewerAssignmentAccess(tx, {
        actorId: assertion.actorId,
        assignmentId: assertion.assignmentId,
      })
      const consumedNonce = await tx.subtitleEvalAssertionNonce.findUnique({
        where: { nonceHash: assertion.nonceHash },
      })
      if (consumedNonce) {
        throw new SubtitleEvalConflictError("review_assertion_replayed")
      }
      await tx.subtitleEvalAssertionNonce.create({
        data: {
          nonceHash: assertion.nonceHash,
          assignmentId: assertion.assignmentId,
          actorId: assertion.actorId,
          expiresAt: assertion.expiresAt,
        },
      })
      const row = await tx.subtitleEvalAssignment.findUniqueOrThrow({
        where: { id: assertion.assignmentId },
        include: {
          reviews: { orderBy: { submittedAt: "asc" } },
          runCell: {
            include: {
              corpusCell: {
                include: { sourceSnapshot: true, referenceSnapshot: true },
              },
              machineAssessment: true,
              artifacts: {
                select: {
                  id: true,
                  kind: true,
                  sha256: true,
                  byteLength: true,
                  mediaType: true,
                },
              },
            },
          },
        },
      })
      const candidateTrack = row.runCell.artifacts.find(
        (artifact) => artifact.kind === "CANDIDATE_VTT",
      )
      if (!candidateTrack || !row.presentationSeed) {
        throw new SubtitleEvalConflictError("review_tracks_unavailable")
      }
      const trackFor = (
        label: "A" | "B",
        track: {
          id: string
          mediaType: string
        },
        role: "REFERENCE" | "CANDIDATE",
      ) => ({
        label,
        contentId: opaqueReviewerTrackId(row.presentationSeed!, {
          assignmentId: row.id,
          role,
          objectIdentity: track.id,
        }),
        mediaType: track.mediaType,
      })
      const referenceFirst =
        reviewerReferenceTrackLabel(row.presentationSeed, row.id) === "A"
      const first = referenceFirst
        ? row.runCell.corpusCell.referenceSnapshot
        : candidateTrack
      const firstRole = referenceFirst ? "REFERENCE" : "CANDIDATE"
      const second = referenceFirst
        ? candidateTrack
        : row.runCell.corpusCell.referenceSnapshot
      const secondRole = referenceFirst ? "CANDIDATE" : "REFERENCE"
      const clip = reviewerClip(row.runCell.corpusCell.metadata)
      const unlockingReview = row.reviews.at(-1)
      if (unlockingReview && !row.runCell.machineAssessment) {
        throw new SubtitleEvalConflictError("review_assessment_unavailable")
      }
      const assessment = row.runCell.machineAssessment
      return {
        id: row.id,
        status: row.status,
        kind: row.kind,
        round: row.round,
        targetLanguageId: row.targetLanguageId,
        targetLanguageSlug: row.targetLanguageSlug,
        caseId: row.runCell.corpusCell.caseId,
        collectionKey: row.runCell.corpusCell.collectionKey,
        videoId: row.runCell.corpusCell.videoId,
        editionIdentity: row.runCell.corpusCell.editionIdentity,
        clipStartSeconds: clip?.startSeconds ?? null,
        clipEndSeconds: clip?.endSeconds ?? null,
        sourceTrack: {
          label: "SOURCE" as const,
          contentId: opaqueReviewerTrackId(row.presentationSeed, {
            assignmentId: row.id,
            role: "SOURCE",
            objectIdentity: row.runCell.corpusCell.sourceSnapshot.id,
          }),
          mediaType: row.runCell.corpusCell.sourceSnapshot.mediaType,
        },
        trackA: trackFor("A", first, firstRole),
        trackB: trackFor("B", second, secondRole),
        submitted: row.reviews.length > 0,
        postSubmitReceipt:
          unlockingReview && assessment
            ? {
                reviewId: unlockingReview.id,
                submittedAt: unlockingReview.submittedAt,
                referenceTrackLabel: referenceFirst ? "A" : "B",
                candidateTrackLabel: referenceFirst ? "B" : "A",
                machineAdvisoryRiskFlags: Array.isArray(
                  assessment.advisoryRiskFlags,
                )
                  ? assessment.advisoryRiskFlags
                      .filter(
                        (flag): flag is string =>
                          typeof flag === "string" &&
                          flag.length > 0 &&
                          flag.length <= 191,
                      )
                      .slice(0, 100)
                  : [],
                resolvedModel: assessment.resolvedModel,
                assessmentDigest: assessment.assessmentDigest,
              }
            : null,
        reviews: row.reviews.map((review) => ({
          id: review.id,
          verdict: review.verdict,
          submittedAt: review.submittedAt,
        })),
      }
    })
  }

  /**
   * Server-only bridge for U4's authenticated BFF media route. This locator
   * must never be projected by the reviewer GraphQL types.
   */
  async resolveReviewerTrackObject(input: {
    assertion: VerifiedSubtitleReviewAssertion
    contentId: string
  }) {
    const assignmentId = input.assertion.assignmentId
    const contentId = Digest.parse(input.contentId)
    if (
      input.assertion.method !== "GET" ||
      input.assertion.bodyDigest !==
        reviewerTrackObjectRequestDigest({ assignmentId, contentId })
    ) {
      throw new ForbiddenError()
    }
    return this.prisma.$transaction(async (tx) => {
      await this.loadReviewerAssignmentAccess(tx, {
        actorId: input.assertion.actorId,
        assignmentId,
      })
      const consumed = await tx.subtitleEvalAssertionNonce.createMany({
        data: {
          nonceHash: input.assertion.nonceHash,
          assignmentId,
          actorId: input.assertion.actorId,
          expiresAt: input.assertion.expiresAt,
        },
        skipDuplicates: true,
      })
      if (consumed.count !== 1) {
        throw new SubtitleEvalConflictError("review_assertion_replayed")
      }
      const row = await tx.subtitleEvalAssignment.findUniqueOrThrow({
        where: { id: assignmentId },
        select: {
          presentationSeed: true,
          runCell: {
            select: {
              corpusCell: {
                select: { sourceSnapshot: true, referenceSnapshot: true },
              },
              artifacts: { where: { kind: "CANDIDATE_VTT" } },
            },
          },
        },
      })
      if (!row.presentationSeed) {
        throw new NotFoundError("SubtitleEvalReviewerTrackObject", contentId)
      }
      const candidates = [
        {
          role: "SOURCE" as const,
          object: row.runCell.corpusCell.sourceSnapshot,
        },
        {
          role: "REFERENCE" as const,
          object: row.runCell.corpusCell.referenceSnapshot,
        },
        ...row.runCell.artifacts.map((object) => ({
          role: "CANDIDATE" as const,
          object,
        })),
      ]
      const resolved = candidates.find(
        (candidate) =>
          opaqueReviewerTrackId(row.presentationSeed!, {
            assignmentId,
            role: candidate.role,
            objectIdentity: candidate.object.id,
          }) === contentId,
      )
      if (!resolved) {
        throw new NotFoundError("SubtitleEvalReviewerTrackObject", contentId)
      }
      return {
        objectKey: resolved.object.objectKey,
        mediaType: resolved.object.mediaType,
        byteLength: resolved.object.byteLength,
        sha256: resolved.object.sha256,
      }
    })
  }

  async submitReview({
    assertion,
    input,
  }: {
    assertion: VerifiedSubtitleReviewAssertion
    input: z.input<typeof SubmitSubtitleEvalReviewInput>
  }) {
    const parsed = SubmitSubtitleEvalReviewInput.parse(input)
    const { bodyDigest: _bodyDigest, ...semanticInput } = parsed
    void _bodyDigest
    if (
      assertion.assignmentId !== parsed.assignmentId ||
      assertion.method !== "POST" ||
      assertion.bodyDigest !== parsed.bodyDigest ||
      parsed.bodyDigest !== canonicalReviewerSubmissionDigest(semanticInput) ||
      assertion.expiresAt <= new Date()
    ) {
      throw new ForbiddenError()
    }

    return this.prisma.$transaction(
      async (tx) => {
        const hasScriptureScore = [
          parsed.trackAssessments.trackA,
          parsed.trackAssessments.trackB,
        ].some((track) => track.scriptureTheologyScore != null)
        const access = await this.loadReviewerAssignmentAccess(tx, {
          actorId: assertion.actorId,
          assignmentId: parsed.assignmentId,
          requireSpecialist: hasScriptureScore,
        })
        if (
          access.assignment.kind === "SPECIALIST" &&
          parsed.verdict === "SPECIALIST_REVIEW"
        ) {
          throw new SubtitleEvalConflictError(
            "specialist_assignment_cannot_reescalate",
          )
        }
        const reviewerMembershipId = access.assignment.reviewerMembershipId
        if (!reviewerMembershipId) throw new ForbiddenError()
        for (const dimension of [
          "MEANING_ACCURACY",
          "NATURALNESS",
          "TIMING_READABILITY",
        ] as const) {
          if (!access.grant.permittedRubricDimensions.includes(dimension)) {
            throw new ForbiddenError()
          }
        }
        if (
          hasScriptureScore &&
          !access.grant.permittedRubricDimensions.includes("SCRIPTURE_THEOLOGY")
        ) {
          throw new ForbiddenError()
        }
        const consumedNonce = await tx.subtitleEvalAssertionNonce.findUnique({
          where: { nonceHash: assertion.nonceHash },
        })
        if (consumedNonce) {
          throw new SubtitleEvalConflictError("review_assertion_replayed")
        }
        const existing = await tx.subtitleEvalHumanReview.findUnique({
          where: { idempotencyKey: parsed.idempotencyKey },
        })
        if (existing) {
          if (
            existing.assignmentId !== parsed.assignmentId ||
            existing.bodyDigest !== parsed.bodyDigest ||
            existing.reviewerMembershipId !== reviewerMembershipId
          ) {
            throw new SubtitleEvalConflictError("review_idempotency_mismatch")
          }
          await tx.subtitleEvalAssertionNonce.create({
            data: {
              nonceHash: assertion.nonceHash,
              assignmentId: parsed.assignmentId,
              actorId: assertion.actorId,
              expiresAt: assertion.expiresAt,
            },
          })
          return { review: existing, replayed: true }
        }
        if (
          access.assignment.status === "SUBMITTED" &&
          !parsed.supersedesReviewId
        ) {
          throw new SubtitleEvalConflictError("review_supersession_required")
        }
        await tx.subtitleEvalAssertionNonce.create({
          data: {
            nonceHash: assertion.nonceHash,
            assignmentId: parsed.assignmentId,
            actorId: assertion.actorId,
            expiresAt: assertion.expiresAt,
          },
        })
        const rubric = await tx.subtitleEvalRubricVersion.findUnique({
          where: { version: parsed.rubricVersion },
        })
        if (!rubric)
          throw new SubtitleEvalConflictError("rubric_version_missing")
        if (parsed.supersedesReviewId) {
          const prior = await tx.subtitleEvalHumanReview.findFirst({
            where: {
              id: parsed.supersedesReviewId,
              assignmentId: parsed.assignmentId,
              reviewerMembershipId,
              supersededBy: null,
            },
          })
          if (!prior)
            throw new SubtitleEvalConflictError("invalid_review_supersession")
        }
        if (!access.assignment.presentationSeed) {
          throw new SubtitleEvalConflictError("review_tracks_unavailable")
        }
        const referenceTrack = reviewerReferenceTrackLabel(
          access.assignment.presentationSeed,
          access.assignment.id,
        )
        const candidateAssessment =
          referenceTrack === "A"
            ? parsed.trackAssessments.trackB
            : parsed.trackAssessments.trackA
        const questionableRole =
          parsed.questionableTrack == null
            ? null
            : parsed.questionableTrack === referenceTrack
              ? "REFERENCE"
              : "CANDIDATE"
        const review = await tx.subtitleEvalHumanReview.create({
          data: {
            idempotencyKey: parsed.idempotencyKey,
            assignmentId: parsed.assignmentId,
            reviewerMembershipId,
            targetLanguageId: access.assignment.targetLanguageId,
            targetLanguageSlug: access.assignment.targetLanguageSlug,
            rubricVersionId: rubric.id,
            meaningAccuracyScore: candidateAssessment.meaningAccuracyScore,
            naturalnessScore: candidateAssessment.naturalnessScore,
            timingReadabilityScore: candidateAssessment.timingReadabilityScore,
            scriptureTheologyScore: candidateAssessment.scriptureTheologyScore,
            verdict: parsed.verdict,
            issueCodes: Array.from(new Set(candidateAssessment.issueCodes)),
            criticalMeaningLoss: candidateAssessment.criticalMeaningLoss,
            criticalHarmful: candidateAssessment.criticalHarmful,
            criticalScriptureRisk: candidateAssessment.criticalScriptureRisk,
            trackAssessments: inputJson(parsed.trackAssessments),
            questionableTrack: parsed.questionableTrack,
            notes: parsed.notes?.trim() || null,
            corrections: inputJson(parsed.corrections),
            bodyDigest: parsed.bodyDigest,
            assertionNonceHash: assertion.nonceHash,
            supersedesReviewId: parsed.supersedesReviewId ?? null,
          },
        })
        await tx.subtitleEvalAssignment.update({
          where: { id: parsed.assignmentId },
          data: { status: "SUBMITTED", submittedAt: new Date() },
        })
        if (
          parsed.verdict === "REFERENCE_QUESTIONABLE" &&
          questionableRole === "REFERENCE"
        ) {
          const assignmentCell =
            await tx.subtitleEvalAssignment.findUniqueOrThrow({
              where: { id: parsed.assignmentId },
              select: { runCell: { select: { corpusCellId: true } } },
            })
          await tx.subtitleEvalReferenceIssue.create({
            data: {
              reviewId: review.id,
              corpusCellId: assignmentCell.runCell.corpusCellId,
            },
          })
        }
        if (
          parsed.verdict === "SPECIALIST_REVIEW" &&
          access.assignment.kind !== "SPECIALIST"
        ) {
          await this.createPendingSpecialistAssignment(tx, {
            sourceAssignmentId: parsed.assignmentId,
            sourceReviewId: review.id,
            assignedById: assertion.actorId,
          })
        }
        await this.audit(tx, {
          eventType: "subtitle_eval_human_review_submitted",
          actorId: assertion.actorId,
          entityType: "human_review",
          entityId: review.id,
          requestId: assertion.requestId,
          reason:
            "Interactive language reviewer submitted append-only evidence.",
          metadata: {
            verdict: parsed.verdict,
            assignmentId: parsed.assignmentId,
            questionableRole,
          },
        })
        return { review, replayed: false }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  }

  private async createPendingSpecialistAssignment(
    tx: Prisma.TransactionClient,
    input: {
      sourceAssignmentId: string
      sourceReviewId: string
      assignedById: string
    },
  ) {
    const source = await tx.subtitleEvalAssignment.findUniqueOrThrow({
      where: { id: input.sourceAssignmentId },
    })
    const aggregate = await tx.subtitleEvalAssignment.aggregate({
      where: { runCellId: source.runCellId },
      _max: { round: true },
    })
    return tx.subtitleEvalAssignment.create({
      data: {
        runCellId: source.runCellId,
        reviewerMembershipId: null,
        targetLanguageId: source.targetLanguageId,
        targetLanguageSlug: source.targetLanguageSlug,
        round: (aggregate._max.round ?? 0) + 1,
        kind: "SPECIALIST",
        status: "BLOCKED",
        specialistDimension: "SCRIPTURE_THEOLOGY",
        presentationSeed: null,
        qualificationVersion: null,
        assignedById: input.assignedById,
        blockedReason: "Awaiting assignment to a qualified specialist.",
        escalatedFromReviewId: input.sourceReviewId,
      },
    })
  }

  async createComparison({
    user,
    input,
  }: {
    user: Principal | null
    input: {
      idempotencyKey: string
      baselineReportId: string
      candidateReportId: string
      changedAxis: SubtitleEvalChangedAxis
      createdById: string
      requestId?: string
    }
  }) {
    assertOperatorOrManagerBackend(user)
    const changedAxis = ChangedAxis.parse(input.changedAxis)
    const requestDigest = subtitleEvalComparisonRequestDigest({
      ...input,
      changedAxis,
    })
    return this.prisma.$transaction(async (tx) => {
      const replay = await tx.subtitleEvalComparison.findUnique({
        where: { idempotencyKey: BoundedId.parse(input.idempotencyKey) },
      })
      if (replay) {
        if (replay.requestDigest !== requestDigest) {
          throw new SubtitleEvalConflictError("comparison_idempotency_mismatch")
        }
        return { comparison: replay, replayed: true }
      }
      const [baseline, candidate] = await Promise.all([
        tx.subtitleEvalTerminalReport.findUnique({
          where: { id: BoundedId.parse(input.baselineReportId) },
          include: {
            run: {
              include: {
                cells: {
                  include: { corpusCell: true, machineAssessment: true },
                },
              },
            },
          },
        }),
        tx.subtitleEvalTerminalReport.findUnique({
          where: { id: BoundedId.parse(input.candidateReportId) },
          include: {
            run: {
              include: {
                cells: {
                  include: { corpusCell: true, machineAssessment: true },
                },
              },
            },
          },
        }),
      ])
      if (!baseline || !candidate || baseline.id === candidate.id) {
        throw new SubtitleEvalConflictError("comparison_reports_invalid")
      }
      if (
        baseline.run.corpusVersionId !== candidate.run.corpusVersionId ||
        baseline.corpusIdentityDigest !== candidate.corpusIdentityDigest
      ) {
        throw new SubtitleEvalConflictError(
          "comparison_corpus_identity_mismatch",
        )
      }
      const identityDifferences = this.identityDifferences(
        baseline.run,
        candidate.run,
      )
      const axisKey: Record<SubtitleEvalChangedAxis, string> = {
        MODEL: "model",
        PROMPT_POLICY: "promptPolicy",
        WORKFLOW_POLICY: "workflowPolicy",
        CODE_REVISION: "codeRevision",
        RUNTIME: "runtime",
      }
      if (
        !identityDifferences.some(
          (entry) => entry.axis === axisKey[changedAxis],
        )
      ) {
        throw new SubtitleEvalConflictError("declared_axis_unchanged")
      }
      const baselineByKey = new Map(
        baseline.run.cells.map((cell) => [
          `${cell.corpusCell.caseId}:${cell.targetLanguageId}`,
          cell,
        ]),
      )
      const candidateByKey = new Map(
        candidate.run.cells.map((cell) => [
          `${cell.corpusCell.caseId}:${cell.targetLanguageId}`,
          cell,
        ]),
      )
      const sharedKeys = [...baselineByKey.keys()].filter((key) =>
        candidateByKey.has(key),
      )
      const unmatchedCells: Array<{
        side: "baseline" | "candidate" | "pair"
        key: string
        reason?: string
      }> = [
        ...[...baselineByKey.keys()]
          .filter((key) => !candidateByKey.has(key))
          .map((key) => ({ side: "baseline" as const, key })),
        ...[...candidateByKey.keys()]
          .filter((key) => !baselineByKey.has(key))
          .map((key) => ({ side: "candidate" as const, key })),
      ]
      const evidenceCells = sharedKeys.flatMap((key) => {
        const before = baselineByKey.get(key)!
        const after = candidateByKey.get(key)!
        if (
          before.status !== "COMPLETED" ||
          after.status !== "COMPLETED" ||
          !before.machineAssessment ||
          !after.machineAssessment
        ) {
          unmatchedCells.push({ side: "pair", key, reason: "unassessed_pair" })
          return []
        }
        const metrics = numericMetricDeltas(
          before.machineAssessment.metrics,
          after.machineAssessment.metrics,
        )
        if (metrics.length === 0) {
          unmatchedCells.push({
            side: "pair",
            key,
            reason: "no_comparable_metrics",
          })
          return []
        }
        return [
          {
            key,
            targetLanguageId: before.targetLanguageId,
            collectionKey: before.corpusCell.collectionKey,
            metrics,
          },
        ]
      })
      const collections = new Set(
        evidenceCells.map((cell) => cell.collectionKey),
      )
      const descriptiveDeltas = {
        cells: evidenceCells,
        byLanguage: aggregateComparisonDeltas(
          evidenceCells,
          (cell) => cell.targetLanguageId,
        ),
        byCollection: aggregateComparisonDeltas(
          evidenceCells,
          (cell) => cell.collectionKey,
        ),
      }
      const comparison = await tx.subtitleEvalComparison.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          requestDigest,
          baselineReportId: baseline.id,
          candidateReportId: candidate.id,
          changedAxis,
          identityDifferences: inputJson(identityDifferences),
          descriptiveDeltas: inputJson(descriptiveDeltas),
          unmatchedCells: inputJson(unmatchedCells),
          matchedCellCount: evidenceCells.length,
          matchedCollectionCount: collections.size,
          coverageLabel: comparisonCoverageLabel(
            evidenceCells.length,
            collections.size,
          ),
          createdById: BoundedId.parse(input.createdById),
        },
      })
      await this.audit(tx, {
        eventType: "subtitle_eval_comparison_created",
        actorId: input.createdById,
        entityType: "comparison",
        entityId: comparison.id,
        requestId: input.requestId,
        reason: "Descriptive subtitle evaluation comparison created.",
        metadata: {
          baselineReportId: baseline.id,
          candidateReportId: candidate.id,
        },
      })
      return { comparison, replayed: false }
    })
  }

  private identityDifferences(
    baseline: {
      corpusVersionId: string
      requestedProvider: string
      requestedModel: string
      promptPolicyId: string
      workflowPolicyDigest: string
      codeRevision: string
      determinism: Prisma.JsonValue
      concurrency: number
      timeoutSeconds: number
      maxAttempts: number
    },
    candidate: {
      corpusVersionId: string
      requestedProvider: string
      requestedModel: string
      promptPolicyId: string
      workflowPolicyDigest: string
      codeRevision: string
      determinism: Prisma.JsonValue
      concurrency: number
      timeoutSeconds: number
      maxAttempts: number
    },
  ) {
    const pairs = [
      ["corpus", baseline.corpusVersionId, candidate.corpusVersionId],
      ["provider", baseline.requestedProvider, candidate.requestedProvider],
      ["model", baseline.requestedModel, candidate.requestedModel],
      ["promptPolicy", baseline.promptPolicyId, candidate.promptPolicyId],
      [
        "workflowPolicy",
        baseline.workflowPolicyDigest,
        candidate.workflowPolicyDigest,
      ],
      ["codeRevision", baseline.codeRevision, candidate.codeRevision],
      [
        "runtime",
        stableJson({
          determinism: baseline.determinism,
          concurrency: baseline.concurrency,
          timeoutSeconds: baseline.timeoutSeconds,
          maxAttempts: baseline.maxAttempts,
        }),
        stableJson({
          determinism: candidate.determinism,
          concurrency: candidate.concurrency,
          timeoutSeconds: candidate.timeoutSeconds,
          maxAttempts: candidate.maxAttempts,
        }),
      ],
    ] as const
    return pairs
      .filter(([, before, after]) => before !== after)
      .map(([axis, before, after]) => ({ axis, before, after }))
  }

  async appendExperimentNarrative({
    user,
    input,
  }: {
    user: Principal | null
    input: {
      comparisonId: string
      hypothesis: string
      conclusion?: string | null
      rationale?: string | null
      followUpAction?: string | null
      createdById: string
      requestId?: string
    }
  }) {
    assertOperatorOrManagerBackend(user)
    return this.prisma.$transaction(async (tx) => {
      const aggregate = await tx.subtitleEvalExperimentNarrative.aggregate({
        where: { comparisonId: BoundedId.parse(input.comparisonId) },
        _max: { version: true },
      })
      const narrative = await tx.subtitleEvalExperimentNarrative.create({
        data: {
          comparisonId: input.comparisonId,
          version: (aggregate._max.version ?? 0) + 1,
          hypothesis: BoundedText.parse(input.hypothesis),
          conclusion: input.conclusion?.trim() || null,
          rationale: input.rationale?.trim() || null,
          followUpAction: input.followUpAction?.trim() || null,
          createdById: BoundedId.parse(input.createdById),
        },
      })
      await this.audit(tx, {
        eventType: "subtitle_eval_narrative_appended",
        actorId: input.createdById,
        entityType: "experiment_narrative",
        entityId: narrative.id,
        requestId: input.requestId,
        reason: "Append-only subtitle evaluation narrative recorded.",
        metadata: {
          comparisonId: input.comparisonId,
          version: narrative.version,
        },
      })
      return narrative
    })
  }

  async getComparison({ user, id }: { user: Principal | null; id: string }) {
    assertOperatorOrManagerBackend(user)
    const comparison = await this.prisma.subtitleEvalComparison.findUnique({
      where: { id: BoundedId.parse(id) },
      include: {
        narratives: { orderBy: { version: "asc" }, take: 100 },
        baselineReport: { include: { run: humanEvidenceRunInclude } },
        candidateReport: { include: { run: humanEvidenceRunInclude } },
      },
    })
    if (!comparison) return null
    return {
      ...comparison,
      humanEvidence: buildHumanComparisonEvidence(
        comparison.baselineReport.run.cells,
        comparison.candidateReport.run.cells,
      ),
    }
  }

  async listReferenceIssues({
    user,
    status,
    limit = 25,
    after,
  }: {
    user: Principal | null
    status?: "OPEN" | "ACCEPTED" | "REJECTED"
    limit?: number
    after?: string | null
  }) {
    assertOperatorOrManagerBackend(user)
    const take = z.number().int().min(1).max(50).parse(limit)
    const rows = await this.prisma.subtitleEvalReferenceIssue.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(after ? { id: { lt: BoundedId.parse(after) } } : {}),
      },
      orderBy: { id: "desc" },
      take: take + 1,
      include: {
        corpusCell: {
          select: {
            id: true,
            caseId: true,
            collectionKey: true,
            targetLanguageId: true,
            targetLanguageSlug: true,
          },
        },
      },
    })
    const hasMore = rows.length > take
    const nodes = hasMore ? rows.slice(0, take) : rows
    return { nodes, nextCursor: hasMore ? (nodes.at(-1)?.id ?? null) : null }
  }

  async listStaleRuns({
    user,
    limit = 25,
    after,
    staleBefore = new Date(Date.now() - 5 * 60 * 1_000),
  }: {
    user: Principal | null
    limit?: number
    after?: string | null
    staleBefore?: Date
  }) {
    assertOperatorOrManagerBackend(user)
    const take = z.number().int().min(1).max(50).parse(limit)
    const rows = await this.prisma.subtitleEvalRun.findMany({
      where: {
        status: { in: [...ACTIVE_RUN_STATUSES] },
        ...(after ? { id: { lt: BoundedId.parse(after) } } : {}),
        OR: [
          { leaseExpiresAt: { lte: staleBefore } },
          {
            leaseTokenHash: null,
            cells: {
              some: {
                status: "RUNNING",
                leaseExpiresAt: { lte: staleBefore },
              },
            },
          },
          {
            leaseTokenHash: null,
            updatedAt: { lte: staleBefore },
            cells: {
              none: {
                status: "RUNNING",
                leaseExpiresAt: { gt: staleBefore },
              },
            },
          },
        ],
      },
      orderBy: { id: "desc" },
      take: take + 1,
      select: {
        id: true,
        status: true,
        leaseGeneration: true,
        leaseExpiresAt: true,
        updatedAt: true,
        _count: { select: { cells: true } },
      },
    })
    const hasMore = rows.length > take
    const nodes = hasMore ? rows.slice(0, take) : rows
    return { nodes, nextCursor: hasMore ? (nodes.at(-1)?.id ?? null) : null }
  }

  async claimRunRecovery({
    user,
    runId,
    leaseSeconds,
  }: {
    user: Principal | null
    runId: string
    leaseSeconds: number
  }) {
    assertOperatorOrManagerBackend(user)
    return this.claimRunRecoveryInternal({ runId, leaseSeconds })
  }

  async claimMachineRunRecovery({
    user,
    runId,
    leaseSeconds,
  }: {
    user: Principal | null
    runId: string
    leaseSeconds: number
  }) {
    assertManagerBackend(user)
    return this.claimRunRecoveryInternal({ runId, leaseSeconds })
  }

  private claimRunRecoveryInternal({
    runId,
    leaseSeconds,
  }: {
    runId: string
    leaseSeconds: number
  }) {
    const id = BoundedId.parse(runId)
    const seconds = z.number().int().min(30).max(300).parse(leaseSeconds)
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.subtitleEvalRun.findUnique({ where: { id } })
      if (!run) throw new NotFoundError("SubtitleEvalRun", id)
      if (
        !ACTIVE_RUN_STATUSES.includes(
          run.status as (typeof ACTIVE_RUN_STATUSES)[number],
        )
      ) {
        throw new SubtitleEvalConflictError("run_not_recoverable")
      }
      const now = new Date()
      if (run.leaseExpiresAt && run.leaseExpiresAt > now) {
        throw new SubtitleEvalConflictError("run_recovery_lease_active")
      }
      const token = randomUUID()
      const expiresAt = new Date(now.getTime() + seconds * 1_000)
      const claimed = await tx.subtitleEvalRun.updateMany({
        where: {
          id,
          leaseGeneration: run.leaseGeneration,
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
        },
        data: {
          leaseGeneration: { increment: 1 },
          leaseTokenHash: leaseTokenHash(token),
          leaseExpiresAt: expiresAt,
        },
      })
      if (claimed.count !== 1) {
        throw new SubtitleEvalConflictError("run_recovery_fence_lost")
      }
      return {
        runId: id,
        leaseGeneration: run.leaseGeneration + 1,
        leaseToken: token,
        leaseExpiresAt: expiresAt,
      }
    })
  }

  async recoverRun({
    user,
    input,
  }: {
    user: Principal | null
    input: {
      runId: string
      leaseGeneration: number
      leaseToken: string
      dispatchFailed?: boolean
      requestId?: string
      actorId: string
    }
  }) {
    assertOperatorOrManagerBackend(user)
    return this.recoverRunInternal(input)
  }

  async recoverMachineRun({
    user,
    input,
  }: {
    user: Principal | null
    input: {
      runId: string
      leaseGeneration: number
      leaseToken: string
      dispatchFailed?: boolean
    }
  }) {
    assertManagerBackend(user)
    return this.recoverRunInternal({
      ...input,
      actorId: "subtitle-eval-recovery-scheduler",
      requestId: `scheduled-recovery:${BoundedId.parse(input.runId)}:${z
        .number()
        .int()
        .positive()
        .parse(input.leaseGeneration)}`,
    })
  }

  private recoverRunInternal(input: {
    runId: string
    leaseGeneration: number
    leaseToken: string
    dispatchFailed?: boolean
    requestId?: string
    actorId: string
  }) {
    const runId = BoundedId.parse(input.runId)
    const generation = z.number().int().positive().parse(input.leaseGeneration)
    const tokenHash = leaseTokenHash(BoundedId.parse(input.leaseToken))
    return this.prisma.$transaction(async (tx) => {
      const now = new Date()
      const run = await tx.subtitleEvalRun.findFirst({
        where: {
          id: runId,
          leaseGeneration: generation,
          leaseTokenHash: tokenHash,
          leaseExpiresAt: { gt: now },
        },
        include: { cells: true },
      })
      if (!run) throw new SubtitleEvalConflictError("run_recovery_fence_lost")
      const activeCell = run.cells.find(
        (cell) =>
          cell.status === "RUNNING" &&
          cell.leaseExpiresAt != null &&
          cell.leaseExpiresAt > now,
      )
      if (activeCell) {
        throw new SubtitleEvalConflictError("cell_lease_active")
      }
      let requeued = 0
      let terminalized = 0
      for (const cell of run.cells) {
        if (cell.status !== "QUEUED" && cell.status !== "RUNNING") continue
        const mustFail =
          input.dispatchFailed === true || cell.attemptCount >= run.maxAttempts
        if (mustFail) {
          const failed = await tx.subtitleEvalRunCell.updateMany({
            where: {
              id: cell.id,
              status: cell.status,
              leaseGeneration: cell.leaseGeneration,
              ...(cell.status === "RUNNING"
                ? { leaseExpiresAt: { lte: now } }
                : {}),
            },
            data: {
              status: "FAILED",
              errorCode: input.dispatchFailed
                ? "dispatch_failed"
                : "lease_expired_attempts_exhausted",
              errorRetryable: false,
              leaseTokenHash: null,
              leaseExpiresAt: null,
              completedAt: now,
            },
          })
          if (failed.count !== 1) {
            throw new SubtitleEvalConflictError("cell_recovery_fence_lost")
          }
          terminalized += 1
        } else if (cell.status === "RUNNING") {
          const queued = await tx.subtitleEvalRunCell.updateMany({
            where: {
              id: cell.id,
              status: "RUNNING",
              leaseGeneration: cell.leaseGeneration,
              leaseExpiresAt: { lte: now },
            },
            data: {
              status: "QUEUED",
              errorCode: "lease_expired_retryable",
              errorRetryable: true,
              leaseTokenHash: null,
              leaseExpiresAt: null,
            },
          })
          if (queued.count !== 1) {
            throw new SubtitleEvalConflictError("cell_recovery_fence_lost")
          }
          requeued += 1
        }
      }
      const released = await tx.subtitleEvalRun.updateMany({
        where: {
          id: run.id,
          leaseGeneration: generation,
          leaseTokenHash: tokenHash,
        },
        data: { leaseTokenHash: null, leaseExpiresAt: null },
      })
      if (released.count !== 1) {
        throw new SubtitleEvalConflictError("run_recovery_fence_lost")
      }
      await this.audit(tx, {
        eventType: "subtitle_eval_run_recovered",
        actorId: BoundedId.parse(input.actorId),
        entityType: "run",
        entityId: run.id,
        requestId: input.requestId,
        reason: "Stale subtitle evaluation work recovered with fencing.",
        metadata: {
          requeued,
          terminalized,
          dispatchFailed: input.dispatchFailed,
        },
      })
      return {
        runId: run.id,
        requeuedCellCount: requeued,
        terminalizedCellCount: terminalized,
        readyToFinalize:
          requeued === 0 &&
          (input.dispatchFailed === true ||
            !run.cells.some((cell) => cell.status === "QUEUED")),
      }
    })
  }

  async listRuns({
    user,
    limit = 25,
    after,
  }: {
    user: Principal | null
    limit?: number
    after?: string | null
  }) {
    assertOperatorOrManagerBackend(user)
    const take = z.number().int().min(1).max(50).parse(limit)
    const rows = await this.prisma.subtitleEvalRun.findMany({
      where: after ? { id: { lt: after } } : undefined,
      orderBy: { id: "desc" },
      take: take + 1,
      select: {
        id: true,
        status: true,
        requestedProvider: true,
        requestedModel: true,
        promptPolicyId: true,
        codeRevision: true,
        createdAt: true,
        terminalAt: true,
        _count: { select: { cells: true } },
      },
    })
    const hasMore = rows.length > take
    const nodes = hasMore ? rows.slice(0, take) : rows
    return { nodes, nextCursor: hasMore ? (nodes.at(-1)?.id ?? null) : null }
  }

  async getRun({ user, id }: { user: Principal | null; id: string }) {
    assertOperatorOrManagerBackend(user)
    return this.prisma.subtitleEvalRun.findUnique({
      where: { id: BoundedId.parse(id) },
      include: {
        corpusVersion: true,
        terminalReport: true,
        cells: {
          include: {
            corpusCell: true,
            artifacts: true,
            machineAssessment: true,
            providerCalls: true,
            assignments: { include: { reviews: true } },
          },
        },
      },
    })
  }

  private audit(
    tx: Prisma.TransactionClient,
    input: {
      eventType: string
      actorId: string
      entityType: string
      entityId: string
      requestId?: string
      reason: string
      metadata: unknown
    },
  ) {
    return tx.subtitleEvalAuditEvent.create({
      data: {
        eventType: input.eventType,
        actorId: input.actorId,
        entityType: input.entityType,
        entityId: input.entityId,
        requestId: BoundedId.parse(input.requestId ?? randomUUID()),
        reason: input.reason,
        metadata: inputJson(input.metadata),
      },
    })
  }
}

type ProviderCallEvidence = {
  leaseGeneration: number
  callSequence: number
  operation: string
  chunkIndex: number | null
  operationAttempt: number
  status: string
  requestDigest: string
  providerRequestId: string | null
  providerResponseId: string | null
  requestedModel: string
  resolvedModel: string | null
  usage: unknown
}

function providerCallEvidence(call: ProviderCallEvidence) {
  return {
    leaseGeneration: call.leaseGeneration,
    callSequence: call.callSequence,
    operation: call.operation,
    chunkIndex: call.chunkIndex,
    operationAttempt: call.operationAttempt,
    status: call.status,
    requestDigest: call.requestDigest,
    providerRequestId: call.providerRequestId,
    providerResponseId: call.providerResponseId,
    requestedModel: call.requestedModel,
    resolvedModel: call.resolvedModel,
    usage: call.usage,
  }
}

async function persistProviderCalls(
  tx: Prisma.TransactionClient,
  runCellId: string,
  leaseGeneration: number,
  calls: z.infer<typeof SubtitleEvalProviderCallsInput>,
) {
  if (calls.length === 0) return
  const existing = await tx.subtitleEvalProviderCall.findMany({
    where: { runCellId, leaseGeneration },
    orderBy: { callSequence: "asc" },
  })
  const expected = calls.map((call) => ({
    leaseGeneration,
    ...call,
  }))
  if (existing.length > 0) {
    if (
      digest(existing.map(providerCallEvidence)) !==
      digest(expected.map(providerCallEvidence))
    ) {
      throw new SubtitleEvalConflictError("provider_call_replay_mismatch")
    }
    return
  }
  await tx.subtitleEvalProviderCall.createMany({
    data: calls.map((call) => ({
      runCellId,
      leaseGeneration,
      callSequence: call.callSequence,
      operation: call.operation,
      chunkIndex: call.chunkIndex,
      operationAttempt: call.operationAttempt,
      status: call.status,
      requestDigest: call.requestDigest,
      providerRequestId: call.providerRequestId,
      providerResponseId: call.providerResponseId,
      requestedModel: call.requestedModel,
      resolvedModel: call.resolvedModel,
      usage: call.usage == null ? Prisma.DbNull : inputJson(call.usage),
    })),
  })
}

async function assertProviderCallReplay(
  tx: Prisma.TransactionClient,
  runCellId: string,
  leaseGeneration: number,
  calls: z.infer<typeof SubtitleEvalProviderCallsInput>,
) {
  const existing = await tx.subtitleEvalProviderCall.findMany({
    where: { runCellId, leaseGeneration },
    orderBy: { callSequence: "asc" },
  })
  const expected = calls.map((call) => ({ leaseGeneration, ...call }))
  if (
    digest(existing.map(providerCallEvidence)) !==
    digest(expected.map(providerCallEvidence))
  ) {
    throw new SubtitleEvalConflictError("provider_call_replay_mismatch")
  }
}

function reviewerClip(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const benchmarkCase = (value as Record<string, unknown>).case
  if (
    !benchmarkCase ||
    typeof benchmarkCase !== "object" ||
    Array.isArray(benchmarkCase)
  ) {
    return null
  }
  const clip = (benchmarkCase as Record<string, unknown>).clip
  if (!clip || typeof clip !== "object" || Array.isArray(clip)) return null
  const startSeconds = (clip as Record<string, unknown>).startSeconds
  const endSeconds = (clip as Record<string, unknown>).endSeconds
  return typeof startSeconds === "number" &&
    Number.isFinite(startSeconds) &&
    typeof endSeconds === "number" &&
    Number.isFinite(endSeconds) &&
    startSeconds >= 0 &&
    endSeconds > startSeconds
    ? { startSeconds, endSeconds }
    : null
}

function numericMetricDeltas(
  before: Prisma.JsonValue | undefined,
  after: Prisma.JsonValue | undefined,
) {
  const beforeMetrics = flattenNumericMetrics(before)
  const afterMetrics = flattenNumericMetrics(after)
  return [...beforeMetrics.keys()]
    .filter((key) => afterMetrics.has(key))
    .sort()
    .map((key) => ({
      metric: key,
      baseline: beforeMetrics.get(key)!,
      candidate: afterMetrics.get(key)!,
      delta: afterMetrics.get(key)! - beforeMetrics.get(key)!,
    }))
}

const humanEvidenceRunInclude =
  Prisma.validator<Prisma.SubtitleEvalRunDefaultArgs>()({
    include: {
      cells: {
        include: {
          corpusCell: {
            select: { caseId: true, collectionKey: true },
          },
          assignments: {
            orderBy: [{ round: "asc" }, { kind: "asc" }],
            include: {
              reviews: {
                where: { supersededBy: null },
                orderBy: { submittedAt: "desc" },
                take: 1,
                select: {
                  id: true,
                  verdict: true,
                  meaningAccuracyScore: true,
                  naturalnessScore: true,
                  timingReadabilityScore: true,
                  scriptureTheologyScore: true,
                  submittedAt: true,
                },
              },
            },
          },
        },
      },
    },
  })

type HumanEvidenceRun = Prisma.SubtitleEvalRunGetPayload<
  typeof humanEvidenceRunInclude
>
type HumanEvidenceCell = HumanEvidenceRun["cells"][number]
type HumanScoreKey =
  | "meaningAccuracyScore"
  | "naturalnessScore"
  | "timingReadabilityScore"
  | "scriptureTheologyScore"

const HUMAN_SCORE_KEYS: readonly HumanScoreKey[] = [
  "meaningAccuracyScore",
  "naturalnessScore",
  "timingReadabilityScore",
  "scriptureTheologyScore",
]

function buildHumanComparisonEvidence(
  baselineCells: readonly HumanEvidenceCell[],
  candidateCells: readonly HumanEvidenceCell[],
) {
  const keyFor = (cell: HumanEvidenceCell) =>
    `${cell.corpusCell.caseId}:${cell.targetLanguageId}`
  const baselineByKey = new Map(
    baselineCells.map((cell) => [keyFor(cell), cell]),
  )
  const candidateByKey = new Map(
    candidateCells.map((cell) => [keyFor(cell), cell]),
  )
  const keys = [
    ...new Set([...baselineByKey.keys(), ...candidateByKey.keys()]),
  ].sort()
  const cells = keys.map((key) => {
    const baseline = baselineByKey.get(key)
    const candidate = candidateByKey.get(key)
    const baselineEvidence = summarizeHumanCell(baseline)
    const candidateEvidence = summarizeHumanCell(candidate)
    const matched = baseline != null && candidate != null
    const reviewed =
      baselineEvidence.status === "REVIEWED" &&
      candidateEvidence.status === "REVIEWED"
    return {
      key,
      targetLanguageId:
        baseline?.targetLanguageId ?? candidate?.targetLanguageId ?? "unknown",
      collectionKey:
        baseline?.corpusCell.collectionKey ??
        candidate?.corpusCell.collectionKey ??
        "unknown",
      status: !matched ? "UNMATCHED" : reviewed ? "REVIEWED" : "PENDING",
      baseline: baselineEvidence,
      candidate: candidateEvidence,
      scoreDeltas: reviewed
        ? humanScoreDeltas(
            baselineEvidence.meanScores,
            candidateEvidence.meanScores,
          )
        : null,
      verdictChanged:
        reviewed &&
        digest(baselineEvidence.verdictCounts) !==
          digest(candidateEvidence.verdictCounts),
    }
  })
  const reviewedCells = cells.filter(
    (
      cell,
    ): cell is (typeof cells)[number] & {
      scoreDeltas: NonNullable<(typeof cells)[number]["scoreDeltas"]>
    } => cell.status === "REVIEWED" && cell.scoreDeltas != null,
  )
  return {
    mode: "LIVE_LATEST_NON_SUPERSEDED" as const,
    generatedAt: new Date().toISOString(),
    cells,
    byLanguage: aggregateHumanComparisonEvidence(
      reviewedCells,
      (cell) => cell.targetLanguageId,
    ),
    byCollection: aggregateHumanComparisonEvidence(
      reviewedCells,
      (cell) => cell.collectionKey,
    ),
    reviewedPairCount: reviewedCells.length,
    pendingPairCount: cells.filter((cell) => cell.status === "PENDING").length,
    unmatchedPairCount: cells.filter((cell) => cell.status === "UNMATCHED")
      .length,
  }
}

function summarizeHumanCell(cell: HumanEvidenceCell | undefined) {
  if (!cell) {
    return {
      status: "UNMATCHED" as const,
      reviewCount: 0,
      rounds: [],
      verdictCounts: {},
      meanScores: {},
    }
  }
  const rounds = cell.assignments.flatMap((assignment) => {
    const review = assignment.reviews[0]
    return review
      ? [
          {
            assignmentKind: assignment.kind,
            round: assignment.round,
            verdict: review.verdict,
            submittedAt: review.submittedAt.toISOString(),
          },
        ]
      : []
  })
  const reviews = cell.assignments.flatMap((assignment) => assignment.reviews)
  const hasOutstandingRequiredAssignment = cell.assignments.some(
    (assignment) =>
      assignment.status !== "SUBMITTED" && assignment.status !== "CANCELLED",
  )
  const verdictCounts = reviews.reduce<Record<string, number>>(
    (counts, review) => ({
      ...counts,
      [review.verdict]: (counts[review.verdict] ?? 0) + 1,
    }),
    {},
  )
  const meanScores = Object.fromEntries(
    HUMAN_SCORE_KEYS.flatMap((key) => {
      const values = reviews
        .map((review) => review[key])
        .filter((value): value is number => value != null)
      return values.length === 0
        ? []
        : [[key, values.reduce((sum, value) => sum + value, 0) / values.length]]
    }),
  ) as Partial<Record<HumanScoreKey, number>>
  return {
    status:
      reviews.length > 0 && !hasOutstandingRequiredAssignment
        ? ("REVIEWED" as const)
        : ("PENDING" as const),
    reviewCount: reviews.length,
    rounds,
    verdictCounts,
    meanScores,
  }
}

function humanScoreDeltas(
  baseline: Partial<Record<HumanScoreKey, number>>,
  candidate: Partial<Record<HumanScoreKey, number>>,
) {
  return HUMAN_SCORE_KEYS.flatMap((metric) => {
    const before = baseline[metric]
    const after = candidate[metric]
    return before == null || after == null
      ? []
      : [{ metric, baseline: before, candidate: after, delta: after - before }]
  })
}

function aggregateHumanComparisonEvidence<
  T extends {
    scoreDeltas: Array<{ metric: string; delta: number }>
    verdictChanged: boolean
  },
>(cells: readonly T[], groupKey: (cell: T) => string) {
  const groups = new Map<
    string,
    { verdictChangeCount: number; values: Map<string, number[]> }
  >()
  for (const cell of cells) {
    const key = groupKey(cell)
    const group = groups.get(key) ?? {
      verdictChangeCount: 0,
      values: new Map<string, number[]>(),
    }
    if (cell.verdictChanged) group.verdictChangeCount += 1
    for (const metric of cell.scoreDeltas) {
      const values = group.values.get(metric.metric) ?? []
      values.push(metric.delta)
      group.values.set(metric.metric, values)
    }
    groups.set(key, group)
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, group]) => ({
      key,
      reviewedPairCount: cells.filter((cell) => groupKey(cell) === key).length,
      verdictChangeCount: group.verdictChangeCount,
      scoreDeltas: [...group.values.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([metric, values]) => ({
          metric,
          sampleCount: values.length,
          meanDelta:
            values.reduce((total, value) => total + value, 0) / values.length,
        })),
    }))
}

function aggregateComparisonDeltas<
  T extends {
    metrics: Array<{ metric: string; delta: number }>
  },
>(cells: readonly T[], groupKey: (cell: T) => string) {
  const groups = new Map<
    string,
    { sampleCount: number; values: Map<string, number[]> }
  >()
  for (const cell of cells) {
    const key = groupKey(cell)
    const group = groups.get(key) ?? {
      sampleCount: 0,
      values: new Map<string, number[]>(),
    }
    group.sampleCount += 1
    for (const metric of cell.metrics) {
      const values = group.values.get(metric.metric) ?? []
      values.push(metric.delta)
      group.values.set(metric.metric, values)
    }
    groups.set(key, group)
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, group]) => ({
      key,
      sampleCount: group.sampleCount,
      metrics: [...group.values.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([metric, values]) => ({
          metric,
          sampleCount: values.length,
          meanDelta:
            values.reduce((total, value) => total + value, 0) / values.length,
        })),
    }))
}

function aggregateAssessmentMetrics<
  T extends {
    machineAssessment: { metrics: Prisma.JsonValue } | null
  },
>(cells: readonly T[], groupKey: (cell: T) => string) {
  const groups = new Map<
    string,
    { sampleCount: number; totals: Map<string, number> }
  >()
  for (const cell of cells) {
    if (!cell.machineAssessment) continue
    const key = groupKey(cell)
    const group = groups.get(key) ?? {
      sampleCount: 0,
      totals: new Map<string, number>(),
    }
    group.sampleCount += 1
    for (const [metric, value] of flattenNumericMetrics(
      cell.machineAssessment.metrics,
    )) {
      group.totals.set(metric, (group.totals.get(metric) ?? 0) + value)
    }
    groups.set(key, group)
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, group]) => ({
      key,
      sampleCount: group.sampleCount,
      metrics: [...group.totals.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([metric, total]) => ({
          metric,
          mean: total / group.sampleCount,
        })),
    }))
}

function flattenNumericMetrics(
  value: unknown,
  prefix = "",
  result = new Map<string, number>(),
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return result
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof child === "number" && Number.isFinite(child))
      result.set(path, child)
    else flattenNumericMetrics(child, path, result)
  }
  return result
}
