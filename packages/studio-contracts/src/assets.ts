import { z } from "zod"
import {
  studioAssetReferenceSchema,
  studioActorSchema,
  studioIdSchema,
  studioDigestSchema,
  studioPropertiesSchema,
} from "./index"

export const studioAssetRoleSchema = z.enum([
  "document",
  "narration",
  "music",
  "background",
  "voice",
  "pronunciation",
  "component",
  "subtitle",
  "source",
  "render",
  "manifest",
  "archive",
])
export const studioProvenanceSchema = z
  .object({
    status: z.enum(["recorded", "unknown"]),
    recorded: z.record(z.string().max(128), z.json()),
  })
  .strict()
  .refine(
    (v) => new TextEncoder().encode(JSON.stringify(v)).length <= 32768,
    "Provenance exceeds 32 KiB",
  )
export const studioNarrationIdentitySchema = z
  .object({
    text: z.string().min(1).max(8000),
    role: studioIdSchema,
    language: studioIdSchema,
    provider: studioIdSchema,
    model: studioIdSchema,
    voiceId: studioIdSchema,
    settings: studioPropertiesSchema,
    pronunciation: studioAssetReferenceSchema.nullable(),
  })
  .strict()
export type StudioNarrationIdentity = z.infer<
  typeof studioNarrationIdentitySchema
>
export const studioVoicePresetSchema = studioNarrationIdentitySchema.omit({
  text: true,
  role: true,
})
export const studioRegisterAssetSchema = z
  .object({
    idempotencyKey: studioIdSchema,
    filename: z.string().min(1).max(200),
    mimeType: z.string().min(1).max(255),
    role: studioAssetRoleSchema,
    provenance: studioProvenanceSchema,
    narration: studioNarrationIdentitySchema.optional(),
    voice: studioVoicePresetSchema.optional(),
    replaces: studioAssetReferenceSchema.optional(),
    dependencies: z.array(studioAssetReferenceSchema).max(128).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.role === "voice" && v.provenance.status === "recorded" && !v.voice)
      ctx.addIssue({
        code: "custom",
        message: "Recorded voice requires a complete preset",
      })
    if (
      v.role === "narration" &&
      v.provenance.status === "recorded" &&
      !v.narration
    )
      ctx.addIssue({
        code: "custom",
        message: "Recorded narration requires complete effective identity",
      })
    if (
      (v.narration &&
        (v.role !== "narration" || v.provenance.status !== "recorded")) ||
      (v.voice && v.role !== "voice")
    )
      ctx.addIssue({
        code: "custom",
        message: "Metadata does not match asset role/provenance",
      })
  })
export const studioAssetVersionSchema = z.object({
  reference: studioAssetReferenceSchema,
  mediaAssetId: studioIdSchema,
  filename: z.string(),
  mimeType: z.string(),
  byteSize: z.number(),
  role: studioAssetRoleSchema,
  provenance: studioProvenanceSchema,
  narration: studioNarrationIdentitySchema.nullable(),
  voice: studioVoicePresetSchema.nullable(),
  actor: studioActorSchema,
})
export type StudioAssetVersion = z.infer<typeof studioAssetVersionSchema>

export const STUDIO_MAX_ASSET_BYTES = 256 * 1024 * 1024
export const studioAssetUploadSchema = z
  .object({
    metadata: studioRegisterAssetSchema,
    digest: studioDigestSchema,
    byteSize: z.number().int().positive().max(STUDIO_MAX_ASSET_BYTES),
  })
  .strict()
