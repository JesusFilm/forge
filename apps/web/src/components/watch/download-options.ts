export type WatchDownloadOption = {
  capability?: string
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

// Legacy distribution-origin rows (`distroHigh` / `distroSd` / `distroLow`).
// They stay in the catalog but are never a user-facing tier: they point at a
// different (older, lower-fidelity) origin than the Mux renditions, and their
// sizes are not comparable with them. Matched by quality KEY only; no URL or
// host is inspected here, the proxy keeps owning target validation.
const LEGACY_DISTRO_QUALITY = /^distro/i

function isUserFacingDownload(download: WatchDownloadOption): boolean {
  return !LEGACY_DISTRO_QUALITY.test(download.quality)
}

// Distinct downloads by opaque id, first (highest-ranked) occurrence wins.
function distinctByDocumentId(
  downloads: WatchDownloadOption[],
): WatchDownloadOption[] {
  const seen = new Set<string>()
  return downloads.filter((download) => {
    if (seen.has(download.documentId)) return false
    seen.add(download.documentId)
    return true
  })
}

// Tier ranking: known quality priority first; size only breaks ties inside one
// quality; unknown qualities rank after every known one (size, then input
// order). Unlike `sortDownloadsByQuality`, a size can never promote a row past
// a higher quality, so an inflated `low` cannot become Highest.
function rankForTiers(downloads: WatchDownloadOption[]): WatchDownloadOption[] {
  const unknownRank = QUALITY_PRIORITY.length
  const positiveSize = (d: WatchDownloadOption) =>
    d.size != null && d.size > 0 ? d.size : 0
  return [...downloads].sort((a, b) => {
    const rankA = QUALITY_PRIORITY.indexOf(a.quality)
    const rankB = QUALITY_PRIORITY.indexOf(b.quality)
    const byQuality =
      (rankA === -1 ? unknownRank : rankA) -
      (rankB === -1 ? unknownRank : rankB)
    return byQuality !== 0 ? byQuality : positiveSize(b) - positiveSize(a)
  })
}

// Only the `fhd` / `highest` pair is treated as an alias. The catalog carries
// both under separate opaque ids for the same 1080p rendition on the JESUS
// film; that is a heuristic about those two keys, not proof two ids are the
// same asset elsewhere, and equal height alone is NOT treated as equivalence
// (codecs and encodes can differ).
function isHighestAlias(
  reference: WatchDownloadOption,
  candidate: WatchDownloadOption,
): boolean {
  const pair = new Set([reference.quality, candidate.quality])
  return pair.size === 2 && pair.has("fhd") && pair.has("highest")
}

// Surface as many tier options as there are distinct non-distro downloads, up
// to three. Quality decides tiers; size never does.
//   1 download  -> [Highest]
//   2 downloads -> [Highest, Low]
//   3+ downloads -> [Highest, High, Low]
// Highest is the highest-quality row. Low is the `low` row and High is the
// `high` row. When one is missing (or `high` is already Highest) the tier
// degrades to a real lower supported quality instead of vanishing: Low takes
// the lowest remaining row, High takes the best remaining row. Fallbacks
// prefer another quality (e.g. `sd`) over the `fhd`/`highest` alias of the
// Highest row; the alias is used only as a last resort
// so up to three distinct downloads are still preserved.
export function bucketDownloads(
  downloads: WatchDownloadOption[],
): DownloadTierOption[] {
  const ranked = distinctByDocumentId(
    rankForTiers(downloads.filter(isUserFacingDownload)),
  )
  const [highest, ...rest] = ranked
  if (!highest) return []
  const options: DownloadTierOption[] = [
    { tier: "highest", label: "Highest", download: highest },
  ]
  if (rest.length === 0) return options

  const distinctRest = rest.filter((d) => !isHighestAlias(highest, d))
  const aliasRest = rest.filter((d) => isHighestAlias(highest, d))
  const lowDownload =
    rest.find((d) => d.quality === "low") ??
    distinctRest[distinctRest.length - 1] ??
    (aliasRest[aliasRest.length - 1] as WatchDownloadOption)
  const middle = [...distinctRest, ...aliasRest].filter(
    (d) => d !== lowDownload,
  )
  const highDownload = middle.find((d) => d.quality === "high") ?? middle[0]
  if (highDownload) {
    options.push({ tier: "high", label: "High", download: highDownload })
  }
  options.push({ tier: "low", label: "Low", download: lowDownload })
  return options
}

export function selectDefaultDownloadTier(
  downloads: WatchDownloadOption[],
): DownloadTierOption | null {
  return bucketDownloads(downloads)[0] ?? null
}
