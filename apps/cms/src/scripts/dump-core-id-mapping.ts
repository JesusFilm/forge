/**
 * Dump Core-ID → cms video id mapping.
 *
 * One-shot operator script. Produces a JSON file (default: stdout) that
 * admin's scene-embedding backfill reads to translate its `Video.coreId`
 * into the integer `videos.id` used as the S3 key prefix for
 * manager-produced scene-analysis artifacts.
 *
 * The mapping is a snapshot. Re-run whenever new videos have been added
 * to cms between backfills. Strapi SERIAL ids don't change, so previously
 * emitted rows stay valid.
 *
 * Usage:
 *   pnpm --filter @forge/cms dump:core-id-mapping > .tmp/core-id-mapping.json
 *   pnpm --filter @forge/cms dump:core-id-mapping --out /path/to/mapping.json
 */

import { writeFile } from "node:fs/promises"
import type { Core } from "@strapi/strapi"

export type CoreIdMappingRow = {
  coreId: string
  cmsVideoId: number
}

export type CoreIdMappingOutput = {
  generatedAt: string
  count: number
  rows: CoreIdMappingRow[]
}

export type DumpOptions = {
  /** Absolute path. When omitted, output goes to stdout. */
  out?: string
}

export async function runDump(
  strapi: Core.Strapi,
  options: DumpOptions,
): Promise<CoreIdMappingOutput> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const knex = strapi.db.connection as any

  const result: { rows: Array<{ core_id: string; id: number | string }> } =
    await knex.raw(
      `SELECT core_id, id
       FROM videos
       WHERE core_id IS NOT NULL
       ORDER BY core_id`,
    )

  const rows: CoreIdMappingRow[] = result.rows.map((row) => ({
    coreId: String(row.core_id),
    cmsVideoId:
      typeof row.id === "number" ? row.id : Number.parseInt(String(row.id), 10),
  }))

  const output: CoreIdMappingOutput = {
    generatedAt: new Date().toISOString(),
    count: rows.length,
    rows,
  }

  const serialized = JSON.stringify(output, null, 2)

  if (options.out) {
    await writeFile(options.out, serialized)
    strapi.log.info(
      `[dump-core-id-mapping] wrote ${rows.length} rows to ${options.out}`,
    )
  } else {
    process.stdout.write(serialized)
  }

  return output
}
