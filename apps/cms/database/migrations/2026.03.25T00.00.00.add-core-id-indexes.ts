/**
 * Add indexes on core_id for all sync-managed content tables.
 *
 * Note: On a fresh DB, content type tables may not exist yet when this
 * migration runs (Strapi creates them after migrations). The indexes
 * will be created on the next startup when the tables exist.
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

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function up(knex: any): Promise<void> {
  for (const table of TABLES) {
    const exists = await knex.schema.hasTable(table)
    if (!exists) continue
    await knex.raw(
      `CREATE INDEX IF NOT EXISTS idx_${table}_core_id ON "${table}" (core_id)`,
    )
  }
}

export async function down(knex: any): Promise<void> {
  for (const table of TABLES) {
    const exists = await knex.schema.hasTable(table)
    if (!exists) continue
    await knex.raw(`DROP INDEX IF EXISTS idx_${table}_core_id`)
  }
}
