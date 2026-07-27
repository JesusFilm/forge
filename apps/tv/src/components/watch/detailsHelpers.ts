// Pure, React-free helpers for the video-details screen. Extracted so the
// non-trivial string-building logic is unit-testable without
// @testing-library/react-native (not available in apps/tv).

import {
  buildCanonicalWatchVideoPath,
  DEFAULT_WATCH_LANGUAGE_SLUG,
} from "@forge/watch-url-policy/routes"

import type { WatchVideoRecord } from "../../lib/normalizeVideo"

/**
 * Build the metadata line under the title: `label · duration · N languages`.
 * Segments with absent sources are omitted; duration is seconds → `M:SS`/`H:MM:SS`.
 * Returns null when nothing to show.
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

/**
 * Which below-hero rail a video gets. A film with its own chapters shows ONLY
 * the chapter rail — Up Next lists the PARENT's other children, which beside 46
 * chapters of the same film reads as clutter rather than a next step. Every
 * other video keeps Up Next, and each rail still self-hides when empty.
 */
export function shouldShowUpNextRail(
  record: Pick<WatchVideoRecord, "chapters"> | null | undefined,
): boolean {
  if (record == null) return false
  return record.chapters.length === 0
}

/**
 * Wire label → hero badge text: `FEATURE_FILM` → `FEATURE FILM`. The badge style
 * already uppercases, so this only has to unpick the enum's underscores — without
 * it a film reads "FEATURE_FILM" on screen. Null/blank yields null (no badge).
 */
export function formatBadgeLabel(
  label: string | null | undefined,
): string | null {
  if (label == null) return null
  const text = label.trim().split("_").filter(Boolean).join(" ")
  return text.length > 0 ? text : null
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
 * Public web share URL for a video (plus active language when known); the QR
 * encodes it since the phone is the Share/Download continuation surface.
 * Returns null when there is no slug to anchor it.
 */
export function buildShareUrl(
  video: Pick<WatchVideoRecord, "slug"> | null | undefined,
  activeLanguageSlug: string | null | undefined,
): string | null {
  if (!video?.slug) return null
  const path = buildCanonicalWatchVideoPath(
    video.slug,
    activeLanguageSlug ?? DEFAULT_WATCH_LANGUAGE_SLUG,
  )
  return `https://www.jesusfilm.org/watch${path}`
}
