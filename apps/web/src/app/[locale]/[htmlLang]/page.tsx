import type { Metadata } from "next"
import { setRequestLocale } from "next-intl/server"
import { resolveWatchLocaleIdentity } from "@/lib/locale"
import { isWatchPageMissingError, resolveWatchPage } from "@/lib/content"
import { getWatchPageMetadata } from "@/lib/experience-metadata"
import { ExperienceSectionRenderer, type Section } from "@/components/sections"
import { ExperienceEmpty } from "@/components/ExperienceEmpty"
import { ExperienceError } from "@/components/ExperienceError"
import { WatchHomePage } from "@/components/watch-home/WatchHomePage"
import { DEFAULT_WATCH_HOME_LANGUAGE_SLUG } from "@/lib/watch-home-carousel-config"
import { resolveWatchHomeCarousel } from "@/lib/watch-home-carousel"

export const revalidate = 60
export const dynamic = "force-static"
export const dynamicParams = true

export function generateStaticParams(): Array<{
  locale: string
  htmlLang: string
}> {
  return []
}

type PageProps = {
  params: Promise<{ locale: string; htmlLang: string }>
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale: rawLocale } = await params
  const { locale } = resolveWatchLocaleIdentity(rawLocale)
  setRequestLocale(locale)
  return getWatchPageMetadata(locale)
}

async function resolveOptionalWatchHomeCarousel(locale: string) {
  try {
    return await resolveWatchHomeCarousel(
      locale,
      DEFAULT_WATCH_HOME_LANGUAGE_SLUG,
    )
  } catch (error) {
    console.error("[watch-home] failed to resolve carousel", error)
    return null
  }
}

export default async function HomePage({ params }: PageProps) {
  const { locale: rawLocale } = await params
  const { locale } = resolveWatchLocaleIdentity(rawLocale)
  setRequestLocale(locale)
  const [result, carousel] = await Promise.all([
    resolveWatchPage(locale),
    resolveOptionalWatchHomeCarousel(locale),
  ])

  if (result.error && !carousel?.slides.length) {
    if (isWatchPageMissingError(result.error)) {
      return <ExperienceEmpty />
    }
    return <ExperienceError message={result.error.message} />
  }

  const page = result.data
  const experience =
    page?.kind === "video-template" ? page.template : (page?.experience ?? null)
  const routeVideo = page?.kind === "video-template" ? page.routeVideo : null
  if (!carousel?.slides.length && !experience?.blocks?.length) {
    return <ExperienceEmpty />
  }
  const blocks = (experience?.blocks ?? []).filter(
    (b): b is Section => b !== null,
  )

  if (carousel?.slides.length) {
    return (
      <WatchHomePage
        carousel={carousel}
        blocks={blocks}
        routeVideo={routeVideo}
      />
    )
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
