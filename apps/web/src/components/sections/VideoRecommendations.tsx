import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import { MuxHoverPreview } from "@/components/watch/MuxHoverPreview"
import type { SceneRecommendation } from "@/lib/recommendations"
import { resolveMuxAnimatedPreviewUrl } from "@/lib/url"

type VideoRecommendationsProps = {
  recommendations: SceneRecommendation[]
  locale: string
  hrefBuilder?: (rec: SceneRecommendation, locale: string) => Route
}

const defaultHrefBuilder = (rec: SceneRecommendation, locale: string): Route =>
  `/demo-recommendations/${rec.videoSlug}/${locale}` as Route

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

function SimilarityBadge({ similarity }: { similarity: number }) {
  const pct = Math.round(similarity * 100)
  return (
    <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs font-medium text-white/80">
      {pct}% match
    </span>
  )
}

function ThemePill({ theme }: { theme: string }) {
  return (
    <span className="rounded-full bg-brand-red/40 px-2 py-0.5 text-xs text-brand-red/80">
      {theme}
    </span>
  )
}

function RecommendationCard({
  rec,
  locale,
  hrefBuilder,
}: {
  rec: SceneRecommendation
  locale: string
  hrefBuilder: (rec: SceneRecommendation, locale: string) => Route
}) {
  const themes = rec.themes.slice(0, 3)
  const muxPreviewUrl = resolveMuxAnimatedPreviewUrl(rec.playbackId)

  return (
    <Link
      href={hrefBuilder(rec, locale)}
      className="group flex flex-col overflow-hidden rounded-lg bg-stone-800 transition hover:bg-stone-700"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-stone-900">
        {rec.imageUrl ? (
          <Image
            src={rec.imageUrl}
            alt={`${rec.videoTitle} — ${rec.description.slice(0, 60)}`}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover transition group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-stone-600">
            No image
          </div>
        )}
        <MuxHoverPreview
          previewUrl={muxPreviewUrl}
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
        />
        <div className="absolute right-2 bottom-2 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white/80">
          {formatTimestamp(rec.startSeconds)}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <h3 className="flex-1 truncate text-sm font-semibold text-white">
            {rec.videoTitle}
          </h3>
          <SimilarityBadge similarity={rec.similarity} />
        </div>

        <p className="line-clamp-2 text-xs leading-relaxed text-stone-300">
          {rec.description}
        </p>

        {themes.length > 0 && (
          <div className="mt-auto flex flex-wrap gap-1">
            {themes.map((theme) => (
              <ThemePill key={theme} theme={theme} />
            ))}
          </div>
        )}
      </div>
    </Link>
  )
}

export function VideoRecommendations({
  recommendations,
  locale,
  hrefBuilder = defaultHrefBuilder,
}: VideoRecommendationsProps) {
  if (recommendations.length === 0) {
    return (
      <div className="py-12 text-center text-stone-400">
        No recommendations found for this video in this locale.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {recommendations.map((rec) => (
        <RecommendationCard
          key={`${rec.videoId}-${rec.sceneIndex}`}
          rec={rec}
          locale={locale}
          hrefBuilder={hrefBuilder}
        />
      ))}
    </div>
  )
}
