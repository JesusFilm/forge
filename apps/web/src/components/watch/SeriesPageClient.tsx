"use client"

import { useCallback, useMemo, useState } from "react"
import type { Route } from "next"
import { useRouter } from "next/navigation"
import { ExternalLink } from "lucide-react"

import { Button } from "@/components/ui/button"
import { LanguageCombobox } from "@/components/watch/LanguageCombobox"
import { SeriesEpisodesGrid } from "@/components/watch/SeriesEpisodesGrid"
import { SeriesHero } from "@/components/watch/SeriesHero"
import { ShareModal } from "@/components/watch/ShareModal"
import type { ResolvedSeriesBySlug } from "@/lib/content"
import { deriveLanguageDisplay } from "@/lib/language-display"
import { writePreferredLanguageSlug } from "@/lib/language-preference-client"
import { isPlayableLanguageVariant } from "@/lib/playable-variant"
import { resolvePosterUrl } from "@/lib/url"

// Narrowed from WatchModalState ("none" | "download" | "language" | "share")
// because the series page only ever opens the share modal — there is no
// download (R-scope: no series-level downloads). The language picker is
// inline (LanguageCombobox in the meta section), not modal-based, so the
// language state is owned by the combobox rather than this modal-state
// machine.
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
  const router = useRouter()
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

  // Build LanguageCombobox options from series variants using the same
  // filter (isPlayableLanguageVariant) and display derivation
  // (deriveLanguageDisplay) the watch page uses, so the series-page
  // dropdown reads "French / Français" and sorts identically.
  const languageOptions = useMemo(() => {
    const variants = series.variants ?? []
    return variants
      .filter(isPlayableLanguageVariant)
      .map((v) => deriveLanguageDisplay(v.language.slug, v.language.name))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [series.variants])

  // Resolve the current language slug against the URL locale. Falls back
  // to the first available so the combobox's controlled value always has
  // a matching option to render.
  const currentLanguageSlug =
    languageOptions.find(
      (opt) =>
        opt.slug === locale || opt.slug.toLowerCase() === locale.toLowerCase(),
    )?.slug ??
    languageOptions[0]?.slug ??
    ""

  const handleLanguageChange = useCallback(
    (nextSlug: string) => {
      const seriesSlug = series.slug
      if (!nextSlug || !seriesSlug || nextSlug === currentLanguageSlug) return
      // Persist preference cookie so subsequent visits respect the choice
      // — matches the watch page's behavior via proxy.ts canonical redirect.
      writePreferredLanguageSlug(nextSlug)
      router.push(`/${seriesSlug}/${nextSlug}` as Route)
    },
    [router, series.slug, currentLanguageSlug],
  )

  const showMetaSection = Boolean(description) || languageOptions.length > 0

  return (
    <main
      data-testid="series-page-client"
      data-modal-state={modalState}
      className="min-h-screen bg-stone-900 text-stone-100"
    >
      <SeriesHero
        series={series}
        selectedVariant={selectedVariant}
        overlay={
          <div
            data-testid="series-page-hero-overlay"
            className="absolute right-10 bottom-0 left-10 flex items-end justify-between gap-4 pb-2 md:right-16 md:left-16 xl:right-24 xl:left-24"
          >
            <div className="flex min-w-0 flex-col items-start gap-2">
              <span
                data-testid="series-page-label"
                className="text-sm font-semibold tracking-wider text-amber-400 uppercase md:text-base"
              >
                {`SERIES · ${episodeLabel}`}
              </span>
              <h1
                data-testid="series-page-title"
                className="min-w-0 text-3xl font-bold text-white drop-shadow-lg md:text-5xl xl:text-6xl"
              >
                {series.title ?? ""}
              </h1>
            </div>
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
        }
      />

      {/* Meta section sits below the hero. Two-column on md+: description
          on the left (col-span 2/3), language combobox on the right
          (col-span 1/3). Single-column on mobile stacks them top-to-
          bottom. Tight padding keeps the section visually attached to
          the hero band above and the episode grid below. */}
      {showMetaSection ? (
        <section
          data-testid="series-page-meta"
          className="grid w-full grid-cols-1 gap-6 pt-3 pb-4 text-stone-100 md:grid-cols-3 md:gap-10"
        >
          {description ? (
            <div className="md:col-span-2">
              <p
                data-testid="series-page-description"
                className="text-base leading-relaxed text-stone-200/80 md:text-lg"
              >
                {description}
              </p>
            </div>
          ) : (
            // Reserve the left column so the combobox stays in the right
            // rail even when description is missing.
            <div className="hidden md:col-span-2 md:block" aria-hidden="true" />
          )}
          {languageOptions.length > 0 ? (
            <div
              data-testid="series-page-languages"
              className="flex flex-col gap-2"
            >
              <span
                data-testid="series-page-languages-label"
                className="text-xs font-semibold tracking-[0.18em] text-stone-400 uppercase"
              >
                Languages
              </span>
              <LanguageCombobox
                options={languageOptions}
                value={currentLanguageSlug}
                onChange={handleLanguageChange}
              />
            </div>
          ) : null}
        </section>
      ) : null}

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
