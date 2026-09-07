import { studioQualityReportSchema } from "./production"
import { z } from "zod"
import { studioIdSchema, studioApplySchema, studioProjectSchema } from "./index"

export const STUDIO_AGENT_ID = "studio-authoring"
export const STUDIO_BLOCK_ID = "studio-authoring-voice"
export const STUDIO_AGENT_LIMITS = Object.freeze({
  runMs: 180_000,
  stepMs: 90_000,
  persistenceMs: 5_000,
  managerMs: 190_000,
})
export const studioInstructionSelectionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("active") }).strict(),
  z
    .object({
      mode: z.literal("version"),
      versionId: studioIdSchema,
      blockVersionId: studioIdSchema,
    })
    .strict(),
])
export const studioInstructionCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("inspect") }).strict(),
  z
    .object({
      action: z.literal("save"),
      expectedVersionId: studioIdSchema,
      content: z.string().min(1).max(16000),
    })
    .strict(),
  z
    .object({
      action: z.literal("activate"),
      versionId: studioIdSchema,
      expectedActiveVersionId: studioIdSchema.nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal("restore"),
      versionId: studioIdSchema,
      expectedVersionId: studioIdSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("compare"),
      from: studioIdSchema,
      to: studioIdSchema,
    })
    .strict(),
])
export const studioChatSchema = z
  .object({
    projectId: studioIdSchema,
    expectedRevision: z.number().int().positive(),
    idempotencyKey: studioIdSchema,
    message: z.string().min(1).max(8000),
  })
  .strict()
export const studioProposalSchema = z
  .object({
    summary: z.string().min(1).max(2000),
    command: studioApplySchema,
    quality: studioQualityReportSchema.optional(),
  })
  .strict()
export const studioAgentEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(16000) }),
  z.object({ type: z.literal("diagnostic"), message: z.string().max(2000) }),
  z.object({ type: z.literal("proposal"), proposal: studioProposalSchema }),
  z.object({
    type: z.literal("admitted"),
    attemptId: studioIdSchema,
    instructions: z.unknown(),
  }),
  z.object({ type: z.literal("done") }),
  z.object({ type: z.literal("error"), message: z.string().max(2000) }),
])
export type StudioAgentEvent = z.infer<typeof studioAgentEventSchema>
export const studioRuntimeRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("instructions"),
      command: studioInstructionCommandSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("test"),
      language: studioIdSchema.default("en"),
      selection: studioInstructionSelectionSchema,
      message: z.string().min(1).max(8000),
    })
    .strict(),
  z
    .object({
      action: z.literal("freeze"),
      input: studioChatSchema,
      project: studioProjectSchema,
    })
    .strict(),
  z
    .object({
      action: z.enum(["bind", "run"]),
      admission: z.string().max(4096),
      toolGrant: z
        .object({ body: z.string().max(2048), assertion: z.string().max(8192) })
        .strict()
        .optional(),
      attemptId: studioIdSchema,
      inputKey: studioIdSchema,
      project: studioProjectSchema,
      message: z.string().min(1).max(8000),
    })
    .strict(),
])
export const studioDelegatedActions = [
  "read",
  "list",
  "history",
  "apply",
  "create",
  "assets",
  "packs",
  "pack",
  "sources",
  "eligibility",
  "request",
  "attempts",
  "asset",
  "capture",
  "source",
  "source-preview",
  "search",
  "asset-read",
  "asset-upload",
  "validate-proposal",
  "generation-read",
] as const
export const studioDelegatedRpcSchema = z
  .object({ action: z.enum(studioDelegatedActions), input: z.unknown() })
  .strict()
export const studioOAuthScopes = [
  "studio:read",
  "studio:edit",
  "studio:chat",
  "studio:instructions:read",
] as const
