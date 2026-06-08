// Pure, React-free helpers for the video-details screen. Extracted so the
// non-trivial string-building logic is unit-testable without
// @testing-library/react-native (not available in apps/tv).

import type { WatchVideoRecord } from "../../lib/normalizeVideo"

/**
 * Build the metadata line shown under the title: `label · duration · N languages`.
 * Each segment is omitted when its source is absent, and the segments are joined
 * with a middle dot. Returns null when there is nothing to show.
 *
 * Duration is formatted from seconds → `M:SS` (or `H:MM:SS` past an hour).
 */
export function buildMetadataLine(
  label: string | null | undefined,
  durationSeconds: number | null | undefined,
  languageCount: number | null | undefined,
): string | null {
  const segments: string[] = []

  if (label && label.trim().length > 0) segments.push(label.trim())

  const duration = formatDuration(durationSeconds)
  if (duration) segments.push(duration)

  if (languageCount != null && languageCount > 0) {
    segments.push(
      languageCount === 1 ? "1 language" : `${languageCount} languages`,
    )
  }

  if (segments.length === 0) return null
  return segments.join("  ·  ")
}

/** Format a duration in seconds as `M:SS` or `H:MM:SS`. Null for non-positive. */
export function formatDuration(
  seconds: number | null | undefined,
): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null
  const total = Math.floor(seconds)
  if (total <= 0) return null
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, "0")
  if (h > 0) {
    const mm = String(m).padStart(2, "0")
    return `${h}:${mm}:${ss}`
  }
  return `${m}:${ss}`
}

/**
 * Build the public web share URL for a video (and its active language, when
 * known). The continuation surface for Share/Download is the viewer's phone;
 * the QR encodes this URL. Returns null when there is no slug to anchor it.
 */
export function buildShareUrl(
  video: Pick<WatchVideoRecord, "slug"> | null | undefined,
  activeLanguageSlug: string | null | undefined,
): string | null {
  if (!video?.slug) return null
  const base = `https://www.jesusfilm.org/watch/${video.slug}`
  return activeLanguageSlug ? `${base}/${activeLanguageSlug}` : base
}
