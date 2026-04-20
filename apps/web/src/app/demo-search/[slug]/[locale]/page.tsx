import type { Metadata } from "next"
import type { Route } from "next"
import Image from "next/image"
import Link from "next/link"
import { DEFAULT_LOCALE, isLocale } from "@/lib/locale"
import { getDemoPlayableVideo } from "@/lib/demo-search"
import { getSceneRecommendations } from "@/lib/recommendations"
import { VideoPlayer } from "@/components/sections/Video"
import { VideoRecommendations } from "@/components/sections/VideoRecommendations"
import type { SceneRecommendation } from "@/lib/recommendations"

export const revalidate = 60

type PageProps = {
  params: Promise<{ slug: string; locale: string }>
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug, locale: rawLocale } = await params
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const video = await getDemoPlayableVideo(slug, locale)
  return {
    title: video?.title ? `Demo: ${video.title}` : "Semantic search demo",
    description: "Semantic search demo — watch + scene-based recommendations.",
    robots: { index: false, follow: false },
  }
}

const demoHrefBuilder = (rec: SceneRecommendation, locale: string): Route =>
  `/demo-search/${rec.videoSlug}/${locale}` as Route

export default async function DemoSearchWatchPage({ params }: PageProps) {
  const { slug, locale: rawLocale } = await params
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE

  const [video, recommendations] = await Promise.all([
    getDemoPlayableVideo(slug, locale),
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
          <Link
            href={"/demo-search" as Route}
            className="mt-6 inline-block rounded-lg bg-stone-800 px-6 py-3 text-sm font-medium text-stone-200 transition hover:bg-stone-700"
          >
            ← Back to search
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-stone-900">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8 lg:px-10">
        <div className="mb-6 flex items-center justify-between">
          <Link
            href={"/demo-search" as Route}
            className="text-sm text-stone-400 hover:text-stone-200"
          >
            ← Back to search
          </Link>
          <span className="text-xs font-medium tracking-wider text-stone-500 uppercase">
            Demo player
          </span>
        </div>

        <h1 className="text-3xl font-bold text-white md:text-4xl">
          {video.title}
        </h1>
        {video.description && (
          <p className="mt-3 max-w-3xl text-base leading-relaxed text-stone-300">
            {video.description}
          </p>
        )}

        <div className="mt-6">
          {video.streamingUrl ? (
            <VideoPlayer
              src={video.streamingUrl}
              poster={video.posterUrl ?? undefined}
            />
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-lg bg-stone-800 text-center">
              <div>
                {video.imageUrl && (
                  <div className="relative mx-auto mb-4 aspect-video w-full max-w-2xl overflow-hidden rounded-lg bg-stone-900">
                    <Image
                      src={video.imageUrl}
                      alt={video.title}
                      fill
                      sizes="(max-width: 1024px) 100vw, 66vw"
                      className="object-cover"
                      priority
                    />
                  </div>
                )}
                <p className="text-stone-400">
                  No playable variant available for this locale.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="mt-12">
          <h2 className="mb-6 text-xl font-semibold text-white">
            Similar scenes{" "}
            <span className="ml-2 text-sm font-normal text-stone-400">
              ({recommendations.length} results)
            </span>
          </h2>
          <VideoRecommendations
            recommendations={recommendations}
            locale={locale}
            hrefBuilder={demoHrefBuilder}
          />
        </div>
      </div>
    </main>
  )
}
