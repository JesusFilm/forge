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

import { readFile, realpath } from "node:fs/promises"
import { isAbsolute, resolve, sep } from "node:path"
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
      | "mapping_read_failed"
      | "mapping_path_rejected",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "CoreIdMappingError"
  }
}

/**
 * Default allowed root for mapping files: `<cwd>/.tmp`. Callers (operators
 * or the workflow trigger) must supply a path whose real-path resolves
 * inside this root. Configurable via the `ADMIN_ARTIFACT_DIR` env (not
 * yet declared; reads `process.env` as a fallback until env.ts carries
 * the key so that ops can redirect locally without a code change).
 */
function getAllowedRoot(): string {
  const fromEnv = process.env.ADMIN_ARTIFACT_DIR
  const candidate = fromEnv ?? resolve(process.cwd(), ".tmp")
  return resolve(candidate)
}

async function assertPathWithinAllowedRoot(path: string): Promise<string> {
  if (!isAbsolute(path)) {
    throw new CoreIdMappingError(
      "mapping_path_rejected",
      `Core-ID mapping path must be absolute, got ${JSON.stringify(path)}`,
    )
  }
  const root = getAllowedRoot()
  let resolved: string
  try {
    resolved = await realpath(path)
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
      `Failed to resolve Core-ID mapping path: ${message}`,
      error,
    )
  }
  const rootWithSep = root.endsWith(sep) ? root : root + sep
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new CoreIdMappingError(
      "mapping_path_rejected",
      `Core-ID mapping path must resolve inside ${root}`,
    )
  }
  return resolved
}

/** Resolved mapping surface — a Map for O(1) lookup + the source metadata. */
export type CoreIdMapping = {
  generatedAt: string
  byCoreId: ReadonlyMap<string, number>
}

export async function loadCoreIdMapping(path: string): Promise<CoreIdMapping> {
  // Reject paths that would escape the configured artifact root before we
  // touch the filesystem at the user-supplied path. The ADMIN-only GraphQL
  // mutation hands this value in directly; without this gate a compromised
  // ADMIN session becomes an arbitrary-file-read primitive.
  const resolvedPath = await assertPathWithinAllowedRoot(path)

  let raw: string
  try {
    raw = await readFile(resolvedPath, "utf8")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/ENOENT|no such file|not found/i.test(message)) {
      throw new CoreIdMappingError(
        "mapping_missing",
        `Core-ID mapping file not found`,
        error,
      )
    }
    throw new CoreIdMappingError(
      "mapping_read_failed",
      `Failed to read Core-ID mapping: ${message}`,
      error,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
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
        path: resolvedPath,
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
