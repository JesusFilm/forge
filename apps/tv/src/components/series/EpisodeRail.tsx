// Below-fold horizontal D-pad rail of a video's own children (U3). Routes by shape
// (episodeRouting): leaf → /watch, nested collection → /series, both seeded. Nothing
// when childless. Rail scaffold + card come from the shared rails/ modules.
// Two callers, two vocabularies: the series screen shows episodes, the watch screen
// a feature film's chapters — `noun` supplies the wording, the behaviour is one.

import { memo, useCallback } from "react"
import { useRouter } from "expo-router"
import { repairLegacyVideoDisplayTitle } from "@forge/content-display"

import type { WatchEpisode } from "../../lib/normalizeVideo"
import { isSeriesLabel } from "../../lib/isSeriesRecord"
import { ThumbCard } from "../rails/ThumbCard"
import { ThumbRail } from "../rails/ThumbRail"
import { episodeHref, resolveEpisodePath } from "./episodeRouting"

const keyExtractor = (item: WatchEpisode, index: number) =>
  `episode-${item.documentId}-${index}`

/** Heading, count line, per-card eyebrow and RUM action name for one vocabulary. */
export type ChildRailNoun = {
  heading: string
  /** Lowercase singular, e.g. "episode" — pluralized with a bare "s". */
  singular: string
  eyebrow: string
  ddActionName: string
}

export const EPISODE_NOUN: ChildRailNoun = {
  heading: "Episodes",
  singular: "episode",
  eyebrow: "EPISODE",
  ddActionName: "series-episode",
}

export const CHAPTER_NOUN: ChildRailNoun = {
  heading: "Chapters",
  singular: "chapter",
  eyebrow: "CHAPTER",
  ddActionName: "film-chapter",
}

type EpisodeRailProps = {
  episodes: WatchEpisode[]
  /** Selected language slug, threaded into the pushed route's `lang` param (U4 provider supplies + consumes it). */
  languageSlug?: string | null
  noun?: ChildRailNoun
}

export const EpisodeRail = memo(function EpisodeRail({
  episodes,
  languageSlug,
  noun = EPISODE_NOUN,
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
          title={
            repairLegacyVideoDisplayTitle({
              title: episode.title,
              slug: episode.slug,
            }) ?? "Video"
          }
          posterUrl={episode.posterUrl}
          eyebrow={
            isNestedSeries
              ? (episode.label ?? "")
              : `${noun.eyebrow} ${index + 1}`
          }
          overlayIcon={isNestedSeries ? "albums" : "play"}
          previewPlaybackId={isNestedSeries ? null : episode.muxPlaybackId}
          recyclingKey={`episode-${episode.documentId}`}
          ddActionName={noun.ddActionName}
          accessibilityHint={
            isNestedSeries ? "Opens this series" : "Opens this video"
          }
          onPress={() => handlePress(episode)}
        />
      )
    },
    [handlePress, noun],
  )

  return (
    <ThumbRail
      heading={noun.heading}
      countLabel={
        episodes.length === 1
          ? `1 ${noun.singular}`
          : `${episodes.length} ${noun.singular}s`
      }
      data={episodes}
      keyExtractor={keyExtractor}
      renderCard={renderCard}
    />
  )
})
