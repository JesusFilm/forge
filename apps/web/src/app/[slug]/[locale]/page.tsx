import type { Metadata, Route } from "next"
import { redirect } from "next/navigation"
import { isLocale, DEFAULT_LOCALE } from "@/lib/locale"
import {
  isSeriesRecord,
  isWatchPageMissingError,
  resolveSeriesBySlug,
  resolveWatchPage,
  resolveWatchVideoBySlug,
  mergeWatchExperience,
} from "@/lib/content"
import {
  generateSeriesMetadata,
  getWatchPageMetadata,
} from "@/lib/experience-metadata"
import { SectionRenderer, type Section } from "@/components/sections"
import { ExperienceEmpty } from "@/components/ExperienceEmpty"
import { ExperienceError } from "@/components/ExperienceError"
import { SeriesPageClient } from "@/components/watch/SeriesPageClient"
import { WatchPageClient } from "@/components/watch/WatchPageClient"

// ISR: pages cached for 60s. The cookie-driven language redirect lives in
// apps/web/src/proxy.ts (middleware) — keeping cookies() out of this page
// route preserves ISR for the ~majority of traffic without the preference
// cookie. See docs/solutions/web/nextjs-headers-defeats-route-cache.md for
// the rationale.
export const revalidate = 60

type PageProps = {
  params: Promise<{ slug: string; locale: string }>
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug, locale: rawLocale } = await params
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE

  // Resolve the video first so the series-shaped branch can read title /
  // description / poster directly from the record. fetchWatchVideoBySlug
  // is wrapped in React `cache()` so the same call from SlugLocalePage
  // below reuses the result without a second admin round-trip.
  //
  // Wrap the resolver calls in try/catch so that a transient Apollo or
  // GraphQL error here doesn't drop metadata entirely (Next silently
  // skips metadata emission when generateMetadata throws). The page
  // body has its own error boundary; metadata should degrade gracefully
  // by falling through to the experience helper rather than emitting an
  // empty <title> and no OG tags for the 60 s revalidate window.
  try {
    const watchVideo = await resolveWatchVideoBySlug(slug, locale)
    if (watchVideo && isSeriesRecord(watchVideo.video)) {
      return generateSeriesMetadata(locale, {
        series: watchVideo.video,
        pathLocale: rawLocale,
        pathPrefix: "watch",
      })
    }
    // A series without a playable trailer is rejected by the video
    // resolver (NOT_FOUND on the playableVariants guard). Try the series
    // resolver as a fallback so its metadata still routes to the series
    // helper.
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
    // Fall through to getWatchPageMetadata. Logging the error here is
    // intentionally omitted — Next's RSC pipeline surfaces the failure
    // via its own telemetry, and the page body will hit the same error
    // path with full context if the slug is unrecoverable.
  }

  return getWatchPageMetadata(locale, {
    slug,
    pathLocale: rawLocale,
    pathPrefix: "watch",
  })
}

export default async function SlugLocalePage({ params }: PageProps) {
  const { slug, locale: rawLocale } = await params
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE

  // Video-by-slug first — bypasses resolveWatchPage's Watch Settings +
  // default template dependency, which isn't always present in dev.
  //
  // Pass rawLocale (not the bcp47-normalised `locale`): the resolver picks
  // the variant by either `variant.language.slug === locale` OR
  // `variant.language.bcp47 === locale`, so slug-form URLs like /the-call/korean
  // need to land in the resolver as "korean", not "en". Normalising here
  // would silently fall back to the primary (English) variant for every
  // non-bcp47-locale URL — exactly what the language switcher writes.
  const watchVideo = await resolveWatchVideoBySlug(slug, rawLocale)
  if (watchVideo) {
    // URL ↔ rendered-variant sync: the resolver's variant chain falls back
    // to primary/first-playable when no dub matches `rawLocale`. Without
    // this redirect the URL says e.g. /afrikaans while the page renders
    // English. The `_lr` sentinel breaks the proxy's cookie redirect loop
    // (see apps/web/src/proxy.ts — `?_lr=1` skips the language-preference
    // override); `WatchPageClient` strips the param post-hydration so the
    // user-visible URL stays clean.
    const actualSlug = watchVideo.selectedVariant.language?.slug ?? null
    const actualBcp47 = watchVideo.selectedVariant.language?.bcp47 ?? null
    if (actualSlug && rawLocale !== actualSlug && rawLocale !== actualBcp47) {
      redirect(`/${slug}/${actualSlug}?_lr=1` as Route)
    }
    if (isSeriesRecord(watchVideo.video)) {
      // Series with a playable trailer: render the series page using the
      // record + the trailer variant. SeriesPageClient's hero will mount
      // HeroPlayer for the trailer-loop preview.
      //
      // Pass rawLocale (NOT the bcp47-normalised `locale`) so the
      // series-page language UI shows the user's actual selection.
      // When the user picks "spanish-castilian" on a video page, the
      // language-preference cookie + proxy redirect lands them here on
      // `/storyclubs/spanish-castilian`. `isLocale("spanish-castilian")`
      // returns false (it's a slug-form, not a bcp47 code), so without
      // this rawLocale pass-through `locale` would fall back to "en"
      // and the combobox + globe-modal would both render "English"
      // instead of "Spanish, Castilian".
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
    return (
      <WatchPageClient
        mergedBlocks={mergedBlocks}
        variant={watchVideo.selectedVariant}
        video={watchVideo.video}
        languageSlug={watchVideo.selectedVariant.language?.slug ?? rawLocale}
        locale={locale}
      />
    )
  }

  // No playable variant — could be a series without a trailer (renders
  // a static-thumbnail hero) or a missing record entirely. Try the
  // series resolver before falling through to the experience layer.
  const series = await resolveSeriesBySlug(slug, locale)
  if (series) {
    // See the rawLocale rationale above on the trailer-bearing series
    // branch. Same fix applies here for trailerless series.
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
  // Required on video-template branch so blocks (MediaCollection, VideoHero,
  // Video, Container) get the video record.
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
          <SectionRenderer key={key} section={block} routeVideo={routeVideo} />
        )
      })}
    </main>
  )
}
