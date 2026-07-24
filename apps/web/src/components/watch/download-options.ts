export type WatchDownloadOption = {
  documentId: string
  height?: number | null
  quality: string
  size: number | null
}

export type DownloadTier = "highest" | "high" | "low"

export type DownloadTierOption = {
  tier: DownloadTier
  label: string
  download: WatchDownloadOption
}

export type DownloadResolutionLabel = "4K" | "2K" | "FHD" | "HD" | "SD"

// Quality keys the CMS emits, ordered highest-fidelity first. Size still wins
// when available because some rows have stale quality labels for the asset.
const QUALITY_METADATA: {
  quality: string
  resolution: DownloadResolutionLabel
}[] = [
  { quality: "uhd", resolution: "4K" },
  { quality: "qhd", resolution: "2K" },
  { quality: "fhd", resolution: "FHD" },
  { quality: "highest", resolution: "FHD" },
  { quality: "high", resolution: "HD" },
  { quality: "distroHigh", resolution: "HD" },
  { quality: "sd", resolution: "SD" },
  { quality: "distroSd", resolution: "SD" },
  { quality: "low", resolution: "SD" },
  { quality: "distroLow", resolution: "SD" },
]

const QUALITY_PRIORITY = QUALITY_METADATA.map(({ quality }) => quality)
const RESOLUTION_BY_QUALITY = new Map(
  QUALITY_METADATA.map(({ quality, resolution }) => [quality, resolution]),
)

export function downloadQualityResolutionLabel(
  quality: string | null | undefined,
): DownloadResolutionLabel | null {
  return quality == null ? null : (RESOLUTION_BY_QUALITY.get(quality) ?? null)
}

export function sortDownloadsByQuality(
  downloads: WatchDownloadOption[],
): WatchDownloadOption[] {
  const priority = new Map<string, number>(
    QUALITY_PRIORITY.map((q, i) => [q, i]),
  )
  const tail = QUALITY_PRIORITY.length
  return [...downloads].sort((a, b) => {
    const aSize = a.size != null && a.size > 0 ? a.size : 0
    const bSize = b.size != null && b.size > 0 ? b.size : 0
    if (aSize > 0 && bSize > 0 && aSize !== bSize) return bSize - aSize
    const ai = priority.get(a.quality) ?? tail
    const bi = priority.get(b.quality) ?? tail
    return ai - bi
  })
}

// Surface as many tier options as there are distinct downloads, up to three.
//   1 download  -> [Highest]
//   2 downloads -> [Highest, Low]
//   3+ downloads -> [Highest, High, Low] picked at evenly-spaced positions.
export function bucketDownloads(
  downloads: WatchDownloadOption[],
): DownloadTierOption[] {
  const sorted = sortDownloadsByQuality(downloads)
  if (sorted.length === 0) return []
  const head = sorted[0] as WatchDownloadOption
  if (sorted.length === 1) {
    return [{ tier: "highest", label: "Highest", download: head }]
  }
  const tail = sorted[sorted.length - 1] as WatchDownloadOption
  if (sorted.length === 2) {
    return [
      { tier: "highest", label: "Highest", download: head },
      { tier: "low", label: "Low", download: tail },
    ]
  }
  const middle = sorted[Math.floor(sorted.length / 2)] as WatchDownloadOption
  return [
    { tier: "highest", label: "Highest", download: head },
    { tier: "high", label: "High", download: middle },
    { tier: "low", label: "Low", download: tail },
  ]
}

export function selectDefaultDownloadTier(
  downloads: WatchDownloadOption[],
): DownloadTierOption | null {
  return bucketDownloads(downloads)[0] ?? null
}
