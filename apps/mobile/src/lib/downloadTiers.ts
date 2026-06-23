import type { WatchDownload } from "./normalizeVideo"

// Size-based quality tiering shared by the per-video download sheet and the
// series resolver. Extracted from DownloadSheet so both consumers pick tiers
// from one implementation rather than drifting copies.

export type QualityTier = "Highest" | "High" | "Low"

export type TieredDownload = WatchDownload & { tier: QualityTier }

export function formatFileSize(sizeString: string): string {
  const bytes = Number(sizeString)
  if (Number.isNaN(bytes) || bytes <= 0) return "Unknown"
  const mb = bytes / 1048576
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`
  }
  return `${mb.toFixed(1)} MB`
}

// Collapse a dub's renditions to up to three labelled tiers by descending size.
// Copies before sorting — Apollo freezes cached arrays and an in-place sort
// throws on a warm cache.
export function tierDownloads(downloads: WatchDownload[]): TieredDownload[] {
  const sorted = [...downloads].sort((a, b) => Number(b.size) - Number(a.size))
  if (sorted.length === 0) return []
  const head = sorted[0]
  if (sorted.length === 1) {
    return [{ ...head, tier: "Highest" }]
  }
  const tail = sorted[sorted.length - 1]
  if (sorted.length === 2) {
    return [
      { ...head, tier: "Highest" },
      { ...tail, tier: "Low" },
    ]
  }
  const middle = sorted[Math.floor(sorted.length / 2)]
  return [
    { ...head, tier: "Highest" },
    { ...middle, tier: "High" },
    { ...tail, tier: "Low" },
  ]
}
