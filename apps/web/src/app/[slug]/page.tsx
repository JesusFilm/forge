import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { setRequestLocale } from "next-intl/server"
import { hasUiLocale } from "@/i18n/locales"
import { DEFAULT_LOCALE, isLocale } from "@/lib/locale"
import { isWatchPageMissingError, resolveWatchPage } from "@/lib/content"
import { getWatchPageMetadata } from "@/lib/experience-metadata"
import { SAFE_SLUG_PATTERN, stripHtmlSuffix } from "@/lib/url-shape"
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

  // Guard B — a single-segment CONTENT slug (not a bcp47 localized-home)
  // must be a lowercase-ASCII kebab slug. Rejects uppercase + empty
  // (`/watch/.html`) so they 404 instead of rendering a fallback 200.
  if (!isLocale(slug) && (!slug || !SAFE_SLUG_PATTERN.test(slug))) notFound()

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
  // Guard C — a single VIDEO resolved at the 1-segment shape must 404: the
  // canonical video URL requires a locale (`/watch/jesus.html/english.html`),
  // so `/watch/jesus.html` (single-video, missing locale) is a §5.6 404.
  // Collections/experiences resolve as `kind: "experience"` and localized
  // homes take the `isLocale(slug)` branch (slug undefined) — both unaffected.
  if (page?.kind === "video-template") notFound()
  // Past guard C the only remaining kind is "experience" (collections +
  // localized homes). Single-video routeVideo never renders at 1-segment.
  const experience = page?.kind === "experience" ? page.experience : null
  const routeVideo = null
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
