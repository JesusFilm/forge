import { mapWithConcurrency } from "./concurrentMap"
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

// Resolve a series' episodes for a single {quality, language, subtitle} choice.
// Episodes carry no dubs (lean cards), so each is a two-hop lazy fetch:
// getEpisodeVariants(slug) → dub by languageSlug → getDubMedia(dubId) → tier.
// Pure given injected fetchers, so the route wires Apollo and tests inject mocks.

export const SERIES_RESOLVE_CONCURRENCY = 4
export const SERIES_PER_EPISODE_TIMEOUT_MS = 10_000

export type SeriesDownloadChoice = {
  qualityTier: QualityTier
  /** Audio language to download across every episode (unique slug, not bcp47). */
  languageSlug: string
  /** Chosen subtitle language slug, or null for "No subtitles". */
  subtitleLanguageSlug: string | null
}

export type SeriesResolveDeps = {
  /** The episode's dub variants (each carries documentId + languageSlug). */
  getEpisodeVariants: (slug: string) => Promise<WatchVariant[]>
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
  /** The tier actually selected — may differ from the request on fallback. */
  resolvedTier?: QualityTier
  subtitleUrl?: string | null
  subtitleMissing?: boolean
  /** Byte size of the chosen rendition; 0 when the size is unknown. */
  sizeBytes?: number
  /** The rendition reported a missing/zero size — the total is a lower bound. */
  sizeUnknown?: boolean
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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Resolution timed out")), ms)
  })
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer)
    }),
    timeout,
  ])
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
  const rendition = selectTierRendition(
    tierDownloads(media.downloads),
    choice.qualityTier,
  )
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
    resolvedTier: rendition.tier,
    subtitleUrl: subtitle.url,
    subtitleMissing: subtitle.missing,
    sizeBytes: sizeUnknown ? 0 : size,
    sizeUnknown,
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

  const resolved = resolutions.filter((r) => r.status === "resolved")
  const totalBytes = resolved.reduce((sum, r) => sum + (r.sizeBytes ?? 0), 0)
  return {
    episodes: resolutions,
    resolved,
    resolvedCount: resolved.length,
    skippedLanguageCount: resolutions.filter(
      (r) => r.status === "skipped-language-absent",
    ).length,
    skippedNoRenditionCount: resolutions.filter(
      (r) => r.status === "skipped-no-rendition",
    ).length,
    failedCount: resolutions.filter((r) => r.status === "failed-resolve")
      .length,
    totalBytes,
    totalIsLowerBound: resolved.some((r) => r.sizeUnknown === true),
  }
}

export type EpisodeAction = "start" | "swap" | "switch" | "skip"

/**
 * Decide how to enqueue a resolved episode against its existing record. State-
 * aware: swapDownload only acts on a `downloaded` record, so an in-progress copy
 * in a different language must be canceled and restarted (`switch`) rather than
 * left to finish in the old language. Same dub (any state) is already satisfied.
 */
export function decideEpisodeAction(
  record: OfflineDownloadRecord | null | undefined,
  chosenDubDocumentId: string,
): EpisodeAction {
  if (!record || record.state === "failed" || record.state === "canceled") {
    return "start"
  }
  if (record.dubDocumentId === chosenDubDocumentId) return "skip"
  return record.state === "downloaded" ? "swap" : "switch"
}
