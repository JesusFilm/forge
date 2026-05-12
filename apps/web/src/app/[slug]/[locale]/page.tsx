import type { Metadata } from "next"
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
  // description / poster directly from the record. resolveWatchVideoBySlug
  // wraps `cache()` (content.ts:1025), so the same call from
  // SlugLocalePage below reuses the result without a second admin
  // round-trip — see Key Technical Decisions in the plan.
  const watchVideo = await resolveWatchVideoBySlug(slug, locale)
  if (watchVideo && isSeriesRecord(watchVideo.video)) {
    return generateSeriesMetadata(locale, {
      series: watchVideo.video,
      pathLocale: rawLocale,
      pathPrefix: "watch",
    })
  }
  // A series without a playable trailer is rejected by the video resolver
  // (NOT_FOUND on the playableVariants guard). Try the series resolver as
  // a fallback so its metadata still routes to the series helper.
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
  const watchVideo = await resolveWatchVideoBySlug(slug, locale)
  if (watchVideo) {
    if (isSeriesRecord(watchVideo.video)) {
      // Series with a playable trailer: render the series page using the
      // record + the trailer variant. SeriesPageClient's hero will mount
      // HeroPlayer for the trailer-loop preview.
      return (
        <SeriesPageClient
          series={watchVideo.video}
          selectedVariant={watchVideo.selectedVariant}
          locale={locale}
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
    return (
      <SeriesPageClient
        series={series.video}
        selectedVariant={series.selectedVariant}
        locale={locale}
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
    (b): b is Section => b !== null && b.__typename !== "Error",
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
