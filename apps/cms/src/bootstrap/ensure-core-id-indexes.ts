import type { Core } from "@strapi/strapi"

/**
 * Ensure core_id indexes exist on all sync-managed tables.
 *
 * This runs on every startup as a safety net — the migration
 * (database/migrations/2026.03.25T00.00.00.add-core-id-indexes.ts)
 * handles the standard case, but on a fresh DB the migration runs
 * before Strapi creates content type tables, so the indexes get
 * skipped. This bootstrap step catches that gap.
 *
 * Idempotent via CREATE INDEX IF NOT EXISTS.
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
  let created = 0
  for (const table of TABLES) {
    try {
      const result = await knex.raw(
        `CREATE INDEX IF NOT EXISTS idx_${table}_core_id ON "${table}" (core_id)`,
      )
      if (result?.command === "CREATE") created++
    } catch {
      // Table may not exist — safe to skip
    }
  }
  if (created > 0) {
    strapi.log.info(`[bootstrap] Created ${created} core_id indexes`)
  }
}
