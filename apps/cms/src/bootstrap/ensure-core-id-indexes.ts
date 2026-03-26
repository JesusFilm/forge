import type { Core } from "@strapi/strapi"

/**
 * Ensure core_id indexes exist on all sync-managed tables.
 * Runs on every startup — idempotent via IF NOT EXISTS.
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

export async function ensureCoreIdIndexes(strapi: Core.Strapi): Promise<void> {
  const knex = strapi.db.connection
  for (const table of TABLES) {
    const indexName = `idx_${table}_core_id`
    try {
      await knex.raw(`CREATE INDEX IF NOT EXISTS ?? ON ?? (core_id)`, [
        indexName,
        table,
      ])
    } catch {
      // Table may not exist yet on first boot — safe to skip
    }
  }
  strapi.log.info("[bootstrap] core_id indexes ensured")
}
