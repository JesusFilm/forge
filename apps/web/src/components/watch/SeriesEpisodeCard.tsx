"use client"

import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import { FolderOpen, Play } from "lucide-react"

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
import { resolveEpisodeImageUrl } from "@/lib/episode-image"
import { resolveMuxAnimatedPreviewUrl } from "@/lib/url"
import { isSeriesRecord } from "@/lib/watch-content-kind"
import {
  tryAsContentSlug,
  tryAsLocaleSlug,
  watchEpisodePath,
  watchVideoPath,
} from "@/lib/routes"
import { cn } from "@/lib/utils"

type Episodes = NonNullable<ResolvedSeriesBySlug["video"]["children"]>
type Episode = NonNullable<Episodes[number]>

type SeriesEpisodeCardProps = {
  episode: Episode
  index: number
  languageSlug: string
  parentSlug: string
  // Backdrop URL surfaced via data-backdrop-url so the parent grid can
  // delegate pointer/focus events at the container level instead of
  // attaching per-card handlers (avoids 20+ rerenders during keyboard
  // tab-through and pointer-event work per card during pan).
  backdropUrl?: string | null
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

export function SeriesEpisodeCard({
  episode,
  index,
  languageSlug,
  parentSlug,
  backdropUrl,
}: SeriesEpisodeCardProps) {
  const slug = episode.slug ? tryAsContentSlug(episode.slug) : null
  const parent = tryAsContentSlug(parentSlug)
  const lang = tryAsLocaleSlug(languageSlug)
  let href: Route | undefined
  if (slug && lang) {
    if (isSeriesRecord(episode)) {
      href = watchVideoPath(slug, lang)
    } else if (parent) {
      href = watchEpisodePath(parent, slug, lang)
    }
  }
  const thumbnailUrl = resolveEpisodeImageUrl(episode)
  const muxPreviewUrl = resolveMuxAnimatedPreviewUrl(episode.muxPlaybackId)
  const isContainer = isSeriesRecord(episode)
  const containerLabel =
    episode.label?.toLowerCase() === "collection" ? "Collection" : "Series"
  // Per-chapter runtime now arrives precomputed as a single Int
  // (admin's Video.durationSeconds — the primary playable dub's runtime)
  // rather than being derived from a per-child dub list.
  const runtimeLabel = isContainer
    ? null
    : formatRuntime(episode.durationSeconds)

  // Shared card surface. When the slug/locale is malformed (rare data bug)
  // the href is undefined, so we render a plain <div> with identical attrs
  // rather than a dead <Link>.
  const cardClassName = cn(
    "animate-card-enter relative flex aspect-video w-full overflow-hidden rounded-xl ring-1 ring-white/5 transition duration-300",
    href &&
      "group cursor-pointer hover:z-10 hover:scale-105 focus:outline-none",
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
          className="object-cover object-left-top"
        />
      ) : (
        <div className="absolute inset-0 bg-stone-800" aria-hidden="true" />
      )}
      <MuxHoverPreview
        previewUrl={href ? muxPreviewUrl : null}
        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 20vw"
        imageClassName="object-left-top"
      />

      {/* Bottom-anchored scrim. Stronger at the bottom so the EPISODE
          label and title stay legible regardless of thumbnail luminance. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent"
      />
      <WatchProgressBar videoId={episode.documentId} />
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
      ) : href || runtimeLabel ? (
        <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-black/40 px-2 py-1 text-xs font-medium text-white ring-1 ring-white/10 backdrop-blur-sm">
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
        data-backdrop-url={backdropUrl ?? ""}
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
      data-testid="series-episode-card"
      data-backdrop-url={backdropUrl ?? ""}
      className={cardClassName}
      style={cardStyle}
    >
      {cardContent}
    </Link>
  )
}
