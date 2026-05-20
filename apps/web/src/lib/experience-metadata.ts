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
  const title = cms?.title ?? fallbackTitle
  const description =
    cms?.description ??
    "Watch the Jesus Film Project's library of free films and short videos exploring the life and teachings of Jesus, available in thousands of languages."
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
    robots: series.noIndex
      ? { index: false, follow: false }
      : { index: true, follow: true },
    ...(fbAppId && { other: { "fb:app_id": fbAppId } }),
    alternates: {
      canonical: url,
    },
  }
}
