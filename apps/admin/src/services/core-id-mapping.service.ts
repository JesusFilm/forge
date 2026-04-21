// Core-ID → cms video id mapping loader.
//
// admin and cms run on separate Postgres databases. During scene-embedding
// backfill (R1), admin needs to translate its `Video.coreId` into the
// integer `videos.id` used by cms as the S3 key prefix for manager's
// scene-analysis artifacts. That mapping is dumped from cms via
// `pnpm --filter @forge/cms dump:core-id-mapping`, uploaded to the
// shared Railway S3 bucket, and loaded here.
//
// Snapshot semantics: Strapi SERIAL ids don't change, so a stale mapping
// only misses newly added videos. Re-run the admin refresh CLI
// (`pnpm --filter @forge/admin refresh:core-id-mapping`) whenever cms's
// catalog has grown.

import { z } from "zod"
import { readObject } from "@/storage/s3"

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
      | "mapping_read_failed",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "CoreIdMappingError"
  }
}

/** Resolved mapping surface — a Map for O(1) lookup + the source metadata. */
export type CoreIdMapping = {
  generatedAt: string
  byCoreId: ReadonlyMap<string, number>
}

export async function loadCoreIdMapping(s3Key: string): Promise<CoreIdMapping> {
  let bytes: Uint8Array
  try {
    bytes = await readObject(s3Key)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/not found|missing|no such key|ENOENT|NoSuchKey/i.test(message)) {
      throw new CoreIdMappingError(
        "mapping_missing",
        `Core-ID mapping not found at s3 key ${s3Key}`,
        error,
      )
    }
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
