import type { Metadata } from "next"
import { setRequestLocale } from "next-intl/server"
import { hasUiLocale } from "@/i18n/locales"
import { DEFAULT_LOCALE, isLocale } from "@/lib/locale"
import { isWatchPageMissingError, resolveWatchPage } from "@/lib/content"
import { getWatchPageMetadata } from "@/lib/experience-metadata"
import { stripHtmlSuffix } from "@/lib/url-shape"
import { ExperienceSectionRenderer, type Section } from "@/components/sections"
import { ExperienceEmpty } from "@/components/ExperienceEmpty"
import { ExperienceError } from "@/components/ExperienceError"

export const revalidate = 60

type PageProps = {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug: rawSlug } = await params
  // Accept both legacy bare slugs (`/watch/jesus`) and the production
  // `.html` shape (`/watch/jesus.html`). The `.html` suffix is part of
  // the public URL contract; routing logic operates on the stripped slug.
  const slug = stripHtmlSuffix(rawSlug)

  // If slug is a locale (e.g. /watch/en or /watch/en.html), let the
  // homepage handle metadata.
  if (isLocale(slug)) return {}

  return getWatchPageMetadata(DEFAULT_LOCALE, { slug })
}

export default async function SlugPage({ params }: PageProps) {
  const { slug: rawSlug } = await params
  const slug = stripHtmlSuffix(rawSlug)

  const locale = isLocale(slug) ? slug : DEFAULT_LOCALE
  setRequestLocale(hasUiLocale(locale) ? locale : DEFAULT_LOCALE)

  const result = await resolveWatchPage(
    locale,
    isLocale(slug) ? undefined : slug,
  )

  if (result.error) {
    if (isWatchPageMissingError(result.error)) {
      return <ExperienceEmpty />
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
