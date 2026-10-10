import { getT, type UiT } from "../i18n/useT"
import type { WatchDownload } from "./normalizeVideo"

// Size-based quality tiering shared by the per-video download sheet and the
// series resolver. Extracted from DownloadSheet so both consumers pick tiers
// from one implementation rather than drifting copies.

/** Tier identifiers, best first. They are also the `DownloadQuality` catalog
 *  keys, so the sheets render the text and no logic ever reads it (KTD15). */
export const QUALITY_TIERS = ["highest", "high", "low"] as const

export type QualityTier = (typeof QUALITY_TIERS)[number]

export type TieredDownload = WatchDownload & { tier: QualityTier }

export type FileSizeT = UiT<"DownloadSheet">

// Units and the decimal point stay raw in every language. React callers pass
// their own `t`; the default serves `.ts` callers.
export function formatFileSize(
  sizeString: string,
  t: FileSizeT = getT("DownloadSheet"),
): string {
  const bytes = Number(sizeString)
  if (Number.isNaN(bytes) || bytes <= 0) return t("unknownSize")
  const mb = bytes / 1048576
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`
  }
  return `${mb.toFixed(1)} MB`
}

/**
 * Format a (possibly lower-bound) size for a tier hint. A lower bound with a
 * partial known sum means the real download is LARGER than `bytes`, so mark it
 * approximate ("~") rather than showing an exact total the storage gate would
 * later reject. A zero/unknown total already renders honestly as "Unknown".
 */
export function formatTierSize(
  total: {
    bytes: number
    isLowerBound: boolean
  },
  t: FileSizeT = getT("DownloadSheet"),
): string {
  const text = formatFileSize(String(total.bytes), t)
  return total.isLowerBound && total.bytes > 0 ? `~${text}` : text
}

// Collapse a dub's renditions to up to three labelled tiers by descending size.
// Copies before sorting — Apollo freezes cached arrays and an in-place sort
// throws on a warm cache.
export function tierDownloads(downloads: WatchDownload[]): TieredDownload[] {
  const sorted = [...downloads].sort((a, b) => Number(b.size) - Number(a.size))
  if (sorted.length === 0) return []
  const head = sorted[0]
  if (sorted.length === 1) {
    return [{ ...head, tier: "highest" }]
  }
  const tail = sorted[sorted.length - 1]
  if (sorted.length === 2) {
    return [
      { ...head, tier: "highest" },
      { ...tail, tier: "low" },
    ]
  }
  const middle = sorted[Math.floor(sorted.length / 2)]
  return [
    { ...head, tier: "highest" },
    { ...middle, tier: "high" },
    { ...tail, tier: "low" },
  ]
}
