import { mapWithConcurrency } from "./concurrentMap"
import { withTimeout } from "./withTimeout"
import { selectSubtitle } from "./downloadUrlResolution"
import {
  type QualityTier,
  type TieredDownload,
  tierDownloads,
} from "./downloadTiers"
import type { OfflineDownloadRecord } from "./offlineManifest"
import type {
  VariantMedia,
  WatchDownload,
  WatchEpisode,
  WatchVariant,
} from "./normalizeVideo"

// Resolve a series' episodes for one {quality, language, subtitle} choice. Lean
// episode cards carry no dubs, so each is a two-hop lazy fetch (variants → dub →
// media → tier). Pure given injected fetchers — route wires Apollo, tests mock.

export const SERIES_RESOLVE_CONCURRENCY = 4
export const SERIES_PER_EPISODE_TIMEOUT_MS = 10_000

export type SeriesDownloadChoice = {
  qualityTier: QualityTier
  /** Audio language to download across every episode (unique slug, not bcp47). */
  languageSlug: string
  /** Chosen subtitle language slug, or null for "No subtitles". */
  subtitleLanguageSlug: string | null
}

/**
 * The dub-index slice resolution needs per episode — deliberately narrower than
 * WatchVariant so the sheet can feed it from a lean query (the full per-episode
 * watch payload made a 61-episode, 2000+-dub-segment resolve take minutes).
 */
export type ResolverVariant = Pick<WatchVariant, "documentId" | "languageSlug">

/**
 * Map a lean dub-index result (GET_VIDEO_DUB_INDEX) to resolver variants,
 * mirroring normalizeVideo's published gate — only published dubs resolve.
 */
export function toResolverVariants(
  dubs:
    | readonly {
        documentId?: string | null
        published?: boolean | null
        language?: { slug?: string | null } | null
      }[]
    | null
    | undefined,
): ResolverVariant[] {
  return (dubs ?? [])
    .filter((dub) => dub.published === true)
    .map((dub) => ({
      documentId: dub.documentId ?? "",
      languageSlug: dub.language?.slug ?? null,
    }))
}

export type SeriesResolveDeps = {
  /** The episode's dub variants (each carries documentId + languageSlug). */
  getEpisodeVariants: (slug: string) => Promise<ResolverVariant[]>
  /** The dub's downloads + subtitles (GET_VIDEO_DUB normalized). */
  getDubMedia: (dubDocumentId: string) => Promise<VariantMedia>
}

export type EpisodeResolutionStatus =
  | "resolved"
  | "skipped-language-absent"
  | "skipped-no-rendition"
  | "failed-resolve"

export type SeriesEpisodeResolution = {
  slug: string
  title: string | null
  posterUrl: string | null
  status: EpisodeResolutionStatus
  /** Present once the dub is identified (resolved or skipped-no-rendition). */
  dubDocumentId?: string
  /** The rendition chosen by tier; present only when resolved. */
  rendition?: WatchDownload
  /** Every tier available for this episode — feeds the per-tier size totals. */
  tiered?: TieredDownload[]
  /** The tier actually selected — may differ from the request on fallback. */
  resolvedTier?: QualityTier
  subtitleUrl?: string | null
  subtitleMissing?: boolean
  /** Byte size of the chosen rendition; 0 when the size is unknown. */
  sizeBytes?: number
  /** The rendition reported a missing/zero size — the total is a lower bound. */
  sizeUnknown?: boolean
}

/** One quality tier's total download size across the resolved set. */
export type TierTotal = {
  /** Sum of this tier's rendition sizes over resolved episodes (known sizes). */
  bytes: number
  /** A resolved episode lacked a size for this tier — bytes understates. */
  isLowerBound: boolean
}

export type SeriesDownloadResolution = {
  episodes: SeriesEpisodeResolution[]
  resolved: SeriesEpisodeResolution[]
  resolvedCount: number
  skippedLanguageCount: number
  skippedNoRenditionCount: number
  failedCount: number
  /** Sum of resolved rendition sizes (a lower bound when totalIsLowerBound). */
  totalBytes: number
  /** Any resolved rendition had an unknown size — totalBytes understates. */
  totalIsLowerBound: boolean
  /** Per-tier total size (Highest/High/Low) for the quality picker's hints. */
  tierTotals: Record<QualityTier, TierTotal>
}

const TIER_ORDER: readonly QualityTier[] = ["Highest", "High", "Low"]

// Pick the rendition matching the requested tier label; fall back to the nearest
// available tier (ties prefer higher quality). NOT a positional index — the tier
// array is variable-length, so a shared index would grab the wrong rendition.
function selectTierRendition(
  tiered: readonly TieredDownload[],
  chosen: QualityTier,
): TieredDownload | null {
  if (tiered.length === 0) return null
  const exact = tiered.find((t) => t.tier === chosen)
  if (exact) return exact
  const chosenRank = TIER_ORDER.indexOf(chosen)
  return (
    [...tiered].sort((a, b) => {
      const da = Math.abs(TIER_ORDER.indexOf(a.tier) - chosenRank)
      const db = Math.abs(TIER_ORDER.indexOf(b.tier) - chosenRank)
      if (da !== db) return da - db
      return TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier)
    })[0] ?? null
  )
}

async function resolveEpisode(
  episode: WatchEpisode,
  choice: SeriesDownloadChoice,
  deps: SeriesResolveDeps,
): Promise<SeriesEpisodeResolution> {
  const base = {
    slug: episode.slug,
    title: episode.title,
    posterUrl: episode.posterUrl,
  }

  const variants = await deps.getEpisodeVariants(episode.slug)
  const variant = variants.find((v) => v.languageSlug === choice.languageSlug)
  if (!variant) {
    return { ...base, status: "skipped-language-absent" }
  }

  const media = await deps.getDubMedia(variant.documentId)
  const tiered = tierDownloads(media.downloads)
  const rendition = selectTierRendition(tiered, choice.qualityTier)
  if (!rendition) {
    return {
      ...base,
      status: "skipped-no-rendition",
      dubDocumentId: variant.documentId,
    }
  }

  const subtitle = selectSubtitle(media, choice.subtitleLanguageSlug)
  const size = Number(rendition.size)
  const sizeUnknown = !Number.isFinite(size) || size <= 0
  return {
    ...base,
    status: "resolved",
    dubDocumentId: variant.documentId,
    rendition,
    tiered,
    resolvedTier: rendition.tier,
    subtitleUrl: subtitle.url,
    subtitleMissing: subtitle.missing,
    sizeBytes: sizeUnknown ? 0 : size,
    sizeUnknown,
  }
}

/**
 * Per-tier (Highest/High/Low) total size across the resolved set for the quality
 * picker's hints. Each resolved episode contributes its rendition size for that
 * tier — using the same nearest-tier fallback the download uses — so the totals
 * reflect what would actually download. A missing size makes that tier a lower
 * bound (its known sizes still sum).
 */
function computeTierTotals(
  resolved: readonly SeriesEpisodeResolution[],
): Record<QualityTier, TierTotal> {
  const totals: Record<QualityTier, TierTotal> = {
    Highest: { bytes: 0, isLowerBound: false },
    High: { bytes: 0, isLowerBound: false },
    Low: { bytes: 0, isLowerBound: false },
  }
  for (const episode of resolved) {
    const tiered = episode.tiered
    if (!tiered || tiered.length === 0) continue
    for (const tier of TIER_ORDER) {
      const size = Number(selectTierRendition(tiered, tier)?.size)
      if (Number.isFinite(size) && size > 0) totals[tier].bytes += size
      else totals[tier].isLowerBound = true
    }
  }
  return totals
}

/**
 * Build the SeriesDownloadResolution summary (resolved set / per-status counts /
 * total bytes / lower-bound flag / per-tier totals) from a per-episode resolution
 * list. Shared by resolveSeriesDownload (fresh fan-out) and the route's
 * failed-retry merge, so the two never drift on how the rollup is computed.
 */
export function summarizeResolution(
  episodes: SeriesEpisodeResolution[],
): SeriesDownloadResolution {
  const resolved = episodes.filter((r) => r.status === "resolved")
  return {
    episodes,
    resolved,
    resolvedCount: resolved.length,
    skippedLanguageCount: episodes.filter(
      (r) => r.status === "skipped-language-absent",
    ).length,
    skippedNoRenditionCount: episodes.filter(
      (r) => r.status === "skipped-no-rendition",
    ).length,
    failedCount: episodes.filter((r) => r.status === "failed-resolve").length,
    totalBytes: resolved.reduce((sum, r) => sum + (r.sizeBytes ?? 0), 0),
    totalIsLowerBound: resolved.some((r) => r.sizeUnknown === true),
    tierTotals: computeTierTotals(resolved),
  }
}

export async function resolveSeriesDownload(
  episodes: readonly WatchEpisode[],
  choice: SeriesDownloadChoice,
  deps: SeriesResolveDeps,
  signal?: AbortSignal,
  perEpisodeTimeoutMs: number = SERIES_PER_EPISODE_TIMEOUT_MS,
): Promise<SeriesDownloadResolution> {
  const settled = await mapWithConcurrency(
    episodes,
    SERIES_RESOLVE_CONCURRENCY,
    (episode) =>
      withTimeout(resolveEpisode(episode, choice, deps), perEpisodeTimeoutMs),
    signal,
  )

  // A rejected slot (network error, timeout, or abort) becomes failed-resolve;
  // index alignment lets us recover the episode card for display + retry.
  const resolutions: SeriesEpisodeResolution[] = settled.map((result, i) => {
    if (result.status === "fulfilled") return result.value
    const episode = episodes[i]
    return {
      slug: episode.slug,
      title: episode.title,
      posterUrl: episode.posterUrl,
      status: "failed-resolve",
    }
  })

  return summarizeResolution(resolutions)
}

export type EpisodeAction = "start" | "swap" | "switch" | "skip"

/**
 * The saved-copy identity a re-download compares against: audio dub + rendition
 * (quality) + subtitle. A difference in ANY of the three is a real change, so
 * re-selecting a new quality or subtitle re-downloads instead of no-oping.
 */
export type EpisodeChoice = {
  dubDocumentId: string
  renditionDocumentId: string
  subtitleLanguageSlug: string | null
}

/**
 * Build the compare-choice for a resolved episode, mirroring buildEpisodeRequest's
 * subtitle-degrade rule (no track on this episode → no subtitle). Null when the
 * episode didn't resolve to a downloadable rendition. Keep in lockstep with
 * buildEpisodeRequest so the enqueue decision and storage gate never diverge.
 */
export function episodeChoiceFor(
  episode: SeriesEpisodeResolution,
  subtitleLanguageSlug: string | null,
): EpisodeChoice | null {
  if (
    episode.status !== "resolved" ||
    !episode.rendition ||
    !episode.dubDocumentId
  ) {
    return null
  }
  return {
    dubDocumentId: episode.dubDocumentId,
    renditionDocumentId: episode.rendition.documentId,
    subtitleLanguageSlug: episode.subtitleUrl ? subtitleLanguageSlug : null,
  }
}

/**
 * Decide how to enqueue a resolved episode against its existing record. A record
 * matching the chosen dub AND rendition AND subtitle is already satisfied
 * (`skip`); differing on any of the three is a real change. State-aware:
 * swapDownload only acts on a `downloaded` record, so a differing in-progress
 * copy must be canceled and restarted (`switch`) rather than swapped.
 */
export function decideEpisodeAction(
  record: OfflineDownloadRecord | null | undefined,
  chosen: EpisodeChoice,
): EpisodeAction {
  if (!record || record.state === "failed" || record.state === "canceled") {
    return "start"
  }
  const sameContent =
    record.dubDocumentId === chosen.dubDocumentId &&
    record.renditionDocumentId === chosen.renditionDocumentId &&
    (record.subtitleLanguageSlug ?? null) ===
      (chosen.subtitleLanguageSlug ?? null)
  if (sameContent) return "skip"
  return record.state === "downloaded" ? "swap" : "switch"
}

export type DownloadedSeriesSelection = {
  /** The quality tier every downloaded episode shares, or null if none/mixed. */
  tier: QualityTier | null
  /**
   * The subtitle LANGUAGE the series was saved with — the one non-null slug in
   * the records (episodes lacking that track saved as null, which is expected).
   * undefined when saved without subtitles, not downloaded, or ambiguous.
   */
  subtitleSlug: string | undefined
}

/**
 * What quality tier + subtitle the series is CURRENTLY saved in for the current
 * audio language — so the download sheet can disable those picker options
 * ("already downloaded"). Only committed (`downloaded`) records in the current
 * dub count; a mixed set returns null/undefined (disable nothing) over a guess.
 */
export function deriveDownloadedSelection(
  resolution: SeriesDownloadResolution,
  getRecord: (slug: string) => OfflineDownloadRecord | null,
): DownloadedSeriesSelection {
  const tiers = new Set<QualityTier>()
  // NON-NULL slugs only: a subtitle is applied uniformly at download, so episodes
  // that lack the chosen track save as null. The one language present IS the
  // choice; the nulls just mean "that episode didn't offer it".
  const subtitleLangs = new Set<string>()
  let downloadedCount = 0
  for (const episode of resolution.resolved) {
    const record = getRecord(episode.slug)
    if (!record || record.state !== "downloaded") continue
    // A different audio language isn't "already downloaded" for this selection.
    if (record.dubDocumentId !== episode.dubDocumentId) continue
    downloadedCount += 1
    const tier = episode.tiered?.find(
      (t) => t.documentId === record.renditionDocumentId,
    )?.tier
    if (tier) tiers.add(tier)
    if (record.subtitleLanguageSlug)
      subtitleLangs.add(record.subtitleLanguageSlug)
  }
  // Only disable a tier/subtitle when EVERY resolved episode is saved — a partial
  // series (some episodes missing) must still allow completing at that quality.
  const fullyDownloaded =
    resolution.resolvedCount > 0 && downloadedCount === resolution.resolvedCount
  return {
    tier: fullyDownloaded && tiers.size === 1 ? [...tiers][0] : null,
    subtitleSlug:
      fullyDownloaded && subtitleLangs.size === 1
        ? [...subtitleLangs][0]
        : undefined,
  }
}
