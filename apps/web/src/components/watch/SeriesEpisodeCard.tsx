"use client"

import Image from "next/image"
import Link from "next/link"
import { Play } from "lucide-react"

import type { ResolvedSeriesBySlug } from "@/lib/content"
import { resolveEpisodeImageUrl } from "@/lib/episode-image"
import { tryAsContentSlug, tryAsLocaleSlug, watchVideoPath } from "@/lib/routes"

type Episodes = NonNullable<ResolvedSeriesBySlug["video"]["children"]>
type Episode = NonNullable<Episodes[number]>

type SeriesEpisodeCardProps = {
  episode: Episode
  index: number
  locale: string
  // Backdrop URL surfaced via data-backdrop-url so the parent grid can
  // delegate pointer/focus events at the container level instead of
  // attaching per-card handlers (avoids 20+ rerenders during keyboard
  // tab-through and pointer-event work per card during pan).
  backdropUrl?: string | null
}

// Production-style duration label: "M:SS" or "H:MM:SS". Returns null when
// the variant doesn't carry a usable duration so the pill collapses to
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

// Pick the first playable variant's duration. Across languages a video's
// runtime is functionally identical, so locale-matching here would buy
// nothing but more conditionals. Skip unpublished or HLS-less variants
// so the pill never reflects an editor-orphaned record.
function pickRuntimeSeconds(episode: Episode): number | null {
  for (const variant of episode.variants ?? []) {
    if (!variant) continue
    if (variant.published !== true) continue
    if (!variant.hls) continue
    if (typeof variant.duration === "number" && variant.duration > 0) {
      return variant.duration
    }
  }
  return null
}

export function SeriesEpisodeCard({
  episode,
  index,
  locale,
  backdropUrl,
}: SeriesEpisodeCardProps) {
  const slug = episode.slug ? tryAsContentSlug(episode.slug) : null
  const lang = tryAsLocaleSlug(locale)
  // Episodes link as standalone videos: canonical two-segment shape.
  const href = slug && lang ? watchVideoPath(slug, lang) : undefined
  const thumbnailUrl = resolveEpisodeImageUrl(episode)
  const runtimeLabel = formatRuntime(pickRuntimeSeconds(episode))

  // Shared card surface. When the slug/locale is malformed (rare data bug)
  // the href is undefined, so we render a plain <div> with identical attrs
  // rather than a dead <Link>.
  const cardClassName =
    "group animate-card-enter relative flex aspect-video w-full cursor-pointer overflow-hidden rounded-xl ring-1 ring-white/5 transition duration-300 hover:z-10 hover:scale-105 hover:ring-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
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

      {/* Bottom-anchored scrim. Stronger at the bottom so the EPISODE
          label and title stay legible regardless of thumbnail luminance. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent"
      />

      {/* Top-right runtime pill. Icon-only when no duration is available
          (still affordant as a "play" hint) — the label collapses rather
          than showing a fake zero runtime. */}
      <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-black/40 px-2 py-1 text-xs font-medium text-white ring-1 ring-white/10 backdrop-blur-sm">
        <Play size={12} className="fill-white" strokeWidth={0} />
        {runtimeLabel ? <span>{runtimeLabel}</span> : null}
      </div>

      {/* Bottom-left text block — EPISODE eyebrow + episode title. */}
      <div className="absolute right-3 bottom-3 left-3 flex flex-col gap-1">
        <span className="text-[10px] font-semibold tracking-[0.18em] text-stone-300/90 uppercase">
          {`Episode ${index + 1}`}
        </span>
        <h3 className="line-clamp-2 text-sm leading-snug font-semibold text-white drop-shadow-md md:text-base">
          {episode.title ?? ""}
        </h3>
      </div>
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
