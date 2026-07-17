import type { WatchVideoMetadataModel } from "@/lib/experience-metadata"
import type { MergedWatchBlock } from "@/lib/content"
import {
  WATCH_BASE_PATH,
  WATCH_PUBLIC_METADATA_ORIGIN,
  tryAsContentSlug,
  tryAsLocaleSlug,
  watchVideoPath,
} from "@/lib/routes"

function secondsToIsoDuration(seconds: number | null): string | undefined {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) {
    return undefined
  }
  return `PT${Math.round(seconds)}S`
}

const WATCH_ROOT_URL = `${WATCH_PUBLIC_METADATA_ORIGIN}${WATCH_BASE_PATH}`

function watchVideoAbsoluteUrl(
  slug: string | null | undefined,
  languageSlug: string | null | undefined,
): string | null {
  if (!slug || !languageSlug) return null
  const contentSlug = tryAsContentSlug(slug)
  const localeSlug = tryAsLocaleSlug(languageSlug)
  if (!contentSlug || !localeSlug) return null
  return `${WATCH_ROOT_URL}${watchVideoPath(contentSlug, localeSlug)}`
}

function firstImageUrl(
  images: Array<{
    url?: string | null
    mobileCinematicHigh?: string | null
    mobileCinematicLow?: string | null
    thumbnail?: string | null
  }>,
): string | null {
  const image = images[0]
  return (
    image?.mobileCinematicHigh ??
    image?.mobileCinematicLow ??
    image?.thumbnail ??
    image?.url ??
    null
  )
}

function isoDate(value: string | null): string | undefined {
  if (!value) return undefined
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return undefined
  return new Date(timestamp).toISOString()
}

export function watchVideoStructuredDataJson(
  model: WatchVideoMetadataModel,
): string {
  const uploadDate = isoDate(model.uploadDate)
  const payload = {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: model.videoTitle,
    ...(model.description && { description: model.description }),
    url: model.canonicalUrl,
    embedUrl: model.embedUrl,
    ...(model.contentUrl && { contentUrl: model.contentUrl }),
    thumbnailUrl: [model.image.url],
    ...(model.inLanguage && { inLanguage: model.inLanguage }),
    ...(uploadDate && { uploadDate }),
    ...(secondsToIsoDuration(model.durationSeconds) && {
      duration: secondsToIsoDuration(model.durationSeconds),
    }),
    publisher: {
      "@type": "Organization",
      name: "Jesus Film Project",
      url: "https://www.jesusfilm.org",
    },
    potentialAction: {
      "@type": "WatchAction",
      target: model.canonicalUrl,
    },
  }

  return JSON.stringify(payload).replace(/</g, "\\u003c")
}

export function watchBreadcrumbStructuredDataJson({
  videoTitle,
  canonicalUrl,
  languageSlug,
  series,
}: {
  videoTitle: string
  canonicalUrl: string
  languageSlug: string | null | undefined
  series?: { slug: string | null; title: string | null } | null
}): string {
  const items: Array<Record<string, unknown>> = [
    {
      "@type": "ListItem",
      position: 1,
      name: "Watch",
      item: WATCH_ROOT_URL,
    },
  ]
  const seriesUrl = watchVideoAbsoluteUrl(series?.slug, languageSlug)
  if (seriesUrl) {
    items.push({
      "@type": "ListItem",
      position: items.length + 1,
      name: series?.title ?? series?.slug ?? "Series",
      item: seriesUrl,
    })
  }
  items.push({
    "@type": "ListItem",
    position: items.length + 1,
    name: videoTitle,
    item: canonicalUrl,
  })

  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items,
  }).replace(/</g, "\\u003c")
}

export function watchRelatedItemListStructuredDataJson({
  blocks,
  languageSlug,
}: {
  blocks: MergedWatchBlock[]
  languageSlug: string | null | undefined
}): string | null {
  const carousel = blocks.find(
    (block) => "kind" in block && block.kind === "SiblingCarousel",
  )
  if (!carousel || !("canonicalParent" in carousel)) return null

  const items = carousel.canonicalParent.children
    .map((child, index) => {
      const url = watchVideoAbsoluteUrl(child.slug, languageSlug)
      if (!url || !child.title) return null
      return {
        "@type": "ListItem",
        position: index + 1,
        item: {
          "@type": "VideoObject",
          name: child.title,
          url,
          ...(firstImageUrl(child.images) && {
            thumbnailUrl: [firstImageUrl(child.images)],
          }),
          ...(secondsToIsoDuration(child.durationSeconds) && {
            duration: secondsToIsoDuration(child.durationSeconds),
          }),
        },
      }
    })
    .filter((item): item is NonNullable<typeof item> => item != null)

  if (items.length === 0) return null

  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: items.map((item, index) => ({
      ...item,
      position: index + 1,
    })),
  }).replace(/</g, "\\u003c")
}
