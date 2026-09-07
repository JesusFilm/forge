import { z } from "zod"
import {
  studioAssetReferenceSchema,
  studioIdSchema,
  studioProjectSchema,
} from "./index"

export const studioCatalogReadinessProofSchema = z
  .object({
    output: studioAssetReferenceSchema,
    codecProof: studioAssetReferenceSchema,
    observedAt: z.iso.datetime(),
    mux: z
      .object({
        assetId: studioIdSchema,
        playbackId: studioIdSchema,
        status: z.literal("ready"),
        playbackPolicies: z.tuple([z.literal("signed")]),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        fps: z.number().positive(),
        durationMs: z.number().positive(),
        audio: z.literal(true),
      })
      .strict(),
  })
  .strict()
export const studioRecordCatalogReadinessSchema = z
  .object({
    id: studioIdSchema,
    releaseId: studioIdSchema,
    attemptId: studioIdSchema,
    leaseId: z.uuid(),
    proof: studioCatalogReadinessProofSchema,
  })
  .strict()

export const studioRenderStateSchema = z.object({
  project: studioProjectSchema,
  attempts: z
    .array(
      z.object({
        id: studioIdSchema,
        baseRevision: z.number().int(),
        status: z.string(),
        createdAt: z.iso.datetime(),
        renderJob: z
          .object({ state: z.string(), generation: z.number().int() })
          .nullable(),
        muxJob: z.object({ state: z.string() }).nullable(),
        catalogRelease: z
          .object({
            id: studioIdSchema,
            output: studioAssetReferenceSchema,
            video: z.object({ slug: z.string().nullable() }),
            dub: z.object({
              hls: z.string().nullable(),
              language: z.object({ slug: z.string().nullable() }).nullable(),
            }),
            readiness: z.array(
              z.object({
                id: studioIdSchema,
                checkedAt: z.iso.datetime(),
                expiresAt: z.iso.datetime(),
              }),
            ),
          })
          .nullable(),
      }),
    )
    .max(20),
  approvals: z
    .array(
      z.object({
        id: studioIdSchema,
        renderAttemptId: studioIdSchema.nullable(),
      }),
    )
    .max(20),
  publication: z
    .object({
      releaseId: studioIdSchema,
      publishedAt: z.iso.datetime(),
      revokedAt: z.iso.datetime().nullable(),
    })
    .nullable(),
})
export type StudioRenderState = z.infer<typeof studioRenderStateSchema>
