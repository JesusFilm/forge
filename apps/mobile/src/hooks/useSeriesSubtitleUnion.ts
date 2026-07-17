import { useCallback, useEffect, useRef, useState } from "react"

import { getApolloClient } from "../lib/apolloClient"
import { GET_VIDEO_BY_SLUG, GET_VIDEO_DUB } from "../lib/queries"
import {
  normalizeDubMedia,
  normalizeVideo,
  type WatchSubtitle,
} from "../lib/normalizeVideo"
import { resolveSeriesSubtitleUnion } from "../lib/seriesSubtitleUnion"

// Series locale matches the series detail + download queries.
const LOCALE = "en"

export type SeriesSubtitleUnion = {
  /** Resolved union, or null while idle/loading/errored (null = "unknown yet"). */
  subtitles: WatchSubtitle[] | null
  loading: boolean
  error: boolean
  retry: () => void
}

type State =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ready"; subtitles: WatchSubtitle[] }

/**
 * Resolve the subtitle languages a series offers for its selected audio language,
 * by unioning the episodes' lazily-fetched dub media (cache-first, so it shares
 * the download flow's fetches). `enabled` gates the fan-out: the detail-page pill
 * passes false until a subtitle is actually set (it only needs the union to
 * reconcile a set preference), while the picker sheet always passes true.
 */
export function useSeriesSubtitleUnion(
  episodes: readonly { slug: string }[] | null,
  languageSlug: string | null,
  enabled = true,
): SeriesSubtitleUnion {
  const [state, setState] = useState<State>({ phase: "idle" })
  const controllerRef = useRef<AbortController | null>(null)

  const active = enabled && !!episodes && !!languageSlug

  const run = useCallback(
    async (controller: AbortController) => {
      if (!episodes || !languageSlug) return
      setState({ phase: "loading" })
      const client = getApolloClient()
      try {
        const { subtitles, failedEpisodes } = await resolveSeriesSubtitleUnion(
          episodes,
          languageSlug,
          {
            getEpisodeVariants: async (slug) => {
              const res = await client.query({
                query: GET_VIDEO_BY_SLUG,
                variables: { slug, locale: LOCALE },
                fetchPolicy: "cache-first" as const,
              })
              return (
                normalizeVideo(res.data?.videoBySlug ?? null)?.variants ?? []
              )
            },
            getDubMedia: async (dubDocumentId) => {
              const res = await client.query({
                query: GET_VIDEO_DUB,
                variables: { id: dubDocumentId },
                fetchPolicy: "cache-first" as const,
              })
              return normalizeDubMedia(res.data?.videoDub ?? null)
            },
          },
          controller.signal,
        )
        if (controller.signal.aborted) return
        // Every episode failing (e.g. offline) is "retry", not an empty union.
        if (episodes.length > 0 && failedEpisodes === episodes.length) {
          setState({ phase: "error" })
          return
        }
        setState({ phase: "ready", subtitles })
      } catch {
        if (controller.signal.aborted) return
        setState({ phase: "error" })
      }
    },
    [episodes, languageSlug],
  )

  useEffect(() => {
    if (!active) {
      setState({ phase: "idle" })
      return
    }
    const controller = new AbortController()
    controllerRef.current = controller
    void run(controller)
    // Abort whatever controller is current at teardown — a retry() may have
    // swapped in a newer one that this closure's `controller` wouldn't cover.
    return () => controllerRef.current?.abort()
  }, [active, run])

  const retry = useCallback(() => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    void run(controller)
  }, [run])

  return {
    subtitles: state.phase === "ready" ? state.subtitles : null,
    loading: state.phase === "loading",
    error: state.phase === "error",
    retry,
  }
}
