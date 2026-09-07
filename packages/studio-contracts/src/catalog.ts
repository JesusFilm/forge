import { z } from "zod"
import {
  studioCommandBaseSchema,
  studioIdSchema,
  studioAssetReferenceSchema,
  studioDigestSchema,
} from "./index"

export const studioStageCatalogSchema = studioCommandBaseSchema.extend({
  renderAttemptId: studioIdSchema,
  mux: z
    .object({
      assetId: studioIdSchema,
      playbackId: studioIdSchema,
      policy: z.literal("signed"),
      status: z.literal("ready"),
    })
    .strict(),
})

/** Trusted renderer's retained verification report; never a source descriptor. */
export const studioCatalogRenderManifestSchema = z
  .object({
    version: z.literal(1),
    projectId: studioIdSchema,
    revision: z.number().int().positive(),
    renderAttemptId: studioIdSchema,
    inputHash: studioDigestSchema,
    output: studioAssetReferenceSchema,
    language: studioIdSchema,
    runtimeVersion: studioIdSchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().int().positive(),
    durationInFrames: z.number().int().positive(),
    verification: z
      .object({
        status: z.literal("verified"),
        verifierVersion: studioIdSchema,
        outputDigest: studioDigestSchema,
      })
      .strict(),
  })
  .strict()

export const studioCatalogReleaseSchema = z.object({
  id: studioIdSchema,
  projectId: studioIdSchema,
  revision: z.number().int().positive(),
  renderAttemptId: studioIdSchema,
  videoId: studioIdSchema,
  dubId: studioIdSchema,
  editionId: studioIdSchema,
  muxId: studioIdSchema,
  snapshot: z.json(),
})
