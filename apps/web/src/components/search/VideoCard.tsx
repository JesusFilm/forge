import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import { useTranslations } from "next-intl"
import { Play } from "lucide-react"
import type { MouseEvent as ReactMouseEvent } from "react"
import {
  VideoThumbnailCaption,
  VideoThumbnailDescription,
  VideoThumbnailEyebrow,
  VideoThumbnailTitle,
} from "@/components/ui/video-thumbnail-caption"
import {
  VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS,
  VideoThumbnailInteractionFrame,
} from "@/components/ui/video-thumbnail-interaction-frame"
import { MuxHoverPreview } from "@/components/watch/MuxHoverPreview"
import { WatchProgressBar } from "@/components/watch/WatchProgressBar"
import { formatDuration } from "@/lib/format-duration"
import { isSeriesRecord } from "@/lib/watch-content-kind"
import {
  asLocaleSlug,
  searchPath,
  tryAsContentSlug,
  tryAsLocaleSlug,
  watchVideoPath,
  watchUnavailableLanguagePath,
} from "@/lib/routes"
import type { AdminVideoLabel, SearchResult } from "@/lib/search"
import { resolveMuxAnimatedPreviewUrl } from "@/lib/url"
import { videoLabelMessageKey } from "@/lib/video-labels"
import { writeWatchUnavailableRecoveryContext } from "@/lib/watch-unavailable-recovery-context"
import { cn } from "@/lib/utils"

type VideoCardProps = {
  result: SearchResult
  index?: number
  requestedLanguageSlug?: string | null
  requestedLanguageName?: string | null
  hrefBuilder?: (
    result: SearchResult,
    requestedLanguageSlug?: string | null,
  ) => Route
  onResultClick?: (
    result: SearchResult,
    event: ReactMouseEvent<HTMLAnchorElement>,
  ) => void
}

// English is the default UI locale for search-result deep links. Hoisted to
// module scope so the throwing constructor runs once at load, not per render.
const ENGLISH_LOCALE = asLocaleSlug("english")

export const defaultHrefBuilder = (
  result: SearchResult,
  requestedLanguageSlug?: string | null,
): Route => {
  const slug = tryAsContentSlug(result.slug)
  const resultLanguage = result.languageSlug
    ? tryAsLocaleSlug(result.languageSlug)
    : null
  const subtitleLanguage = result.subtitleLanguageSlug
    ? tryAsLocaleSlug(result.subtitleLanguageSlug)
    : null
  // On a malformed slug, fall back to the modal-capable watch home rather than
  // emitting a broken deep link or resurrecting the deprecated /search page.
  if (!slug) return searchPath()
  if (result.availabilityKind === "unavailable") {
    const requestedLanguage = requestedLanguageSlug
      ? tryAsLocaleSlug(requestedLanguageSlug)
      : null
    return requestedLanguage
      ? watchUnavailableLanguagePath(slug, requestedLanguage)
      : searchPath()
  }
  if (result.availabilityKind === "target_subtitle") {
    if (!resultLanguage || !subtitleLanguage) return searchPath()
    return watchVideoPath(slug, resultLanguage, { subtitleLanguage })
  }
  return watchVideoPath(slug, resultLanguage ?? ENGLISH_LOCALE)
}

// Full tailwind class strings so JIT can extract them at build time.
// Each palette is a dark, saturated gradient that reads as intentional
// branded artwork when the CMS hasn't joined the experience's og_image.
const EXPERIENCE_PLACEHOLDER_GRADIENTS = [
  "from-violet-700 via-purple-900 to-indigo-950",
  "from-orange-600 via-amber-800 to-stone-950",
  "from-emerald-600 via-teal-800 to-stone-950",
  "from-rose-600 via-pink-800 to-purple-950",
  "from-sky-600 via-blue-800 to-indigo-950",
  "from-red-700 via-rose-900 to-stone-950",
  "from-lime-600 via-green-800 to-emerald-950",
  "from-fuchsia-600 via-purple-800 to-indigo-950",
] as const

// djb2 — used only to pick a palette slot, not for anything security-
// sensitive. Spreads "easter" vs "christmas" into different slots.
function gradientForSlug(slug: string): string {
  let hash = 5381
  for (let i = 0; i < slug.length; i++) {
    hash = ((hash * 33) ^ slug.charCodeAt(i)) | 0
  }
  const index = Math.abs(hash) % EXPERIENCE_PLACEHOLDER_GRADIENTS.length
  return EXPERIENCE_PLACEHOLDER_GRADIENTS[index]
}

// Admin watch search can return a curated `imageUrl`; when it cannot,
// `playbackId` lets the card fall back to a Mux poster. Scene-level
// matches can also use `startSeconds` to land near the matched moment.
function muxSearchThumbnail(
  playbackId: string,
  startSeconds: number | null,
): string {
  const time = startSeconds != null ? `&time=${startSeconds}` : ""
  return `https://image.mux.com/${playbackId}/thumbnail.jpg?width=448&height=336&fit_mode=smartcrop${time}`
}

// Connectives that stay lowercase when not the first word in a multi-word
// label ("Behind the Scenes", "Wages of Sin", etc.).
const SHORT_WORDS = new Set(["of", "the", "and", "in", "on", "for"])

// Format admin's VideoLabel enum for human reading. EPISODE → "Episode",
// SHORT_FILM → "Short Film", BEHIND_THE_SCENES → "Behind the Scenes".
export function formatVideoLabel(label: AdminVideoLabel | null): string {
  if (label == null) return "Video"
  return label
    .toLowerCase()
    .split("_")
    .map((word, i) =>
      i > 0 && SHORT_WORDS.has(word)
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ")
}

// VideoLabels that semantically have children — i.e., the count pill is
// meaningful. Everything else (EPISODE, FEATURE_FILM, SHORT_FILM, SEGMENT,
// TRAILER, BEHIND_THE_SCENES) is a singular video and should show duration,
// not an episode count.
//
// Trusting `label` instead of `childCount > 0` shields the pill from the
// admin Video.parents/children relation inversion: when the inversion is
// active upstream, EPISODE rows come back with non-zero childCount (it's
// actually their parent-count). The old heuristic `childCount > 0 ⇒ series`
// then mislabels every episode as "1 episode". Gating on label removes
// that coupling entirely.
// Decide what to render in the top-right pill. Series-shaped rows
// (label SERIES / COLLECTION with childCount > 0) get `{n} episodes`;
// every other video shows duration. Experiences carry null label and are
// filtered out at the call site. Returns null when there's nothing to
// show — caller renders nothing on null.
export function pickCardPill(
  result: SearchResult,
): { kind: "count"; text: string } | { kind: "duration"; text: string } | null {
  const isSeriesShaped = isSeriesRecord({ label: result.label })
  if (isSeriesShaped && result.childCount != null && result.childCount > 0) {
    const noun = result.childCount === 1 ? "episode" : "episodes"
    return { kind: "count", text: `${result.childCount} ${noun}` }
  }
  if (result.durationSeconds != null && result.durationSeconds > 0) {
    return { kind: "duration", text: formatDuration(result.durationSeconds) }
  }
  return null
}

export function VideoCard({
  result,
  index = 0,
  requestedLanguageSlug,
  requestedLanguageName,
  hrefBuilder = defaultHrefBuilder,
  onResultClick,
}: VideoCardProps) {
  const t = useTranslations("SearchResultCard")
  const videoLabels = useTranslations("VideoLabels")
  const muxThumbnailSrc =
    result.type === "video" && result.playbackId
      ? muxSearchThumbnail(result.playbackId, result.startSeconds)
      : null
  const muxPreviewUrl =
    result.type === "video"
      ? resolveMuxAnimatedPreviewUrl(result.playbackId)
      : null
  const thumbnailSrc = result.imageUrl ?? muxThumbnailSrc
  const thumbnailBlurDataURL =
    result.imageUrl != null
      ? result.imageBlurDataUrl
      : muxThumbnailSrc != null
        ? result.muxThumbnailBlurDataUrl
        : null

  const isExperience = result.type === "experience"
  // Experience cards reuse the legacy amber chip (now top-right, was
  // top-left in the pre-pill design). They never carry a count or a
  // duration, so the regular pill helper isn't consulted — the chip
  // IS the surface signal. Non-experience cards use the new count /
  // duration pill at top-right and a type badge bottom-left.
  const pill = isExperience ? null : pickCardPill(result)
  const typeBadge =
    isExperience || result.label == null
      ? null
      : videoLabels(videoLabelMessageKey(result.label))
  const pillText =
    pill?.kind === "count" && result.childCount != null
      ? t("episodeCount", { count: result.childCount })
      : pill?.text

  return (
    <Link
      href={hrefBuilder(result, requestedLanguageSlug)}
      prefetch={result.availabilityKind === "unavailable" ? false : undefined}
      onClick={(event) => {
        if (
          result.availabilityKind === "unavailable" &&
          requestedLanguageSlug &&
          isUnmodifiedPrimaryNavigation(event)
        ) {
          writeWatchUnavailableRecoveryContext({
            target: result,
            requestedLanguageSlug,
            requestedLanguageName,
          })
        }
        onResultClick?.(result, event)
      }}
      className={cn(
        "group animate-card-enter relative flex cursor-pointer flex-col overflow-hidden rounded-lg transition-shadow hover:shadow-2xl hover:shadow-black/40",
        VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS,
      )}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Full-bleed thumbnail */}
      <div
        className="relative aspect-video w-full overflow-hidden bg-stone-800 bg-cover bg-center"
        style={
          thumbnailBlurDataURL
            ? { backgroundImage: `url("${thumbnailBlurDataURL}")` }
            : undefined
        }
      >
        {thumbnailSrc ? (
          <Image
            src={thumbnailSrc}
            alt={result.title ?? t("thumbnailAlt")}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw"
            className="search-card-hover-zoom object-cover transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
            {...(thumbnailBlurDataURL
              ? {
                  placeholder: "blur" as const,
                  blurDataURL: thumbnailBlurDataURL,
                }
              : {})}
          />
        ) : result.type === "experience" ? (
          <div
            aria-hidden
            className={`search-card-hover-zoom relative h-full w-full overflow-hidden bg-gradient-to-br transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${gradientForSlug(result.slug)}`}
          >
            {/* Decorative soft radial glow + diagonal stripes so the
                placeholder reads as intentional branded artwork rather
                than a missing asset. */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.18),transparent_55%)]" />
            <div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.05)_0_14px,transparent_14px_32px)]" />
            <div className="absolute inset-0 flex items-center justify-center px-4">
              <VideoThumbnailTitle
                as="span"
                lines={3}
                size="display"
                className="text-center tracking-tight text-white/90 select-none"
              >
                {result.title}
              </VideoThumbnailTitle>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-stone-500">
            <svg
              className="h-12 w-12"
              fill="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        )}
        <MuxHoverPreview
          previewUrl={muxPreviewUrl}
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw"
        />

        {/* Gradient overlay for text legibility */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/25 to-transparent" />
        {result.type === "video" ? (
          <WatchProgressBar videoId={result.id} />
        ) : null}

        {/* Top-right slot.
            - Experience: amber pill labeled "Experience" (the only place
              the type signal appears on this card).
            - Non-experience with countable children OR a duration: dark
              translucent pill with the count / runtime.
            - Otherwise nothing. */}
        {isExperience ? (
          <span
            data-testid="search-card-experience-chip"
            className="absolute top-3 right-3 rounded-full bg-amber-500/90 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-stone-950 uppercase shadow"
          >
            {t("experience")}
          </span>
        ) : pill ? (
          <span
            data-testid="search-card-pill"
            data-pill-kind={pill.kind}
            className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm"
          >
            {pill.kind === "duration" ? (
              <Play size={10} fill="currentColor" stroke="none" aria-hidden />
            ) : null}
            {pillText}
          </span>
        ) : null}

        {/* Bottom-left content: type badge (videos only) + title +
            snippet. Experience cards skip the badge — the amber chip in
            the top-right is the sole type signal. */}
        <VideoThumbnailCaption>
          {typeBadge ? (
            <VideoThumbnailEyebrow
              data-testid="search-card-type-badge"
              size="compact"
            >
              {typeBadge}
            </VideoThumbnailEyebrow>
          ) : null}
          <VideoThumbnailTitle size="compact">
            {result.title}
          </VideoThumbnailTitle>
          {result.snippet && (
            <VideoThumbnailDescription>
              {result.snippet}
            </VideoThumbnailDescription>
          )}
        </VideoThumbnailCaption>
      </div>
      <VideoThumbnailInteractionFrame data-testid="search-card-hover-outline" />
    </Link>
  )
}

export function isUnmodifiedPrimaryNavigation(
  event: Pick<
    ReactMouseEvent<HTMLAnchorElement>,
    "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
  >,
): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  )
}
