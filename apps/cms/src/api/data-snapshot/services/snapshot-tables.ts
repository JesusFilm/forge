/**
 * Hardcoded allowlist of PostgreSQL tables to include in the dev data snapshot.
 * These correspond to the content types synced by core-sync (videos, languages, countries)
 * plus their Strapi-generated component and join tables.
 *
 * Update this list when adding new content types to the core-sync scope.
 */
export const SNAPSHOT_TABLES = [
  // Video-related content
  "videos",
  "video_variants",
  "video_subtitles",
  "video_study_questions",
  "video_editions",
  "video_origins",
  "keywords",
  "bible_citations",
  "bible_books",
  "mux_videos",
  "cloudflare_r2s",
  "video_images",
  "video_variant_downloads",
  // Language-related content
  "languages",
  "language_audio_previews",
  "i18n_locale",
  // Country-related content
  "countries",
  "country_languages",
  "continents",
  // Strapi component tables (used by content types above)
  "components_video_cloudflare_images",
  "components_video_variant_downloads",
  "components_language_audio_previews",
] as const

/**
 * Glob patterns for Strapi-generated join/link tables.
 * These are auto-created for relations between content types (*_lnk)
 * and for component links (*_cmps, *_components).
 *
 * pg_dump -t supports shell-style globs.
 */
export const SNAPSHOT_TABLE_GLOBS = [
  // Relation join tables (e.g. videos_keywords_lnk, videos_primary_language_lnk)
  "videos_*_lnk",
  "video_variants_*_lnk",
  "video_subtitles_*_lnk",
  "video_study_questions_*_lnk",
  "video_editions_*_lnk",
  "video_origins_*_lnk",
  "keywords_*_lnk",
  "bible_citations_*_lnk",
  "bible_books_*_lnk",
  "mux_videos_*_lnk",
  "cloudflare_r2s_*_lnk",
  "video_images_*_lnk",
  "video_variant_downloads_*_lnk",
  "languages_*_lnk",
  "language_audio_previews_*_lnk",
  "countries_*_lnk",
  "country_languages_*_lnk",
  "continents_*_lnk",
  // Component join tables (link entities to their component rows)
  "videos_cmps",
  "video_variants_cmps",
  "languages_cmps",
] as const

export type SnapshotTable = (typeof SNAPSHOT_TABLES)[number]
