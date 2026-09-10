import { z } from "zod"
import { studioAssetReferenceSchema, studioIdSchema } from "./index"
export const contentPackDocumentSchema = z
  .object({
    title: z.string().min(1).max(300),
    guidance: z.string().max(16000),
    sources: z
      .array(
        z
          .object({
            label: z.string().min(1).max(300),
            asset: studioAssetReferenceSchema,
            excerpt: z.string().max(8000),
            sourceSnapshotId: studioIdSchema.optional(),
          })
          .strict(),
      )
      .max(64),
  })
  .strict()
  .refine(
    (v) => new TextEncoder().encode(JSON.stringify(v)).length <= 131072,
    "Pack exceeds 128 KiB",
  )
export const writeContentPackSchema = z
  .object({
    packId: studioIdSchema,
    expectedRevision: z.number().int().min(0).max(2147483646),
    idempotencyKey: studioIdSchema,
    document: contentPackDocumentSchema,
  })
  .strict()
export type ContentPackDocument = z.infer<typeof contentPackDocumentSchema>
