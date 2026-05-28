import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"

import { ExperienceEmpty } from "@/components/ExperienceEmpty"
import { WatchPageClient } from "@/components/watch/WatchPageClient"
import { mergeWatchExperience, resolveSeriesEpisodeBySlug } from "@/lib/content"
import { getWatchPageMetadata } from "@/lib/experience-metadata"
import { DEFAULT_LOCALE, isLocale } from "@/lib/locale"
import {
  tryAsContentSlug,
  tryAsLocaleSlug,
  watchEpisodePath,
} from "@/lib/routes"
import { stripHtmlSuffix } from "@/lib/url-shape"

// ISR mirrors the two-segment route. The cookie-driven language redirect
// lives in apps/web/src/proxy.ts (middleware) — keeping cookies() out of
// this page preserves ISR for traffic without the preference cookie.
export const revalidate = 60

type PageProps = {
  params: Promise<{ slug: string; episode: string; locale: string }>
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const {
    slug: rawSlug,
    episode: rawEpisode,
    locale: rawLocaleParam,
  } = await params
  // Three-segment shape /{series}.html/{episode}/{lang}.html — segments 0
  // and 2 carry .html per production contract; the episode segment is bare.
  // We still defensively strip the episode segment in case a partner link
  // arrived with a stale .html on it (the proxy normalizes this in Phase 3,
  // but routing must tolerate both).
  const seriesSlug = stripHtmlSuffix(rawSlug)
  const episodeSlug = stripHtmlSuffix(rawEpisode)
  const rawLocale = stripHtmlSuffix(rawLocaleParam)
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE

  // The episode IS the playable video; OG/canonical metadata follows the
  // episode's slug, not the series. Future Phase 5 will replace this with
  // a series-context-aware metadata helper.
  return getWatchPageMetadata(locale, {
    slug: episodeSlug,
    pathLocale: rawLocale,
    pathPrefix: "watch",
  })
  // seriesSlug is reserved for future series-context metadata enrichment.
  void seriesSlug
}

export default async function SeriesEpisodePage({ params }: PageProps) {
  const {
    slug: rawSlug,
    episode: rawEpisode,
    locale: rawLocaleParam,
  } = await params
  const seriesSlug = stripHtmlSuffix(rawSlug)
  const episodeSlug = stripHtmlSuffix(rawEpisode)
  const rawLocale = stripHtmlSuffix(rawLocaleParam)
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE

  const resolved = await resolveSeriesEpisodeBySlug(
    seriesSlug,
    episodeSlug,
    rawLocale,
  )
  if (!resolved) notFound()

  // URL ↔ rendered-variant sync — same pattern as the two-segment route.
  // The resolver falls back to primary/first-playable when no dub matches
  // the requested locale; emit the canonical .html shape so the proxy
  // doesn't re-normalize.
  const actualSlug = resolved.selectedVariant.language?.slug ?? null
  const actualBcp47 = resolved.selectedVariant.language?.bcp47 ?? null
  if (actualSlug && rawLocale !== actualSlug && rawLocale !== actualBcp47) {
    const seriesContentSlug = tryAsContentSlug(seriesSlug)
    const episodeContentSlug = tryAsContentSlug(episodeSlug)
    const localeSlug = tryAsLocaleSlug(actualSlug)
    if (seriesContentSlug && episodeContentSlug && localeSlug) {
      redirect(
        watchEpisodePath(seriesContentSlug, episodeContentSlug, localeSlug, {
          reason: "locale-resolved",
        }),
      )
    }
  }

  const mergedBlocks = mergeWatchExperience({
    video: resolved.video,
    variant: resolved.selectedVariant,
    canonicalParent: resolved.series,
  })
  if (!mergedBlocks.length) return <ExperienceEmpty />

  // LCP poster preload — mirrors the two-segment route. The poster lives
  // inside <mux-player>'s shadow DOM and isn't discoverable in the initial
  // HTML scan without an explicit hint.
  const lcpPlaybackId = resolved.selectedVariant.muxVideo?.playbackId ?? null

  return (
    <>
      {lcpPlaybackId ? (
        <link
          rel="preload"
          as="image"
          href={`https://image.mux.com/${lcpPlaybackId}/thumbnail.webp?width=1280`}
          fetchPriority="high"
        />
      ) : null}
      <WatchPageClient
        mergedBlocks={mergedBlocks}
        variant={resolved.selectedVariant}
        video={resolved.video}
        languageSlug={resolved.selectedVariant.language?.slug ?? rawLocale}
        locale={locale}
      />
    </>
  )
}
