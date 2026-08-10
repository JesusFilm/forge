import type { Metadata } from "next"
import type { Route } from "next"
import Image from "next/image"
import Link from "next/link"
import { resolveVideoDisplayTitle } from "@forge/content-display"
import { isLocale, DEFAULT_LOCALE } from "@/lib/locale"
import { getSceneRecommendations, getVideoBySlug } from "@/lib/recommendations"
import { VideoRecommendations } from "@/components/sections/VideoRecommendations"

export const revalidate = 60

type PageProps = {
  params: Promise<{ slug: string; locale: string }>
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug, locale: rawLocale } = await params
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const video = await getVideoBySlug(slug, locale)
  const displayTitle = resolveVideoDisplayTitle({
    requestedTitles: [video?.title],
    slug: video?.slug ?? slug,
  })
  const title = displayTitle
    ? `Recommendations: ${displayTitle}`
    : "Recommendations Demo"

  return {
    title,
    description: `Scene-based recommendations for ${displayTitle ?? "this video"}`,
  }
}

function LocaleToggle({
  slug,
  currentLocale,
}: {
  slug: string
  currentLocale: string
}) {
  const demoLocales = ["en", "es", "fr"] as const

  return (
    <nav className="flex gap-2" aria-label="Language">
      {demoLocales.map((loc) => (
        <Link
          key={loc}
          href={`/demo-recommendations/${slug}/${loc}` as Route}
          className={`rounded-full px-4 py-1.5 text-sm font-medium uppercase transition ${
            loc === currentLocale
              ? "bg-white text-stone-900"
              : "bg-stone-700 text-stone-300 hover:bg-stone-600"
          }`}
        >
          {loc}
        </Link>
      ))}
    </nav>
  )
}

function VideoHeroSection({
  title,
  description,
  imageUrl,
}: {
  title: string
  description: string | null
  imageUrl: string | null
}) {
  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-center">
      {imageUrl && (
        <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-stone-800 md:w-1/2">
          <Image
            src={imageUrl}
            alt={title}
            fill
            sizes="(max-width: 768px) 100vw, 50vw"
            className="object-cover"
            priority
          />
        </div>
      )}
      <div className={imageUrl ? "md:w-1/2" : "w-full"}>
        <h1 className="text-3xl font-bold text-white md:text-4xl">{title}</h1>
        {description && (
          <p className="mt-3 text-lg leading-relaxed text-stone-300">
            {description}
          </p>
        )}
      </div>
    </div>
  )
}

export default async function DemoRecommendationsPage({ params }: PageProps) {
  const { slug, locale: rawLocale } = await params
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE

  const [video, recommendations] = await Promise.all([
    getVideoBySlug(slug, locale),
    getSceneRecommendations(slug, locale, 10),
  ])

  if (!video) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-900">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white">Video not found</h1>
          <p className="mt-2 text-stone-400">
            No published video found for slug &ldquo;{slug}&rdquo;
          </p>
        </div>
      </main>
    )
  }

  const imageUrl =
    video.images?.[0]?.mobileCinematicHigh ?? video.images?.[0]?.url ?? null
  const displayTitle =
    resolveVideoDisplayTitle({
      requestedTitles: [video.title],
      slug: video.slug ?? slug,
    }) ?? "Video"

  return (
    <main className="min-h-screen bg-stone-900">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8 lg:px-10">
        <div className="mb-8 flex items-center justify-between">
          <span className="text-sm font-medium tracking-wider text-stone-500 uppercase">
            Recommendations Demo
          </span>
          <LocaleToggle slug={slug} currentLocale={locale} />
        </div>

        <VideoHeroSection
          title={displayTitle}
          description={video.description ?? null}
          imageUrl={imageUrl}
        />

        <div className="mt-10">
          <h2 className="mb-6 text-xl font-semibold text-white">
            Similar Scenes
            <span className="ml-2 text-sm font-normal text-stone-400">
              ({recommendations.length} results)
            </span>
          </h2>
          <VideoRecommendations
            recommendations={recommendations}
            locale={locale}
          />
        </div>
      </div>
    </main>
  )
}
