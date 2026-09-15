import { SeriesEpisodeCard } from "@/components/watch/SeriesEpisodeCard"
import { SERIES_CONTENT_GLASS_CLASS_NAME } from "@/components/watch/series-page-styles"
import type { ResolvedSeriesBySlug } from "@/lib/content"
import { WATCH_PAGE_CONTENT_CLASSES } from "@/lib/content-width"

type Episodes = NonNullable<ResolvedSeriesBySlug["video"]["children"]>
type Episode = NonNullable<Episodes[number]>

type SeriesEpisodesGridProps = {
  episodes: Episodes
  languageSlug: string
  parentSlug: string
}

export function SeriesEpisodesGrid({
  episodes,
  languageSlug,
  parentSlug,
}: SeriesEpisodesGridProps) {
  const visibleEpisodes = episodes.filter(
    (episode): episode is Episode => episode != null && Boolean(episode.slug),
  )

  return (
    <section
      data-testid="series-episodes-grid-wrapper"
      className={`relative z-20 isolate overflow-hidden pt-16 pb-16 md:pt-20 md:pb-20 ${SERIES_CONTENT_GLASS_CLASS_NAME}`}
    >
      <div
        data-testid="series-episodes-grid"
        className={`relative z-10 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 ${WATCH_PAGE_CONTENT_CLASSES}`}
      >
        {visibleEpisodes.map((episode, index) => (
          <SeriesEpisodeCard
            key={episode.documentId}
            episode={episode}
            index={index}
            languageSlug={languageSlug}
            parentSlug={parentSlug}
          />
        ))}
      </div>
    </section>
  )
}
