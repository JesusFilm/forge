import { z } from "zod"

export const studioIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/)
export const studioDigestSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const studioActorSchema = z
  .object({
    kind: z.enum(["human", "service"]),
    id: studioIdSchema,
    authority: z.enum(["interactive", "delegated"]).optional(),
    clientId: studioIdSchema.optional(),
  })
  .strict()
export type StudioActor = z.infer<typeof studioActorSchema>
export const studioLifecycleSchema = z.enum([
  "DRAFT",
  "PUBLISHED",
  "UNPUBLISHED",
])
const frame = z.number().int().min(0).max(2_592_000)
export const studioAssetReferenceSchema = z
  .object({
    assetId: studioIdSchema,
    versionId: studioIdSchema,
    digest: studioDigestSchema,
  })
  .strict()
export type StudioAssetReference = z.infer<typeof studioAssetReferenceSchema>
const controlSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("text"),
      maxLength: z.number().int().min(1).max(8000),
    })
    .strict(),
  z.object({ type: z.literal("color") }).strict(),
  z
    .object({
      type: z.literal("number"),
      min: z.number().finite(),
      max: z.number().finite(),
    })
    .strict(),
  z.object({ type: z.literal("boolean") }).strict(),
  z
    .object({
      type: z.literal("enum"),
      values: z.array(z.string().max(200)).min(1).max(32),
    })
    .strict(),
])
export const studioPropertiesSchema = z.record(
  z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/),
  z.union([z.string().max(8000), z.number().finite(), z.boolean()]),
)
export const studioComponentSchema = z
  .object({
    versionId: studioIdSchema,
    code: studioAssetReferenceSchema,
    runtimeVersion: studioIdSchema,
    dependencies: z
      .array(
        z
          .object({
            name: z
              .string()
              .max(128)
              .regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/),
            version: studioIdSchema,
          })
          .strict(),
      )
      .max(32),
    width: z.number().int().min(16).max(7680),
    height: z.number().int().min(16).max(7680),
    duration: z
      .object({ minFrames: frame.min(1), maxFrames: frame.min(1) })
      .strict(),
    assets: z.array(studioAssetReferenceSchema).max(64),
    controls: z.record(z.string(), controlSchema),
  })
  .strict()
export const studioSourceSchema = z
  .object({
    videoId: studioIdSchema,
    dubId: studioIdSchema,
    editionId: studioIdSchema,
    language: studioIdSchema,
    subtitle: z
      .object({
        trackId: studioIdSchema,
        editionId: studioIdSchema,
        language: studioIdSchema,
        asset: studioAssetReferenceSchema,
      })
      .strict(),
    preview: studioAssetReferenceSchema,
    export: studioAssetReferenceSchema,
    startMs: z.number().int().nonnegative().max(86_400_000),
    endMs: z.number().int().positive().max(86_400_000),
  })
  .strict()
export const studioTransformSchema = z
  .object({
    x: z.number().finite().min(-10000).max(10000),
    y: z.number().finite().min(-10000).max(10000),
    scaleX: z.number().positive().max(100),
    scaleY: z.number().positive().max(100),
    rotation: z.number().min(-360).max(360),
    opacity: z.number().min(0).max(1),
    crop: z
      .object({
        top: z.number().min(0).max(1),
        right: z.number().min(0).max(1),
        bottom: z.number().min(0).max(1),
        left: z.number().min(0).max(1),
      })
      .strict()
      .optional(),
  })
  .strict()
export const studioSpeechSchema = z
  .object({
    text: z.string().max(8000),
    role: studioIdSchema,
    suppressed: z.boolean(),
    voice: studioAssetReferenceSchema,
    provider: studioIdSchema,
    model: studioIdSchema,
    settings: studioPropertiesSchema,
    pronunciation: studioAssetReferenceSchema.nullable(),
  })
  .strict()
export const studioTextPropertiesSchema = z
  .object({
    color: z
      .string()
      .regex(/^#[a-fA-F0-9]{6}$/)
      .optional(),
    fontSize: z.number().min(1).max(1000).optional(),
    fontFamily: studioIdSchema.optional(),
    fontWeight: z.number().int().min(100).max(900).optional(),
    align: z.enum(["left", "center", "right"]).optional(),
  })
  .strict()
const itemBase = {
  id: studioIdSchema,
  trackId: studioIdSchema,
  startFrame: frame,
  durationInFrames: frame.min(1),
  timingLocked: z.boolean().optional(),
  linkedTo: studioIdSchema.optional(),
  transform: studioTransformSchema.optional(),
  speech: studioSpeechSchema.optional(),
}
export const studioTimelineItemSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...itemBase,
      kind: z.literal("text"),
      text: z.string().max(8000),
      properties: studioTextPropertiesSchema,
    })
    .strict(),
  z
    .object({
      ...itemBase,
      kind: z.literal("component"),
      componentVersionId: studioIdSchema,
      properties: studioPropertiesSchema,
    })
    .strict(),
  z
    .object({
      ...itemBase,
      kind: z.literal("video"),
      source: studioSourceSchema,
      volume: z.number().min(0).max(2),
    })
    .strict(),
  z
    .object({
      ...itemBase,
      kind: z.literal("audio"),
      narrationFor: studioIdSchema.optional(),
      asset: studioAssetReferenceSchema,
      sourceStartMs: z.number().int().nonnegative().max(86_400_000),
      volume: z.number().min(0).max(2),
    })
    .strict(),
  z
    .object({
      ...itemBase,
      kind: z.literal("image"),
      asset: studioAssetReferenceSchema,
    })
    .strict(),
])
export type StudioTimelineItem = z.infer<typeof studioTimelineItemSchema>
export const studioTrackSchema = z
  .object({ id: studioIdSchema, kind: z.enum(["visual", "audio", "caption"]) })
  .strict()
export const studioDocumentSchema = z
  .object({
    version: z.literal(1),
    title: z.string().min(1).max(300),
    language: studioIdSchema,
    runtimeVersion: studioIdSchema,
    width: z.number().int().min(16).max(7680),
    height: z.number().int().min(16).max(7680),
    fps: z.number().int().min(1).max(120),
    durationInFrames: frame.min(1),
    tracks: z.array(studioTrackSchema).max(64),
    components: z.array(studioComponentSchema).max(128),
    items: z.array(studioTimelineItemSchema).max(1000),
    packRevisionIds: z.array(studioIdSchema).max(64),
  })
  .strict()
  .superRefine((doc, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message })
    if (new TextEncoder().encode(JSON.stringify(doc)).length > 262144)
      fail("Composition exceeds 256 KiB")
    for (const ids of [
      doc.tracks.map((t) => t.id),
      doc.items.map((i) => i.id),
      doc.components.map((c) => c.versionId),
      doc.packRevisionIds,
    ])
      if (new Set(ids).size !== ids.length) fail("Duplicate identity")
    for (const c of doc.components) {
      if (
        c.runtimeVersion !== doc.runtimeVersion ||
        c.duration.minFrames > c.duration.maxFrames ||
        Object.keys(c.controls).length > 64
      )
        fail("Invalid component declaration")
      for (const control of Object.values(c.controls))
        if (control.type === "number" && control.min > control.max)
          fail("Invalid numeric control range")
    }
    const links = new Map(doc.items.map((item) => [item.id, item.linkedTo]))
    for (const item of doc.items) {
      if (
        item.kind === "audio" &&
        item.narrationFor &&
        item.linkedTo !== item.narrationFor
      )
        fail("Generated narration must remain linked to its spoken item")
      const seen = new Set([item.id])
      let parent = item.linkedTo
      while (parent) {
        if (!links.has(parent)) {
          fail("Unknown timing link target")
          break
        }
        if (seen.has(parent)) {
          fail("Cyclic timing link")
          break
        }
        seen.add(parent)
        parent = links.get(parent)
      }
      if (
        !doc.tracks.some((t) => t.id === item.trackId) ||
        item.startFrame + item.durationInFrames > doc.durationInFrames
      )
        fail("Item outside track or duration")
      if (item.kind === "component") {
        const c = doc.components.find(
          (c) => c.versionId === item.componentVersionId,
        )
        if (!c) {
          fail("Unknown component version")
          continue
        }
        if (
          item.durationInFrames < c.duration.minFrames ||
          item.durationInFrames > c.duration.maxFrames
        )
          fail("Unsupported component duration")
        if (
          Object.keys(item.properties).length !== Object.keys(c.controls).length
        )
          fail("Invalid component properties")
        for (const [key, control] of Object.entries(c.controls)) {
          const value = item.properties[key]
          const valid =
            control.type === "text"
              ? typeof value === "string" && value.length <= control.maxLength
              : control.type === "color"
                ? typeof value === "string" && /^#[a-fA-F0-9]{6}$/.test(value)
                : control.type === "number"
                  ? typeof value === "number" &&
                    value >= control.min &&
                    value <= control.max
                  : control.type === "boolean"
                    ? typeof value === "boolean"
                    : typeof value === "string" &&
                      control.values.includes(value)
          if (!valid) fail("Invalid component property: " + key)
        }
      }
      if (item.kind === "video") {
        const s = item.source
        if (
          s.language !== doc.language ||
          s.subtitle.language !== doc.language ||
          s.subtitle.editionId !== s.editionId
        )
          fail("Exact source language and subtitle edition required")
        if (
          s.endMs <= s.startMs ||
          Math.abs(
            ((s.endMs - s.startMs) * doc.fps) / 1000 - item.durationInFrames,
          ) > 1
        )
          fail("Source trim must match item duration")
      }
    }
  })
export type StudioDocument = z.infer<typeof studioDocumentSchema>
export const studioCreateSchema = z
  .object({
    sourceVideoDubId: studioIdSchema.nullable().optional(),
    projectId: studioIdSchema,
    expectedRevision: z.literal(0),
    idempotencyKey: studioIdSchema,
    document: studioDocumentSchema,
  })
  .strict()
export type StudioCreate = z.infer<typeof studioCreateSchema>

export const studioOperationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("set-metadata"),
      title: z.string().min(1).max(300).optional(),
      language: studioIdSchema.optional(),
      durationInFrames: frame.min(1).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("set-text"),
      itemId: studioIdSchema,
      text: z.string().max(8000),
    })
    .strict()
    .describe(
      "Set the displayed text of a text item. If the item has speech when this operation executes, also replace that speech's text with these exact bytes; this does not create speech. Operations execute in array order. A later set-text can overwrite text supplied by an earlier set-speech. To intentionally keep different displayed and spoken text, put set-speech after set-text.",
    ),
  z
    .object({
      kind: z.literal("set-properties"),
      itemId: studioIdSchema,
      properties: studioPropertiesSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("set-transform"),
      itemId: studioIdSchema,
      transform: studioTransformSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("set-speech"),
      itemId: studioIdSchema,
      speech: studioSpeechSchema.nullable(),
    })
    .strict()
    .describe(
      "Set or remove this item's speech without changing displayed text. Operations execute in array order: a later set-text on a text item with speech also replaces speech.text. Review canonical effective speech after all operations.",
    ),
  z
    .object({
      kind: z.literal("move-item"),
      itemId: studioIdSchema,
      trackId: studioIdSchema,
      startFrame: frame,
    })
    .strict(),
  z
    .object({
      kind: z.literal("set-timing"),
      itemId: studioIdSchema,
      durationInFrames: frame.min(1),
      timingLocked: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("trim-source"),
      itemId: studioIdSchema,
      startMs: z.number().int().nonnegative().max(86_400_000),
      endMs: z.number().int().positive().max(86_400_000),
    })
    .strict(),
  z
    .object({ kind: z.literal("insert-item"), item: studioTimelineItemSchema })
    .strict(),
  z.object({ kind: z.literal("remove-item"), itemId: studioIdSchema }).strict(),
  z.object({ kind: z.literal("add-track"), track: studioTrackSchema }).strict(),
  z
    .object({ kind: z.literal("remove-track"), trackId: studioIdSchema })
    .strict(),
  z
    .object({
      kind: z.literal("register-component"),
      component: studioComponentSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("assign-content-packs"),
      packRevisionIds: z.array(studioIdSchema).max(64),
    })
    .strict(),
  z
    .object({
      kind: z.literal("restore-document"),
      document: studioDocumentSchema,
    })
    .strict(),
])
export type StudioOperation = z.infer<typeof studioOperationSchema>
export const studioCommandBaseSchema = z
  .object({
    projectId: studioIdSchema,
    expectedRevision: z.number().int().min(1).max(2_147_483_646),
    idempotencyKey: studioIdSchema,
  })
  .strict()
export const studioApplySchema = studioCommandBaseSchema.extend({
  operations: z.array(studioOperationSchema).min(1).max(100),
})
export type StudioApply = z.infer<typeof studioApplySchema>
export const studioCommandResultSchema = z
  .object({
    projectId: studioIdSchema,
    revision: z.number().int().positive(),
    outcome: z.enum(["ACCEPTED", "STALE"]),
    attemptId: studioIdSchema.optional(),
    approvalId: studioIdSchema.optional(),
    timingConflicts: z.array(studioIdSchema).max(1000).optional(),
  })
  .strict()
export type StudioCommandResult = z.infer<typeof studioCommandResultSchema>

export const studioAttemptKindSchema = z.enum([
  "GENERATION",
  "NARRATION",
  "RENDER",
])
export const studioAttemptStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "STALE",
])
export const studioInstructionReferenceSchema = z
  .object({
    agentVersionId: studioIdSchema,
    blockVersionId: studioIdSchema,
    digest: studioDigestSchema,
    agentDigest: studioDigestSchema.optional(),
    blockDigest: studioDigestSchema.optional(),
  })
  .strict()
export const studioRequestSchema = studioCommandBaseSchema.extend({
  executionInputDigest: studioDigestSchema.optional(),
  kind: studioAttemptKindSchema,
  instructions: z.array(studioInstructionReferenceSchema).max(64),
})
export type StudioRequest = z.infer<typeof studioRequestSchema>
export const studioAttemptResultSchema = z
  .object({
    assets: z.array(studioAssetReferenceSchema).max(128),
    manifest: studioAssetReferenceSchema.optional(),
    timingConflictIndices: z
      .array(z.number().int().min(0).max(999))
      .max(1000)
      .optional(),
    costMicros: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
    diagnostic: z.string().max(2000).optional(),
  })
  .strict()
export const studioCompleteSchema = studioCommandBaseSchema.extend({
  attemptId: studioIdSchema,
  status: z.enum(["SUCCEEDED", "FAILED", "CANCELLED"]),
  result: studioAttemptResultSchema,
  operations: z.array(studioOperationSchema).max(100),
})
export type StudioComplete = z.infer<typeof studioCompleteSchema>
export const studioAttemptSchema = z
  .object({
    id: studioIdSchema,
    projectId: studioIdSchema,
    baseRevision: z.number().int().positive(),
    kind: studioAttemptKindSchema,
    status: studioAttemptStatusSchema,
    inputHash: studioDigestSchema,
    actor: studioActorSchema,
    instructions: z.array(studioInstructionReferenceSchema).max(64),
    result: studioAttemptResultSchema.nullable(),
    jobReference: studioIdSchema.nullable(),
  })
  .strict()
export type ShortAttempt = z.infer<typeof studioAttemptSchema>

export const studioApprovalKindSchema = z.enum(["SCRIPT", "PUBLICATION"])
export const studioApproveSchema = studioCommandBaseSchema.extend({
  kind: studioApprovalKindSchema,
  renderAttemptId: studioIdSchema.optional(),
})
export type StudioApprove = z.infer<typeof studioApproveSchema>
export const studioApprovalSchema = z
  .object({
    id: studioIdSchema,
    projectId: studioIdSchema,
    revision: z.number().int().positive(),
    kind: studioApprovalKindSchema,
    dependencyHash: studioDigestSchema,
    actor: studioActorSchema,
    renderAttemptId: studioIdSchema.nullable(),
  })
  .strict()
export type ShortApproval = z.infer<typeof studioApprovalSchema>

export const studioStartSchema = studioCommandBaseSchema.extend({
  attemptId: studioIdSchema,
  jobReference: studioIdSchema,
})
export type StudioStart = z.infer<typeof studioStartSchema>
export const studioProjectSchema = z
  .object({
    sourceVideoDubId: studioIdSchema.nullable().optional(),
    projectId: studioIdSchema,
    revision: z.number().int().positive(),
    lifecycle: studioLifecycleSchema,
    firstPublishedAt: z.string().datetime().nullable(),
    document: studioDocumentSchema,
    actor: studioActorSchema,
  })
  .strict()
export type Short = z.infer<typeof studioProjectSchema>
export const studioListSchema = z
  .object({
    cursor: studioIdSchema.optional(),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict()
export const studioProjectSummarySchema = z
  .object({
    projectId: studioIdSchema,
    revision: z.number().int().positive(),
    lifecycle: studioLifecycleSchema,
  })
  .strict()
export type StudioProjectSummary = z.infer<typeof studioProjectSummarySchema>

export const studioRevisionSchema = z
  .object({
    revision: z.number().int().positive(),
    document: studioDocumentSchema,
    actor: studioActorSchema,
  })
  .strict()
export type StudioRevision = z.infer<typeof studioRevisionSchema>
export const studioHistorySchema = z
  .object({
    beforeRevision: z.number().int().positive().optional(),
    limit: z.number().int().min(1).max(20).default(10),
  })
  .strict()
