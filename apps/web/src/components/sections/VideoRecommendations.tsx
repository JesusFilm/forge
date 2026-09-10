import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import { useCallback, type MouseEvent } from "react"
import { useTranslations } from "next-intl"
import {
  VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS,
  VideoThumbnailInteractionFrame,
} from "@/components/ui/video-thumbnail-interaction-frame"
import { MuxHoverPreview } from "@/components/watch/MuxHoverPreview"
import type { SceneRecommendation } from "@/lib/recommendations"
import { formatDuration } from "@/lib/format-duration"
import { resolveMuxAnimatedPreviewUrl } from "@/lib/url"
import { cn } from "@/lib/utils"

type VideoRecommendationsProps<T extends SceneRecommendation> = {
  recommendations: T[]
  locale: string
  hrefBuilder?: (rec: T, locale: string) => Route
  recommendationKey?: (rec: T) => string
  onRecommendationSelect?: (
    rec: T,
    event: MouseEvent<HTMLAnchorElement>,
  ) => void
  onRecommendationCardElement?: (
    rec: T,
    element: HTMLAnchorElement | null,
  ) => void
  busyRecommendationKey?: string | null
  showRankingMetadata?: boolean
  recommendationTimeMode?: "scene-start" | "video-duration"
}

const defaultHrefBuilder = (rec: SceneRecommendation, locale: string): Route =>
  `/demo-recommendations/${rec.videoSlug}/${locale}` as Route

function SimilarityBadge({ similarity }: { similarity: number }) {
  const t = useTranslations("VideoRecommendations")
  const pct = Math.round(similarity * 100)
  return (
    <span className="rounded-full bg-white/15 px-2 py-0.5 text-sm sm:text-xs font-medium text-white/80">
      {t("match", { percent: pct })}
    </span>
  )
}

function ThemePill({ theme }: { theme: string }) {
  return (
    <span className="rounded-full bg-brand-red/40 px-2 py-0.5 text-sm sm:text-xs text-brand-red/80">
      {theme}
    </span>
  )
}

function RecommendationCard<T extends SceneRecommendation>({
  rec,
  locale,
  hrefBuilder,
  itemKey,
  onSelect,
  onCardElement,
  busy,
  showRankingMetadata,
  recommendationTimeMode,
}: {
  rec: T
  locale: string
  hrefBuilder: (rec: T, locale: string) => Route
  itemKey: string
  onSelect?: (rec: T, event: MouseEvent<HTMLAnchorElement>) => void
  onCardElement?: (rec: T, element: HTMLAnchorElement | null) => void
  busy: boolean
  showRankingMetadata: boolean
  recommendationTimeMode: "scene-start" | "video-duration"
}) {
  const searchT = useTranslations("SearchResultCard")
  const themes = showRankingMetadata ? rec.themes.slice(0, 3) : []
  const muxPreviewUrl = resolveMuxAnimatedPreviewUrl(rec.playbackId)
  const recommendationTimeSeconds =
    recommendationTimeMode === "video-duration"
      ? rec.durationSeconds
      : rec.startSeconds
  const cardRef = useCallback(
    (element: HTMLAnchorElement | null) => onCardElement?.(rec, element),
    [onCardElement, rec],
  )

  return (
    <Link
      ref={cardRef}
      href={hrefBuilder(rec, locale)}
      onClick={(event) => onSelect?.(rec, event)}
      aria-busy={busy || undefined}
      aria-label={busy ? `Opening ${rec.videoTitle}` : undefined}
      data-recommendation-key={itemKey}
      className={cn(
        "group flex flex-col overflow-hidden rounded-lg bg-stone-800 transition hover:bg-stone-700",
        VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS,
      )}
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
            {searchT("thumbnailAlt")}
          </div>
        )}
        <MuxHoverPreview
          previewUrl={muxPreviewUrl}
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
        />
        {recommendationTimeSeconds != null &&
        (recommendationTimeMode === "scene-start" ||
          recommendationTimeSeconds > 0) ? (
          <div
            data-testid="video-recommendation-duration"
            className="absolute right-2 bottom-2 rounded bg-black/70 px-1.5 py-0.5 text-sm sm:text-xs text-white/80"
          >
            {formatDuration(recommendationTimeSeconds)}
          </div>
        ) : null}
        <VideoThumbnailInteractionFrame data-testid="video-recommendation-thumbnail-frame" />
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <h3 className="flex-1 truncate text-base sm:text-sm font-semibold text-white">
            {rec.videoTitle}
          </h3>
          {showRankingMetadata ? (
            <SimilarityBadge similarity={rec.similarity} />
          ) : null}
        </div>

        <p className="line-clamp-2 text-sm sm:text-xs leading-relaxed text-stone-300">
          {rec.description}
        </p>

        {showRankingMetadata && themes.length > 0 && (
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

export function VideoRecommendations<T extends SceneRecommendation>({
  recommendations,
  locale,
  hrefBuilder = defaultHrefBuilder,
  recommendationKey = (rec) => `${rec.videoId}-${rec.sceneIndex}`,
  onRecommendationSelect,
  onRecommendationCardElement,
  busyRecommendationKey = null,
  showRankingMetadata = true,
  recommendationTimeMode = "scene-start",
}: VideoRecommendationsProps<T>) {
  const t = useTranslations("VideoRecommendations")
  if (recommendations.length === 0) {
    return <div className="py-12 text-center text-stone-400">{t("none")}</div>
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {recommendations.map((rec) => {
        const itemKey = recommendationKey(rec)
        return (
          <RecommendationCard
            key={itemKey}
            rec={rec}
            locale={locale}
            hrefBuilder={hrefBuilder}
            itemKey={itemKey}
            onSelect={onRecommendationSelect}
            onCardElement={onRecommendationCardElement}
            busy={busyRecommendationKey === itemKey}
            showRankingMetadata={showRankingMetadata}
            recommendationTimeMode={recommendationTimeMode}
          />
        )
      })}
    </div>
  )
}
