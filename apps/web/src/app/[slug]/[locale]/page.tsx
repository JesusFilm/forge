import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { isLocale, DEFAULT_LOCALE } from "@/lib/locale"
import {
  isWatchPageMissingError,
  resolveWatchPage,
  resolveWatchVideoBySlug,
  mergeWatchExperience,
} from "@/lib/content"
import { getWatchPageMetadata } from "@/lib/experience-metadata"
import {
  readPreferredLanguageSlug,
  shouldRedirectForPreference,
} from "@/lib/language-preference-server"
import { SectionRenderer, type Section } from "@/components/sections"
import { ExperienceEmpty } from "@/components/ExperienceEmpty"
import { ExperienceError } from "@/components/ExperienceError"
import { WatchPageClient } from "@/components/watch/WatchPageClient"

// NOTE: this route reads a request cookie below (forge_watch_lang via
// readPreferredLanguageSlug). Calling cookies() in a Server Component opts
// the route into dynamic rendering, so this `revalidate = 60` declaration
// is currently inert — every GET is a fresh server render. Tracked as a
// follow-up to move the redirect logic to apps/web/src/proxy.ts so the
// page can stay ISR-cached. See docs/solutions/web/nextjs-headers-defeats-route-cache.md.
export const revalidate = 60

function serializeSearchParams(
  searchParams: Record<string, string | string[] | undefined>,
): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    if (value == null) continue
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, v)
    } else {
      params.set(key, value)
    }
  }
  const serialized = params.toString()
  return serialized ? `?${serialized}` : ""
}

type PageProps = {
  params: Promise<{ slug: string; locale: string }>
  searchParams: Promise<{
    [key: string]: string | string[] | undefined
  }>
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug, locale: rawLocale } = await params
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE

  return getWatchPageMetadata(locale, {
    slug,
    pathLocale: rawLocale,
    pathPrefix: "watch",
  })
}

export default async function SlugLocalePage({
  params,
  searchParams,
}: PageProps) {
  const { slug, locale: rawLocale } = await params
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE

  // Video-by-slug first — bypasses resolveWatchPage's Watch Settings +
  // default template dependency, which isn't always present in dev.
  const watchVideo = await resolveWatchVideoBySlug(slug, locale)

  const preferredSlug = await readPreferredLanguageSlug()
  const redirectSlug = shouldRedirectForPreference({
    preferredSlug,
    rawLocale,
    variants: watchVideo?.video.variants ?? [],
  })
  if (redirectSlug) {
    // basePath '/watch' is auto-prepended at runtime; do NOT include here.
    // Forward the incoming searchParams so deep links like ?t=120 survive
    // the cookie-driven redirect — the client Apply handler preserves ?t=
    // for the same reason.
    const queryString = serializeSearchParams(await searchParams)
    redirect(`/${slug}/${redirectSlug}${queryString}`)
  }

  if (watchVideo) {
    const mergedBlocks = mergeWatchExperience({
      video: watchVideo.video,
      variant: watchVideo.selectedVariant,
      canonicalParent: watchVideo.canonicalParent,
    })
    return (
      <WatchPageClient
        mergedBlocks={mergedBlocks}
        variant={watchVideo.selectedVariant}
        video={watchVideo.video}
        languageSlug={watchVideo.selectedVariant.language?.slug ?? rawLocale}
        locale={locale}
      />
    )
  }

  const result = await resolveWatchPage(locale, slug)

  if (result.error) {
    if (isWatchPageMissingError(result.error)) {
      return <ExperienceEmpty />
    }
    return <ExperienceError message={result.error.message} />
  }

  const page = result.data
  const experienceLike =
    page.kind === "experience" ? page.experience : page.template
  // Required on video-template branch so blocks (MediaCollection, VideoHero,
  // Video, Container) get the video record.
  const routeVideo = page.kind === "video-template" ? page.routeVideo : null
  const blocks = (experienceLike.blocks ?? []).filter(
    (b): b is Section => b !== null && b.__typename !== "Error",
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
          <SectionRenderer key={key} section={block} routeVideo={routeVideo} />
        )
      })}
    </main>
  )
}
