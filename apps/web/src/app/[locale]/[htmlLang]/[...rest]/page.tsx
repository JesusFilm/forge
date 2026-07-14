import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { setRequestLocale } from "next-intl/server"

import { ExperienceEmpty } from "@/components/ExperienceEmpty"
import { ExperienceError } from "@/components/ExperienceError"
import { ExperienceSectionRenderer, type Section } from "@/components/sections"
import { WatchHomeFooter } from "@/components/home/WatchHomeFooter"
import { WatchHomeExperiencePage } from "@/components/home/WatchHomeExperiencePage"
import { SeriesPageClient } from "@/components/watch/SeriesPageClient"
import { WatchPageClient } from "@/components/watch/WatchPageClient"
import { WatchQuestionPanel } from "@/components/watch/WatchQuestionPanel"
import {
  isWatchPageMissingError,
  mergeWatchExperience,
  type MergedWatchBlock,
  resolveSeriesEpisodeBySlug,
  resolveWatchRouteBySlug,
  resolveWatchExperiencePage,
  resolveWatchPage,
  type WatchVariant,
  type WatchVideoRecord,
} from "@/lib/content"
import {
  buildWatchVideoMetadataModel,
  generateSeriesMetadata,
  generateWatchVideoMetadata,
  getWatchPageMetadata,
  getWatchRouteFallbackMetadata,
} from "@/lib/experience-metadata"
import { resolveWatchHome } from "@/lib/watch-home"
import {
  isWatchCtaTextCopyEnabled,
  isWatchHideBibleQuotesEnabled,
  isWatchQuestionPanelEnabled,
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
import {
  watchBreadcrumbStructuredDataJson,
  watchVideoStructuredDataJson,
  watchRelatedItemListStructuredDataJson,
} from "@/lib/watch-structured-data"
import { logWatchServerEvent } from "@/lib/watch-observability"
import { getInitialSubtitleTranscript } from "@/lib/watch-transcript"

// ISR: pages cached for 1 hour. Cookie-driven language redirect lives in
// apps/web/src/proxy.ts (middleware) — keeping cookies() out of this page
// route preserves ISR for the majority of traffic without the preference
// cookie. Admin revalidation clears both route paths and tagged resolver data;
// the route TTL is the fallback when a webhook or process-local invalidation is
// missed.
// Keep the build output clean so runtime ISR artifacts from old deploys cannot
// be packaged as fresh pages. See
// docs/solutions/web/nextjs-headers-defeats-route-cache.md.
export const revalidate = 3600
export const dynamic = "force-static"
export const dynamicParams = true

export function generateStaticParams(): Array<{
  locale: string
  htmlLang: string
  rest: string[]
}> {
  return []
}

function pruneWatchVideoForClient(
  video: WatchVideoRecord,
  selectedVariant: WatchVariant,
): WatchVideoRecord {
  const selected =
    video.variants.find(
      (variant) => variant.documentId === selectedVariant.documentId,
    ) ?? selectedVariant
  return {
    ...video,
    parents: [],
    children: [],
    childDubLanguages: [],
    variants: [pruneWatchVariantForClient(selected)],
    studyQuestions: [],
    bibleCitations: [],
  }
}

function pruneWatchVariantForClient(variant: WatchVariant): WatchVariant {
  return {
    ...variant,
    // `video.subtitles` is the canonical client-side subtitle list. Keeping
    // the selected variant's full edition subtitle payload duplicates every
    // track in the RSC stream and initial HTML.
    videoEdition: null,
  }
}

function pruneMergedWatchBlocksForClient(
  blocks: MergedWatchBlock[],
  selectedVariant: WatchVariant,
): MergedWatchBlock[] {
  return blocks.map((block) => {
    if (!("kind" in block)) return block
    switch (block.kind) {
      case "HeroPlayer":
      case "WatchBody":
        return {
          ...block,
          video: pruneWatchVideoForClient(block.video, selectedVariant),
          variant: pruneWatchVariantForClient(block.variant),
        }
      case "Share":
        return {
          ...block,
          video: pruneWatchVideoForClient(block.video, selectedVariant),
        }
      default:
        return block
    }
  })
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

async function getDownloadButtonLabel(
  route: string,
  locale: UiLocale,
): Promise<string | undefined> {
  const useUpdatedCtaCopy = await isWatchCtaTextCopyEnabled({
    custom: { route },
  })
  if (!useUpdatedCtaCopy) return undefined

  const messages = (await import(`../../../../../messages/${locale}.json`))
    .default as { DownloadButton?: { saveVideo?: string } }
  return messages.DownloadButton?.saveVideo ?? "Save Video"
}

async function getQuestionPanelEnabled(route: string): Promise<boolean> {
  return isWatchQuestionPanelEnabled({
    custom: { route },
  })
}

async function getHideBibleQuotesEnabled(route: string): Promise<boolean> {
  return isWatchHideBibleQuotesEnabled({
    custom: { route },
  })
}

async function getInitialTranscriptForWatchVideo(
  video: WatchVideoRecord,
  selectedVariant: WatchVariant,
): ReturnType<typeof getInitialSubtitleTranscript> {
  if (video.subtitles.length === 0) return null
  return getInitialSubtitleTranscript({
    subtitles: video.subtitles,
    audioSlug: selectedVariant.language?.slug ?? null,
    durationSeconds: selectedVariant.duration ?? null,
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
      const routeModel = await resolveWatchRouteBySlug(slug, rawLocale)
      if (routeModel.kind === "series") {
        return generateSeriesMetadata(locale, {
          series: routeModel.video,
          pathLocale: rawLocale,
        })
      }
      if (routeModel.kind === "video") {
        return generateWatchVideoMetadata(locale, {
          video: routeModel.video,
          selectedVariant: routeModel.selectedVariant,
          routeSlug: slug,
          pathLocale: rawLocale,
        })
      }
    } catch (error) {
      logWatchServerEvent("watch_metadata.video.fallback", {
        slug,
        rawLocale,
        detail: error instanceof Error ? error : String(error),
      })
      return getWatchRouteFallbackMetadata(locale, {
        slug,
        pathLocale: rawLocale,
      })
    }
    return getWatchPageMetadata(locale, {
      slug,
      pathLocale: rawLocale,
    })
  }

  if (shape.kind === "episode") {
    const { seriesSlug, episodeSlug, rawLocale, locale } = shape
    // The episode IS the playable video; keep metadata on the verified
    // three-segment public URL when the series parent resolves.
    try {
      const resolved = await resolveSeriesEpisodeBySlug(
        seriesSlug,
        episodeSlug,
        rawLocale,
      )
      if (resolved) {
        return generateWatchVideoMetadata(locale, {
          video: resolved.video,
          selectedVariant: resolved.selectedVariant,
          routeSlug: episodeSlug,
          pathLocale: rawLocale,
          seriesSlug,
        })
      }
    } catch (error) {
      logWatchServerEvent("watch_metadata.episode.fallback", {
        seriesSlug,
        episodeSlug,
        rawLocale,
        detail: error instanceof Error ? error : String(error),
      })
      return getWatchRouteFallbackMetadata(locale, {
        slug: episodeSlug,
        pathLocale: rawLocale,
      })
    }
    return getWatchPageMetadata(locale, {
      slug: episodeSlug,
      pathLocale: rawLocale,
    })
  }

  return {}
}

function WatchVideoStructuredData({
  model,
}: {
  model: ReturnType<typeof buildWatchVideoMetadataModel>
}) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: watchVideoStructuredDataJson(model),
      }}
    />
  )
}

function WatchStructuredData({ json }: { json: string | null | undefined }) {
  if (!json) return null
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  )
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
  if (isLanguageHome) {
    const [heroResult, pageResult] = await Promise.all([
      resolveWatchHome(locale),
      resolveWatchPage(locale),
    ])
    if (heroResult.error) {
      return <ExperienceError message={heroResult.error.message} />
    }

    const builderBlocks =
      pageResult.data?.kind === "experience"
        ? (pageResult.data.experience.blocks ?? [])
        : []

    if (
      pageResult.error &&
      !isWatchPageMissingError(pageResult.error) &&
      process.env.NODE_ENV === "development"
    ) {
      console.warn("[watch-home] Unable to load builder-authored body.", {
        error: pageResult.error.message,
      })
    }

    if (!heroResult.data.heroSlides.length && !builderBlocks.length) {
      return <ExperienceEmpty />
    }
    return (
      <WatchHomeExperiencePage
        heroModel={heroResult.data}
        blocks={builderBlocks}
      />
    )
  }

  const result = await resolveWatchExperiencePage(locale, slug)

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
  locale: UiLocale
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
  const [downloadButtonLabel, questionPanelEnabled, hideBibleQuotes] =
    await Promise.all([
      getDownloadButtonLabel(route, locale),
      getQuestionPanelEnabled(route),
      getHideBibleQuotesEnabled(route),
    ])
  const mergedBlocks = mergeWatchExperience({
    video: resolved.video,
    variant: resolved.selectedVariant,
    canonicalParent: resolved.series,
  })
  const clientVariant = pruneWatchVariantForClient(resolved.selectedVariant)
  const clientMergedBlocks = pruneMergedWatchBlocksForClient(
    mergedBlocks,
    resolved.selectedVariant,
  )
  const clientVideo = pruneWatchVideoForClient(
    resolved.video,
    resolved.selectedVariant,
  )
  if (!mergedBlocks.length) return <ExperienceEmpty />
  const metadataModel = buildWatchVideoMetadataModel({
    video: resolved.video,
    selectedVariant: resolved.selectedVariant,
    routeSlug: episodeSlug,
    pathLocale: rawLocale,
    seriesSlug,
  })
  const initialTranscript = await getInitialTranscriptForWatchVideo(
    resolved.video,
    resolved.selectedVariant,
  )
  const languageSlug = resolved.selectedVariant.language?.slug ?? rawLocale
  const breadcrumbJson = watchBreadcrumbStructuredDataJson({
    videoTitle: metadataModel.videoTitle,
    canonicalUrl: metadataModel.canonicalUrl,
    languageSlug,
    series: {
      slug: resolved.series.slug,
      title: resolved.series.title,
    },
  })
  const relatedItemsJson = watchRelatedItemListStructuredDataJson({
    blocks: mergedBlocks,
    languageSlug,
  })

  return (
    <>
      <WatchVideoStructuredData model={metadataModel} />
      <WatchStructuredData json={breadcrumbJson} />
      <WatchStructuredData json={relatedItemsJson} />
      <WatchPageClient
        downloadButtonLabel={downloadButtonLabel}
        mergedBlocks={clientMergedBlocks}
        variant={clientVariant}
        video={clientVideo}
        languageSlug={languageSlug}
        collectionSlug={seriesSlug}
        locale={locale}
        hideBibleQuotes={hideBibleQuotes}
        questionPanelEnabled={questionPanelEnabled}
        initialTranscript={initialTranscript}
      />
      <WatchHomeFooter />
    </>
  )
}

async function renderVideo(shape: {
  kind: "video"
  slug: string
  rawLocale: string
  locale: UiLocale
}) {
  const { slug, rawLocale, locale } = shape
  const route = `/watch/${slug}.html/${rawLocale}.html`

  // Video-by-slug first. Pass rawLocale (not the bcp47-normalised
  // `locale`) so the resolver matches either variant.language.slug OR
  // variant.language.bcp47 — slug-form URLs like /the-call/korean need to
  // land in the resolver as "korean", not "en". A same-slug Experience is
  // only a fallback after video and series routes fail to render.
  const routeModel = await resolveWatchRouteBySlug(slug, rawLocale)
  if (routeModel.kind === "video") {
    const watchVideo = routeModel
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
    const [downloadButtonLabel, questionPanelEnabled, hideBibleQuotes] =
      await Promise.all([
        getDownloadButtonLabel(route, locale),
        getQuestionPanelEnabled(route),
        getHideBibleQuotesEnabled(route),
      ])
    const mergedBlocks = mergeWatchExperience({
      video: watchVideo.video,
      variant: watchVideo.selectedVariant,
      canonicalParent: null,
    })
    const clientVariant = pruneWatchVariantForClient(watchVideo.selectedVariant)
    const clientMergedBlocks = pruneMergedWatchBlocksForClient(
      mergedBlocks,
      watchVideo.selectedVariant,
    )
    const clientVideo = pruneWatchVideoForClient(
      watchVideo.video,
      watchVideo.selectedVariant,
    )
    const metadataModel = buildWatchVideoMetadataModel({
      video: watchVideo.video,
      selectedVariant: watchVideo.selectedVariant,
      routeSlug: slug,
      pathLocale: rawLocale,
    })
    const initialTranscript = await getInitialTranscriptForWatchVideo(
      watchVideo.video,
      watchVideo.selectedVariant,
    )
    const languageSlug = watchVideo.selectedVariant.language?.slug ?? rawLocale
    const breadcrumbJson = watchBreadcrumbStructuredDataJson({
      videoTitle: metadataModel.videoTitle,
      canonicalUrl: metadataModel.canonicalUrl,
      languageSlug,
    })
    const relatedItemsJson = watchRelatedItemListStructuredDataJson({
      blocks: mergedBlocks,
      languageSlug,
    })
    return (
      <>
        <WatchVideoStructuredData model={metadataModel} />
        <WatchStructuredData json={breadcrumbJson} />
        <WatchStructuredData json={relatedItemsJson} />
        <WatchPageClient
          downloadButtonLabel={downloadButtonLabel}
          mergedBlocks={clientMergedBlocks}
          variant={clientVariant}
          video={clientVideo}
          languageSlug={languageSlug}
          locale={locale}
          hideBibleQuotes={hideBibleQuotes}
          questionPanelEnabled={questionPanelEnabled}
          initialTranscript={initialTranscript}
        />
        <WatchHomeFooter />
      </>
    )
  }

  if (routeModel.kind === "series") {
    const series = routeModel
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
