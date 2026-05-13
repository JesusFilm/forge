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

  // Aggregate language options from every child episode's variants
  // rather than from `series.variants` (series records have no
  // variants of their own — variants live on each individual episode).
  // Dedupe by language slug so a language that appears across all
  // 13 episodes shows up once. Same filter / display / sort the watch
  // page uses, so "French / Français" formatting + A→Z ordering match.
  // We also build a bcp47 → slug map alongside the options so the URL
  // locale can be resolved to a combobox option regardless of which
  // form the URL uses ("en" vs "english").
  const { languageOptions, slugByBcp47 } = useMemo(() => {
    const seenSlugs = new Set<string>()
    const aggregated: ReturnType<typeof deriveLanguageDisplay>[] = []
    const bcp47Map = new Map<string, string>()
    for (const child of series.children ?? []) {
      if (!child) continue
      for (const variant of child.variants ?? []) {
        if (!variant) continue
        if (!isPlayableLanguageVariant(variant)) continue
        const slug = variant.language.slug
        const bcp47 = variant.language.bcp47 ?? null
        if (bcp47 && !bcp47Map.has(bcp47.toLowerCase())) {
          bcp47Map.set(bcp47.toLowerCase(), slug)
        }
        if (seenSlugs.has(slug)) continue
        seenSlugs.add(slug)
        aggregated.push(deriveLanguageDisplay(slug, variant.language.name))
      }
    }
    return {
      languageOptions: aggregated.sort((a, b) => a.name.localeCompare(b.name)),
      slugByBcp47: bcp47Map,
    }
  }, [series.children])

  // Resolve the current language slug from the URL locale. Accept either
  // form — language-slug form ("english") OR bcp47 ("en") — since the
  // resolver matches variants on either. Falls back to the first option
  // so the combobox's controlled value always has a matching entry.
  const currentLanguageSlug =
    languageOptions.find(
      (opt) =>
        opt.slug === locale || opt.slug.toLowerCase() === locale.toLowerCase(),
    )?.slug ??
    slugByBcp47.get(locale.toLowerCase()) ??
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
          // Stack the label on top, then a horizontal row with the title
          // on the left and the share pill on the right. Using
          // `items-center` on that row aligns the share button to the
          // title's vertical midline rather than its bottom — earlier
          // `items-end` alignment positioned the share slightly below
          // the title baseline because the pill is shorter than the H1.
          <div
            data-testid="series-page-hero-overlay"
            className="absolute right-10 bottom-0 left-10 flex flex-col items-stretch gap-3 pb-8 md:right-16 md:left-16 md:pb-10 xl:right-24 xl:left-24"
          >
            <span
              data-testid="series-page-label"
              className="text-sm font-semibold tracking-wider text-amber-400 uppercase md:text-base"
            >
              {`SERIES · ${episodeLabel}`}
            </span>
            <div className="flex items-baseline justify-between gap-4">
              <h1
                data-testid="series-page-title"
                className="min-w-0 text-3xl font-bold text-white drop-shadow-lg md:text-5xl xl:text-6xl"
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
          </div>
        }
      />

      {/* Meta section sits below the hero. Two-column on md+: description
          on the left (col-span 2/3), language combobox on the right
          (col-span 1/3). Single-column on mobile stacks them top-to-
          bottom. Tight padding keeps the section visually attached to
          the hero band above and the episode grid below.
          `bg-stone-900` is load-bearing — the hero is `position: sticky`
          and stays painted in the viewport as the body scrolls up. A
          transparent meta section lets the still-pinned hero bleed
          through (description text on top of trailer = unreadable). The
          opaque bg covers the hero as soon as the section overlaps it. */}
      {showMetaSection ? (
        <section
          data-testid="series-page-meta"
          className="relative z-30 grid w-full grid-cols-1 gap-6 bg-stone-900 px-10 pt-10 pb-16 text-stone-100 md:grid-cols-4 md:gap-10 md:px-16 md:pt-12 md:pb-20 xl:px-24"
        >
          {description ? (
            <div className="md:col-span-3">
              <p
                data-testid="series-page-description"
                className="text-base leading-relaxed text-stone-200/80 md:text-lg"
              >
                {description}
              </p>
            </div>
          ) : (
            // Reserve the left columns so the combobox stays in the right
            // rail even when description is missing.
            <div className="hidden md:col-span-3 md:block" aria-hidden="true" />
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
          gate the render here.
          Wrapper provides the same opaque background + horizontal
          padding as the meta section so the grid covers the sticky
          hero (same rationale as above) and aligns with the meta
          column rail. */}
      <div className="relative z-20 bg-stone-900 px-10 pb-12 md:px-16 xl:px-24">
        <SeriesEpisodesGrid episodes={episodes} locale={locale} />
      </div>

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
