// Core-ID → cms video id mapping loader.
//
// admin and cms run on separate Postgres databases. During scene-embedding
// backfill (R1), admin needs to translate its `Video.coreId` into the
// integer `videos.id` used by cms as the S3 key prefix for manager's
// scene-analysis artifacts. That mapping is dumped one-shot from cms via
// `pnpm --filter @forge/cms dump:core-id-mapping` and loaded here.
//
// Snapshot semantics: Strapi SERIAL ids don't change, so a stale mapping
// only misses newly added videos. Re-dump between backfills when the cms
// catalog has grown.

import { readFile } from "node:fs/promises"
import { z } from "zod"

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

export async function loadCoreIdMapping(path: string): Promise<CoreIdMapping> {
  let raw: string
  try {
    raw = await readFile(path, "utf8")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/ENOENT|no such file|not found/i.test(message)) {
      throw new CoreIdMappingError(
        "mapping_missing",
        `Core-ID mapping file not found at ${path}`,
        error,
      )
    }
    throw new CoreIdMappingError(
      "mapping_read_failed",
      `Failed to read Core-ID mapping at ${path}: ${message}`,
      error,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new CoreIdMappingError(
      "mapping_invalid",
      `Core-ID mapping at ${path} is not valid JSON`,
      error,
    )
  }

  const validated = CoreIdMappingFileSchema.safeParse(parsed)
  if (!validated.success) {
    throw new CoreIdMappingError(
      "mapping_invalid",
      `Core-ID mapping at ${path} failed schema validation: ${validated.error.message}`,
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
