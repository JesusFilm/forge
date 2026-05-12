"use client"

import { useCallback, useState } from "react"
import { ExternalLink } from "lucide-react"

import { Button } from "@/components/ui/button"
import { SeriesEpisodesGrid } from "@/components/watch/SeriesEpisodesGrid"
import { SeriesHero } from "@/components/watch/SeriesHero"
import { ShareModal } from "@/components/watch/ShareModal"
import type { ResolvedSeriesBySlug } from "@/lib/content"
import { resolvePosterUrl } from "@/lib/url"

// Narrowed from WatchModalState ("none" | "download" | "language" | "share")
// because the series page only ever opens the share modal — there is no
// download (R-scope: no series-level downloads) and no language picker
// (the locale is determined by the URL, R7 / scope boundary).
type SeriesModalState = "none" | "share"

type SeriesPageClientProps = {
  series: ResolvedSeriesBySlug["video"]
  selectedVariant: ResolvedSeriesBySlug["selectedVariant"]
  locale: string
}

// R8 pluralization rule: N === 1 → "1 EPISODE"; N === 0 or N >= 2 →
// "{N} EPISODES". Plural form covers the empty case ("0 EPISODES") because
// English plural matches the empty count.
function formatEpisodeCount(count: number): string {
  return count === 1 ? "1 EPISODE" : `${count} EPISODES`
}

export function SeriesPageClient({
  series,
  selectedVariant,
  locale,
}: SeriesPageClientProps) {
  const [modalState, setModalState] = useState<SeriesModalState>("none")
  const openShare = useCallback(() => setModalState("share"), [])
  const closeModal = useCallback(() => setModalState("none"), [])

  const episodes = (series.children ?? []).filter(
    (child): child is NonNullable<(typeof series.children)[number]> =>
      child != null,
  )
  const episodeLabel = formatEpisodeCount(episodes.length)
  const description = series.description ?? series.snippet ?? null
  const posterUrl = resolvePosterUrl(series.images?.[0], null)

  return (
    <main
      data-testid="series-page-client"
      data-modal-state={modalState}
      className="min-h-screen bg-stone-900 text-stone-100"
    >
      <SeriesHero series={series} selectedVariant={selectedVariant} />

      {/* Metadata block — mirrors the WatchBody section's outer padding so
          the body column sits on the same Y as the video page when both
          are scrolled past the hero. The series page has no two-column
          right rail (no related questions / no Ask Yours by R-scope)
          so a single-column layout is sufficient. */}
      <section
        data-testid="series-page-meta"
        className="flex w-full flex-col gap-4 py-8 text-stone-100"
      >
        <span
          data-testid="series-page-label"
          className="text-sm font-semibold tracking-wider text-amber-400 uppercase md:text-base"
        >
          {`SERIES · ${episodeLabel}`}
        </span>
        <div
          data-testid="series-page-title-row"
          className="flex items-center justify-between gap-4"
        >
          <h1
            data-testid="series-page-title"
            className="min-w-0 text-3xl font-bold text-stone-100 md:text-4xl xl:text-5xl"
          >
            {series.title ?? ""}
          </h1>
          <div className="shrink-0">
            <Button
              variant="pill"
              onClick={openShare}
              aria-label="Share"
              data-testid="series-page-share-button"
            >
              <ExternalLink size={16} />
              <span>Share</span>
            </Button>
          </div>
        </div>
        {description ? (
          <p
            data-testid="series-page-description"
            className="text-base leading-relaxed text-stone-200/80 md:text-lg"
          >
            {description}
          </p>
        ) : null}
      </section>

      {/* Episode grid. For zero children the grid wrapper renders empty
          (acceptable low-content state per the doc-review deferral —
          editors mid-populating a series still see the hero + metadata
          so they can confirm they're on the right page). If product
          decides this should fall through to ExperienceEmpty instead,
          gate the render here. */}
      <SeriesEpisodesGrid episodes={episodes} locale={locale} />

      <ShareModal
        open={modalState === "share"}
        videoSlug={series.slug ?? ""}
        currentLanguageSlug={locale}
        videoTitle={series.title ?? null}
        videoDescription={description}
        posterUrl={posterUrl}
        // Series-level share never embeds the trailer — Embed tab
        // suppresses on null playbackId by ShareModal's own gate.
        playbackId={null}
        onClose={closeModal}
      />
    </main>
  )
}

export type SeriesPageClientResolved = ResolvedSeriesBySlug
