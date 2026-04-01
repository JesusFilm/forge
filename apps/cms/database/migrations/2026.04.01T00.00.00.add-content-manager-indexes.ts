/**
 * Add indexes to accelerate Strapi content manager queries.
 *
 * The admin panel runs these queries on every page load for every content type:
 *
 * 1. `SELECT ... FROM <table> WHERE locale = $1` — document listing/counting.
 *    Without an index, video_variant_downloads (2.7M rows) takes 13s per call.
 *
 * 2. Draft-diff self-join on (document_id, published_at, updated_at) — counts
 *    modified/unmodified documents. Without a composite index, video_subtitles
 *    (20K rows) takes 3.9s per call.
 *
 * 3. `SELECT ... WHERE published_at IS NOT NULL AND source = $1` — filters
 *    published documents by sync source.
 */

const LOCALE_TABLES = [
  "video_variant_downloads",
  "video_variants",
  "mux_videos",
  "video_subtitles",
] as const

const DRAFT_DIFF_TABLES = [
  "video_variant_downloads",
  "video_variants",
  "video_subtitles",
] as const

const PUBLISHED_SOURCE_TABLES = [
  "video_variant_downloads",
  "video_variants",
] as const

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function up(knex: any): Promise<void> {
  for (const table of LOCALE_TABLES) {
    const exists = await knex.schema.hasTable(table)
    if (!exists) continue
    await knex.raw(
      `CREATE INDEX IF NOT EXISTS idx_${table}_locale ON "${table}" (locale)`,
    )
  }

  for (const table of DRAFT_DIFF_TABLES) {
    const exists = await knex.schema.hasTable(table)
    if (!exists) continue
    await knex.raw(
      `CREATE INDEX IF NOT EXISTS idx_${table}_draft_diff ON "${table}" (document_id, published_at, updated_at)`,
    )
  }

  for (const table of PUBLISHED_SOURCE_TABLES) {
    const exists = await knex.schema.hasTable(table)
    if (!exists) continue
    await knex.raw(
      `CREATE INDEX IF NOT EXISTS idx_${table}_published_source ON "${table}" (published_at, source)`,
    )
  }
}

export async function down(knex: any): Promise<void> {
  for (const table of LOCALE_TABLES) {
    await knex.raw(`DROP INDEX IF EXISTS idx_${table}_locale`)
  }
  for (const table of DRAFT_DIFF_TABLES) {
    await knex.raw(`DROP INDEX IF EXISTS idx_${table}_draft_diff`)
  }
  for (const table of PUBLISHED_SOURCE_TABLES) {
    await knex.raw(`DROP INDEX IF EXISTS idx_${table}_published_source`)
  }
}
