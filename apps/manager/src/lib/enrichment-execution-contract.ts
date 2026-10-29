import { createHash } from "node:crypto"
import { z } from "zod"
import { CorrectionSchema } from "@/services/mastra-transcript-scripture-correction"

export const EXECUTION_BODY_MAX_BYTES = 64 * 1024
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
export const ExecutionFenceSchema = z
  .object({
    jobId: id,
    runId: id,
    inputDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
export const MastraExecutionStageSchema = z.enum([
  "source",
  "correction",
  "translation",
  "chapters",
  "metadata",
  "embeddings",
  "scene-analysis",
])
const stageFence = {
  stage: MastraExecutionStageSchema,
  stageDigest: z.string().regex(/^[a-f0-9]{64}$/),
}
export const ExecutionOperationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("run-admission"),
      assetId: id,
      muxAssetId: id,
      sourceReuse: z.enum(["none", "transcript", "subtitles"]),
    })
    .strict(),
  z.object({ kind: z.literal("audio-cleanup") }).strict(),
  z.object({ kind: z.literal("mastra-stage-claim"), ...stageFence }).strict(),
  z
    .object({
      kind: z.literal("mastra-stage-complete"),
      ...stageFence,
      claimToken: z.string().min(1).max(128),
      result: z.object({ status: z.enum(["completed", "failed"]) }).strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("apply-transcript-corrections"),
      correction: CorrectionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("mux-publication"),
      languageResults: z
        .array(
          z
            .object({
              lang: z.string().regex(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i),
              status: z.enum(["completed", "failed"]),
              error: z.string().max(2000).optional(),
            })
            .strict(),
        )
        .max(50)
        .refine(
          (results) =>
            new Set(results.map((result) => result.lang.toLowerCase())).size ===
            results.length,
          "Duplicate languages",
        ),
    })
    .strict(),
])
export const ExecutionRequestSchema = ExecutionFenceSchema.extend({
  operation: ExecutionOperationSchema,
}).strict()
export type ExecutionRequest = z.infer<typeof ExecutionRequestSchema>
export type ExecutionOperation = ExecutionRequest["operation"]
export type ExecutionClaimInput = z.infer<typeof ExecutionFenceSchema> & {
  operationId: string
  operationDigest: string
}
export type ExecutionCompleteInput = ExecutionClaimInput & {
  claimToken: string
  result: unknown
}
export const ExecutionClaimResultSchema = z
  .object({
    status: z.enum(["claimed", "replayed", "conflict", "stale"]),
    claimToken: z.string().min(1).max(128).optional(),
    result: z.unknown().optional(),
  })
  .strict()
export type ExecutionClaimResult = z.infer<typeof ExecutionClaimResultSchema>

/** Stable JSON binds semantically identical HTTP objects independent of key order. */
export function executionDigest(value: unknown): string {
  const normalize = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(normalize)
      : item !== null && typeof item === "object"
        ? Object.fromEntries(
            Object.entries(item)
              .filter(([, v]) => v !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, val]) => [key, normalize(val)]),
          )
        : item
  return createHash("sha256")
    .update(JSON.stringify(normalize(value)))
    .digest("hex")
}
