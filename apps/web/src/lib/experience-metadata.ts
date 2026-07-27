import type { Metadata } from "next"
import {
  experienceToMetadata,
  resolveWatchPage,
  type ResolvedSeriesBySlug,
  type ResolvedWatchPage,
  type WatchVariant,
  type WatchVideoRecord,
} from "@/lib/content"
import {
  WATCH_BASE_PATH,
  WATCH_PUBLIC_METADATA_ORIGIN,
  localizedHomePath,
  tryAsContentSlug,
  tryAsLocaleSlug,
  watchVideoPath,
} from "@/lib/routes"
import { getSocialConfig } from "@/lib/social-config"
import { resolvePosterUrl } from "@/lib/url"
import { stripHtmlSuffix } from "@/lib/url-shape"

const TITLE_SUFFIX = "| Jesus Film Project"
const TITLE_SUFFIX_TEXT = "Jesus Film Project"

/**
 * Build the canonical absolute URL for a watch page in the `.html` shape,
 * keyed off the (slug, pathLocale) the route resolved. Routes through the
 * `lib/routes.ts` path builders so the canonical `<link>` matches the public
 * website URL contract exactly (origin from `WATCH_PUBLIC_METADATA_ORIGIN`,
 * `.html` per segment), independent of local/preview deployment origins.
 *
 * Shapes:
 * - slug + pathLocale → 2-segment `/{slug}.html/{locale}.html`
 * - one segment (slug-only OR pathLocale-only) → 1-segment `/{seg}.html`
 *   (localized home or single-segment collection — same URL shape)
 * - neither → the watch root `/watch`
 *
 * Inputs arrive `.html`-stripped from `classify()` but are NOT slug-regex
 * validated there, so a malformed slug (uppercase, dot) can reach here. On
 * such input the branded builders can't run, so we fall back to a bare
 * origin+basePath+segment string. This deliberately diverges from the
 * Phase 4 nav-emission sites (which OMIT a link on invalid input): a
 * canonical `<link>` must always be present, and metadata must never throw.
 * The fallback is injection-safe — Next.js HTML-entity-encodes the canonical
 * href attribute, so a slug with quotes/brackets can't break out.
 */
function buildCanonicalUrl(slug?: string, pathLocale?: string): string {
  const root = `${WATCH_PUBLIC_METADATA_ORIGIN}${WATCH_BASE_PATH}`
  const s = slug ? stripHtmlSuffix(slug) : undefined
  const l = pathLocale ? stripHtmlSuffix(pathLocale) : undefined

  if (s && l) {
    const cs = tryAsContentSlug(s)
    const ls = tryAsLocaleSlug(l)
    if (cs && ls) return `${root}${watchVideoPath(cs, ls)}`
    return `${root}/${s}/${l}`
  }

  const single = s ?? l
  if (single) {
    const ls = tryAsLocaleSlug(single)
    // localizedHomePath emits `/{seg}.html` — the correct 1-segment canonical
    // for both a localized home (seg is a language) and a single-segment
    // collection landing (seg is content); the URL shape is identical, so the
    // nominal LocaleSlug brand is fine here.
    if (ls) return `${root}${localizedHomePath(ls)}`
    return `${root}/${single}`
  }

  return root
}

const OG_LOCALE_OVERRIDES: Record<string, string> = {
  en: "en_US",
  pt: "pt_BR",
}

function getOgLocale(locale: string): string {
  if (OG_LOCALE_OVERRIDES[locale]) return OG_LOCALE_OVERRIDES[locale]
  if (locale.includes("-")) return locale.replace(/-/g, "_")
  return `${locale}_${locale.toUpperCase()}`
}

function withTitleSuffix(title: string): string {
  const trimmed = title.trim()
  if (!trimmed) return `Watch ${TITLE_SUFFIX}`
  if (trimmed.endsWith(TITLE_SUFFIX_TEXT)) return trimmed
  return `${trimmed} ${TITLE_SUFFIX}`
}

const DEFAULT_OG_IMAGE = {
  url: "https://images.unsplash.com/photo-1482424917728-d82d29662023?w=1400&auto=format&fit=crop&q=60",
  width: 1400,
  height: 933,
  alt: "Jesus Film Project",
  type: "image/jpeg" as const,
}

type WatchMetadataImage = {
  url: string
  width: number
  height: number
  alt: string
  type: "image/jpeg"
}

export type WatchStructuredDataCaption = {
  contentUrl: string
  inLanguage: string
}

const MUX_SOCIAL_IMAGE_WIDTH = 1200
const MUX_SOCIAL_IMAGE_HEIGHT = 630

function buildMuxSocialImage(
  playbackId: string | null | undefined,
  alt: string,
): WatchMetadataImage | null {
  if (!playbackId) return null

  return {
    url: `https://image.mux.com/${playbackId}/thumbnail.jpg?width=${MUX_SOCIAL_IMAGE_WIDTH}&height=${MUX_SOCIAL_IMAGE_HEIGHT}&fit_mode=smartcrop`,
    width: MUX_SOCIAL_IMAGE_WIDTH,
    height: MUX_SOCIAL_IMAGE_HEIGHT,
    alt,
    type: "image/jpeg",
  }
}

function firstValidDate(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    const candidate = value?.trim()
    if (candidate && Number.isFinite(Date.parse(candidate))) return candidate
  }
  return null
}

export type WatchVideoMetadataModel = {
  title: string
  videoTitle: string
  /**
   * Eligible VideoObject name. Unlike page and social metadata titles, this
   * intentionally never falls back to the route slug or a generic label.
   */
  structuredDataTitle: string | null
  structuredDataDescription: string | null
  description: string
  canonicalUrl: string
  image: WatchMetadataImage
  structuredDataThumbnailUrl: string | null
  noIndex: boolean
  inLanguage: string | null
  durationSeconds: number | null
  contentUrl: string | null
  uploadDate: string | null
  captions: WatchStructuredDataCaption[]
}

type WatchVideoMetadataOptions = {
  video: WatchVideoRecord
  selectedVariant: WatchVariant
  routeSlug: string
  pathLocale: string
  seriesSlug?: string
}

export function buildWatchVideoMetadataModel(
  options: WatchVideoMetadataOptions,
): WatchVideoMetadataModel {
  const episodeSlug = options.video.slug ?? options.routeSlug
  const canonicalUrl = buildCanonicalUrl(episodeSlug, options.pathLocale)
  const videoTitle = options.video.title || options.routeSlug || "Watch"
  const structuredDataTitle = options.video.title?.trim() || null
  const title = `${videoTitle} ${TITLE_SUFFIX}`
  const description = options.video.description ?? options.video.snippet ?? ""
  const structuredDataDescription =
    options.video.description?.trim() ||
    options.video.snippet?.trim() ||
    (structuredDataTitle
      ? `Watch ${structuredDataTitle} from Jesus Film Project.`
      : null)
  const imageAlt =
    options.video.imageAlt ?? options.video.title ?? DEFAULT_OG_IMAGE.alt
  const muxSocialImage = buildMuxSocialImage(
    options.selectedVariant.muxVideo?.playbackId,
    imageAlt,
  )
  const posterUrl = resolvePosterUrl(
    options.video.images?.[0],
    options.selectedVariant.muxVideo?.playbackId,
  )
  const image =
    muxSocialImage ??
    (posterUrl
      ? {
          url: posterUrl,
          width: DEFAULT_OG_IMAGE.width,
          height: DEFAULT_OG_IMAGE.height,
          alt: imageAlt,
          type: "image/jpeg" as const,
        }
      : DEFAULT_OG_IMAGE)

  return {
    title,
    videoTitle,
    structuredDataTitle,
    structuredDataDescription,
    description,
    canonicalUrl,
    image,
    structuredDataThumbnailUrl: muxSocialImage?.url ?? posterUrl,
    noIndex: options.video.noIndex ?? false,
    inLanguage: options.selectedVariant.language?.bcp47?.trim() || null,
    durationSeconds: options.selectedVariant.duration ?? null,
    contentUrl: options.selectedVariant.hls?.trim() || null,
    uploadDate: firstValidDate(
      options.video.publishedAt,
      options.video.localePublishedAt,
    ),
    captions: options.video.subtitles.map((subtitle) => ({
      contentUrl: subtitle.vttSrc.trim(),
      inLanguage: subtitle.language.bcp47.trim(),
    })),
  }
}

export function generateWatchVideoMetadata(
  locale: string,
  options: WatchVideoMetadataOptions,
): Metadata {
  const model = buildWatchVideoMetadataModel(options)
  const { fbAppId } = getSocialConfig()

  return {
    title: model.title,
    description: model.description || undefined,
    openGraph: {
      title: model.title,
      description: model.description || undefined,
      url: model.canonicalUrl,
      siteName: "Jesus Film Project",
      locale: getOgLocale(locale),
      type: "website" as const,
      images: [model.image],
    },
    twitter: {
      card: "summary_large_image" as const,
      site: "@JesusFilm",
      creator: "@JesusFilm",
      title: model.title,
      description: model.description || undefined,
      images: [
        {
          url: model.image.url,
          alt: model.image.alt,
        },
      ],
    },
    robots: model.noIndex
      ? { index: false, follow: false }
      : { index: true, follow: true },
    ...(fbAppId && { other: { "fb:app_id": fbAppId } }),
    alternates: {
      canonical: model.canonicalUrl,
    },
  }
}

function toMetadata(
  locale: string,
  resolvedPage: ResolvedWatchPage | null,
  options?: { slug?: string; pathLocale?: string },
): Metadata {
  const url = buildCanonicalUrl(options?.slug, options?.pathLocale)

  const { fbAppId } = getSocialConfig()

  if (resolvedPage?.kind === "video-template") {
    // Prefer the longer `description` over the punchier `snippet` for SEO —
    // Google prefers 120–160 chars in the meta description; snippets are
    // routinely below that floor (one-line taglines). Keep snippet as the
    // fallback so videos with no body description still get something.
    const description =
      resolvedPage.routeVideo.description ??
      resolvedPage.routeVideo.snippet ??
      ""
    const baseTitle = resolvedPage.routeVideo.title || options?.slug || "Watch"
    // Always append the brand suffix so video pages get the same
    // "<title> | Jesus Film Project" treatment that experience pages and
    // series pages already produce (via `experienceToMetadata` and
    // `generateSeriesMetadata`).
    const title = `${baseTitle} ${TITLE_SUFFIX}`
    const ogImage = resolvedPage.routeVideo.imageUrl
      ? {
          url: resolvedPage.routeVideo.imageUrl,
          width: DEFAULT_OG_IMAGE.width,
          height: DEFAULT_OG_IMAGE.height,
          alt:
            resolvedPage.routeVideo.imageAlt ??
            resolvedPage.routeVideo.title ??
            DEFAULT_OG_IMAGE.alt,
          type: "image/jpeg" as const,
        }
      : DEFAULT_OG_IMAGE

    return {
      title,
      description: description || undefined,
      openGraph: {
        title,
        description: description || undefined,
        url,
        siteName: "Jesus Film Project",
        locale: getOgLocale(locale),
        type: "website" as const,
        images: [ogImage],
      },
      twitter: {
        card: "summary_large_image" as const,
        site: "@JesusFilm",
        creator: "@JesusFilm",
        title,
        description: description || undefined,
        images: [
          {
            url: ogImage.url,
            alt: ogImage.alt,
          },
        ],
      },
      robots: resolvedPage.routeVideo.noIndex
        ? { index: false, follow: false }
        : { index: true, follow: true },
      ...(fbAppId && { other: { "fb:app_id": fbAppId } }),
      alternates: {
        canonical: url,
      },
    }
  }

  const cms =
    resolvedPage?.kind === "experience"
      ? experienceToMetadata(resolvedPage.experience)
      : null

  const fallbackTitle = options?.slug
    ? `${options.slug} ${TITLE_SUFFIX}`
    : "Watch | Jesus Film Project"
  const title = cms?.title ? withTitleSuffix(cms.title) : fallbackTitle
  const description =
    cms?.description ??
    "Watch the Jesus Film Project's library of free films and short videos exploring the life and teachings of Jesus, available in thousands of languages."
  const ogTitle = cms?.ogTitle ? withTitleSuffix(cms.ogTitle) : title
  const ogDescription = cms?.ogDescription ?? description
  const ogImage = cms?.ogImage
    ? {
        url: cms.ogImage.url,
        width: cms.ogImage.width ?? DEFAULT_OG_IMAGE.width,
        height: cms.ogImage.height ?? DEFAULT_OG_IMAGE.height,
        alt: cms.ogImage.alt || DEFAULT_OG_IMAGE.alt,
        type: "image/jpeg" as const,
      }
    : DEFAULT_OG_IMAGE

  return {
    title,
    description: description || undefined,
    openGraph: {
      title: ogTitle,
      description: ogDescription || undefined,
      url,
      siteName: "Jesus Film Project",
      locale: getOgLocale(locale),
      type: "website" as const,
      images: [ogImage],
    },
    twitter: {
      card: "summary_large_image" as const,
      site: "@JesusFilm",
      creator: "@JesusFilm",
      title: ogTitle,
      description: ogDescription || undefined,
      images: [
        {
          url: ogImage.url,
          alt: ogImage.alt,
        },
      ],
    },
    // Explicit index/follow default. Without this, no <meta name="robots">
    // is emitted — Google still defaults to index,follow, but explicit is
    // unambiguous and lets WAF/CDN edge layers reason about expected SEO.
    robots: { index: true, follow: true },
    ...(fbAppId && { other: { "fb:app_id": fbAppId } }),
    alternates: {
      canonical: url,
    },
  }
}

export async function getWatchPageMetadata(
  locale: string,
  options?: { slug?: string; pathLocale?: string },
): Promise<Metadata> {
  const result = await resolveWatchPage(locale, options?.slug)
  return toMetadata(locale, result.data, options)
}

export function getWatchRouteFallbackMetadata(
  locale: string,
  options?: { slug?: string; pathLocale?: string },
): Metadata {
  return toMetadata(locale, null, options)
}

// Series-page metadata helper. Mirrors the shape `getWatchPageMetadata`
// produces but reads title / description / poster directly from the
// resolved series record rather than going through `resolveWatchPage`'s
// experience/template path. Lives next to `getWatchPageMetadata` so the
// two helpers evolve together — if the OG image format or canonical URL
// construction changes here, the same change should land there.
export function generateSeriesMetadata(
  locale: string,
  options: {
    series: ResolvedSeriesBySlug["video"]
    pathLocale?: string
  },
): Metadata {
  const { series, pathLocale } = options
  const slug = series.slug ?? ""
  const url = buildCanonicalUrl(slug, pathLocale)

  const { fbAppId } = getSocialConfig()

  const title =
    (series.title && `${series.title} ${TITLE_SUFFIX}`) ||
    `Watch ${TITLE_SUFFIX}`
  const description = series.description ?? series.snippet ?? ""
  const posterUrl = resolvePosterUrl(series.images?.[0], null)
  const ogImage = posterUrl
    ? {
        url: posterUrl,
        width: DEFAULT_OG_IMAGE.width,
        height: DEFAULT_OG_IMAGE.height,
        alt: series.imageAlt ?? series.title ?? DEFAULT_OG_IMAGE.alt,
        type: "image/jpeg" as const,
      }
    : DEFAULT_OG_IMAGE

  return {
    title,
    description: description || undefined,
    openGraph: {
      title,
      description: description || undefined,
      url,
      siteName: "Jesus Film Project",
      locale: getOgLocale(locale),
      type: "website" as const,
      images: [ogImage],
    },
    twitter: {
      card: "summary_large_image" as const,
      site: "@JesusFilm",
      creator: "@JesusFilm",
      title,
      description: description || undefined,
      images: [
        {
          url: ogImage.url,
          alt: ogImage.alt,
        },
      ],
    },
    robots: series.noIndex
      ? { index: false, follow: false }
      : { index: true, follow: true },
    ...(fbAppId && { other: { "fb:app_id": fbAppId } }),
    alternates: {
      canonical: url,
    },
  }
}
