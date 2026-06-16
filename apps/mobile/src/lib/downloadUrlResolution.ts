import type { VariantMedia, WatchDownload } from "./normalizeVideo"

/**
 * Offline-download URL re-resolution: given a fetched dub's media
 * ({@link VariantMedia}) and the stable identity stored in the manifest, pick
 * the fresh media + subtitle URLs to (re)start a download or resume against.
 *
 * The manifest deliberately stores IDENTITY (rendition documentId, quality
 * label, subtitle language slug) rather than the volatile signed URLs, which
 * expire — so the engine re-resolves through `videoDub(id)` immediately before
 * each enqueue/resume. This module is the PURE selection over already-fetched
 * media; the Apollo fetch wiring and the offline (needs-network) typed error are
 * part of the engine layer.
 */

export type DesiredDownload = {
  /** Stable rendition id (primary key for re-resolution). */
  renditionDocumentId: string
  /** Quality label fallback if the rendition id is gone (e.g. "High"). */
  qualityLabel: string
  /** Original byte size, used for the nearest-size fallback. */
  totalBytes?: number
  /** Chosen subtitle language slug, or null for "No subtitles". */
  subtitleLanguageSlug: string | null
}

export type DownloadResolution =
  | {
      kind: "resolved"
      mediaUrl: string
      renditionDocumentId: string
      qualityLabel: string
      subtitleUrl: string | null
      /**
       * True when a subtitle was requested by slug but is not in the fetched
       * media. The engine degrades to no-subtitle and reports it, rather than
       * failing the whole download.
       */
      subtitleMissing: boolean
    }
  /** The dub was fetched but exposes no downloadable rendition — terminal. */
  | { kind: "empty" }

/**
 * Pick the rendition matching the stored identity, with graceful fallback:
 * exact documentId → quality label → nearest size. Returns null only when there
 * are no downloads at all. Copies before sorting (the Apollo cache freezes
 * arrays, so an in-place sort would throw on a warm cache).
 */
export function selectRendition(
  downloads: readonly WatchDownload[],
  desired: DesiredDownload,
): WatchDownload | null {
  if (downloads.length === 0) return null

  const byId = downloads.find(
    (d) => d.documentId === desired.renditionDocumentId,
  )
  if (byId) return byId

  const byQuality = downloads.find((d) => d.quality === desired.qualityLabel)
  if (byQuality) return byQuality

  const target = desired.totalBytes ?? 0
  const sorted = [...downloads].sort(
    (a, b) =>
      Math.abs(Number(a.size) - target) - Math.abs(Number(b.size) - target),
  )
  return sorted[0] ?? null
}

/**
 * Pick the chosen subtitle by language SLUG (not bcp47 — bcp47 prefixes collide
 * across distinct languages). A null slug means "No subtitles". A slug that is
 * set but not present in the media resolves to no URL with `missing: true`.
 */
export function selectSubtitle(
  media: VariantMedia,
  subtitleLanguageSlug: string | null,
): { url: string | null; missing: boolean } {
  if (subtitleLanguageSlug == null) return { url: null, missing: false }
  const match = media.subtitles.find(
    (s) => s.languageSlug === subtitleLanguageSlug,
  )
  if (match) return { url: match.vttSrc, missing: false }
  return { url: null, missing: true }
}

/** Resolve the fresh media + subtitle URLs from already-fetched dub media. */
export function resolveFromMedia(
  media: VariantMedia,
  desired: DesiredDownload,
): DownloadResolution {
  const rendition = selectRendition(media.downloads, desired)
  if (!rendition) return { kind: "empty" }

  const subtitle = selectSubtitle(media, desired.subtitleLanguageSlug)
  return {
    kind: "resolved",
    mediaUrl: rendition.url,
    renditionDocumentId: rendition.documentId,
    qualityLabel: rendition.quality,
    subtitleUrl: subtitle.url,
    subtitleMissing: subtitle.missing,
  }
}
