import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { setRequestLocale } from "next-intl/server"

import { ExperienceEmpty } from "@/components/ExperienceEmpty"
import { ExperienceError } from "@/components/ExperienceError"
import { ExperienceSectionRenderer, type Section } from "@/components/sections"
import { SeriesPageClient } from "@/components/watch/SeriesPageClient"
import { WatchPageClient } from "@/components/watch/WatchPageClient"
import { WatchQuestionPanel } from "@/components/watch/WatchQuestionPanel"
import {
  isSeriesRecord,
  isWatchPageMissingError,
  mergeWatchExperience,
  resolveSeriesBySlug,
  resolveSeriesEpisodeBySlug,
  resolveWatchExperiencePage,
  resolveWatchPage,
  resolveWatchVideoBySlug,
} from "@/lib/content"
import {
  generateSeriesMetadata,
  getWatchPageMetadata,
} from "@/lib/experience-metadata"
import {
  isWatchCtaTextCopyEnabled,
  isWatchQuestionPanelEnabled,
  isWatchYouVersionBibleQuotesEnabled,
} from "@/lib/feature-flags"
import {
  isLocale,
  isPublicWatchHomeLanguageSlug,
  isPublicWatchLanguageSlug,
  resolveWatchLocaleIdentity,
  type UiLocale,
} from "@/lib/locale"
import {
  tryAsContentSlug,
  tryAsLocaleSlug,
  watchEpisodePath,
  watchVideoPath,
} from "@/lib/routes"
import {
  isOneSegmentCollectionSlug,
  SAFE_SLUG_PATTERN,
  stripHtmlSuffix,
} from "@/lib/url-shape"
import { fetchYouVersionBibleQuotePassages } from "@/lib/youversion-passage"

// ISR: pages cached for 60s. Cookie-driven language redirect lives in
// apps/web/src/proxy.ts (middleware) — keeping cookies() out of this page
// route preserves ISR for the majority of traffic without the preference
// cookie. See docs/solutions/web/nextjs-headers-defeats-route-cache.md.
export const revalidate = 60
export const dynamic = "force-static"
export const dynamicParams = true

export function generateStaticParams(): Array<{
  locale: string
  htmlLang: string
  rest: string[]
}> {
  return []
}

// Catch-all dispatcher for the one-, two-, and three-segment watch URL shapes.
// The proxy prepends internal /[locale]/[htmlLang] segments for static layout
// params, but params.rest preserves the original public path verbatim:
//
//   rest.length === 1 → /{lang-or-collection}.html
//   rest.length === 2 → /{slug}.html/{lang}.html
//   rest.length === 3 → /{series}.html/{episode}/{lang}.html
//
// Any other length 404s before resolver calls so malformed paths don't mint
// arbitrary ISR entries or force admin lookups.
type PageProps = {
  params: Promise<{ locale: string; htmlLang: string; rest: string[] }>
}

type Shape =
  | {
      kind: "one-segment"
      slug: string
      locale: UiLocale
      isLanguageHome: boolean
    }
  | { kind: "video"; slug: string; rawLocale: string; locale: UiLocale }
  | {
      kind: "episode"
      seriesSlug: string
      episodeSlug: string
      rawLocale: string
      locale: UiLocale
    }
  | { kind: "unknown" }

function stripSafeSegment(segment: string): string | null {
  const stripped = stripHtmlSuffix(segment)
  return SAFE_SLUG_PATTERN.test(stripped) ? stripped : null
}

function classify(rest: string[], internalLocale: UiLocale): Shape {
  if (rest.length === 1) {
    const slug = stripSafeSegment(rest[0])
    if (!slug) return { kind: "unknown" }
    if (isLocale(slug)) return { kind: "unknown" }
    const isLanguageHome = isPublicWatchHomeLanguageSlug(slug)
    if (!isLanguageHome && !isOneSegmentCollectionSlug(slug)) {
      return { kind: "unknown" }
    }
    return {
      kind: "one-segment",
      slug,
      locale: isLanguageHome
        ? resolveWatchLocaleIdentity(slug).locale
        : internalLocale,
      isLanguageHome,
    }
  }
  if (rest.length === 2) {
    const slug = stripSafeSegment(rest[0])
    const rawLocale = stripSafeSegment(rest[1])
    if (!slug || !rawLocale) return { kind: "unknown" }
    if (!isPublicWatchLanguageSlug(rawLocale)) return { kind: "unknown" }
    return {
      kind: "video",
      slug,
      rawLocale,
      // The message-catalog key is the prepended internal locale. The raw
      // audio slug stays in params.rest for variant selection and URLs.
      locale: internalLocale,
    }
  }
  if (rest.length === 3) {
    // 3-segment: middle segment is the bare episode slug per production
    // contract. Defensive .html strip in case a partner link shipped with
    // a stale suffix on the episode (the proxy normalizes this in Phase 3,
    // but routing must tolerate either shape).
    const seriesSlug = stripSafeSegment(rest[0])
    const episodeSlug = stripSafeSegment(rest[1])
    const rawLocale = stripSafeSegment(rest[2])
    if (!seriesSlug || !episodeSlug || !rawLocale) {
      return { kind: "unknown" }
    }
    if (!isPublicWatchLanguageSlug(rawLocale)) return { kind: "unknown" }
    return {
      kind: "episode",
      seriesSlug,
      episodeSlug,
      rawLocale,
      locale: internalLocale,
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

async function getYouVersionBibleQuotePassages(
  route: string,
  bibleCitations: Parameters<typeof fetchYouVersionBibleQuotePassages>[0],
) {
  const enabled = await isWatchYouVersionBibleQuotesEnabled({
    custom: { route },
  })
  if (!enabled) return []
  return fetchYouVersionBibleQuotePassages(bibleCitations)
}

async function getQuestionPanelEnabled(route: string): Promise<boolean> {
  return isWatchQuestionPanelEnabled({
    custom: { route },
  })
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale: rawInternalLocale, rest } = await params
  const { locale: internalLocale } =
    resolveWatchLocaleIdentity(rawInternalLocale)
  const shape = classify(rest, internalLocale)
  if (shape.kind !== "unknown") {
    setRequestLocale(shape.locale)
  }

  if (shape.kind === "one-segment") {
    return shape.isLanguageHome
      ? getWatchPageMetadata(shape.locale, { pathLocale: shape.slug })
      : getWatchPageMetadata(shape.locale, { slug: shape.slug })
  }

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
        })
      }
      if (!watchVideo) {
        const series = await resolveSeriesBySlug(slug, locale)
        if (series) {
          return generateSeriesMetadata(locale, {
            series: series.video,
            pathLocale: rawLocale,
          })
        }
      }
    } catch {
      // Fall through to getWatchPageMetadata.
    }
    return getWatchPageMetadata(locale, {
      slug,
      pathLocale: rawLocale,
    })
  }

  if (shape.kind === "episode") {
    const { episodeSlug, rawLocale, locale } = shape
    // The episode IS the playable video; OG/canonical metadata follows
    // the episode's slug. Series-context enrichment is Phase 5 work.
    return getWatchPageMetadata(locale, {
      slug: episodeSlug,
      pathLocale: rawLocale,
    })
  }

  return {}
}

export default async function SlugRestPage({ params }: PageProps) {
  const { locale: rawInternalLocale, rest } = await params
  const { locale: internalLocale } =
    resolveWatchLocaleIdentity(rawInternalLocale)
  const shape = classify(rest, internalLocale)

  if (shape.kind === "unknown") notFound()

  setRequestLocale(shape.locale)

  if (shape.kind === "one-segment") {
    return renderOneSegment(shape)
  }

  if (shape.kind === "episode") {
    return renderEpisode(shape)
  }

  return renderVideo(shape)
}

async function renderOneSegment(shape: {
  kind: "one-segment"
  slug: string
  locale: UiLocale
  isLanguageHome: boolean
}) {
  const { slug, locale, isLanguageHome } = shape
  const result = isLanguageHome
    ? await resolveWatchPage(locale)
    : await resolveWatchExperiencePage(locale, slug)

  if (result.error) {
    if (isWatchPageMissingError(result.error)) {
      if (isLanguageHome) return <ExperienceEmpty />
      notFound()
    }
    return <ExperienceError message={result.error.message} />
  }

  const page = result.data
  const experience =
    page?.kind === "video-template" ? page.template : (page?.experience ?? null)
  const routeVideo = page?.kind === "video-template" ? page.routeVideo : null
  const blocks = (experience?.blocks ?? []).filter(
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
  if (actualSlug && rawLocale !== actualSlug) {
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

  const route = `/watch/${seriesSlug}.html/${episodeSlug}/${rawLocale}.html`
  const [downloadButtonLabel, questionPanelEnabled, youVersionPassages] =
    await Promise.all([
      getDownloadButtonLabel(route),
      getQuestionPanelEnabled(route),
      getYouVersionBibleQuotePassages(route, resolved.video.bibleCitations),
    ])
  const mergedBlocks = mergeWatchExperience({
    video: resolved.video,
    variant: resolved.selectedVariant,
    canonicalParent: resolved.series,
    youVersionPassages,
  })
  if (!mergedBlocks.length) return <ExperienceEmpty />
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
        questionPanelEnabled={questionPanelEnabled}
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
  const route = `/watch/${slug}.html/${rawLocale}.html`

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
      const questionPanelEnabled = await getQuestionPanelEnabled(route)
      return (
        <main
          className={`min-h-screen bg-stone-900 ${
            questionPanelEnabled
              ? "pb-[calc(5.75rem+env(safe-area-inset-bottom,0px))] sm:pb-0"
              : ""
          }`}
        >
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
          {questionPanelEnabled ? (
            <WatchQuestionPanel enabled={questionPanelEnabled} />
          ) : null}
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
    if (actualSlug && rawLocale !== actualSlug) {
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
    const [downloadButtonLabel, questionPanelEnabled, youVersionPassages] =
      await Promise.all([
        getDownloadButtonLabel(route),
        getQuestionPanelEnabled(route),
        getYouVersionBibleQuotePassages(route, watchVideo.video.bibleCitations),
      ])
    const mergedBlocks = mergeWatchExperience({
      video: watchVideo.video,
      variant: watchVideo.selectedVariant,
      canonicalParent: watchVideo.canonicalParent,
      youVersionPassages,
    })
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
          questionPanelEnabled={questionPanelEnabled}
        />
      </>
    )
  }

  const series = await resolveSeriesBySlug(slug, locale)
  if (series) {
    const actualSlug = series.selectedVariant?.language?.slug ?? null
    if (actualSlug && rawLocale !== actualSlug) {
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
      notFound()
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
  const questionPanelEnabled = await getQuestionPanelEnabled(route)

  return (
    <main
      className={`min-h-screen bg-stone-900 ${
        questionPanelEnabled
          ? "pb-[calc(5.75rem+env(safe-area-inset-bottom,0px))] sm:pb-0"
          : ""
      }`}
    >
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
      {questionPanelEnabled ? (
        <WatchQuestionPanel enabled={questionPanelEnabled} />
      ) : null}
    </main>
  )
}
