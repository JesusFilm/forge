"use client"

import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import { FolderOpen, Play } from "lucide-react"
import { useTranslations } from "next-intl"

import {
  VideoThumbnailCaption,
  VideoThumbnailEyebrow,
  VideoThumbnailTitle,
} from "@/components/ui/video-thumbnail-caption"
import {
  VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS,
  VideoThumbnailInteractionFrame,
} from "@/components/ui/video-thumbnail-interaction-frame"
import { MuxHoverPreview } from "@/components/watch/MuxHoverPreview"
import { WatchProgressBar } from "@/components/watch/WatchProgressBar"
import type { ResolvedSeriesBySlug } from "@/lib/content"
import { resolveEpisodeThumbnail } from "@/lib/episode-image"
import { resolveMuxAnimatedPreviewUrl } from "@/lib/url"
import { isSeriesRecord } from "@/lib/watch-content-kind"
import {
  tryAsContentSlug,
  tryAsLocaleSlug,
  watchEpisodePath,
  watchVideoPath,
  watchUnavailableLanguagePath,
} from "@/lib/routes"
import { cn } from "@/lib/utils"

type Episodes = NonNullable<ResolvedSeriesBySlug["video"]["children"]>
type Episode = NonNullable<Episodes[number]>

type SeriesEpisodeCardProps = {
  episode: Episode
  index: number
  languageSlug: string
  parentSlug: string
  unavailable?: boolean
  requestedLanguageName?: string
}

// Production-style duration label: "M:SS" or "H:MM:SS". Returns null when
// the chapter doesn't carry a usable duration so the pill collapses to
// the play icon alone (still affordant) rather than rendering "0:00".
function formatRuntime(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad2 = (n: number) => n.toString().padStart(2, "0")
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`
}

function UnavailableSeriesLanguageBadge({
  requestedLanguageName,
}: {
  requestedLanguageName?: string
}) {
  const t = useTranslations("LanguagePickerModal")
  return (
    <span
      data-testid="series-card-availability-badge"
      className="absolute top-3 left-3 z-30 inline-flex max-w-[calc(100%-1.5rem)] rounded-md bg-stone-100/95 px-2.5 py-1 text-xs leading-4 font-semibold text-stone-950 sm:text-[11px] shadow-lg ring-1 ring-black/20 backdrop-blur-sm"
    >
      <span className="truncate">
        <span>{t("notAvailable")}</span>
        {requestedLanguageName ? (
          <>
            <span aria-hidden="true"> · </span>
            <bdi dir="auto">{requestedLanguageName}</bdi>
          </>
        ) : null}
      </span>
    </span>
  )
}

export function SeriesEpisodeCard({
  episode,
  index,
  languageSlug,
  parentSlug,
  unavailable = false,
  requestedLanguageName,
}: SeriesEpisodeCardProps) {
  const isContainer = isSeriesRecord(episode)
  const isUnavailable = unavailable && !isContainer
  const slug = episode.slug ? tryAsContentSlug(episode.slug) : null
  const parent = tryAsContentSlug(parentSlug)
  const lang = tryAsLocaleSlug(languageSlug)
  let href: Route | undefined
  if (slug && lang) {
    if (isUnavailable) {
      href = watchUnavailableLanguagePath(slug, lang)
    } else if (isContainer) {
      href = watchVideoPath(slug, lang)
    } else if (parent) {
      href = watchEpisodePath(parent, slug, lang)
    }
  }
  const { url: thumbnailUrl, blurDataUrl } = resolveEpisodeThumbnail(
    isUnavailable ? { ...episode, muxPlaybackId: null } : episode,
  )
  const muxPreviewUrl = isUnavailable
    ? null
    : resolveMuxAnimatedPreviewUrl(episode.muxPlaybackId)
  const containerLabel =
    episode.label?.toLowerCase() === "collection" ? "Collection" : "Series"
  // Per-chapter runtime now arrives precomputed as a single Int
  // (admin's Video.durationSeconds — the primary playable dub's runtime)
  // rather than being derived from a per-child dub list.
  const runtimeLabel =
    isContainer || isUnavailable ? null : formatRuntime(episode.durationSeconds)

  // Shared card surface. When the slug/locale is malformed (rare data bug)
  // the href is undefined, so we render a plain <div> with identical attrs
  // rather than a dead <Link>.
  const cardClassName = cn(
    "animate-card-enter relative flex aspect-video w-full overflow-hidden rounded-xl ring-1 ring-white/5 transition duration-300",
    href && "group cursor-pointer focus:outline-none",
    href && !isUnavailable && "hover:z-10 hover:scale-105",
    href && VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS,
  )
  const cardStyle = { animationDelay: `${index * 40}ms` }

  const cardContent = (
    <>
      {thumbnailUrl ? (
        <Image
          src={thumbnailUrl}
          alt={episode.title ?? `Episode ${index + 1} thumbnail`}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 20vw"
          className={cn(
            "object-cover object-left-top",
            isUnavailable && "opacity-40",
          )}
          {...(blurDataUrl
            ? { placeholder: "blur" as const, blurDataURL: blurDataUrl }
            : {})}
        />
      ) : (
        <div className="absolute inset-0 bg-stone-800" aria-hidden="true" />
      )}
      {!isUnavailable ? (
        <MuxHoverPreview
          previewUrl={href ? muxPreviewUrl : null}
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 20vw"
          imageClassName="object-left-top"
        />
      ) : null}

      {/* Bottom-anchored scrim. Stronger at the bottom so the EPISODE
          label and title stay legible regardless of thumbnail luminance. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent"
      />
      {!isUnavailable ? (
        <WatchProgressBar videoId={episode.documentId} />
      ) : null}
      {isUnavailable ? (
        <UnavailableSeriesLanguageBadge
          requestedLanguageName={requestedLanguageName}
        />
      ) : null}
      {href ? (
        <VideoThumbnailInteractionFrame data-testid="series-episode-card-hover-outline" />
      ) : null}

      {/* Container cards open another Watch surface; chapters retain their
          playback/runtime indicator. Static fallbacks never show a play
          affordance or a fake zero runtime. */}
      {isContainer && href ? (
        <div className="absolute top-2 right-2 rounded-full bg-black/40 p-1.5 text-white ring-1 ring-white/10 backdrop-blur-sm">
          <FolderOpen
            size={14}
            aria-label={`Open ${containerLabel.toLowerCase()}`}
          />
        </div>
      ) : !isUnavailable && (href || runtimeLabel) ? (
        <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-black/40 px-2 py-1 text-sm sm:text-xs font-medium text-white ring-1 ring-white/10 backdrop-blur-sm">
          {href ? (
            <Play size={12} className="fill-white" strokeWidth={0} />
          ) : null}
          {runtimeLabel ? <span>{runtimeLabel}</span> : null}
        </div>
      ) : null}

      {/* Bottom-left text block — EPISODE eyebrow + episode title. */}
      <VideoThumbnailCaption inset="compact">
        <VideoThumbnailEyebrow size="compact">
          {isContainer ? containerLabel : `Episode ${index + 1}`}
        </VideoThumbnailEyebrow>
        <VideoThumbnailTitle size="compact-md">
          {episode.title ?? ""}
        </VideoThumbnailTitle>
      </VideoThumbnailCaption>
    </>
  )

  if (!href) {
    return (
      <div
        data-testid="series-episode-card"
        className={cardClassName}
        style={cardStyle}
      >
        {cardContent}
      </div>
    )
  }

  return (
    <Link
      href={href}
      prefetch={isUnavailable ? false : undefined}
      data-testid="series-episode-card"
      className={cardClassName}
      style={cardStyle}
    >
      {cardContent}
    </Link>
  )
}
