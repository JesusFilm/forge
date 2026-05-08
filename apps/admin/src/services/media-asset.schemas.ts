// Zod input schemas for media asset service operations.
//
// The service owns coercion for GraphQL/agent callers so storage and Prisma
// receive normalized enum values, BigInts, and bounded strings.

import { z } from "zod"

export const MediaAssetKindSchema = z.enum(["IMAGE", "VIDEO", "PDF", "FILE"])
export const MediaAssetBackendSchema = z.enum(["LOCAL", "S3", "MUX"])
export const MediaAssetStatusSchema = z.enum([
  "PENDING",
  "UPLOADING",
  "PROCESSING",
  "READY",
  "FAILED",
  "MISSING",
])
export const MediaAssetVisibilitySchema = z.enum(["PRIVATE", "PUBLIC"])
export const MediaImageEnrichmentStatusSchema = z.enum([
  "WAITING",
  "PROCESSING",
  "COMPLETE",
  "FAILED",
  "SKIPPED",
])
export const MediaAssetLocaleStatusSchema = z.enum([
  "WAITING",
  "PROCESSING",
  "COMPLETE",
  "FAILED",
  "SKIPPED",
])

const NullableString = z.string().max(2000).nullable().optional()
const OptionalPositiveInt = z.number().int().positive().nullable().optional()
const MediaObjectKey = z
  .string()
  .max(1024)
  .regex(
    /^media-assets\/[a-zA-Z0-9_-]+\/(original|preview)\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/,
    "Invalid media object key",
  )
  .nullable()
  .optional()
const OptionalBigInt = z
  .union([
    z.bigint(),
    z.number().int().nonnegative(),
    z.string().regex(/^\d+$/),
  ])
  .transform((value) => BigInt(value))
  .nullable()
  .optional()

export const ListMediaAssetsInput = z.object({
  kind: MediaAssetKindSchema.optional(),
  backend: MediaAssetBackendSchema.optional(),
  status: MediaAssetStatusSchema.optional(),
  folderId: z.string().min(1).nullable().optional(),
  search: z.string().trim().min(1).max(200).optional(),
  limit: z.number().int().positive().max(500).optional(),
  offset: z.number().int().nonnegative().optional(),
})
export type ListMediaAssetsInput = z.infer<typeof ListMediaAssetsInput>

export const CreateMediaAssetInput = z.object({
  kind: MediaAssetKindSchema,
  backend: MediaAssetBackendSchema.default("LOCAL"),
  status: MediaAssetStatusSchema.default("READY"),
  visibility: MediaAssetVisibilitySchema.default("PRIVATE"),
  mimeType: z.string().trim().min(1).max(255),
  byteSize: OptionalBigInt,
  width: OptionalPositiveInt,
  height: OptionalPositiveInt,
  blurDataUrl: NullableString,
  dominantColor: z.string().max(32).nullable().optional(),
  imageEnrichmentStatus: MediaImageEnrichmentStatusSchema.optional(),
  imageEnrichmentErrorCode: z.string().max(100).nullable().optional(),
  imageEnrichmentErrorMessage: z.string().max(1000).nullable().optional(),
  imageEnrichmentStartedAt: z.date().nullable().optional(),
  imageEnrichmentCompletedAt: z.date().nullable().optional(),
  durationMs: OptionalBigInt,
  originalFilename: z.string().max(255).nullable().optional(),
  checksumSha256: z.string().length(64).nullable().optional(),
  objectKey: MediaObjectKey,
  previewObjectKey: MediaObjectKey,
  folderId: z.string().min(1).nullable().optional(),
  muxAssetId: z.string().max(255).nullable().optional(),
  muxUploadId: z.string().max(255).nullable().optional(),
  muxPlaybackId: z.string().max(255).nullable().optional(),
})
export type CreateMediaAssetInput = z.infer<typeof CreateMediaAssetInput>

export const UpdateMediaAssetInput = z.object({
  id: z.string().min(1),
  status: MediaAssetStatusSchema.optional(),
  visibility: MediaAssetVisibilitySchema.optional(),
  byteSize: OptionalBigInt,
  width: OptionalPositiveInt,
  height: OptionalPositiveInt,
  blurDataUrl: NullableString,
  dominantColor: z.string().max(32).nullable().optional(),
  imageEnrichmentStatus: MediaImageEnrichmentStatusSchema.optional(),
  imageEnrichmentErrorCode: z.string().max(100).nullable().optional(),
  imageEnrichmentErrorMessage: z.string().max(1000).nullable().optional(),
  imageEnrichmentStartedAt: z.date().nullable().optional(),
  imageEnrichmentCompletedAt: z.date().nullable().optional(),
  durationMs: OptionalBigInt,
  originalFilename: z.string().max(255).nullable().optional(),
  checksumSha256: z.string().length(64).nullable().optional(),
  objectKey: MediaObjectKey,
  previewObjectKey: MediaObjectKey,
  folderId: z.string().min(1).nullable().optional(),
  muxAssetId: z.string().max(255).nullable().optional(),
  muxUploadId: z.string().max(255).nullable().optional(),
  muxPlaybackId: z.string().max(255).nullable().optional(),
  errorCode: z.string().max(100).nullable().optional(),
  errorMessage: z.string().max(1000).nullable().optional(),
})
export type UpdateMediaAssetInput = z.infer<typeof UpdateMediaAssetInput>

export const ImageLocaleCode = z
  .string()
  .trim()
  .min(2)
  .max(35)
  .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
  .transform((value) => value.toLowerCase())

export const UpdateMediaAssetLocaleInput = z.object({
  mediaAssetId: z.string().min(1),
  locale: ImageLocaleCode,
  displayName: z.string().trim().max(300).nullable().optional(),
  altText: z.string().trim().max(500).nullable().optional(),
})
export type UpdateMediaAssetLocaleInput = z.infer<
  typeof UpdateMediaAssetLocaleInput
>

export const UpsertAiMediaAssetLocaleInput = z.object({
  mediaAssetId: z.string().min(1),
  locale: ImageLocaleCode,
  displayName: z.string().trim().max(300).nullable().optional(),
  altText: z.string().trim().max(500).nullable().optional(),
  status: MediaAssetLocaleStatusSchema.default("COMPLETE"),
  errorCode: z.string().max(100).nullable().optional(),
  errorMessage: z.string().max(1000).nullable().optional(),
})
export type UpsertAiMediaAssetLocaleInput = z.infer<
  typeof UpsertAiMediaAssetLocaleInput
>
