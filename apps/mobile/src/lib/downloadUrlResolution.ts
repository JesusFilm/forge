import type { VariantMedia, WatchDownload } from "./normalizeVideo"

/**
 * Pure URL re-resolution: pick fresh media + subtitle URLs from a fetched dub's
 * media ({@link VariantMedia}) keyed by the manifest's stable IDENTITY (it stores
 * identity not signed URLs, which expire), so the engine re-resolves via `videoDub(id)`.
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
       * Subtitle requested by slug but absent from fetched media; engine
       * degrades to no-subtitle and reports it rather than failing the download.
       */
      subtitleMissing: boolean
    }
  /** The dub was fetched but exposes no downloadable rendition — terminal. */
  | { kind: "empty" }

/**
 * Pick the rendition by stored identity with fallback: documentId → quality
 * label → nearest size. Null only when no downloads exist. Copies before sorting
 * (Apollo freezes cached arrays; an in-place sort throws on a warm cache).
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
 * Pick subtitle by language SLUG, not bcp47 (bcp47 prefixes collide across
 * distinct languages). Null slug = "No subtitles"; a set-but-absent slug
 * resolves to no URL with `missing: true`.
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
