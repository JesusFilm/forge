import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"

import { ExperienceEmpty } from "@/components/ExperienceEmpty"
import { ExperienceError } from "@/components/ExperienceError"
import { ExperienceSectionRenderer, type Section } from "@/components/sections"
import { SeriesPageClient } from "@/components/watch/SeriesPageClient"
import { WatchPageClient } from "@/components/watch/WatchPageClient"
import {
  isSeriesRecord,
  isWatchPageMissingError,
  mergeWatchExperience,
  resolveSeriesBySlug,
  resolveSeriesEpisodeBySlug,
  resolveWatchPage,
  resolveWatchVideoBySlug,
} from "@/lib/content"
import {
  generateSeriesMetadata,
  getWatchPageMetadata,
} from "@/lib/experience-metadata"
import { isWatchCtaTextCopyEnabled } from "@/lib/feature-flags"
import { DEFAULT_LOCALE, resolveUiLocale } from "@/lib/locale"
import {
  tryAsContentSlug,
  tryAsLocaleSlug,
  watchEpisodePath,
  watchVideoPath,
} from "@/lib/routes"
import { stripHtmlSuffix } from "@/lib/url-shape"

// ISR: pages cached for 60s. Cookie-driven language redirect lives in
// apps/web/src/proxy.ts (middleware) — keeping cookies() out of this page
// route preserves ISR for the majority of traffic without the preference
// cookie. See docs/solutions/web/nextjs-headers-defeats-route-cache.md.
export const revalidate = 60

// Catch-all dispatcher for the two- and three-segment watch URL shapes.
// Phase 2 of the URL i18n restructure: this single handler replaces the
// prior parallel [slug]/[locale] + [slug]/[episode]/[locale] routes that
// Next.js refused to co-locate ("different slug names for the same
// dynamic path"). Segment-count dispatch keeps both shapes in one file:
//
//   rest.length === 1 → /{slug}.html/{lang}.html       — two-segment
//   rest.length === 2 → /{series}.html/{episode}/{lang}.html — three-segment
//
// Any other length 404s. This file is the only place segment-count
// classification lives at the page-route layer; the same classification
// also lives in `parseWatchPath` inside `lib/routes.ts` (used by the
// canonicalizer + future Phase-4 emit sites). If a new shape arrives in
// the URL contract (e.g. four-segment), add a branch here and a new kind
// to ParsedWatchPath.
type PageProps = {
  params: Promise<{ slug: string; rest: string[] }>
}

type Shape =
  | { kind: "video"; slug: string; rawLocale: string; locale: string }
  | {
      kind: "episode"
      seriesSlug: string
      episodeSlug: string
      rawLocale: string
      locale: string
    }
  | { kind: "unknown" }

function classify(rawSlug: string, rest: string[]): Shape {
  const slug = stripHtmlSuffix(rawSlug)
  if (rest.length === 1) {
    const rawLocale = stripHtmlSuffix(rest[0])
    return {
      kind: "video",
      slug,
      rawLocale,
      // Resolve the UI chrome locale via the slug→bcp47 family fallback
      // (`spanish-castilian` → `es-ES` → primary subtag `es`). Falls back
      // to DEFAULT_LOCALE only when the slug doesn't map to a SUPPORTED
      // language family. `rawLocale` stays slug-form so the audio variant
      // selector + language picker UI keep their dub-grain resolution.
      locale: resolveUiLocale(rawLocale) ?? DEFAULT_LOCALE,
    }
  }
  if (rest.length === 2) {
    // 3-segment: middle segment is the bare episode slug per production
    // contract. Defensive .html strip in case a partner link shipped with
    // a stale suffix on the episode (the proxy normalizes this in Phase 3,
    // but routing must tolerate either shape).
    const episodeSlug = stripHtmlSuffix(rest[0])
    const rawLocale = stripHtmlSuffix(rest[1])
    return {
      kind: "episode",
      seriesSlug: slug,
      episodeSlug,
      rawLocale,
      locale: resolveUiLocale(rawLocale) ?? DEFAULT_LOCALE,
    }
  }
  return { kind: "unknown" }
}

async function getDownloadButtonLabel(route: string): Promise<string> {
  const useUpdatedCtaCopy = await isWatchCtaTextCopyEnabled({
    custom: { route },
  })
  return useUpdatedCtaCopy ? "Save Video" : "Download"
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug: rawSlug, rest } = await params
  const shape = classify(rawSlug, rest)

  if (shape.kind === "video") {
    const { slug, rawLocale, locale } = shape
    // Wrap resolver calls so a transient Apollo / GraphQL error here
    // doesn't drop metadata entirely. Next silently skips metadata when
    // generateMetadata throws; the page body has its own error boundary.
    try {
      const watchVideo = await resolveWatchVideoBySlug(slug, locale)
      if (watchVideo && isSeriesRecord(watchVideo.video)) {
        return generateSeriesMetadata(locale, {
          series: watchVideo.video,
          pathLocale: rawLocale,
          pathPrefix: "watch",
        })
      }
      if (!watchVideo) {
        const series = await resolveSeriesBySlug(slug, locale)
        if (series) {
          return generateSeriesMetadata(locale, {
            series: series.video,
            pathLocale: rawLocale,
            pathPrefix: "watch",
          })
        }
      }
    } catch {
      // Fall through to getWatchPageMetadata.
    }
    return getWatchPageMetadata(locale, {
      slug,
      pathLocale: rawLocale,
      pathPrefix: "watch",
    })
  }

  if (shape.kind === "episode") {
    const { episodeSlug, rawLocale, locale } = shape
    // The episode IS the playable video; OG/canonical metadata follows
    // the episode's slug. Series-context enrichment is Phase 5 work.
    return getWatchPageMetadata(locale, {
      slug: episodeSlug,
      pathLocale: rawLocale,
      pathPrefix: "watch",
    })
  }

  return {}
}

export default async function SlugRestPage({ params }: PageProps) {
  const { slug: rawSlug, rest } = await params
  const shape = classify(rawSlug, rest)

  if (shape.kind === "unknown") notFound()

  if (shape.kind === "episode") {
    return renderEpisode(shape)
  }

  return renderVideo(shape)
}

async function renderEpisode(shape: {
  kind: "episode"
  seriesSlug: string
  episodeSlug: string
  rawLocale: string
  locale: string
}) {
  const { seriesSlug, episodeSlug, rawLocale, locale } = shape

  const resolved = await resolveSeriesEpisodeBySlug(
    seriesSlug,
    episodeSlug,
    rawLocale,
  )
  if (!resolved) notFound()

  // URL ↔ rendered-variant sync (mirrors the two-segment branch). The
  // resolver falls back to primary/first-playable when no dub matches
  // rawLocale; emit the canonical .html shape so the proxy doesn't
  // re-normalize through per-segment .html append.
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

  const downloadButtonLabel = await getDownloadButtonLabel(
    `/watch/${seriesSlug}.html/${episodeSlug}/${rawLocale}.html`,
  )
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
        downloadButtonLabel={downloadButtonLabel}
        mergedBlocks={mergedBlocks}
        variant={resolved.selectedVariant}
        video={resolved.video}
        languageSlug={resolved.selectedVariant.language?.slug ?? rawLocale}
        locale={locale}
      />
    </>
  )
}

async function renderVideo(shape: {
  kind: "video"
  slug: string
  rawLocale: string
  locale: string
}) {
  const { slug, rawLocale, locale } = shape

  // Experience-first precedence: when an editor curated an Experience at
  // this slug, that's the intended landing — even when a slug-colliding
  // Video (e.g. an `easter` Video alongside an `easter` Experience) exists.
  // `resolveWatchPage` is React `cache()`-wrapped so the tail-end call
  // for the video-template fallback is free.
  const watchPage = await resolveWatchPage(locale, slug)
  if (watchPage.data?.kind === "experience") {
    const blocks = (watchPage.data.experience.blocks ?? []).filter(
      (b): b is Section => b !== null,
    )
    if (blocks.length) {
      return (
        <main className="min-h-screen bg-stone-900">
          {blocks.map((block, i) => {
            const key =
              "id" in block && typeof block.id === "string"
                ? block.id
                : `block-${i}`
            return (
              <ExperienceSectionRenderer
                key={key}
                section={block}
                routeVideo={null}
              />
            )
          })}
        </main>
      )
    }
    return <ExperienceEmpty />
  }

  // Video-by-slug second. Pass rawLocale (not the bcp47-normalised
  // `locale`) so the resolver matches either variant.language.slug OR
  // variant.language.bcp47 — slug-form URLs like /the-call/korean need to
  // land in the resolver as "korean", not "en".
  const watchVideo = await resolveWatchVideoBySlug(slug, rawLocale)
  if (watchVideo) {
    const actualSlug = watchVideo.selectedVariant.language?.slug ?? null
    const actualBcp47 = watchVideo.selectedVariant.language?.bcp47 ?? null
    if (actualSlug && rawLocale !== actualSlug && rawLocale !== actualBcp47) {
      const contentSlug = tryAsContentSlug(slug)
      const localeSlug = tryAsLocaleSlug(actualSlug)
      if (contentSlug && localeSlug) {
        redirect(
          watchVideoPath(contentSlug, localeSlug, {
            reason: "locale-resolved",
          }),
        )
      }
    }
    if (isSeriesRecord(watchVideo.video)) {
      return (
        <SeriesPageClient
          series={watchVideo.video}
          selectedVariant={watchVideo.selectedVariant}
          locale={rawLocale}
        />
      )
    }
    const mergedBlocks = mergeWatchExperience({
      video: watchVideo.video,
      variant: watchVideo.selectedVariant,
      canonicalParent: watchVideo.canonicalParent,
    })
    const downloadButtonLabel = await getDownloadButtonLabel(
      `/watch/${slug}.html/${rawLocale}.html`,
    )
    const lcpPlaybackId =
      watchVideo.selectedVariant.muxVideo?.playbackId ?? null
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
          downloadButtonLabel={downloadButtonLabel}
          mergedBlocks={mergedBlocks}
          variant={watchVideo.selectedVariant}
          video={watchVideo.video}
          languageSlug={watchVideo.selectedVariant.language?.slug ?? rawLocale}
          locale={locale}
        />
      </>
    )
  }

  const series = await resolveSeriesBySlug(slug, locale)
  if (series) {
    return (
      <SeriesPageClient
        series={series.video}
        selectedVariant={series.selectedVariant}
        locale={rawLocale}
      />
    )
  }

  const result = await resolveWatchPage(locale, slug)
  if (result.error) {
    if (isWatchPageMissingError(result.error)) {
      return <ExperienceEmpty />
    }
    return <ExperienceError message={result.error.message} />
  }

  const page = result.data
  const experienceLike =
    page.kind === "experience" ? page.experience : page.template
  const routeVideo = page.kind === "video-template" ? page.routeVideo : null
  const blocks = (experienceLike.blocks ?? []).filter(
    (b): b is Section => b !== null,
  )
  if (!blocks.length) {
    return <ExperienceEmpty />
  }

  return (
    <main className="min-h-screen bg-stone-900">
      {blocks.map((block, i) => {
        const key =
          "id" in block && typeof block.id === "string"
            ? block.id
            : `block-${i}`
        return (
          <ExperienceSectionRenderer
            key={key}
            section={block}
            routeVideo={routeVideo}
          />
        )
      })}
    </main>
  )
}
