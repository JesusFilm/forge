"use client"

import { useCallback, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronsUpDown, ExternalLink, Globe } from "lucide-react"

import { Button } from "@/components/ui/button"
import { SeriesEpisodesGrid } from "@/components/watch/SeriesEpisodesGrid"
import { SeriesHero } from "@/components/watch/SeriesHero"
import { ShareModal } from "@/components/watch/ShareModal"
import type { ResolvedSeriesBySlug } from "@/lib/content"
import { resolvePosterUrl } from "@/lib/url"

// Narrowed from WatchModalState ("none" | "download" | "language" | "share")
// because the series page only ever opens the share modal — there is no
// download (R-scope: no series-level downloads). The language switcher
// (scope expansion vs the original brainstorm) uses a native <select>
// rather than the LanguagePickerModal so the locale switch is a single
// click without an intermediate modal.
type SeriesModalState = "none" | "share"

type SeriesLanguage = {
  documentId: string
  slug: string
  name: string
}

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

  // Available languages mirror LanguagePickerModal's filter: published
  // variants with a usable hls source and a language slug. Memoised so
  // <select>'s render-time identity is stable across modal toggles.
  const availableLanguages = useMemo<SeriesLanguage[]>(() => {
    const variants = series.variants ?? []
    const list: SeriesLanguage[] = []
    const seen = new Set<string>()
    for (const variant of variants) {
      if (!variant) continue
      if (variant.published !== true) continue
      if (!variant.hls) continue
      const slug = variant.language?.slug ?? null
      const name = variant.language?.name ?? null
      if (!slug || !name) continue
      if (seen.has(slug)) continue
      seen.add(slug)
      list.push({ documentId: variant.documentId, slug, name })
    }
    return list
  }, [series.variants])

  // Match against the URL locale OR the BCP-47 form, since either can
  // appear in the URL (the watch-video resolver accepts both forms when
  // matching variants). Falls back to the first available so the
  // <select>'s controlled value always has a matching option.
  const currentLanguageSlug =
    availableLanguages.find(
      (lang) =>
        lang.slug === locale ||
        lang.slug.toLowerCase() === locale.toLowerCase(),
    )?.slug ??
    availableLanguages[0]?.slug ??
    ""

  const handleLanguageChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const next = event.target.value
      const seriesSlug = series.slug
      if (!next || !seriesSlug || next === currentLanguageSlug) return
      router.push(`/${seriesSlug}/${next}`)
    },
    [router, series.slug, currentLanguageSlug],
  )

  const showMetaSection = Boolean(description) || availableLanguages.length > 0

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
          on the left (col-span 2/3), language selector on the right
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
            // Reserve the left column so the language selector stays in
            // the right rail even when description is missing.
            <div className="hidden md:col-span-2 md:block" aria-hidden="true" />
          )}
          {availableLanguages.length > 0 ? (
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
              <div className="relative">
                <Globe
                  size={16}
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-stone-300"
                />
                <ChevronsUpDown
                  size={16}
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-stone-400"
                />
                <select
                  data-testid="series-page-language-select"
                  aria-label="Choose language"
                  value={currentLanguageSlug}
                  onChange={handleLanguageChange}
                  className="w-full cursor-pointer appearance-none rounded-lg border border-stone-700/70 bg-stone-800/40 py-3 pr-10 pl-10 text-stone-100 hover:bg-stone-800/60 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:outline-none"
                >
                  {availableLanguages.map((lang) => (
                    <option
                      key={lang.documentId}
                      value={lang.slug}
                      className="bg-stone-900 text-stone-100"
                    >
                      {lang.name}
                    </option>
                  ))}
                </select>
              </div>
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
