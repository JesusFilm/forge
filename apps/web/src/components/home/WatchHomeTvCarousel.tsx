"use client"

import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from "react"
import type { MuxPlayerRef } from "@forge/video-player"
import MuxVideo from "@forge/video-player/mux-video"
import { useTranslations } from "next-intl"
import {
  Play,
  Share2,
  SkipForward,
  UserPlus,
  Volume2,
  VolumeX,
} from "lucide-react"
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
  VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS,
  VideoThumbnailInteractionFrame,
} from "@/components/ui/video-thumbnail-interaction-frame"
import {
  VideoThumbnailCaption,
  VideoThumbnailEyebrow,
  VideoThumbnailTitle,
} from "@/components/ui/video-thumbnail-caption"
import {
  WATCH_PAGE_CONTENT_CLASSES,
  WATCH_PAGE_RAIL_PADDING_CLASSES,
} from "@/lib/content-width"
import { FORGE_SUBTITLE_TRACK_LABEL } from "@/components/watch/subtitle-track"
import { HeroPlayerControls } from "@/components/watch/HeroPlayerControls"
import { useWatchModalMediaRef } from "@/components/watch/WatchModalActivityProvider"
import {
  WATCH_PLAYER_CHROME_VISIBILITY_EVENT,
  type WatchPlayerChromeVisibilityDetail,
} from "@/lib/watch-player-chrome-events"
import type { WatchHomeHeroSlide } from "@/lib/watch-home"
import type {
  WatchHomeCarouselSequenceData,
  WatchHomeTvCarouselMuxSlide,
} from "@/lib/watch-home-carousel-sequence"
import { cn } from "@/lib/utils"
import {
  useWatchHomeTvCarousel,
  watchHomeTvAdvanceTargetSeconds,
  type WatchHomeTvCarouselSlide,
} from "@/components/home/useWatchHomeTvCarousel"
import { videoLabelMessageKey } from "@/lib/video-labels"
import { getWebVttCueText } from "@/lib/webvtt"
import {
  useWatchHomeTvSlideCopy,
  watchHomeMuxActionMessageKey,
} from "@/components/home/useWatchHomeTvSlideCopy"

type WatchHomeTvCarouselProps = {
  slides: WatchHomeHeroSlide[]
  sequence?: WatchHomeCarouselSequenceData | null
}

type WatchHomeTakeover = {
  slideId: string
  phase: "transitioning" | "playing"
}

const WATCH_HOME_TAKEOVER_TRANSITION_MS = 360
const WATCH_HOME_TV_MEDIA_FRAME_ID = "watch-home-tv-media-frame"

export function watchHomePreviewOverlapPx({
  desktop,
  frameBottom,
  railHeight,
  viewportHeight,
}: {
  desktop: boolean
  frameBottom: number
  railHeight: number
  viewportHeight: number
}) {
  if (!desktop || railHeight <= 0 || viewportHeight <= 0) return 0
  return Math.max(
    0,
    Math.min(railHeight, Math.ceil(frameBottom + railHeight - viewportHeight)),
  )
}

function WatchHomeTvCarouselRegion({
  activeSlide,
  children,
}: {
  activeSlide: WatchHomeTvCarouselSlide
  children: ReactNode
}) {
  const copy = useWatchHomeTvSlideCopy(activeSlide)

  return (
    <section
      aria-label={copy.title}
      className="relative bg-black"
      data-testid="watch-home-tv-carousel"
    >
      {children}
    </section>
  )
}

function muxStreamUrl(playbackId: string | null) {
  return playbackId ? `https://stream.mux.com/${playbackId}.m3u8` : null
}

function muxThumbnailUrl(playbackId: string | null, width = 1280) {
  return playbackId
    ? `https://image.mux.com/${playbackId}/thumbnail.jpg?width=${width}&height=720&fit_mode=smartcrop`
    : null
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
  onPlayVideo,
  onWatchShortFilm,
  slide,
}: {
  onPlayVideo: (
    slide: WatchHomeTvCarouselSlide,
    options?: { focusControls?: boolean },
  ) => void
  onWatchShortFilm?: (slide: WatchHomeTvCarouselSlide) => void
  slide: WatchHomeTvCarouselSlide
}) {
  const t = useTranslations("WatchHome")
  const muxCopy = useTranslations("WatchHomeMuxInserts")
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
        <span className="truncate">{muxCopy("watchShortFilm")}</span>
      </button>
    ) : null

  if (slide.kind === "mux" && slide.action) {
    return (
      <div className="flex max-w-[calc(100vw-9rem)] flex-col items-start gap-3 sm:max-w-full sm:flex-row sm:items-center">
        <a href={slide.action.url} className={primaryClassName}>
          <PrimaryActionIcon icon={slide.action.icon} />
          <span className="truncate">
            {muxCopy(watchHomeMuxActionMessageKey(slide.action.copyId))}
          </span>
        </a>
        {secondaryAction}
      </div>
    )
  }

  if (slide.kind === "video" && slide.src) {
    return (
      <button
        type="button"
        aria-controls={WATCH_HOME_TV_MEDIA_FRAME_ID}
        className={primaryClassName}
        onClick={(event) =>
          onPlayVideo(slide, { focusControls: event.detail === 0 })
        }
      >
        <Play className="h-5 w-5 shrink-0 fill-current" aria-hidden />
        <span className="truncate">{t("watchNow")}</span>
      </button>
    )
  }

  if (slide.kind === "video" && slide.href) {
    return (
      <Link href={slide.href as Route} className={primaryClassName}>
        <Play className="h-5 w-5 shrink-0 fill-current" aria-hidden />
        <span className="truncate">{t("watchNow")}</span>
      </Link>
    )
  }

  return secondaryAction
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
  onMediaRef,
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
  onMediaRef: (player: MuxPlayerRef | null) => void
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
      onMediaRef((next ?? null) as MuxPlayerRef | null)
    },
    [onMediaRef, videoRef],
  )
  const takeoverActive = fullPlayerMode || playerTransitioning

  return (
    <div
      id={WATCH_HOME_TV_MEDIA_FRAME_ID}
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
        if (cue.text) texts.push(getWebVttCueText(cue))
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
  const copy = useWatchHomeTvSlideCopy(slide)

  return (
    <div
      className={cn("absolute inset-0", className)}
      data-testid="watch-home-tv-visual-layer"
    >
      {slide.posterUrl ? (
        <Image
          src={slide.posterUrl}
          alt={copy.imageAlt}
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
  onPlayVideo,
  onToggleMuted,
  onWatchShortFilm,
  previewBottomOffsetPx,
}: {
  activeSlide: WatchHomeTvCarouselSlide
  exitingToPlayer: boolean
  fullPlayerMode: boolean
  isMuted: boolean
  leavingSlide: WatchHomeTvCarouselSlide | null
  onNext: () => void
  onPlayVideo: (
    slide: WatchHomeTvCarouselSlide,
    options?: { focusControls?: boolean },
  ) => void
  onToggleMuted: () => void
  onWatchShortFilm: (slide: WatchHomeTvCarouselSlide) => void
  previewBottomOffsetPx: number
}) {
  const t = useTranslations("WatchHome")
  const advanceDurationSeconds =
    watchHomeTvSlideAdvanceDurationSeconds(activeSlide)

  if (fullPlayerMode && !exitingToPlayer) return null

  return (
    <div
      data-testid="watch-home-tv-overlay"
      className={cn(
        "absolute inset-x-0 z-10 flex items-end justify-between gap-4",
        fullPlayerMode
          ? "pointer-events-none bottom-16 pb-4 sm:hidden"
          : "bottom-0 pb-4 sm:pb-8",
        WATCH_PAGE_RAIL_PADDING_CLASSES,
      )}
      style={
        fullPlayerMode || exitingToPlayer
          ? undefined
          : { bottom: `${previewBottomOffsetPx}px` }
      }
    >
      <div className="relative min-w-0 flex-1 text-white drop-shadow-[0_2px_16px_rgba(0,0,0,0.7)]">
        {leavingSlide ? (
          <WatchHomeTvOverlayContent
            key={`${leavingSlide.id}-leaving-copy`}
            mode="leaving"
            onPlayVideo={onPlayVideo}
            slide={leavingSlide}
          />
        ) : null}
        <WatchHomeTvOverlayContent
          key={`${activeSlide.id}-${exitingToPlayer ? "player-exit" : "entering"}-copy`}
          enterDelayOffsetMs={leavingSlide ? 430 : 0}
          mode={exitingToPlayer ? "leaving" : "entering"}
          onPlayVideo={onPlayVideo}
          onWatchShortFilm={onWatchShortFilm}
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
            aria-label={isMuted ? t("unmutePreview") : t("mutePreview")}
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

function WatchHomeTvSlideLabel({ slide }: { slide: WatchHomeTvCarouselSlide }) {
  const t = useTranslations("WatchHome")
  const videoLabels = useTranslations("VideoLabels")
  const copy = useWatchHomeTvSlideCopy(slide)

  if (slide.kind === "mux") return copy.label
  if (slide.label === "Featured") return t("featured")
  return videoLabels(videoLabelMessageKey(slide.label))
}

function WatchHomeTvOverlayContent({
  enterDelayOffsetMs = 0,
  mode,
  onPlayVideo,
  onWatchShortFilm,
  showAction = true,
  slide,
}: {
  enterDelayOffsetMs?: number
  mode: "entering" | "leaving"
  onPlayVideo: (
    slide: WatchHomeTvCarouselSlide,
    options?: { focusControls?: boolean },
  ) => void
  onWatchShortFilm?: (slide: WatchHomeTvCarouselSlide) => void
  showAction?: boolean
  slide: WatchHomeTvCarouselSlide
}) {
  const copy = useWatchHomeTvSlideCopy(slide)
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
          <WatchHomeTvSlideLabel slide={slide} />
        </p>
        <p
          className={cn(
            itemClassName,
            "line-clamp-3 leading-tight font-extrabold sm:line-clamp-2",
            "text-3xl max-[360px]:text-2xl sm:text-5xl md:text-6xl",
          )}
          data-testid={
            mode === "entering" ? "watch-home-tv-active-title" : undefined
          }
          style={delayStyle(1)}
        >
          {copy.title}
        </p>
        {copy.description ? (
          <p
            className={cn(
              itemClassName,
              "mt-2 hidden max-w-[min(52rem,calc(100vw-2.5rem))] text-base leading-7 font-semibold text-white/78 sm:mt-3 sm:line-clamp-3 sm:block sm:text-lg md:text-xl",
            )}
            style={delayStyle(2)}
          >
            {copy.description}
          </p>
        ) : null}
      </div>
      {showAction ? (
        <div className={itemClassName} style={delayStyle(3)}>
          <PrimaryAction
            slide={slide}
            onPlayVideo={onPlayVideo}
            onWatchShortFilm={onWatchShortFilm}
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
  const t = useTranslations("WatchHome")
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
        aria-label={t("nextVideo")}
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
  const t = useTranslations("WatchHome")
  const copy = useWatchHomeTvSlideCopy(slide)

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group relative block aspect-video w-[clamp(13.5rem,68vw,26.25rem)] overflow-hidden rounded-lg bg-stone-950 text-left shadow-[0_2px_6px_rgba(0,0,0,0.35),0_14px_32px_-12px_rgba(0,0,0,0.6)] transition-[opacity,box-shadow] sm:w-[clamp(14.75rem,30vw,26.25rem)] md:w-full",
        VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS,
        isActive
          ? "opacity-100"
          : "opacity-62 hover:opacity-95 focus-visible:opacity-95 hover:shadow-[0_4px_10px_rgba(0,0,0,0.4),0_22px_44px_-14px_rgba(0,0,0,0.7)]",
      )}
      aria-pressed={isActive}
      aria-label={t("showVideo", { title: copy.title })}
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
      <VideoThumbnailCaption>
        <VideoThumbnailEyebrow as="p" size="compact-sm">
          <WatchHomeTvSlideLabel slide={slide} />
        </VideoThumbnailEyebrow>
        <VideoThumbnailTitle as="span" size="regular-sm">
          {copy.title}
        </VideoThumbnailTitle>
      </VideoThumbnailCaption>
      <div
        aria-hidden
        data-testid="watch-home-tv-card-bevel"
        className="pointer-events-none absolute inset-0 z-40 rounded-lg opacity-40 mix-blend-soft-light shadow-[inset_0_0_0_1px_rgba(255,255,255,0.7)]"
      />
      <VideoThumbnailInteractionFrame
        data-testid="watch-home-tv-card-hover-outline"
        interactive={!isActive}
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
  railRef,
  slides,
}: {
  activeSlideId: string
  onSelect: (slideId: string) => void
  progress: number
  railRef: RefObject<HTMLDivElement | null>
  slides: readonly WatchHomeTvCarouselSlide[]
}) {
  const t = useTranslations("WatchHome")
  const [api, setApi] = useState<CarouselApi | null>(null)

  useEffect(() => {
    if (!api) return
    const activeIndex = slides.findIndex((slide) => slide.id === activeSlideId)
    if (activeIndex < 0) return

    api.scrollTo(activeIndex)
  }, [activeSlideId, api, slides])

  return (
    <div
      ref={railRef}
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
                label={t("previousVideoPreview")}
              />
              <CarouselNext
                className="hidden text-stone-900 hover:text-stone-900 md:inline-flex"
                label={t("nextVideoPreview")}
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
  const t = useTranslations("WatchHome")
  const carouselSlides = useMemo(
    () => watchHomeHeroSlidesToTvCarouselSlides(slides),
    [slides],
  )
  const [takeover, setTakeover] = useState<WatchHomeTakeover | null>(null)
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
    pinActiveSlide,
    progress,
    selectSlide,
    setMuted,
    slides: displaySlides,
    toggleMuted,
    videoRef,
  } = useWatchHomeTvCarousel(carouselSlides, sequence, {
    autoAdvancePausedForSlideId: takeover?.slideId ?? null,
    suppressLeavingSlide: takeover != null,
  })
  const [subtitleCueText, setSubtitleCueText] = useState<string | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const previewFrameRef = useRef<HTMLDivElement | null>(null)
  const railRef = useRef<HTMLDivElement | null>(null)
  const [previewOverlapPx, setPreviewOverlapPx] = useState(0)
  const [previewMeasured, setPreviewMeasured] = useState(false)
  const takeoverGenerationRef = useRef(0)
  const focusPlayerControlsRef = useRef(false)
  const restoreWatchNowFocusRef = useRef(false)
  const { media: player, setMediaRef } = useWatchModalMediaRef<MuxPlayerRef>(
    activeSlide?.id ?? null,
  )
  const handleMediaRef = useCallback(
    (next: MuxPlayerRef | null) => {
      if (next) pinActiveSlide()
      setMediaRef(next)
    },
    [pinActiveSlide, setMediaRef],
  )
  const [overlayAnchor, setOverlayAnchor] = useState<HTMLDivElement | null>(
    null,
  )
  const handleOpenPlayer = useCallback(
    (
      slide: WatchHomeTvCarouselSlide,
      options: { focusControls?: boolean } = {},
    ) => {
      const muxTakeoverEligible =
        slide.kind === "mux" && slide.secondaryAction != null
      if (!slide.src || (slide.kind !== "video" && !muxTakeoverEligible)) return

      const video = videoRef.current
      if (!video) return

      const generation = takeoverGenerationRef.current + 1
      takeoverGenerationRef.current = generation
      focusPlayerControlsRef.current = options.focusControls === true
      setTakeover({ slideId: slide.id, phase: "transitioning" })
      setMuted(false)

      const rollbackRejectedTakeover = () => {
        if (takeoverGenerationRef.current !== generation) return
        restoreWatchNowFocusRef.current = options.focusControls === true
        focusPlayerControlsRef.current = false
        setMuted(true)
        setTakeover(null)
      }

      try {
        const playResult = video.play()
        if (playResult && typeof playResult.catch === "function") {
          void playResult.catch(rollbackRejectedTakeover)
        }
      } catch {
        rollbackRejectedTakeover()
      }
    },
    [setMuted, videoRef],
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
    if (takeover?.phase !== "transitioning") return
    const slideId = takeover.slideId
    const timeout = window.setTimeout(() => {
      setTakeover((current) =>
        current?.slideId === slideId && current.phase === "transitioning"
          ? { ...current, phase: "playing" }
          : current,
      )
    }, WATCH_HOME_TAKEOVER_TRANSITION_MS)
    return () => window.clearTimeout(timeout)
  }, [takeover])

  const fullPlayerMode =
    takeover?.phase === "playing" && activeSlide?.id === takeover.slideId
  const playerTransitioning =
    takeover?.phase === "transitioning" && activeSlide?.id === takeover.slideId
  const effectivePreviewOverlapPx = takeover == null ? previewOverlapPx : 0

  const handleMediaEnded = useCallback(() => {
    if (takeover != null && activeSlide?.id === takeover.slideId) return
    handleEnded()
  }, [activeSlide.id, handleEnded, takeover])

  useEffect(() => {
    if (fullPlayerMode || playerTransitioning) return
    handlePlayerChromeVisibilityChange({ visible: true, opacity: 1 })
  }, [fullPlayerMode, playerTransitioning, handlePlayerChromeVisibilityChange])

  useEffect(
    () => () => {
      handlePlayerChromeVisibilityChange({ visible: true, opacity: 1 })
    },
    [handlePlayerChromeVisibilityChange],
  )

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

  useEffect(() => {
    if (!fullPlayerMode || !focusPlayerControlsRef.current) return
    focusPlayerControlsRef.current = false
    overlayAnchor?.querySelector<HTMLButtonElement>("button")?.focus()
  }, [fullPlayerMode, overlayAnchor])

  useEffect(() => {
    if (takeover != null || !restoreWatchNowFocusRef.current) return
    restoreWatchNowFocusRef.current = false
    previewFrameRef.current
      ?.querySelector<HTMLButtonElement>(
        `button[aria-controls="${WATCH_HOME_TV_MEDIA_FRAME_ID}"]`,
      )
      ?.focus()
  }, [takeover])

  useLayoutEffect(() => {
    const frame = previewFrameRef.current
    const rail = railRef.current
    if (!frame || !rail) return

    let animationFrame = 0
    const syncOverlap = () => {
      animationFrame = 0
      const desktop =
        typeof window.matchMedia === "function"
          ? window.matchMedia("(min-width: 768px)").matches
          : window.innerWidth >= 768
      if (!desktop) {
        setPreviewOverlapPx(0)
        setPreviewMeasured(true)
        return
      }
      const frameRect = frame.getBoundingClientRect()
      const railRect = rail.getBoundingClientRect()
      setPreviewOverlapPx(
        watchHomePreviewOverlapPx({
          desktop,
          frameBottom: frameRect.bottom,
          railHeight: railRect.height,
          viewportHeight: window.innerHeight,
        }),
      )
      setPreviewMeasured(true)
    }
    const scheduleSync = () => {
      if (animationFrame !== 0) return
      animationFrame = window.requestAnimationFrame(syncOverlap)
    }

    syncOverlap()
    window.addEventListener("resize", scheduleSync, { passive: true })
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleSync)
    observer?.observe(frame)
    observer?.observe(rail)

    return () => {
      window.removeEventListener("resize", scheduleSync)
      observer?.disconnect()
      if (animationFrame !== 0) window.cancelAnimationFrame(animationFrame)
    }
  }, [displaySlides.length])

  const handleSelectSlide = useCallback(
    (slideId: string) => {
      if (takeover != null && slideId === activeSlide.id) return
      takeoverGenerationRef.current += 1
      focusPlayerControlsRef.current = false
      setTakeover(null)
      setMuted(true)
      selectSlide(slideId)
    },
    [activeSlide.id, selectSlide, setMuted, takeover],
  )

  if (!activeSlide) return null

  return (
    <WatchHomeTvCarouselRegion activeSlide={activeSlide}>
      <div
        ref={previewFrameRef}
        data-preview-overlap={effectivePreviewOverlapPx > 0 ? "true" : "false"}
        data-preview-overlap-px={effectivePreviewOverlapPx}
        data-preview-measured={previewMeasured ? "true" : "false"}
        data-testid="watch-home-tv-preview-frame"
        className={cn(
          "relative mx-auto h-[66svh] w-full max-w-[1920px] overflow-hidden bg-black md:h-[min(100svh,56.25vw)]",
          previewMeasured &&
            "transition-[margin-bottom] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        )}
        style={{
          marginBottom:
            effectivePreviewOverlapPx > 0
              ? `${-effectivePreviewOverlapPx}px`
              : "0px",
        }}
      >
        <WatchHomeTvMedia
          activeSlide={activeSlide}
          fullPlayerMode={fullPlayerMode}
          isMuted={isMuted}
          leavingSlide={leavingSlide}
          mediaReady={mediaReady}
          onCanPlay={handleCanPlay}
          onEnded={handleMediaEnded}
          onLoadedMetadata={handleLoadedMetadata}
          onMediaRef={handleMediaRef}
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
          onNext={advance}
          onPlayVideo={handleOpenPlayer}
          onToggleMuted={toggleMuted}
          onWatchShortFilm={handleOpenPlayer}
          previewBottomOffsetPx={effectivePreviewOverlapPx}
        />
        {activeSlide.kind === "video" &&
        activeSlide.src &&
        !fullPlayerMode &&
        !playerTransitioning ? (
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            data-testid="watch-home-player-click-surface"
            onClick={() => handleOpenPlayer(activeSlide)}
            className="absolute inset-0 z-[5] cursor-pointer bg-transparent focus:outline-none"
          />
        ) : null}
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
              onClick={advance}
              size="compact"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={isMuted ? t("unmutePreview") : t("mutePreview")}
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
        railRef={railRef}
      />
    </WatchHomeTvCarouselRegion>
  )
}
