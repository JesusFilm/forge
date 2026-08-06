export const VIDEO_DB_BACKUP_PROFILES = {
  "video-core": [
    "language",
    "language_locale",
    "continent",
    "continent_locale",
    "country",
    "country_locale",
    "country_language",
    "keyword",
    "video_origin",
    "video_edition",
    "mux_video",
    "bible_book",
    "video",
    "video_locale",
    "video_relation",
    "video_keyword",
    "video_dub",
    "video_dub_download",
    "video_subtitle",
    "video_study_question",
    "video_image",
    "bible_citation",
  ],
  "video-search": [
    "language",
    "language_locale",
    "continent",
    "continent_locale",
    "country",
    "country_locale",
    "country_language",
    "keyword",
    "video_origin",
    "video_edition",
    "mux_video",
    "bible_book",
    "video",
    "video_locale",
    "video_relation",
    "video_keyword",
    "video_dub",
    "video_dub_download",
    "video_subtitle",
    "video_study_question",
    "video_image",
    "bible_citation",
    "video_scene",
    "video_scene_locale",
    "video_transcript",
    "video_transcript_chunk",
  ],
  "video-full": [
    "language",
    "language_locale",
    "continent",
    "continent_locale",
    "country",
    "country_locale",
    "country_language",
    "keyword",
    "video_origin",
    "video_edition",
    "mux_video",
    "bible_book",
    "video",
    "video_locale",
    "video_relation",
    "video_keyword",
    "video_dub",
    "video_dub_download",
    "video_subtitle",
    "video_study_question",
    "video_image",
    "bible_citation",
    "video_scene",
    "video_scene_locale",
    "video_transcript",
    "video_transcript_chunk",
  ],
} as const

export type VideoDbBackupProfile = keyof typeof VIDEO_DB_BACKUP_PROFILES

export const SCHEDULED_VIDEO_DB_BACKUP_PROFILES = [
  "video-core",
  "video-search",
] as const satisfies readonly VideoDbBackupProfile[]

export type VideoDbBackupJobResult = {
  event: "video-db.backup.complete" | "video-db.backup.dry-run-complete"
  profile: VideoDbBackupProfile
  tables: number
  path: string
  size?: number
  exportDurationMs?: number
  uploadDurationMs?: number
  upload?: {
    bucket: string
    key: string
  }
}
