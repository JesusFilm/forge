/**
 * Add indexes to Strapi v5 link tables used by custom REST endpoints.
 *
 * Strapi v5 auto-generates `_lnk` junction tables for content type relations
 * but does not create indexes on the foreign key columns. Without indexes,
 * JOINs through these tables fall back to sequential scans.
 *
 * These link tables are joined by:
 * - /api/language-geo (country_languages → languages, countries, continents)
 * - /api/video-coverage (video_subtitles → videos, languages; video_variants → videos, languages)
 */

const LINK_TABLE_INDEXES = [
  // language-geo endpoint
  { table: "country_languages_language_lnk", column: "country_language_id" },
  { table: "country_languages_language_lnk", column: "language_id" },
  { table: "country_languages_country_lnk", column: "country_language_id" },
  { table: "country_languages_country_lnk", column: "country_id" },
  { table: "countries_continent_lnk", column: "country_id" },
  { table: "countries_continent_lnk", column: "continent_id" },
  // video-coverage endpoint
  { table: "video_subtitles_video_lnk", column: "video_subtitle_id" },
  { table: "video_subtitles_video_lnk", column: "video_id" },
  { table: "video_subtitles_language_lnk", column: "video_subtitle_id" },
  { table: "video_subtitles_language_lnk", column: "language_id" },
  { table: "video_variants_video_lnk", column: "video_variant_id" },
  { table: "video_variants_video_lnk", column: "video_id" },
  { table: "video_variants_language_lnk", column: "video_variant_id" },
  { table: "video_variants_language_lnk", column: "language_id" },
  { table: "videos_children_lnk", column: "video_id" },
  { table: "videos_children_lnk", column: "inv_video_id" },
  { table: "video_images_video_lnk", column: "video_image_id" },
  { table: "video_images_video_lnk", column: "video_id" },
] as const

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function up(knex: any): Promise<void> {
  for (const { table, column } of LINK_TABLE_INDEXES) {
    const exists = await knex.schema.hasTable(table)
    if (!exists) continue
    const indexName = `idx_${table}_${column}`
    await knex.raw(
      `CREATE INDEX IF NOT EXISTS ${indexName} ON "${table}" ("${column}")`,
    )
  }
}

export async function down(knex: any): Promise<void> {
  for (const { table, column } of LINK_TABLE_INDEXES) {
    const indexName = `idx_${table}_${column}`
    await knex.raw(`DROP INDEX IF EXISTS ${indexName}`)
  }
}
