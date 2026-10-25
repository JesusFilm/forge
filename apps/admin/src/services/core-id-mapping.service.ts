// Core-ID → cms video id mapping loader.
//
// admin and cms run on separate Postgres databases. During transcript
// embedding backfills, admin needs to translate its `Video.coreId` into the
// integer `videos.id` used by cms as the S3 key prefix for manager's
// transcript artifacts. That mapping is dumped from cms via
// `pnpm --filter @forge/cms dump:core-id-mapping`, uploaded to the
// shared Railway S3 bucket, and loaded here.
//
// Snapshot semantics: Strapi SERIAL ids don't change, so a stale mapping
// only misses newly added videos. Re-run the admin refresh CLI
// (`pnpm --filter @forge/admin refresh:core-id-mapping`) whenever cms's
// catalog has grown.

import { z } from "zod"
import { readObject } from "@/storage/s3"

// Re-export the canonical constants so existing consumers that import
// from the service module keep working. The refresh CLI imports from
// `./core-id-mapping.constants` directly to avoid pulling @/storage/s3
// → @/config/env into the CLI's runtime env matrix.
import {
  ADMIN_MIGRATIONS_S3_PREFIX,
  DEFAULT_CORE_ID_MAPPING_S3_KEY,
} from "./core-id-mapping.constants"
export { ADMIN_MIGRATIONS_S3_PREFIX, DEFAULT_CORE_ID_MAPPING_S3_KEY }

export const CoreIdMappingRowSchema = z.object({
  coreId: z.string().min(1),
  cmsVideoId: z.number().int().positive(),
})

export const CoreIdMappingFileSchema = z.object({
  generatedAt: z.string(),
  count: z.number().int().nonnegative(),
  rows: z.array(CoreIdMappingRowSchema),
})

export type CoreIdMappingRow = z.infer<typeof CoreIdMappingRowSchema>
export type CoreIdMappingFile = z.infer<typeof CoreIdMappingFileSchema>

export class CoreIdMappingError extends Error {
  constructor(
    readonly code:
      | "mapping_missing"
      | "mapping_invalid"
      | "mapping_read_failed"
      | "mapping_key_rejected",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "CoreIdMappingError"
  }
}

// Each path segment must begin with a non-dot character, matching the
// shape storage/s3.ts's SAFE_OBJECT_KEY_PATTERN enforces. Running this
// check inside assertMappingS3KeyAllowed means a key like
// `admin-migrations/../escape.json` is reported as mapping_key_rejected
// (operator intent clear) rather than as mapping_read_failed (storage
// validateObjectKey throws a plain Error and loadCoreIdMapping wraps it
// in the wrong CoreIdMappingError.code).
const SAFE_MAPPING_KEY_PATTERN =
  /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*(\/[a-zA-Z0-9_-][a-zA-Z0-9._-]*)*$/

export function assertMappingS3KeyAllowed(s3Key: string): void {
  if (!SAFE_MAPPING_KEY_PATTERN.test(s3Key)) {
    throw new CoreIdMappingError(
      "mapping_key_rejected",
      `Core-ID mapping s3 key is not a well-formed path (each segment must start with a letter, digit, '-', or '_')`,
    )
  }
  if (!s3Key.startsWith(ADMIN_MIGRATIONS_S3_PREFIX)) {
    throw new CoreIdMappingError(
      "mapping_key_rejected",
      `Core-ID mapping s3 key must live under ${ADMIN_MIGRATIONS_S3_PREFIX}`,
    )
  }
}

/** Resolved mapping surface — a Map for O(1) lookup + the source metadata. */
export type CoreIdMapping = {
  generatedAt: string
  byCoreId: ReadonlyMap<string, number>
}

/**
 * Classify a storage read error as "the thing isn't there" vs "something is
 * broken". Checks typed discriminants — `@aws-sdk/client-s3` exports
 * `NoSuchKey` and `NotFound` classes whose `name` is a literal string
 * constant, and local fs misses carry `code: "ENOENT"`. We deliberately do
 * NOT treat a bare HTTP 404 as "missing": `NoSuchBucket` / `AccessDenied`
 * can also surface as 404 depending on bucket policy, and those are
 * configuration failures the operator should see as `mapping_read_failed`,
 * not `mapping_missing` (which reads as "re-run the refresh CLI").
 */
function isStorageMissingError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const err = error as {
    name?: unknown
    code?: unknown
  }
  return (
    err.name === "NoSuchKey" ||
    err.name === "NotFound" ||
    err.code === "NoSuchKey" ||
    err.code === "ENOENT"
  )
}

export async function loadCoreIdMapping(s3Key: string): Promise<CoreIdMapping> {
  assertMappingS3KeyAllowed(s3Key)

  let bytes: Uint8Array
  try {
    bytes = await readObject(s3Key)
  } catch (error) {
    if (isStorageMissingError(error)) {
      throw new CoreIdMappingError(
        "mapping_missing",
        `Core-ID mapping not found at s3 key ${s3Key}`,
        error,
      )
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new CoreIdMappingError(
      "mapping_read_failed",
      `Failed to read Core-ID mapping from s3 key ${s3Key}: ${message}`,
      error,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    throw new CoreIdMappingError(
      "mapping_invalid",
      `Core-ID mapping is not valid JSON`,
      error,
    )
  }

  const validated = CoreIdMappingFileSchema.safeParse(parsed)
  if (!validated.success) {
    // Do not surface zod's validated.error.message — it can echo rejected
    // field values back to the caller. Log the detail server-side only.
    console.error(
      JSON.stringify({
        event: "core_id_mapping_invalid",
        s3Key,
        zodMessage: validated.error.message,
      }),
    )
    throw new CoreIdMappingError(
      "mapping_invalid",
      `Core-ID mapping failed schema validation`,
      validated.error,
    )
  }

  const byCoreId = new Map<string, number>()
  for (const row of validated.data.rows) {
    byCoreId.set(row.coreId, row.cmsVideoId)
  }

  return {
    generatedAt: validated.data.generatedAt,
    byCoreId,
  }
}
