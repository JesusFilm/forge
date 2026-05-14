import type { Metadata } from "next"
import {
  experienceToMetadata,
  resolveWatchPage,
  type ResolvedSeriesBySlug,
  type ResolvedWatchPage,
} from "@/lib/content"
import { getSocialConfig } from "@/lib/social-config"
import { resolvePosterUrl } from "@/lib/url"

const SITE_BASE = "https://www.jesusfilm.org"
const TITLE_SUFFIX = "| Jesus Film Project"

const OG_LOCALE_OVERRIDES: Record<string, string> = {
  en: "en_US",
  pt: "pt_BR",
}

function getOgLocale(locale: string): string {
  if (OG_LOCALE_OVERRIDES[locale]) return OG_LOCALE_OVERRIDES[locale]
  if (locale.includes("-")) return locale.replace(/-/g, "_")
  return `${locale}_${locale.toUpperCase()}`
}

const DEFAULT_OG_IMAGE = {
  url: "https://images.unsplash.com/photo-1482424917728-d82d29662023?w=1400&auto=format&fit=crop&q=60",
  width: 1400,
  height: 933,
  alt: "Jesus Film Project",
  type: "image/jpeg" as const,
}

function toMetadata(
  locale: string,
  resolvedPage: ResolvedWatchPage | null,
  options?: { slug?: string; pathLocale?: string; pathPrefix?: string },
): Metadata {
  const prefix = options?.pathPrefix ? `/${options.pathPrefix}` : ""
  const pathSuffix = options?.slug
    ? options?.pathLocale
      ? `/${options.slug}/${options.pathLocale}`
      : `/${options.slug}`
    : options?.pathLocale
      ? `/${options.pathLocale}`
      : ""
  const url = `${SITE_BASE}${prefix}${pathSuffix}`

  const { fbAppId } = getSocialConfig()

  if (resolvedPage?.kind === "video-template") {
    const description =
      resolvedPage.routeVideo.snippet ??
      resolvedPage.routeVideo.description ??
      ""
    const title =
      resolvedPage.routeVideo.title ||
      `${options?.slug ?? "Watch"} ${TITLE_SUFFIX}`
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
      },
      ...(resolvedPage.routeVideo.noIndex && {
        robots: { index: false, follow: false },
      }),
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
  const title = cms?.title ?? fallbackTitle
  const description =
    cms?.description ?? "Watch films and videos about the life of Jesus."
  const ogTitle = cms?.ogTitle ?? title
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
    },
    ...(fbAppId && { other: { "fb:app_id": fbAppId } }),
    alternates: {
      canonical: url,
    },
  }
}

export async function getWatchPageMetadata(
  locale: string,
  options?: { slug?: string; pathLocale?: string; pathPrefix?: string },
): Promise<Metadata> {
  const result = await resolveWatchPage(locale, options?.slug)
  return toMetadata(locale, result.data, options)
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
    pathPrefix?: string
  },
): Metadata {
  const { series, pathLocale, pathPrefix = "watch" } = options
  const prefix = pathPrefix ? `/${pathPrefix}` : ""
  const slug = series.slug ?? ""
  const pathSuffix = pathLocale ? `/${slug}/${pathLocale}` : `/${slug}`
  const url = `${SITE_BASE}${prefix}${pathSuffix}`

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
    },
    ...(series.noIndex && {
      robots: { index: false, follow: false },
    }),
    ...(fbAppId && { other: { "fb:app_id": fbAppId } }),
    alternates: {
      canonical: url,
    },
  }
}
