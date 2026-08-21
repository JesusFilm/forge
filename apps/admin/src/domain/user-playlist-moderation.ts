export const USER_PLAYLIST_BLOCK_REASONS = [
  "ABUSE",
  "COPYRIGHT",
  "PRIVACY",
  "SAFETY",
  "SPAM",
  "OTHER_POLICY",
] as const

export type UserPlaylistBlockReason =
  (typeof USER_PLAYLIST_BLOCK_REASONS)[number]

export const USER_PLAYLIST_RESTORE_REASONS = [
  "REVIEW_CLEARED",
  "APPEAL_APPROVED",
  "ERROR_CORRECTED",
] as const

export type UserPlaylistRestoreReason =
  (typeof USER_PLAYLIST_RESTORE_REASONS)[number]
