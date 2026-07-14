// Below-fold horizontal D-pad rail of the series' children (U3). Routes by shape
// (episodeRouting): leaf → /watch, nested collection → /series, both seeded. Nothing
// when childless. Rail scaffold + card come from the shared rails/ modules.

import { memo, useCallback } from "react"
import { useRouter } from "expo-router"

import type { WatchEpisode } from "../../lib/normalizeVideo"
import { isSeriesLabel } from "../../lib/isSeriesRecord"
import { ThumbCard } from "../rails/ThumbCard"
import { ThumbRail } from "../rails/ThumbRail"
import { episodeHref, resolveEpisodePath } from "./episodeRouting"

const keyExtractor = (item: WatchEpisode, index: number) =>
  `episode-${item.documentId}-${index}`

type EpisodeRailProps = {
  episodes: WatchEpisode[]
  /** Selected language slug, threaded into the pushed route's `lang` param (U4 provider supplies + consumes it). */
  languageSlug?: string | null
}

export const EpisodeRail = memo(function EpisodeRail({
  episodes,
  languageSlug,
}: EpisodeRailProps) {
  const router = useRouter()

  const handlePress = useCallback(
    (episode: WatchEpisode) => {
      router.push(episodeHref(resolveEpisodePath(episode, { languageSlug })))
    },
    [router, languageSlug],
  )

  const renderCard = useCallback(
    (episode: WatchEpisode, index: number) => {
      // A series-shaped card opens a nested collection, not a video — its
      // eyebrow shows the shape label and its overlay a stack icon, so the
      // routing difference is visible before the press.
      const isNestedSeries = isSeriesLabel(episode.label)
      return (
        <ThumbCard
          title={episode.title ?? episode.slug}
          posterUrl={episode.posterUrl}
          eyebrow={
            isNestedSeries ? (episode.label ?? "") : `EPISODE ${index + 1}`
          }
          overlayIcon={isNestedSeries ? "albums" : "play"}
          previewPlaybackId={isNestedSeries ? null : episode.muxPlaybackId}
          recyclingKey={`episode-${episode.documentId}`}
          ddActionName="series-episode"
          accessibilityHint={
            isNestedSeries ? "Opens this series" : "Opens this video"
          }
          onPress={() => handlePress(episode)}
        />
      )
    },
    [handlePress],
  )

  return (
    <ThumbRail
      heading="Episodes"
      countLabel={
        episodes.length === 1 ? "1 episode" : `${episodes.length} episodes`
      }
      data={episodes}
      keyExtractor={keyExtractor}
      renderCard={renderCard}
    />
  )
})
