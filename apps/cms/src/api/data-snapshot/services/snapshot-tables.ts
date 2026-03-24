/**
 * Hardcoded allowlist of PostgreSQL tables to include in the dev data snapshot.
 * These correspond to the content types synced by gateway-sync (videos, languages, countries).
 *
 * Update this list when adding new content types to the gateway-sync scope.
 * Join tables (*_lnk) for relations between these types are included via glob pattern.
 */
export const SNAPSHOT_TABLES = [
  // Video-related
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
  // Language-related
  "languages",
  "i18n_locale",
  // Country-related
  "countries",
  "country_languages",
  "continents",
] as const

export type SnapshotTable = (typeof SNAPSHOT_TABLES)[number]
