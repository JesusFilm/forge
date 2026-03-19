/**
 * SEO and social metadata for experience pages ([slug] and [slug]/[locale]).
 * Uses CMS (Strapi Experience) data via experienceToMetadata; minimal fallback when no CMS data.
 */

import { cacheLife, cacheTag } from "next/cache"
import type { Metadata } from "next"
import { getWatchExperience, experienceToMetadata } from "@/lib/content"
import { getSocialConfig } from "@/lib/social-config"

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

/** Builds Next.js Metadata for an experience by slug (e.g. /watch/[slug] and /watch/[slug]/[locale]). */
export async function getExperienceMetadata(
  locale: string,
  slug: string,
  options?: { pathLocale?: string; pathPrefix?: string },
): Promise<Metadata> {
  "use cache"
  cacheTag("experience", `experience:${slug}`, `experience:${slug}:${locale}`)
  cacheLife("max")

  const result = await getWatchExperience(locale, slug)
  const cms = result.data ? experienceToMetadata(result.data) : null

  const title = cms?.title ?? `${slug} ${TITLE_SUFFIX}`
  const description = cms?.description ?? ""
  const ogTitle = cms?.ogTitle ?? title
  const ogDescription = cms?.ogDescription ?? description

  const prefix = options?.pathPrefix ? `/${options.pathPrefix}` : ""
  const canonicalPath = options?.pathLocale
    ? `${prefix}/${slug}/${options.pathLocale}`
    : `${prefix}/${slug}`
  const url = `${SITE_BASE}${canonicalPath}`

  const { fbAppId } = getSocialConfig()
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
