"use client"

import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import dynamic from "next/dynamic"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type RefObject,
} from "react"
import type { MuxPlayerRef } from "@forge/video-player"
import MuxVideo from "@forge/video-player/mux-video"
import {
  Play,
  Share2,
  SkipForward,
  UserPlus,
  Volume2,
  VolumeX,
} from "lucide-react"
import { useTranslations } from "next-intl"
import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel"
import { Button } from "@/components/ui/button"
import {
  WATCH_PAGE_CONTENT_CLASSES,
  WATCH_PAGE_RAIL_PADDING_CLASSES,
} from "@/lib/content-width"
import { FORGE_SUBTITLE_TRACK_LABEL } from "@/components/watch/subtitle-track"
import { HeroPlayerControls } from "@/components/watch/HeroPlayerControls"
import {
  WATCH_PLAYER_CHROME_VISIBILITY_EVENT,
  type WatchPlayerChromeVisibilityDetail,
} from "@/lib/watch-player-chrome-events"
import type { WatchHomeHeroSlide } from "@/lib/watch-home"
import type {
  WatchHomeCarouselSequenceData,
  WatchHomeTvCarouselMuxSlide,
  WatchHomeTvCarouselVideoSlide,
} from "@/lib/watch-home-carousel-sequence"
import { loadWatchInteraction } from "@/lib/watch-interaction-loader"
import { cn } from "@/lib/utils"
import {
  useWatchHomeTvCarousel,
  watchHomeTvAdvanceTargetSeconds,
  type WatchHomeTvCarouselSlide,
} from "@/components/home/useWatchHomeTvCarousel"

type WatchHomeTvCarouselProps = {
  slides: WatchHomeHeroSlide[]
  sequence?: WatchHomeCarouselSequenceData | null
}

type WatchHomeShortFilmPhase = "transitioning" | "playing"

const WATCH_HOME_SHORT_FILM_TRANSITION_MS = 360
const WATCH_HOME_SHARE_CLOSE_DELAY_MS = 150

const ShareModal = dynamic(
  () =>
    import("@/components/watch/ShareModal").then((module) => ({
      default: module.ShareModal,
    })),
  { ssr: false },
)

function muxStreamUrl(playbackId: string | null) {
  return playbackId ? `https://stream.mux.com/${playbackId}.m3u8` : null
}

function muxThumbnailUrl(playbackId: string | null, width = 1280) {
  return playbackId
    ? `https://image.mux.com/${playbackId}/thumbnail.jpg?width=${width}&height=720&fit_mode=smartcrop`
    : null
}

function appendAutoplaySignal(href: string, playbackTimeSeconds = 0): string {
  try {
    const url = new URL(href, "http://watch.local")
    if (Number.isFinite(playbackTimeSeconds) && playbackTimeSeconds >= 1) {
      url.searchParams.set("t", String(Math.floor(playbackTimeSeconds)))
    }
    url.searchParams.set("autoplay", "1")
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    const startTime =
      Number.isFinite(playbackTimeSeconds) && playbackTimeSeconds >= 1
        ? `t=${Math.floor(playbackTimeSeconds)}&`
        : ""
    return href.includes("?")
      ? `${href}&${startTime}autoplay=1`
      : `${href}?${startTime}autoplay=1`
  }
}

export function watchHomeHeroSlidesToTvCarouselSlides(
  slides: readonly WatchHomeHeroSlide[],
): WatchHomeTvCarouselSlide[] {
  return slides.map((slide) => {
    const muxThumbnail = muxThumbnailUrl(slide.playbackId)
    const posterUrl = slide.imageUrl ?? muxThumbnail

    return {
      kind: "video",
      id: slide.coreId,
      shareVideoSlug: slide.shareVideoSlug,
      shareLanguageSlug: slide.shareLanguageSlug,
      title: slide.title,
      description: slide.description,
      label: slide.eyebrow || slide.label,
      href: slide.href,
      posterUrl,
      thumbnailUrl:
        slide.imageUrl ?? muxThumbnailUrl(slide.playbackId, 640) ?? posterUrl,
      imageAlt: slide.imageAlt,
      src: slide.hls ?? muxStreamUrl(slide.playbackId),
      playbackId: slide.playbackId,
      subtitleVttSrc: slide.subtitleVttSrc,
      subtitleLanguageBcp47: slide.subtitleLanguageBcp47,
      durationSeconds: slide.durationSeconds,
    }
  })
}

type PrimaryActionIconName = NonNullable<
  WatchHomeTvCarouselMuxSlide["action"]
>["icon"]

function isShareableCatalogSlide(
  slide: WatchHomeTvCarouselSlide,
): slide is WatchHomeTvCarouselVideoSlide & {
  shareVideoSlug: string
  shareLanguageSlug: string
} {
  return (
    slide.kind === "video" &&
    Boolean(slide.href && slide.shareVideoSlug && slide.shareLanguageSlug)
  )
}

function PrimaryActionIcon({ icon }: { icon: PrimaryActionIconName }) {
  const iconClassName = "h-5 w-5 shrink-0"

  if (icon === "join") {
    return <UserPlus className={iconClassName} aria-hidden />
  }

  if (icon === "share") {
    return <Share2 className={iconClassName} aria-hidden />
  }

  return <Play className={`${iconClassName} fill-current`} aria-hidden />
}

function PrimaryAction({
  onShare,
  onWatchShortFilm,
  playbackTimeSeconds,
  shareLabel,
  slide,
}: {
  onShare?: (slide: WatchHomeTvCarouselVideoSlide) => void
  onWatchShortFilm?: (slide: WatchHomeTvCarouselSlide) => void
  playbackTimeSeconds: number
  shareLabel: string
  slide: WatchHomeTvCarouselSlide
}) {
  const primaryClassName =
    "inline-flex h-11 min-w-0 max-w-full items-center gap-2 rounded-full bg-brand-red px-4 text-sm font-bold text-white shadow-[0_14px_32px_rgba(0,0,0,0.34)] transition hover:bg-brand-red/90 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none sm:h-14 sm:gap-3 sm:px-6 sm:text-lg"
  const secondaryClassName =
    "inline-flex h-11 min-w-0 max-w-full items-center gap-2 rounded-full border border-white/35 bg-black/30 px-4 text-sm font-bold text-white shadow-[0_14px_32px_rgba(0,0,0,0.22)] backdrop-blur transition hover:border-white/60 hover:bg-white/12 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none sm:h-14 sm:gap-3 sm:px-6 sm:text-lg"

  const secondaryAction =
    slide.kind === "mux" && slide.secondaryAction && slide.src ? (
      <button
        type="button"
        className={secondaryClassName}
        onClick={() => onWatchShortFilm?.(slide)}
      >
        <Play className="h-5 w-5 shrink-0 fill-current" aria-hidden />
        <span className="truncate">{slide.secondaryAction.label}</span>
      </button>
    ) : null

  if (slide.kind === "mux" && slide.action) {
    return (
      <div className="flex max-w-[calc(100vw-9rem)] flex-col items-start gap-3 sm:max-w-full sm:flex-row sm:items-center">
        <a href={slide.action.url} className={primaryClassName}>
          <PrimaryActionIcon icon={slide.action.icon} />
          <span className="truncate">{slide.action.label}</span>
        </a>
        {secondaryAction}
      </div>
    )
  }

  if (!slide.href) return secondaryAction

  const shareableSlide = isShareableCatalogSlide(slide) ? slide : null

  return (
    <div className="flex max-w-[calc(100vw-9rem)] flex-col items-start gap-3 sm:max-w-full sm:flex-row sm:items-center">
      <Link
        href={appendAutoplaySignal(slide.href, playbackTimeSeconds) as Route}
        className={primaryClassName}
      >
        <Play className="h-5 w-5 shrink-0 fill-current" aria-hidden />
        <span className="truncate">Watch Now</span>
      </Link>
      {shareableSlide ? (
        <button
          type="button"
          aria-label={shareLabel}
          className={secondaryClassName}
          data-testid="watch-home-share-button"
          onClick={() => onShare?.(shareableSlide)}
        >
          <Share2 className="h-5 w-5 shrink-0" aria-hidden />
          <span className="truncate">{shareLabel}</span>
        </button>
      ) : null}
    </div>
  )
}

function WatchHomeTvMedia({
  activeSlide,
  fullPlayerMode,
  playerTransitioning,
  isMuted,
  leavingSlide,
  mediaReady,
  onCanPlay,
  onEnded,
  onLoadedMetadata,
  onPlayerReady,
  onSubtitleCueTextChange,
  onTimeUpdate,
  videoRef,
  wrapperRef,
}: {
  activeSlide: WatchHomeTvCarouselSlide
  fullPlayerMode: boolean
  playerTransitioning: boolean
  isMuted: boolean
  leavingSlide: WatchHomeTvCarouselSlide | null
  mediaReady: boolean
  onCanPlay: () => void
  onEnded?: () => void
  onLoadedMetadata: () => void
  onPlayerReady?: (player: MuxPlayerRef | null) => void
  onSubtitleCueTextChange: (cueText: string | null) => void
  onTimeUpdate: () => void
  videoRef: MutableRefObject<HTMLVideoElement | null>
  wrapperRef: RefObject<HTMLDivElement | null>
}) {
  const subtitleVttSrc =
    isMuted && activeSlide.kind === "video"
      ? (activeSlide.subtitleVttSrc ?? null)
      : null
  const subtitleLanguageBcp47 =
    isMuted && activeSlide.kind === "video"
      ? (activeSlide.subtitleLanguageBcp47 ?? null)
      : null

  useWatchHomeMutedSubtitles({
    activeSlideId: activeSlide.id,
    onCueTextChange: onSubtitleCueTextChange,
    subtitleLanguageBcp47,
    subtitleVttSrc,
    videoRef,
  })

  const handleVideoRef = useCallback(
    (next: HTMLVideoElement | null) => {
      videoRef.current = next
      onPlayerReady?.((next ?? null) as MuxPlayerRef | null)
    },
    [onPlayerReady, videoRef],
  )
  const takeoverActive = fullPlayerMode || playerTransitioning

  return (
    <div
      ref={wrapperRef}
      className="absolute inset-0 isolate z-0 overflow-hidden bg-black"
      data-testid="watch-home-tv-media-frame"
    >
      {leavingSlide && !fullPlayerMode ? (
        <WatchHomeTvVisualLayer
          key={`${leavingSlide.id}-leaving`}
          slide={leavingSlide}
          className="watch-home-media-exit z-0"
          priority={false}
        />
      ) : null}
      {!fullPlayerMode ? (
        <WatchHomeTvVisualLayer
          key={`${activeSlide.id}-entering`}
          slide={activeSlide}
          className="watch-home-media-enter z-10"
          priority
        />
      ) : null}
      {activeSlide.src ? (
        <MuxVideo
          key={activeSlide.id}
          ref={handleVideoRef}
          src={activeSlide.src}
          poster={activeSlide.posterUrl ?? undefined}
          muted={takeoverActive ? false : isMuted}
          playsInline
          disableTracking
          controls={false}
          crossOrigin="anonymous"
          onCanPlay={onCanPlay}
          onEnded={takeoverActive ? undefined : onEnded}
          onLoadedMetadata={onLoadedMetadata}
          onTimeUpdate={onTimeUpdate}
          className={cn(
            "absolute inset-0 z-20 h-full w-full opacity-0 transition-opacity duration-[900ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none",
            fullPlayerMode ? "object-contain" : "object-cover",
            fullPlayerMode || mediaReady ? "opacity-100" : "opacity-0",
            playerTransitioning && "watch-home-player-enter",
          )}
        />
      ) : null}
      {!fullPlayerMode ? (
        <>
          <div className="absolute inset-0 z-30 bg-[linear-gradient(180deg,rgba(0,0,0,0.18),rgba(0,0,0,0)_36%,rgba(0,0,0,0.35)_70%,rgba(0,0,0,0.72)_100%)]" />
          <div className="absolute inset-y-0 left-0 z-30 w-3/5 bg-[linear-gradient(90deg,rgba(0,0,0,0.48)_0%,rgba(0,0,0,0)_100%)]" />
        </>
      ) : null}
    </div>
  )
}

function stripHtmlTags(text: string): string {
  if (typeof DOMParser === "undefined") return text.replace(/<[^>]+>/g, "")
  const doc = new DOMParser().parseFromString(text, "text/html")
  return doc.body.textContent ?? ""
}

function useWatchHomeMutedSubtitles({
  activeSlideId,
  onCueTextChange,
  subtitleLanguageBcp47,
  subtitleVttSrc,
  videoRef,
}: {
  activeSlideId: string
  onCueTextChange: (cueText: string | null) => void
  subtitleLanguageBcp47: string | null
  subtitleVttSrc: string | null
  videoRef: RefObject<HTMLVideoElement | null>
}) {
  useEffect(() => {
    const media = videoRef.current as HTMLMediaElement | null
    if (!media) return undefined

    const video = (() => {
      const host = media as unknown as HTMLElement
      const muxVideo = host.shadowRoot?.querySelector(
        "mux-video",
      ) as HTMLElement | null
      return (
        muxVideo?.shadowRoot?.querySelector("video") ??
        host.shadowRoot?.querySelector("video") ??
        (media instanceof HTMLVideoElement ? media : null)
      )
    })()
    if (!video) return undefined

    const existing = video.querySelector("track[data-subtitle-track]")
    if (existing) existing.remove()

    if (!subtitleVttSrc) return undefined

    const trackEl = document.createElement("track")
    trackEl.kind = "subtitles"
    trackEl.label = FORGE_SUBTITLE_TRACK_LABEL
    trackEl.src = subtitleVttSrc
    trackEl.default = true
    trackEl.setAttribute("data-subtitle-track", "true")
    if (subtitleLanguageBcp47) trackEl.srclang = subtitleLanguageBcp47
    video.appendChild(trackEl)

    const track = trackEl.track ?? null
    if (track) {
      track.mode = "hidden"
    }

    const onCueChange = () => {
      const activeCues = track?.activeCues
      if (!activeCues || activeCues.length === 0) {
        onCueTextChange(null)
        return
      }

      const texts: string[] = []
      for (let i = 0; i < activeCues.length; i++) {
        const cue = activeCues[i] as VTTCue
        if (cue.text) texts.push(stripHtmlTags(cue.text))
      }
      onCueTextChange(texts.length > 0 ? texts.join("\n") : null)
    }

    track?.addEventListener("cuechange", onCueChange)
    onCueChange()

    return () => {
      track?.removeEventListener("cuechange", onCueChange)
      if (track) track.mode = "disabled"
      trackEl.remove()
      onCueTextChange(null)
    }
  }, [
    activeSlideId,
    onCueTextChange,
    subtitleLanguageBcp47,
    subtitleVttSrc,
    videoRef,
  ])
}

function WatchHomeSubtitleOverlay({ cueText }: { cueText: string }) {
  return (
    <div
      data-testid="watch-home-subtitle-overlay"
      className="pointer-events-none absolute inset-x-0 bottom-8 z-30 hidden justify-center sm:flex"
    >
      <div className="max-w-[min(80%,700px)] whitespace-pre-line rounded-md bg-black/40 px-5 py-2.5 text-center text-lg font-medium text-white shadow-lg backdrop-blur-sm md:text-xl">
        {cueText}
      </div>
    </div>
  )
}

function WatchHomeTvVisualLayer({
  className,
  priority,
  slide,
}: {
  className?: string
  priority: boolean
  slide: WatchHomeTvCarouselSlide
}) {
  return (
    <div
      className={cn("absolute inset-0", className)}
      data-testid="watch-home-tv-visual-layer"
    >
      {slide.posterUrl ? (
        <Image
          src={slide.posterUrl}
          alt={slide.imageAlt}
          fill
          priority={priority}
          sizes="100vw"
          className="object-cover"
        />
      ) : (
        <div
          aria-hidden
          className="h-full w-full bg-[linear-gradient(135deg,#020617,#3f1d2b_48%,#14332c)]"
        />
      )}
    </div>
  )
}

function WatchHomeTvOverlay({
  activeSlide,
  exitingToPlayer,
  fullPlayerMode,
  isMuted,
  leavingSlide,
  onNext,
  onShare,
  onToggleMuted,
  onWatchShortFilm,
  playbackTimeSeconds,
  shareLabel,
}: {
  activeSlide: WatchHomeTvCarouselSlide
  exitingToPlayer: boolean
  fullPlayerMode: boolean
  isMuted: boolean
  leavingSlide: WatchHomeTvCarouselSlide | null
  onNext: () => void
  onShare: (slide: WatchHomeTvCarouselVideoSlide) => void
  onToggleMuted: () => void
  onWatchShortFilm: (slide: WatchHomeTvCarouselSlide) => void
  playbackTimeSeconds: number
  shareLabel: string
}) {
  const advanceDurationSeconds =
    watchHomeTvSlideAdvanceDurationSeconds(activeSlide)

  if (fullPlayerMode && !exitingToPlayer) return null

  return (
    <div
      className={cn(
        "absolute inset-x-0 z-10 flex items-end justify-between gap-4",
        fullPlayerMode
          ? "pointer-events-none bottom-16 pb-4 sm:hidden"
          : "bottom-0 pb-4 sm:pb-8",
        WATCH_PAGE_RAIL_PADDING_CLASSES,
      )}
    >
      <div className="relative min-w-0 flex-1 text-white drop-shadow-[0_2px_16px_rgba(0,0,0,0.7)]">
        {leavingSlide ? (
          <WatchHomeTvOverlayContent
            key={`${leavingSlide.id}-leaving-copy`}
            mode="leaving"
            playbackTimeSeconds={0}
            shareLabel={shareLabel}
            slide={leavingSlide}
          />
        ) : null}
        <WatchHomeTvOverlayContent
          key={`${activeSlide.id}-${exitingToPlayer ? "player-exit" : "entering"}-copy`}
          enterDelayOffsetMs={leavingSlide ? 430 : 0}
          mode={exitingToPlayer ? "leaving" : "entering"}
          onShare={onShare}
          onWatchShortFilm={onWatchShortFilm}
          playbackTimeSeconds={playbackTimeSeconds}
          shareLabel={shareLabel}
          showAction={!fullPlayerMode}
          slide={activeSlide}
        />
      </div>
      {!fullPlayerMode ? (
        <div
          className={cn(
            "hidden shrink-0 items-center gap-4 text-white sm:flex",
            exitingToPlayer && "watch-home-controls-exit pointer-events-none",
          )}
        >
          <NextVideoButton
            advanceDurationSeconds={advanceDurationSeconds}
            animationKey={activeSlide.id}
            onClick={onNext}
            size="large"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={isMuted ? "Unmute preview" : "Mute preview"}
            onClick={onToggleMuted}
            className="h-14 w-14 rounded-full text-white/80 hover:bg-white/10 hover:text-white"
          >
            {isMuted ? (
              <VolumeX className="size-7" aria-hidden />
            ) : (
              <Volume2 className="size-7" aria-hidden />
            )}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function watchHomeTvSlideAdvanceDurationSeconds(
  slide: WatchHomeTvCarouselSlide,
) {
  if (!slide.src) return 7
  return watchHomeTvAdvanceTargetSeconds(slide.durationSeconds ?? Number.NaN)
}

function WatchHomeTvOverlayContent({
  enterDelayOffsetMs = 0,
  mode,
  onShare,
  onWatchShortFilm,
  playbackTimeSeconds,
  shareLabel,
  showAction = true,
  slide,
}: {
  enterDelayOffsetMs?: number
  mode: "entering" | "leaving"
  onShare?: (slide: WatchHomeTvCarouselVideoSlide) => void
  onWatchShortFilm?: (slide: WatchHomeTvCarouselSlide) => void
  playbackTimeSeconds: number
  shareLabel: string
  showAction?: boolean
  slide: WatchHomeTvCarouselSlide
}) {
  const enterDelays = [0, 70, 140, 210]
  const exitDelays = [0, 35, 70, 105]
  const itemClassName =
    mode === "entering" ? "watch-home-copy-enter" : "watch-home-copy-exit"
  const wrapperClassName =
    mode === "leaving"
      ? "pointer-events-none absolute bottom-0 left-0 flex w-full flex-col items-start gap-3 sm:gap-4"
      : "relative flex flex-col items-start gap-3 sm:gap-4"
  const delayStyle = (index: number) => {
    const delay =
      mode === "entering"
        ? enterDelayOffsetMs + enterDelays[index]
        : exitDelays[index]
    return { "--watch-home-copy-delay": `${delay}ms` } as CSSProperties
  }

  return (
    <div className={wrapperClassName} aria-hidden={mode === "leaving"}>
      <div className="min-w-0">
        <p
          className={cn(
            itemClassName,
            "text-xs font-bold tracking-[0.24em] text-amber-300 uppercase sm:text-sm",
          )}
          style={delayStyle(0)}
        >
          {slide.label}
        </p>
        <h1
          className={cn(
            itemClassName,
            "line-clamp-3 leading-tight font-extrabold sm:line-clamp-2",
            "text-3xl max-[360px]:text-2xl sm:text-5xl md:text-6xl",
          )}
          style={delayStyle(1)}
        >
          {slide.title}
        </h1>
        {slide.description ? (
          <p
            className={cn(
              itemClassName,
              "mt-2 hidden max-w-[min(52rem,calc(100vw-2.5rem))] text-base leading-7 font-semibold text-white/78 sm:mt-3 sm:line-clamp-3 sm:block sm:text-lg md:text-xl",
            )}
            style={delayStyle(2)}
          >
            {slide.description}
          </p>
        ) : null}
      </div>
      {showAction ? (
        <div className={itemClassName} style={delayStyle(3)}>
          <PrimaryAction
            slide={slide}
            onShare={onShare}
            onWatchShortFilm={onWatchShortFilm}
            playbackTimeSeconds={playbackTimeSeconds}
            shareLabel={shareLabel}
          />
        </div>
      ) : null}
    </div>
  )
}

function NextVideoButton({
  advanceDurationSeconds,
  animationKey,
  onClick,
  size,
}: {
  advanceDurationSeconds: number
  animationKey: string
  onClick: () => void
  size: "large" | "compact"
}) {
  const radius = size === "large" ? 30 : 24
  const circumference = 2 * Math.PI * radius
  const buttonClassName =
    size === "large"
      ? "h-14 w-14 rounded-full text-white/80 hover:bg-white/10 hover:text-white"
      : "h-11 w-11 rounded-full bg-black/35 text-white hover:bg-black/55"
  const iconClassName = "size-7 fill-current"
  const svgSize = size === "large" ? 68 : 56
  const center = svgSize / 2
  const completedRef = useRef(false)
  const previousAnimationKeyRef = useRef(animationKey)
  const [showResetRing, setShowResetRing] = useState(false)

  useEffect(() => {
    const previousCompleted = completedRef.current
    const animationKeyChanged = previousAnimationKeyRef.current !== animationKey

    completedRef.current = false

    let resetTimeout = 0
    if (animationKeyChanged) {
      previousAnimationKeyRef.current = animationKey
      setShowResetRing(previousCompleted)
      if (previousCompleted) {
        resetTimeout = window.setTimeout(() => {
          setShowResetRing(false)
        }, 950)
      }
    }

    const completionTimeout = window.setTimeout(
      () => {
        completedRef.current = true
      },
      Math.max(0, advanceDurationSeconds * 1000 - 80),
    )

    return () => {
      window.clearTimeout(completionTimeout)
      if (resetTimeout !== 0) window.clearTimeout(resetTimeout)
    }
  }, [advanceDurationSeconds, animationKey])

  return (
    <div className="relative grid place-items-center">
      <svg
        aria-hidden
        data-testid="watch-home-next-progress"
        className="pointer-events-none absolute inset-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-90 overflow-visible"
        height={svgSize}
        width={svgSize}
        viewBox={`0 0 ${svgSize} ${svgSize}`}
      >
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.18)"
          strokeWidth="3"
        />
        <circle
          key={animationKey}
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.9)"
          strokeLinecap="round"
          strokeWidth="3"
          className="watch-home-progress-ring"
          strokeDasharray={circumference}
          strokeDashoffset={circumference}
          style={
            {
              "--watch-home-progress-duration": `${advanceDurationSeconds}s`,
            } as CSSProperties
          }
        />
        {showResetRing ? (
          <circle
            key={`${animationKey}-reset`}
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.92)"
            strokeLinecap="round"
            strokeWidth="3"
            className="watch-home-progress-ring-reset"
            strokeDasharray={circumference}
            strokeDashoffset={0}
            style={
              {
                "--watch-home-progress-circumference": circumference,
              } as CSSProperties
            }
          />
        ) : null}
      </svg>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Next video"
        onClick={onClick}
        className={buttonClassName}
      >
        <SkipForward className={iconClassName} aria-hidden />
      </Button>
    </div>
  )
}

function WatchHomeTvCard({
  isActive,
  onSelect,
  progress,
  slide,
}: {
  isActive: boolean
  onSelect: () => void
  progress: number
  slide: WatchHomeTvCarouselSlide
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group relative block aspect-video w-[clamp(13.5rem,68vw,26.25rem)] overflow-hidden rounded-lg bg-stone-950 text-left shadow-[0_2px_6px_rgba(0,0,0,0.35),0_14px_32px_-12px_rgba(0,0,0,0.6)] transition-[opacity,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80 sm:w-[clamp(14.75rem,30vw,26.25rem)] md:w-full",
        isActive
          ? "opacity-100"
          : "opacity-62 hover:opacity-95 hover:shadow-[0_4px_10px_rgba(0,0,0,0.4),0_22px_44px_-14px_rgba(0,0,0,0.7)]",
      )}
      aria-pressed={isActive}
      aria-label={`Show ${slide.title}`}
      data-testid="watch-home-tv-carousel-card"
    >
      {slide.thumbnailUrl ? (
        <Image
          src={slide.thumbnailUrl}
          alt=""
          fill
          sizes="(max-width: 640px) 72vw, (max-width: 767px) min(30vw, 26.25rem), 33vw"
          className="object-cover transition-transform duration-300 group-hover:scale-105 group-focus-visible:scale-105"
        />
      ) : (
        <div
          aria-hidden
          className="h-full w-full bg-[linear-gradient(135deg,#111827,#4c1d1d_52%,#064e3b)]"
        />
      )}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0)_28%,rgba(0,0,0,0.72)_100%)]" />
      {isActive ? (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-white/25">
          <div
            className="h-full bg-brand-red"
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : null}
      <div className="absolute right-4 bottom-4 left-4">
        <p className="mb-1 truncate text-[0.7rem] font-bold tracking-[0.22em] text-white/55 uppercase sm:text-xs">
          {slide.label}
        </p>
        <h2 className="line-clamp-2 text-base leading-tight font-extrabold text-white sm:text-xl">
          {slide.title}
        </h2>
      </div>
      <div
        aria-hidden
        data-testid="watch-home-tv-card-bevel"
        className="pointer-events-none absolute inset-0 z-40 rounded-lg opacity-40 mix-blend-soft-light shadow-[inset_0_0_0_1px_rgba(255,255,255,0.7)]"
      />
      <div
        aria-hidden
        data-testid="watch-home-tv-card-hover-outline"
        className={cn(
          "watch-home-gradient-outline watch-home-gradient-outline-landscape pointer-events-none absolute z-50 opacity-0 shadow-[0_-4px_22px_rgba(239,68,68,0.26)] transition-opacity duration-200",
          !isActive &&
            "group-hover:opacity-100 group-focus-visible:opacity-100",
        )}
      />
      <div
        aria-hidden
        data-testid="watch-home-tv-card-active-outline"
        className={cn(
          "pointer-events-none absolute inset-0 z-[60] rounded-lg shadow-[inset_0_0_0_4px_rgba(255,255,255,1),inset_0_0_0_5px_rgba(0,0,0,0.45)] transition-[opacity,transform] duration-300 ease-out",
          isActive ? "scale-100 opacity-100" : "scale-[0.985] opacity-0",
        )}
      />
    </button>
  )
}

function WatchHomeTvRail({
  activeSlideId,
  onSelect,
  progress,
  slides,
}: {
  activeSlideId: string
  onSelect: (slideId: string) => void
  progress: number
  slides: readonly WatchHomeTvCarouselSlide[]
}) {
  const [api, setApi] = useState<CarouselApi | null>(null)

  useEffect(() => {
    if (!api) return
    const activeIndex = slides.findIndex((slide) => slide.id === activeSlideId)
    if (activeIndex < 0) return

    api.scrollTo(activeIndex)
  }, [activeSlideId, api, slides])

  return (
    <div
      className="relative z-20 bg-black/45 py-4 backdrop-blur-sm"
      data-testid="watch-home-tv-rail"
    >
      <div className={cn("relative w-full", WATCH_PAGE_CONTENT_CLASSES)}>
        <Carousel
          opts={{
            align: "start",
            containScroll: "trimSnaps",
            dragFree: true,
            loop: true,
          }}
          setApi={setApi}
          className="-mx-5 w-[calc(100%+2.5rem)] pl-5 md:mx-0 md:w-full md:pl-0"
        >
          <CarouselContent
            className="-ml-4"
            viewportClassName="overflow-x-visible md:overflow-x-clip"
          >
            {slides.map((slide) => (
              <CarouselItem
                key={slide.id}
                className="basis-auto pl-4 md:basis-1/3 lg:basis-1/4"
              >
                <WatchHomeTvCard
                  slide={slide}
                  isActive={slide.id === activeSlideId}
                  progress={slide.id === activeSlideId ? progress : 0}
                  onSelect={() => onSelect(slide.id)}
                />
              </CarouselItem>
            ))}
          </CarouselContent>
          {slides.length > 2 ? (
            <>
              <CarouselPrevious
                className="hidden text-stone-900 hover:text-stone-900 md:inline-flex"
                label="Previous video preview"
              />
              <CarouselNext
                className="hidden text-stone-900 hover:text-stone-900 md:inline-flex"
                label="Next video preview"
              />
            </>
          ) : null}
        </Carousel>
      </div>
    </div>
  )
}

export function WatchHomeTvCarousel({
  sequence = null,
  slides,
}: WatchHomeTvCarouselProps) {
  const tBibleQuotes = useTranslations("BibleQuotes")
  const carouselSlides = useMemo(
    () => watchHomeHeroSlidesToTvCarouselSlides(slides),
    [slides],
  )
  const [shortFilmSlide, setShortFilmSlide] =
    useState<WatchHomeTvCarouselMuxSlide | null>(null)
  const [shortFilmPhase, setShortFilmPhase] =
    useState<WatchHomeShortFilmPhase | null>(null)
  const [shareSlide, setShareSlide] =
    useState<WatchHomeTvCarouselVideoSlide | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const shareLockedSlideId = shareSlide?.id ?? null
  const {
    activeSlide,
    advance,
    handleCanPlay,
    handleEnded,
    handleLoadedMetadata,
    handleTimeUpdate,
    isMuted,
    leavingSlide,
    mediaReady,
    playbackTimeSeconds,
    progress,
    selectSlide,
    slides: displaySlides,
    toggleMuted,
    videoRef,
  } = useWatchHomeTvCarousel(carouselSlides, sequence, {
    autoAdvancePausedForSlideId: shortFilmSlide?.id ?? shareLockedSlideId,
    suppressLeavingSlide: shortFilmSlide != null,
  })
  const [subtitleCueText, setSubtitleCueText] = useState<string | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const shortFilmTakeoverSlideIdRef = useRef<string | null>(null)
  const shareCloseTimeoutRef = useRef<number | null>(null)
  const shareWasPlayingRef = useRef(false)
  const [player, setPlayer] = useState<MuxPlayerRef | null>(null)
  const [overlayAnchor, setOverlayAnchor] = useState<HTMLDivElement | null>(
    null,
  )
  const handlePlayerReady = useCallback((next: MuxPlayerRef | null) => {
    if (shortFilmTakeoverSlideIdRef.current == null) return
    setPlayer((current) => (current === next ? current : next))
  }, [])
  const handleOpenShare = useCallback(
    (slide: WatchHomeTvCarouselVideoSlide) => {
      if (!isShareableCatalogSlide(slide)) return
      if (shareCloseTimeoutRef.current != null) {
        window.clearTimeout(shareCloseTimeoutRef.current)
        shareCloseTimeoutRef.current = null
      }
      setShareSlide(slide)
      setShareOpen(true)
      void loadWatchInteraction("share").catch(() => {})
    },
    [],
  )
  const handleCloseShare = useCallback(() => {
    setShareOpen(false)
    shareCloseTimeoutRef.current = window.setTimeout(() => {
      setShareSlide(null)
      shareCloseTimeoutRef.current = null
    }, WATCH_HOME_SHARE_CLOSE_DELAY_MS)
  }, [])
  const handleAdvance = useCallback(() => {
    if (shareLockedSlideId) return
    advance()
  }, [advance, shareLockedSlideId])
  const handleOpenShortFilm = useCallback(
    (slide: WatchHomeTvCarouselSlide) => {
      if (shareLockedSlideId) return
      if (slide.kind !== "mux" || !slide.src) return
      shortFilmTakeoverSlideIdRef.current = slide.id
      setShortFilmSlide(slide)
      setShortFilmPhase("transitioning")
      if (isMuted) toggleMuted()
      const video = videoRef.current
      if (!video) return
      setPlayer(video as MuxPlayerRef)
      video.muted = false
      const playResult = video.play()
      if (playResult && typeof playResult.catch === "function") {
        playResult.catch(() => undefined)
      }
    },
    [isMuted, shareLockedSlideId, toggleMuted, videoRef],
  )
  const handlePlayerChromeVisibilityChange = useCallback(
    (detail: WatchPlayerChromeVisibilityDetail) => {
      if (typeof window === "undefined") return
      window.dispatchEvent(
        new CustomEvent<WatchPlayerChromeVisibilityDetail>(
          WATCH_PLAYER_CHROME_VISIBILITY_EVENT,
          { detail },
        ),
      )
    },
    [],
  )

  useEffect(() => {
    const video = videoRef.current
    if (!video || shortFilmSlide == null) return
    video.muted = false
    video.controls = false
  }, [shortFilmSlide, videoRef])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (shareOpen) {
      shareWasPlayingRef.current = !video.paused
      if (shareWasPlayingRef.current) video.pause()
      return
    }

    if (!shareWasPlayingRef.current) return
    shareWasPlayingRef.current = false
    const playResult = video.play()
    if (playResult && typeof playResult.catch === "function") {
      playResult.catch(() => undefined)
    }
  }, [shareOpen, videoRef])

  useEffect(
    () => () => {
      if (shareCloseTimeoutRef.current != null) {
        window.clearTimeout(shareCloseTimeoutRef.current)
      }
    },
    [],
  )

  useEffect(() => {
    if (shortFilmSlide == null || shortFilmPhase !== "transitioning") return
    const timeout = window.setTimeout(() => {
      setShortFilmPhase("playing")
    }, WATCH_HOME_SHORT_FILM_TRANSITION_MS)
    return () => window.clearTimeout(timeout)
  }, [shortFilmPhase, shortFilmSlide])

  const fullPlayerMode =
    shortFilmSlide != null &&
    shortFilmPhase === "playing" &&
    activeSlide?.id === shortFilmSlide.id
  const playerTransitioning =
    shortFilmSlide != null &&
    shortFilmPhase === "transitioning" &&
    activeSlide?.id === shortFilmSlide.id
  const handleMediaEnded = useCallback(() => {
    if (shareLockedSlideId) return
    if (
      shortFilmTakeoverSlideIdRef.current != null &&
      activeSlide?.id === shortFilmTakeoverSlideIdRef.current
    ) {
      return
    }
    handleEnded()
  }, [activeSlide?.id, handleEnded, shareLockedSlideId])

  useEffect(() => {
    if (fullPlayerMode || playerTransitioning) return
    handlePlayerChromeVisibilityChange({ visible: true, opacity: 1 })
  }, [fullPlayerMode, playerTransitioning, handlePlayerChromeVisibilityChange])

  useEffect(() => {
    if (!fullPlayerMode) return

    const revealHeaderOffPlayer = () => {
      const rect = wrapperRef.current?.getBoundingClientRect()
      if (!rect) return
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) {
        handlePlayerChromeVisibilityChange({ visible: true, opacity: 1 })
      }
    }

    window.addEventListener("scroll", revealHeaderOffPlayer, { passive: true })
    window.addEventListener("resize", revealHeaderOffPlayer)
    return () => {
      window.removeEventListener("scroll", revealHeaderOffPlayer)
      window.removeEventListener("resize", revealHeaderOffPlayer)
    }
  }, [fullPlayerMode, handlePlayerChromeVisibilityChange])

  const handleSelectSlide = useCallback(
    (slideId: string) => {
      if (shareLockedSlideId) return
      shortFilmTakeoverSlideIdRef.current = null
      setShortFilmSlide(null)
      setShortFilmPhase(null)
      selectSlide(slideId)
    },
    [selectSlide, shareLockedSlideId],
  )

  if (!activeSlide) return null

  return (
    <section className="relative bg-black" data-testid="watch-home-tv-carousel">
      <h1 className="sr-only">Jesus Film Project Watch</h1>
      <div className="relative mx-auto h-[66svh] w-full max-w-[1920px] overflow-hidden bg-black md:h-[min(100svh,56.25vw)]">
        <WatchHomeTvMedia
          activeSlide={activeSlide}
          fullPlayerMode={fullPlayerMode}
          isMuted={isMuted}
          leavingSlide={leavingSlide}
          mediaReady={mediaReady}
          onCanPlay={handleCanPlay}
          onEnded={handleMediaEnded}
          onLoadedMetadata={handleLoadedMetadata}
          onPlayerReady={handlePlayerReady}
          onSubtitleCueTextChange={setSubtitleCueText}
          onTimeUpdate={handleTimeUpdate}
          playerTransitioning={playerTransitioning}
          videoRef={videoRef}
          wrapperRef={wrapperRef}
        />
        <WatchHomeTvOverlay
          activeSlide={activeSlide}
          exitingToPlayer={playerTransitioning}
          fullPlayerMode={fullPlayerMode}
          isMuted={isMuted}
          leavingSlide={leavingSlide}
          onNext={handleAdvance}
          onShare={handleOpenShare}
          onToggleMuted={toggleMuted}
          onWatchShortFilm={handleOpenShortFilm}
          playbackTimeSeconds={playbackTimeSeconds}
          shareLabel={tBibleQuotes("share")}
        />
        {subtitleCueText && !fullPlayerMode ? (
          <WatchHomeSubtitleOverlay cueText={subtitleCueText} />
        ) : null}
        {fullPlayerMode ? (
          <HeroPlayerControls
            player={player}
            playerRef={videoRef as unknown as RefObject<MuxPlayerRef | null>}
            wrapperRef={wrapperRef}
            overlayAnchor={overlayAnchor}
            playbackId={activeSlide.playbackId ?? undefined}
            showLanguageButton={false}
            onVisibilityChange={handlePlayerChromeVisibilityChange}
          />
        ) : null}
        {!fullPlayerMode ? (
          <div
            className={cn(
              "absolute right-5 bottom-4 z-30 flex gap-2 sm:hidden",
              playerTransitioning &&
                "watch-home-controls-exit pointer-events-none",
            )}
          >
            <NextVideoButton
              advanceDurationSeconds={watchHomeTvSlideAdvanceDurationSeconds(
                activeSlide,
              )}
              animationKey={activeSlide.id}
              onClick={handleAdvance}
              size="compact"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={isMuted ? "Unmute preview" : "Mute preview"}
              onClick={toggleMuted}
              className="h-11 w-11 rounded-full bg-black/35 text-white hover:bg-black/55"
            >
              {isMuted ? (
                <VolumeX className="size-7" aria-hidden />
              ) : (
                <Volume2 className="size-7" aria-hidden />
              )}
            </Button>
          </div>
        ) : null}
      </div>
      <div
        ref={setOverlayAnchor}
        data-testid="watch-home-player-overlay-anchor"
        className="relative z-40 mx-auto h-0 w-full max-w-[1920px]"
      />
      <WatchHomeTvRail
        slides={displaySlides}
        activeSlideId={activeSlide.id}
        progress={progress}
        onSelect={handleSelectSlide}
      />
      {shareSlide ? (
        <ShareModal
          open={shareOpen}
          videoSlug={shareSlide.shareVideoSlug ?? ""}
          currentLanguageSlug={shareSlide.shareLanguageSlug ?? ""}
          videoTitle={shareSlide.title}
          videoDescription={shareSlide.description}
          posterUrl={shareSlide.posterUrl}
          playbackId={shareSlide.playbackId}
          onClose={handleCloseShare}
        />
      ) : null}
    </section>
  )
}
