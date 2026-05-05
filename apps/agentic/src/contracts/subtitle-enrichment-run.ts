import { z } from "zod"

export const subtitleEnrichmentRequestedBySchema = z.discriminatedUnion(
  "kind",
  [
    z.object({
      kind: z.literal("manager_user"),
      id: z.string().min(1),
    }),
    z.object({
      kind: z.literal("service"),
      id: z.string().min(1),
    }),
  ],
)

export const subtitleMaterializationSchema = z
  .object({
    mode: z.enum(["direct_mux_asset_reuse", "snapshot_to_stage_clone"]),
    targetEnvironment: z.enum(["mux-production", "mux-stage"]),
  })
  .strict()

export const startSubtitleEnrichmentRunRequestSchema = z
  .object({
    jobId: z.string().min(1),
    videoDocumentId: z.string().min(1).optional(),
    assetId: z.string().min(1),
    muxAssetId: z.string().min(1),
    muxPlaybackId: z.string().min(1).optional(),
    sourceLanguage: z.string().min(1),
    targetLanguage: z.string().min(1),
    materialization: subtitleMaterializationSchema,
    requestedTranscriptionProvider: z
      .enum(["automatic", "mux", "elevenlabs"])
      .optional(),
    initialArtifacts: z.record(z.string(), z.unknown()).optional(),
    requestedBy: subtitleEnrichmentRequestedBySchema,
    idempotencyKey: z.string().min(1),
  })
  .strict()

export type StartSubtitleEnrichmentRunRequest = z.infer<
  typeof startSubtitleEnrichmentRunRequestSchema
>

const subtitleRunSuccessStatusSchema = z.enum(["queued", "running"])

export const subtitleEnrichmentFailureCodeSchema = z.enum([
  "unauthorized",
  "invalid_request",
  "job_not_approved",
  "idempotency_conflict",
  "manager_unavailable",
  "mastra_runtime_error",
])

export type SubtitleEnrichmentFailureCode = z.infer<
  typeof subtitleEnrichmentFailureCodeSchema
>

export const startSubtitleEnrichmentRunResponseSchema = z.discriminatedUnion(
  "ok",
  [
    z.object({
      ok: z.literal(true),
      agenticRunId: z.string().min(1),
      managerJobId: z.string().min(1),
      status: subtitleRunSuccessStatusSchema,
      summary: z.string().min(1),
    }),
    z.object({
      ok: z.literal(false),
      code: subtitleEnrichmentFailureCodeSchema,
      message: z.string().min(1),
    }),
  ],
)

export type StartSubtitleEnrichmentRunResponse = z.infer<
  typeof startSubtitleEnrichmentRunResponseSchema
>
