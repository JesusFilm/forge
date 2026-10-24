// The current film, as the Grow module shows it (prototype `WatchNextSteps`
// derivation): title, its series position, the next episode in the visitor's
// audio language, and the passages the film is drawn from. Built from the
// video page's own blocks; absent on surfaces with no current film.

import type { Route } from "next"

import type {
  WatchBibleQuotesBlock,
  WatchBodyBlock,
  WatchSiblingCarouselBlock,
} from "@/lib/content"
import {
  tryAsContentSlug,
  tryAsLocaleSlug,
  watchEpisodePath,
} from "@/lib/routes"

export type WatchGrowFilmContext = {
  citations: WatchBibleQuotesBlock["bibleCitations"]
  filmTitle: string
  seriesTitle: string | null
  episodeCount: number
  /** 1-based position of the current film in its series. */
  episodeIndex: number | null
  nextEpisode: { title: string; minutes: number | null; href: Route } | null
}

export function watchGrowFilmContext({
  bodyBlock,
  siblingBlock,
  bibleQuotesBlock,
  languageSlug,
}: {
  bodyBlock: WatchBodyBlock
  siblingBlock: WatchSiblingCarouselBlock | null
  bibleQuotesBlock: WatchBibleQuotesBlock | null
  languageSlug: string
}): WatchGrowFilmContext {
  const parent = siblingBlock?.canonicalParent ?? null
  const children = parent?.children ?? []
  const position = children.findIndex(
    (c) => c.documentId === siblingBlock?.currentVideoDocumentId,
  )

  let nextEpisode: WatchGrowFilmContext["nextEpisode"] = null
  if (parent) {
    const playable = children.filter((c) => c.slug != null && c.title != null)
    const idx = playable.findIndex(
      (c) => c.documentId === siblingBlock?.currentVideoDocumentId,
    )
    const next = idx >= 0 ? playable[idx + 1] : null
    const parentSlug = parent.slug ? tryAsContentSlug(parent.slug) : null
    const childSlug = next?.slug ? tryAsContentSlug(next.slug) : null
    const lang = tryAsLocaleSlug(languageSlug)
    if (next && parentSlug && childSlug && lang) {
      nextEpisode = {
        title: next.title as string,
        minutes:
          next.durationSeconds != null
            ? Math.max(1, Math.round(next.durationSeconds / 60))
            : null,
        href: watchEpisodePath(parentSlug, childSlug, lang),
      }
    }
  }

  return {
    citations: bibleQuotesBlock?.bibleCitations ?? [],
    filmTitle: bodyBlock.video.title ?? "Jesus Film Project",
    seriesTitle: parent?.title ?? null,
    episodeCount: children.length,
    episodeIndex: position >= 0 ? position + 1 : null,
    nextEpisode,
  }
}
