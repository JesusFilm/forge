import { z } from "zod"

const Sha256ChecksumSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/, "expected a lowercase SHA-256 checksum")

export const CoreVideoSubtitleChecksumRecordSchema = z
  .object({
    id: z.string().min(1),
    videoId: z.string().min(1),
    languageId: z.string().min(1),
    edition: z.string(),
    primary: z.boolean(),
    vttSrc: z.string().nullable(),
    vttVersion: z.number().int().nonnegative(),
    srtSrc: z.string().nullable(),
    srtVersion: z.number().int().nonnegative(),
    value: z.string(),
  })
  .strict()

export const CoreVideoSubtitleChecksumBucketSchema = z
  .object({
    videoId: z.string().min(1),
    count: z.number().int().nonnegative(),
    checksum: Sha256ChecksumSchema,
  })
  .strict()

export const CoreVideoSubtitleChecksumDetailSchema = z
  .object({
    videoId: z.string().min(1),
    count: z.number().int().nonnegative(),
    checksum: Sha256ChecksumSchema,
    records: z.array(CoreVideoSubtitleChecksumRecordSchema),
  })
  .strict()

export const CoreVideoSubtitleChecksumManifestSchema = z
  .object({
    version: z.number().int().positive(),
    snapshot: z.string().min(1),
    totalCount: z.number().int().nonnegative(),
    rootChecksum: Sha256ChecksumSchema,
    buckets: z.array(CoreVideoSubtitleChecksumBucketSchema),
    details: z.array(CoreVideoSubtitleChecksumDetailSchema),
  })
  .strict()

export type CoreVideoSubtitleChecksumRecord = z.infer<
  typeof CoreVideoSubtitleChecksumRecordSchema
>
export type CoreVideoSubtitleChecksumBucket = z.infer<
  typeof CoreVideoSubtitleChecksumBucketSchema
>
export type CoreVideoSubtitleChecksumDetail = z.infer<
  typeof CoreVideoSubtitleChecksumDetailSchema
>
export type CoreVideoSubtitleChecksumManifest = z.infer<
  typeof CoreVideoSubtitleChecksumManifestSchema
>
