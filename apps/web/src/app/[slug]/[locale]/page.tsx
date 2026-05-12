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

export const revalidate = 60

type PageProps = {
  params: Promise<{ slug: string; locale: string }>
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

export default async function SlugLocalePage({ params }: PageProps) {
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
    redirect(`/${slug}/${redirectSlug}`)
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
