export class StudioProductionContractError extends Error {}
import {
  studioExperimentDraftSchema,
  studioExperimentRequestSchema,
} from "./experiments"
import { z } from "zod"
import {
  studioApplySchema,
  studioAssetReferenceSchema,
  studioCommandBaseSchema,
  studioIdSchema,
  studioTextPropertiesSchema,
} from "./index"
import { studioNarrationIdentitySchema } from "./assets"
export const studioPronunciationLocatorsSchema = z
  .array(
    z
      .object({
        pronunciation_dictionary_id: z.string().min(1).max(128),
        version_id: z.string().min(1).max(128),
      })
      .strict(),
  )
  .max(3)
export const studioNarrationPlanSchema = z
  .object({
    projectId: studioIdSchema,
    revision: z.number().int().positive(),
    segments: z
      .array(
        z
          .object({
            itemId: studioIdSchema,
            identity: studioNarrationIdentitySchema,
            pronunciationLocators: studioPronunciationLocatorsSchema.default(
              [],
            ),
            matches: z.array(studioAssetReferenceSchema).max(100),
          })
          .strict(),
      )
      .max(1000),
  })
  .strict()
export const studioProductionRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("experiment-estimate"),
      input: studioExperimentDraftSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("experiment-run"),
      input: studioExperimentRequestSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("experiment-register"),
      runId: studioIdSchema,
      candidateKey: studioIdSchema,
      name: z.string().min(1).max(100),
      confirmed: z.literal(true),
    })
    .strict(),

  z
    .object({
      kind: z.literal("plan"),
      projectId: studioIdSchema,
      expectedRevision: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("narrate"),
      input: studioCommandBaseSchema,
      maxCostMicros: z.number().int().nonnegative().max(100000000),
      confirmed: z.literal(true),
    })
    .strict(),
  z.object({ kind: z.literal("resume"), runId: studioIdSchema }).strict(),
  z
    .object({
      kind: z.literal("status"),
      runId: studioIdSchema,
      after: studioIdSchema.optional(),
    })
    .strict(),
  z.object({ kind: z.literal("cancel"), runId: studioIdSchema }).strict(),
])

export const studioRoleCoverageSchema = z
  .object({
    role: studioIdSchema,
    status: z.enum(["present", "absent", "not_checked"]),
    itemIds: z.array(studioIdSchema).max(1000),
  })
  .strict()
export const studioQualityReportSchema = z
  .object({
    coverage: z.array(studioRoleCoverageSchema).max(64),
    findings: z
      .array(
        z
          .object({
            criterion: studioIdSchema,
            status: z.enum(["pass", "fail", "not_checked"]),
            reason: z.string().min(1).max(2000),
            itemIds: z.array(studioIdSchema).max(1000),
            sources: z.array(studioAssetReferenceSchema).max(32),
          })
          .strict(),
      )
      .max(64),
  })
  .strict()
export const studioCoverageFeedbackSchema = z
  .object({
    code: z.enum([
      "ROLE_COVERAGE_MISMATCH",
      "ROLE_COVERAGE_DUPLICATE",
      "ROLE_COVERAGE_UNCHECKED_IDS",
    ]),
    role: studioIdSchema,
    expectedItemCount: z.number().int().min(0).max(1000),
    expectedItemIds: z.array(studioIdSchema).max(8),
    expectedItemIdsComplete: z.boolean(),
    observedRoles: z.array(studioIdSchema).max(8),
    observedRolesComplete: z.boolean(),
  })
  .strict()
export const studioCoverageRejectionSchema = z
  .object({
    error: z.literal("Studio role coverage rejected"),
    feedback: studioCoverageFeedbackSchema,
  })
  .strict()
export class StudioCoverageError extends Error {
  constructor(
    message: string,
    readonly feedback: z.infer<typeof studioCoverageFeedbackSchema>,
  ) {
    super(message)
  }
}

/** Known schema facts only; never include supplied property values or arbitrary keys. */
export const studioProposalFieldFeedbackSchema = z
  .object({
    code: z.literal("PROPOSAL_FIELD_TYPE_MISMATCH"),
    issues: z
      .array(
        z
          .object({
            path: z.tuple([
              z.literal("operations"),
              z.number().int().min(0).max(99),
              z.literal("properties"),
              studioTextPropertiesSchema.keyof(),
            ]),
            expected: z.enum(["number", "string"]),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict()
export const studioProposalFieldRejectionSchema = z
  .object({
    error: z.literal("Studio proposal fields rejected"),
    feedback: studioProposalFieldFeedbackSchema,
  })
  .strict()
export class StudioProposalFieldError extends Error {
  constructor(
    readonly feedback: z.infer<typeof studioProposalFieldFeedbackSchema>,
  ) {
    super("Studio proposal fields rejected")
  }
}
function coverageError(
  document: import("./index").StudioDocument,
  role: string,
  code: z.infer<typeof studioCoverageFeedbackSchema>["code"],
  message: string,
) {
  const spoken = document.items.filter(
    (item) =>
      item.speech && !item.speech.suppressed && item.speech.text.length > 0,
  )
  const actual = spoken
    .filter((item) => item.speech!.role === role)
    .map((item) => item.id)
    .sort()
  const roles = [...new Set(spoken.map((item) => item.speech!.role))].sort()
  return new StudioCoverageError(message, {
    code,
    role,
    expectedItemCount: actual.length,
    expectedItemIds: actual.slice(0, 8),
    expectedItemIdsComplete: actual.length <= 8,
    observedRoles: roles.slice(0, 8),
    observedRolesComplete: roles.length <= 8,
  })
}
/** Role presence is a timeline fact. No particular role or creative arrangement is mandatory. */
export function validateStudioRoleCoverage(
  document: import("./index").StudioDocument,
  raw: unknown,
) {
  const claims = z.array(studioRoleCoverageSchema).max(64).parse(raw)
  const duplicate = claims.find(
    (claim, index) =>
      claims.findIndex((other) => other.role === claim.role) !== index,
  )
  if (duplicate)
    throw coverageError(
      document,
      duplicate.role,
      "ROLE_COVERAGE_DUPLICATE",
      "Duplicate role coverage",
    )
  for (const claim of claims) {
    const actual = document.items
      .filter(
        (i) =>
          i.speech?.role === claim.role &&
          !i.speech.suppressed &&
          i.speech.text.length > 0,
      )
      .map((i) => i.id)
      .sort()
    if (claim.status === "not_checked") {
      if (claim.itemIds.length)
        throw coverageError(
          document,
          claim.role,
          "ROLE_COVERAGE_UNCHECKED_IDS",
          "Unchecked coverage cannot assert item identities",
        )
      continue
    }
    if (
      (claim.status === "present") !== Boolean(actual.length) ||
      JSON.stringify([...claim.itemIds].sort()) !== JSON.stringify(actual)
    )
      throw coverageError(
        document,
        claim.role,
        "ROLE_COVERAGE_MISMATCH",
        "Role coverage disagrees with admitted effective speech",
      )
  }
  return claims
}

export const studioValidateProposalSchema = z
  .object({
    command: studioApplySchema,
    quality: studioQualityReportSchema.optional(),
  })
  .strict()

/** Reserve room for immutable per-item audio bindings before any paid request.
 * IDs/digests use their contract maxima; timeline numeric fields may grow during ripple.
 */
export function assertStudioNarrationCapacity(
  document: import("./index").StudioDocument,
) {
  const spoken = document.items.filter(
    (i) => i.speech && !i.speech.suppressed && i.speech.text.length,
  )
  const bound = document.items.filter(
    (i) =>
      i.kind === "audio" &&
      i.narrationFor &&
      spoken.some((s) => s.id === i.narrationFor),
  )
  if (document.items.length - bound.length + spoken.length > 1000)
    throw new StudioProductionContractError(
      "Narration attachment would exceed 1,000 items; split this explicit production batch into smaller projects",
    )
  const track = document.tracks.find((t) => t.id === "studio-narration")
  if (
    (track && track.kind !== "audio") ||
    (!track && spoken.length && document.tracks.length >= 64)
  )
    throw new StudioProductionContractError(
      "Narration needs an available audio track before dispatch",
    )
  const ref = {
    assetId: "a".repeat(128),
    versionId: "v".repeat(128),
    digest: "d".repeat(64),
  }
  const items = document.items
    .filter((i) => !bound.includes(i))
    .concat(
      spoken.map((item) => ({
        id: "narration-" + "a".repeat(32),
        kind: "audio" as const,
        trackId: "studio-narration",
        linkedTo: item.id,
        narrationFor: item.id,
        startFrame: 86400000,
        durationInFrames: 86400000,
        sourceStartMs: 0,
        volume: 1,
        timingLocked: false,
        asset: ref,
      })),
    )
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      ...document,
      items,
      tracks: track
        ? document.tracks
        : [...document.tracks, { id: "studio-narration", kind: "audio" }],
    }),
  ).length
  if (bytes + document.items.length * 32 > 262144)
    throw new StudioProductionContractError(
      "Narration attachment may exceed 256 KiB; reduce this composition before dispatch",
    )
  let chunks = 1,
    entries: unknown[] = []
  for (const item of spoken) {
    const entry = { itemId: item.id, asset: ref, durationMs: 3600000 }
    if (
      entries.length === 64 ||
      new TextEncoder().encode(
        JSON.stringify({ version: 1, entries: [...entries, entry] }),
      ).length > 32768
    ) {
      chunks++
      entries = []
    }
    entries.push(entry)
  }
  if (chunks > 16)
    throw new StudioProductionContractError(
      "Narration manifest exceeds 16 bounded chunks; reduce this production batch",
    )
}

/** Same deterministic spoken order for review, approval hashing, dispatch and reconciliation. */
export function orderedStudioSpeech(
  document: import("./index").StudioDocument,
) {
  return document.items
    .filter((item) => item.speech)
    .sort(
      (a, b) =>
        a.startFrame - b.startFrame ||
        document.tracks.findIndex((track) => track.id === a.trackId) -
          document.tracks.findIndex((track) => track.id === b.trackId) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
}

export const studioProductionListSchema = z
  .object({
    projectId: studioIdSchema.optional(),
    kind: z.enum(["narration", "experiment"]).optional(),
    before: z
      .object({ createdAt: z.string().datetime(), id: studioIdSchema })
      .strict()
      .optional(),
  })
  .strict()

export const STUDIO_SPEECH_FEEDBACK_LIMITS = Object.freeze({
  inlineBytes: 30720,
  nativeBytes: 32768,
})
const feedbackCount = z.number().int().nonnegative().max(1000)
const feedbackDigest = z.string().regex(/^[a-f0-9]{64}$/)
const speechFeedbackHeader = z
  .object({
    version: z.literal(1),
    projectId: studioIdSchema,
    baseRevision: z.number().int().positive(),
    language: studioIdSchema,
    operationsDigest: feedbackDigest,
    scriptDigest: feedbackDigest,
    speechItemCount: feedbackCount,
    spokenItemCount: feedbackCount,
    suppressedItemCount: feedbackCount,
    emptyItemCount: feedbackCount,
    exactTextUtf8Bytes: z.number().int().nonnegative().max(32_000_000),
  })
  .strict()
const speechFeedbackItem = z
  .object({
    itemId: studioIdSchema,
    trackId: studioIdSchema,
    startFrame: z.number().int().nonnegative(),
    durationInFrames: z.number().int().positive(),
    role: studioIdSchema,
    suppressed: z.boolean(),
    text: z.string().max(8000),
    spoken: z.boolean(),
  })
  .strict()
export const studioEffectiveSpeechSchema = z
  .discriminatedUnion("view", [
    speechFeedbackHeader
      .extend({
        view: z.literal("inline"),
        complete: z.literal(true),
        items: z.array(speechFeedbackItem).max(1000),
      })
      .strict(),
    speechFeedbackHeader
      .extend({
        view: z.literal("unavailable"),
        complete: z.literal(false),
        reason: z.literal("INLINE_BYTE_LIMIT"),
        inlineByteLimit: z.literal(30720),
      })
      .strict(),
  ])
  .superRefine((value, ctx) => {
    const invalid = () =>
      ctx.addIssue({
        code: "custom",
        message: "Invalid canonical speech feedback",
      })
    if (
      [
        value.spokenItemCount,
        value.suppressedItemCount,
        value.emptyItemCount,
      ].some((n) => n > value.speechItemCount)
    )
      invalid()
    if (value.view === "inline") {
      if (
        new TextEncoder().encode(JSON.stringify(value)).length >
        STUDIO_SPEECH_FEEDBACK_LIMITS.inlineBytes
      )
        invalid()
      if (
        value.items.length !== value.speechItemCount ||
        new Set(value.items.map((i) => i.itemId)).size !== value.items.length ||
        value.items.filter((i) => i.spoken).length !== value.spokenItemCount ||
        value.items.filter((i) => i.suppressed).length !==
          value.suppressedItemCount ||
        value.items.filter((i) => !i.text.length).length !==
          value.emptyItemCount ||
        value.items.some(
          (i) => i.spoken !== (!i.suppressed && i.text.length > 0),
        ) ||
        value.items.reduce(
          (sum, i) => sum + new TextEncoder().encode(i.text).length,
          0,
        ) !== value.exactTextUtf8Bytes
      )
        invalid()
    }
  })
export type StudioEffectiveSpeech = z.infer<typeof studioEffectiveSpeechSchema>
export function unavailableStudioSpeech(
  value: StudioEffectiveSpeech,
): StudioEffectiveSpeech {
  const {
    version,
    projectId,
    baseRevision,
    language,
    operationsDigest,
    scriptDigest,
    speechItemCount,
    spokenItemCount,
    suppressedItemCount,
    emptyItemCount,
    exactTextUtf8Bytes,
  } = value
  return {
    version,
    projectId,
    baseRevision,
    language,
    operationsDigest,
    scriptDigest,
    speechItemCount,
    spokenItemCount,
    suppressedItemCount,
    emptyItemCount,
    exactTextUtf8Bytes,
    view: "unavailable",
    complete: false,
    reason: "INLINE_BYTE_LIMIT",
    inlineByteLimit: 30720,
  }
}
export const studioProposalValidationResultSchema = z
  .object({
    valid: z.literal(true),
    projectId: studioIdSchema,
    revision: z.number().int().positive(),
    quality: studioQualityReportSchema.optional(),
    effectiveSpeech: studioEffectiveSpeechSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.projectId !== value.effectiveSpeech.projectId ||
      value.revision !== value.effectiveSpeech.baseRevision
    )
      ctx.addIssue({
        code: "custom",
        message: "Canonical speech binding mismatch",
      })
  })
