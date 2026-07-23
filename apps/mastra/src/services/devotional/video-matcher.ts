import {
  getDevotionalVideoSearchConfig,
  type DevotionalVideoSearchConfig,
} from "../../config/env"
import { callAdminEvalSearch } from "../admin-search-eval-client"
import type { Hook, ScriptureRef, VideoClip, VideoMatchSource } from "./types"

/**
 * Find a relevant Jesus Film library clip for the day's scripture/theme via the
 * Admin semantic-search HTTP contract (A2), applying the always-a-clip fallback
 * (A8): a real hit above threshold -> "search"; otherwise the configured default
 * clip -> "fallback"; otherwise -> "none". Never throws — a search failure
 * degrades to the fallback so the pipeline can still produce a devotional.
 */

const DEFAULT_RELEVANCE_THRESHOLD = 0.5
const DEFAULT_SEARCH_LIMIT = 5
const FALLBACK_CLIP_TITLE = "Featured Jesus Film clip"

export type VideoSearchHit = {
  id: string
  title: string
  /** Slug/path the watch site resolves to a public clip URL. */
  url: string
  thumbnailUrl: string | null
  score: number
}

export type VideoSearchFn = (input: {
  query: string
  limit: number
}) => Promise<VideoSearchHit[]>

export type MatchVideoOptions = {
  scripture: ScriptureRef
  hook: Hook
  search?: VideoSearchFn
  config?: DevotionalVideoSearchConfig
  threshold?: number
  fetchImpl?: typeof fetch
}

export type VideoMatchResult = {
  video: VideoClip | null
  videoMatch: VideoMatchSource
}

function buildQuery(scripture: ScriptureRef, hook: Hook): string {
  return `${scripture.reference} — ${hook.title}`.slice(0, 256)
}

function createDefaultVideoSearch(
  config: DevotionalVideoSearchConfig,
  fetchImpl?: typeof fetch,
): VideoSearchFn {
  return async ({ query, limit }) => {
    const response = await callAdminEvalSearch({
      url: config.url,
      bearer: config.bearer,
      payload: { query, locale: "en", limit, contentType: "video" },
      ...(fetchImpl ? { fetchImpl } : {}),
    })
    if (!response.ok) {
      throw new Error(`admin video search failed: ${response.reason}`)
    }
    return response.result.results.map((result) => ({
      id: result.id,
      title: result.title,
      url: result.slug,
      thumbnailUrl: result.imageUrl,
      score: result.score,
    }))
  }
}

function fallbackResult(config: DevotionalVideoSearchConfig): VideoMatchResult {
  if (!config.defaultVideoId) {
    return { video: null, videoMatch: "none" }
  }
  return {
    video: {
      videoId: config.defaultVideoId,
      title: FALLBACK_CLIP_TITLE,
      url: config.defaultVideoId,
      thumbnailUrl: null,
    },
    videoMatch: "fallback",
  }
}

export async function matchVideo(
  options: MatchVideoOptions,
): Promise<VideoMatchResult> {
  const config = options.config ?? getDevotionalVideoSearchConfig()
  const threshold = options.threshold ?? DEFAULT_RELEVANCE_THRESHOLD
  const query = buildQuery(options.scripture, options.hook)

  if (config.url && config.bearer) {
    const search =
      options.search ?? createDefaultVideoSearch(config, options.fetchImpl)
    try {
      const hits = await search({ query, limit: DEFAULT_SEARCH_LIMIT })
      const best = hits.reduce<VideoSearchHit | null>((top, hit) => {
        return top === null || hit.score > top.score ? hit : top
      }, null)
      if (best && best.score >= threshold) {
        return {
          video: {
            videoId: best.id,
            title: best.title,
            url: best.url,
            thumbnailUrl: best.thumbnailUrl,
          },
          videoMatch: "search",
        }
      }
    } catch {
      // Search is best-effort; fall through to the configured fallback clip.
    }
  }

  return fallbackResult(config)
}

export const _internal = {
  DEFAULT_RELEVANCE_THRESHOLD,
  buildQuery,
}
