/**
 * Add indexes on core_id for all sync-managed content tables.
 *
 * Without these indexes every upsertByCoreId call does a full table scan,
 * causing the core-sync to take 10+ hours instead of minutes.
 */

const TABLES = [
  "bible_books",
  "bible_citations",
  "cloudflare_r2s",
  "continents",
  "countries",
  "country_languages",
  "keywords",
  "language_audio_previews",
  "languages",
  "mux_videos",
  "video_editions",
  "video_images",
  "video_origins",
  "video_study_questions",
  "video_subtitles",
  "video_variant_downloads",
  "video_variants",
  "videos",
] as const

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(knex: any): Promise<void> {
  for (const table of TABLES) {
    const exists = await knex.schema.hasTable(table)
    if (!exists) continue

    const indexName = `idx_${table}_core_id`
    const hasIndex = await knex.raw(
      `SELECT 1 FROM pg_indexes WHERE indexname = ?`,
      [indexName],
    )
    if (hasIndex.rows.length === 0) {
      await knex.schema.alterTable(table, (t: any) => {
        t.index("core_id", indexName)
      })
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(knex: any): Promise<void> {
  for (const table of TABLES) {
    const exists = await knex.schema.hasTable(table)
    if (!exists) continue

    const indexName = `idx_${table}_core_id`
    const hasIndex = await knex.raw(
      `SELECT 1 FROM pg_indexes WHERE indexname = ?`,
      [indexName],
    )
    if (hasIndex.rows.length > 0) {
      await knex.schema.alterTable(table, (t: any) => {
        t.dropIndex("core_id", indexName)
      })
    }
  }
}
