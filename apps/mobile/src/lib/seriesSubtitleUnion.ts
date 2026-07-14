import { mapWithConcurrency } from "./concurrentMap"
import { withTimeout } from "./withTimeout"
import type {
  VariantMedia,
  WatchSubtitle,
  WatchVariant,
} from "./normalizeVideo"

// Union of subtitle languages a series offers for one audio language: each episode
// is a two-hop lazy fetch (variants → dub → media → subtitles), deduped by
// languageSlug. Pure with injected fetchers; route wires Apollo cache-first, tests mock.

const SUBTITLE_UNION_CONCURRENCY = 4
const SUBTITLE_UNION_PER_EPISODE_TIMEOUT_MS = 10_000

export type SubtitleUnionDeps = {
  /** The episode's dub variants (each carries documentId + languageSlug). */
  getEpisodeVariants: (slug: string) => Promise<WatchVariant[]>
  /** The dub's downloads + subtitles (GET_VIDEO_DUB normalized). */
  getDubMedia: (dubDocumentId: string) => Promise<VariantMedia>
}

export type SubtitleUnionResult = {
  /** Deduped by languageSlug (bcp47 isn't unique), sorted by display name. */
  subtitles: WatchSubtitle[]
  /** Episodes whose fetch failed/timed out — the union may be incomplete. */
  failedEpisodes: number
}

// One episode's subtitle tracks for the chosen audio language; empty when the
// language isn't offered (skip, not an error — it just adds nothing to the union).
async function episodeSubtitles(
  slug: string,
  languageSlug: string,
  deps: SubtitleUnionDeps,
): Promise<WatchSubtitle[]> {
  const variants = await deps.getEpisodeVariants(slug)
  const variant = variants.find((v) => v.languageSlug === languageSlug)
  if (!variant) return []
  const media = await deps.getDubMedia(variant.documentId)
  return media.subtitles
}

export async function resolveSeriesSubtitleUnion(
  episodes: readonly { slug: string }[],
  languageSlug: string,
  deps: SubtitleUnionDeps,
  signal?: AbortSignal,
  perEpisodeTimeoutMs: number = SUBTITLE_UNION_PER_EPISODE_TIMEOUT_MS,
): Promise<SubtitleUnionResult> {
  const settled = await mapWithConcurrency(
    episodes,
    SUBTITLE_UNION_CONCURRENCY,
    (episode) =>
      withTimeout(
        episodeSubtitles(episode.slug, languageSlug, deps),
        perEpisodeTimeoutMs,
        signal,
      ),
    signal,
  )

  // First track wins per languageSlug — the union only needs one representative
  // per language for the picker (name + slug); later duplicates are dropped.
  const byLanguage = new Map<string, WatchSubtitle>()
  let failedEpisodes = 0
  for (const result of settled) {
    if (result.status === "rejected") {
      failedEpisodes += 1
      continue
    }
    for (const sub of result.value) {
      if (sub.languageSlug && !byLanguage.has(sub.languageSlug)) {
        byLanguage.set(sub.languageSlug, sub)
      }
    }
  }

  const subtitles = [...byLanguage.values()].sort((a, b) =>
    a.languageName.toLowerCase().localeCompare(b.languageName.toLowerCase()),
  )
  return { subtitles, failedEpisodes }
}
