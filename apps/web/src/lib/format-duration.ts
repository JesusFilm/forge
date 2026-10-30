/**
 * Format a duration in seconds as a `m:ss` (sub-hour) or `h:mm:ss`
 * (one hour or longer) timecode. Single source of truth for media-duration
 * labels across search cards, recommendation cards, and download modals.
 *
 * Sub-hour: `1:10`, `9:59`, `12:34` (minutes are NOT zero-padded —
 * standard media-duration convention).
 * Hour-plus: `1:00:00`, `1:02:05` (hour is NOT zero-padded; minutes
 * and seconds are).
 *
 * Returns `""` for `NaN` / negative input; the empty string lets call
 * sites render nothing without a separate null branch.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return ""
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const pad = (n: number) => n.toString().padStart(2, "0")
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}
