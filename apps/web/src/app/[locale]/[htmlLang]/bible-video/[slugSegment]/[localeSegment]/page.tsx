import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { setRequestLocale } from "next-intl/server"

import { SeriesPageClient } from "@/components/watch/SeriesPageClient"
import { BibleVideoPageClient } from "@/components/watch/BibleVideoPageClient"
import {
  isSeriesRecord,
  mergeWatchExperience,
  resolveSeriesBySlug,
  resolveWatchVideoBySlug,
  type MergedWatchBlock,
  type WatchVariant,
  type WatchVideoRecord,
} from "@/lib/content"
import {
  buildWatchVideoMetadataModel,
  generateSeriesMetadata,
  generateWatchVideoMetadata,
  getWatchPageMetadata,
} from "@/lib/experience-metadata"
import {
  isWatchCtaTextCopyEnabled,
  isWatchHideBibleQuotesEnabled,
  isWatchQuestionPanelEnabled,
  isWatchYouVersionBibleQuotesEnabled,
} from "@/lib/feature-flags"
import {
  isPublicWatchLanguageSlug,
  resolveWatchLocaleIdentity,
  type UiLocale,
} from "@/lib/locale"
import { bibleVideoPath, tryAsContentSlug, tryAsLocaleSlug } from "@/lib/routes"
import { SAFE_SLUG_PATTERN, stripHtmlSuffix } from "@/lib/url-shape"
import { watchVideoStructuredDataJson } from "@/lib/watch-structured-data"
import { getInitialSubtitleTranscript } from "@/lib/watch-transcript"
import { fetchYouVersionBibleQuotePassages } from "@/lib/youversion-passage"

export const revalidate = 3600
export const dynamic = "force-static"
export const dynamicParams = true

export function generateStaticParams(): Array<{
  locale: string
  htmlLang: string
  slugSegment: string
  localeSegment: string
}> {
  return []
}

type PageProps = {
  params: Promise<{
    locale: string
    htmlLang: string
    slugSegment: string
    localeSegment: string
  }>
}

type BibleVideoShape = {
  slug: string
  rawLocale: string
  locale: UiLocale
}

function stripSafeSegment(segment: string): string | null {
  const stripped = stripHtmlSuffix(segment)
  return SAFE_SLUG_PATTERN.test(stripped) ? stripped : null
}

async function classifyParams(params: PageProps["params"]) {
  const { locale: rawInternalLocale, slugSegment, localeSegment } = await params
  const { locale } = resolveWatchLocaleIdentity(rawInternalLocale)
  const slug = stripSafeSegment(slugSegment)
  const rawLocale = stripSafeSegment(localeSegment)

  if (!slug || !rawLocale) return null
  if (!isPublicWatchLanguageSlug(rawLocale)) return null

  return { slug, rawLocale, locale } satisfies BibleVideoShape
}

function pruneWatchVideoForClient(
  video: WatchVideoRecord,
  selectedVariant: WatchVariant,
): WatchVideoRecord {
  const selected =
    video.variants.find(
      (variant) => variant.documentId === selectedVariant.documentId,
    ) ?? selectedVariant
  return { ...video, variants: [selected] }
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

async function getDownloadButtonLabel(
  route: string,
  locale: UiLocale,
): Promise<string | undefined> {
  const useUpdatedCtaCopy = await isWatchCtaTextCopyEnabled({
    custom: { route },
  })
  if (!useUpdatedCtaCopy) return undefined

  const messages = (
    await import(`../../../../../../../messages/${locale}.json`)
  ).default as { DownloadButton?: { saveVideo?: string } }
  return messages.DownloadButton?.saveVideo ?? "Save Video"
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

async function getHideBibleQuotesEnabled(route: string): Promise<boolean> {
  return isWatchHideBibleQuotesEnabled({
    custom: { route },
  })
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

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const shape = await classifyParams(params)
  if (!shape) return {}

  const { slug, rawLocale, locale } = shape
  setRequestLocale(locale)

  try {
    const watchVideo = await resolveWatchVideoBySlug(slug, rawLocale)
    if (watchVideo && isSeriesRecord(watchVideo.video)) {
      return generateSeriesMetadata(locale, {
        series: watchVideo.video,
        pathLocale: rawLocale,
      })
    }
    if (watchVideo) {
      return generateWatchVideoMetadata(locale, {
        video: watchVideo.video,
        selectedVariant: watchVideo.selectedVariant,
        routeSlug: slug,
        pathLocale: rawLocale,
        videoPathBuilder: bibleVideoPath,
      })
    }

    const series = await resolveSeriesBySlug(slug, rawLocale)
    if (series) {
      return generateSeriesMetadata(locale, {
        series: series.video,
        pathLocale: rawLocale,
      })
    }
  } catch {
    // Fall through to the safe generic metadata path.
  }

  return getWatchPageMetadata(locale, {
    slug,
    pathLocale: rawLocale,
  })
}

export default async function BibleVideoPage({ params }: PageProps) {
  const shape = await classifyParams(params)
  if (!shape) notFound()

  const { slug, rawLocale, locale } = shape
  setRequestLocale(locale)

  const route = `/watch/bible-video/${slug}.html/${rawLocale}.html`
  const watchVideo = await resolveWatchVideoBySlug(slug, rawLocale)
  if (watchVideo) {
    const actualSlug = watchVideo.selectedVariant.language?.slug ?? null
    if (actualSlug && rawLocale !== actualSlug) {
      const contentSlug = tryAsContentSlug(slug)
      const localeSlug = tryAsLocaleSlug(actualSlug)
      if (contentSlug && localeSlug) {
        redirect(
          bibleVideoPath(contentSlug, localeSlug, {
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

    const [downloadButtonLabel, questionPanelEnabled, hideBibleQuotes] =
      await Promise.all([
        getDownloadButtonLabel(route, locale),
        getQuestionPanelEnabled(route),
        getHideBibleQuotesEnabled(route),
      ])
    const [youVersionPassages, initialTranscript] = await Promise.all([
      hideBibleQuotes
        ? Promise.resolve([])
        : getYouVersionBibleQuotePassages(
            route,
            watchVideo.video.bibleCitations,
          ),
      getInitialSubtitleTranscript({
        subtitles: watchVideo.video.subtitles,
        audioSlug: watchVideo.selectedVariant.language?.slug ?? rawLocale,
        durationSeconds: watchVideo.selectedVariant.duration ?? null,
      }),
    ])
    const mergedBlocks = mergeWatchExperience({
      video: watchVideo.video,
      variant: watchVideo.selectedVariant,
      canonicalParent: watchVideo.canonicalParent,
      youVersionPassages,
    })
    const clientMergedBlocks = pruneMergedWatchBlocksForClient(
      mergedBlocks,
      watchVideo.selectedVariant,
    )
    const clientVideo = pruneWatchVideoForClient(
      watchVideo.video,
      watchVideo.selectedVariant,
    )
    const lcpPlaybackId =
      watchVideo.selectedVariant.muxVideo?.playbackId ?? null
    const metadataModel = buildWatchVideoMetadataModel({
      video: watchVideo.video,
      selectedVariant: watchVideo.selectedVariant,
      routeSlug: slug,
      pathLocale: rawLocale,
      videoPathBuilder: bibleVideoPath,
    })

    return (
      <>
        <WatchVideoStructuredData model={metadataModel} />
        {lcpPlaybackId ? (
          <link
            rel="preload"
            as="image"
            href={`https://image.mux.com/${lcpPlaybackId}/thumbnail.webp?width=1280`}
            fetchPriority="high"
          />
        ) : null}
        <BibleVideoPageClient
          downloadButtonLabel={downloadButtonLabel}
          mergedBlocks={clientMergedBlocks}
          variant={watchVideo.selectedVariant}
          video={clientVideo}
          languageSlug={watchVideo.selectedVariant.language?.slug ?? rawLocale}
          locale={locale}
          hideBibleQuotes={hideBibleQuotes}
          questionPanelEnabled={questionPanelEnabled}
          initialTranscript={initialTranscript}
        />
      </>
    )
  }

  const series = await resolveSeriesBySlug(slug, rawLocale)
  if (series) {
    const actualSlug = series.selectedVariant?.language?.slug ?? null
    if (actualSlug && rawLocale !== actualSlug) {
      const contentSlug = tryAsContentSlug(slug)
      const localeSlug = tryAsLocaleSlug(actualSlug)
      if (contentSlug && localeSlug) {
        redirect(
          bibleVideoPath(contentSlug, localeSlug, {
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

  notFound()
}
