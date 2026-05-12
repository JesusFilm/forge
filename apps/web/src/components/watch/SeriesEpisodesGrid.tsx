import type { Route } from "next"

import type { ResolvedSeriesBySlug } from "@/lib/content"
import type { SearchResult } from "@/lib/search"
import { VideoCard } from "@/components/search/VideoCard"

type Episodes = NonNullable<ResolvedSeriesBySlug["video"]["children"]>
type Episode = NonNullable<Episodes[number]>

type SeriesEpisodesGridProps = {
  episodes: Episodes
  locale: string
}

// Adapter projecting a series child onto the SearchResult shape VideoCard
// consumes. Inline + unexported per the plan's Key Technical Decisions —
// six lines of pure data shaping, blast radius scoped to this file. No
// `as SearchResult` cast — the structural conformance check is the point:
// if SearchResult gains a required field, this site fails typecheck.
function toSearchResult(episode: Episode): SearchResult {
  return {
    id: 0,
    type: "video",
    slug: episode.slug ?? "",
    title: episode.title ?? "",
    imageUrl:
      episode.images?.[0]?.mobileCinematicHigh ??
      episode.images?.[0]?.thumbnail ??
      null,
    snippet: "",
    startSeconds: null,
    playbackId: null,
    score: 0,
  }
}

export function SeriesEpisodesGrid({
  episodes,
  locale,
}: SeriesEpisodesGridProps) {
  // Verbatim grid template from SearchOverlay.tsx:263 — same column counts
  // at every breakpoint, same gap. R13 wants byte-for-byte parity so the
  // visual rhythm of the series-page grid matches the search-results grid.
  return (
    <div
      data-testid="series-episodes-grid"
      className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    >
      {episodes
        .filter((episode): episode is Episode => episode != null)
        .map((episode, index) => (
          <VideoCard
            key={episode.documentId}
            result={toSearchResult(episode)}
            index={index}
            // Series page routes episode clicks to the standard video page
            // for that episode. Locale is preserved from the URL the user is
            // currently viewing the series in.
            hrefBuilder={(result) => `/${result.slug}/${locale}` as Route}
          />
        ))}
    </div>
  )
}
