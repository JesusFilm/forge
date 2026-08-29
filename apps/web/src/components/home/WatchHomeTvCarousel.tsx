"use client"

import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import {
  useCallback,
  useEffect,
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
import { Play, SkipForward, Volume2, VolumeX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { WATCH_PAGE_RAIL_PADDING_CLASSES } from "@/lib/content-width"
import { FORGE_SUBTITLE_TRACK_LABEL } from "@/components/watch/subtitle-track"
import { usePauseForWatchModal } from "@/components/watch/WatchModalActivityProvider"
import {
  WATCH_PLAYER_CHROME_VISIBILITY_EVENT,
  type WatchPlayerChromeVisibilityDetail,
} from "@/lib/watch-player-chrome-events"
import type { WatchHomeHeroSlide } from "@/lib/watch-home"
import type { WatchHomeCarouselSequenceData } from "@/lib/watch-home-carousel-sequence"
import { cn } from "@/lib/utils"
import {
  useWatchHomeTvCarousel,
  watchHomeTvAdvanceTargetSeconds,
  type WatchHomeTvCarouselSlide,
} from "@/components/home/useWatchHomeTvCarousel"
import { videoLabelMessageKey } from "@/lib/video-labels"
import { getWebVttCueText } from "@/lib/webvtt"

type WatchHomeTvCarouselProps = {
  slides: WatchHomeHeroSlide[]
  sequence?: WatchHomeCarouselSequenceData | null
}

function WatchHomeTvCarouselRegion({
  activeSlide,
  children,
}: {
  activeSlide: WatchHomeTvCarouselSlide
  children: ReactNode
}) {
  return (
    <section
      aria-label={activeSlide.title}
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

function PrimaryAction({
  playbackTimeSeconds,
  slide,
}: {
  playbackTimeSeconds: number
  slide: WatchHomeTvCarouselSlide
}) {
  const t = useTranslations("WatchHome")

  if (!slide.href) return null

  return (
    <Link
      href={appendAutoplaySignal(slide.href, playbackTimeSeconds) as Route}
      className="inline-flex h-11 min-w-0 max-w-full items-center gap-2 rounded-full bg-brand-red px-4 text-sm font-bold text-white shadow-[0_14px_32px_rgba(0,0,0,0.34)] transition hover:bg-brand-red/90 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none sm:h-14 sm:gap-3 sm:px-6 sm:text-lg"
    >
      <Play className="h-5 w-5 shrink-0 fill-current" aria-hidden />
      <span className="truncate">{t("watchNow")}</span>
    </Link>
  )
}

function WatchHomeTvMedia({
  activeSlide,
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
  const subtitleVttSrc = isMuted ? (activeSlide.subtitleVttSrc ?? null) : null
  const subtitleLanguageBcp47 = isMuted
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
  return (
    <div
      ref={wrapperRef}
      className="absolute inset-0 isolate z-0 overflow-hidden bg-black"
      data-testid="watch-home-tv-media-frame"
    >
      {leavingSlide ? (
        <WatchHomeTvVisualLayer
          key={`${leavingSlide.id}-leaving`}
          slide={leavingSlide}
          className="watch-home-media-exit z-0"
          priority={false}
        />
      ) : null}
      <WatchHomeTvVisualLayer
        key={`${activeSlide.id}-entering`}
        slide={activeSlide}
        className="watch-home-media-enter z-10"
        priority
      />
      {activeSlide.src ? (
        <MuxVideo
          key={activeSlide.id}
          ref={handleVideoRef}
          src={activeSlide.src}
          poster={activeSlide.posterUrl ?? undefined}
          muted={isMuted}
          playsInline
          disableTracking
          controls={false}
          crossOrigin="anonymous"
          onCanPlay={onCanPlay}
          onEnded={onEnded}
          onLoadedMetadata={onLoadedMetadata}
          onTimeUpdate={onTimeUpdate}
          className={cn(
            "absolute inset-0 z-20 h-full w-full opacity-0 transition-opacity duration-[900ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none",
            "object-cover",
            mediaReady ? "opacity-100" : "opacity-0",
          )}
        />
      ) : null}
      <div className="absolute inset-0 z-30 bg-[linear-gradient(180deg,rgba(0,0,0,0.18),rgba(0,0,0,0)_36%,rgba(0,0,0,0.35)_70%,rgba(0,0,0,0.72)_100%)]" />
      <div className="absolute inset-y-0 left-0 z-30 w-3/5 bg-[linear-gradient(90deg,rgba(0,0,0,0.48)_0%,rgba(0,0,0,0)_100%)]" />
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
  isMuted,
  leavingSlide,
  onNext,
  onToggleMuted,
  playbackTimeSeconds,
}: {
  activeSlide: WatchHomeTvCarouselSlide
  isMuted: boolean
  leavingSlide: WatchHomeTvCarouselSlide | null
  onNext: () => void
  onToggleMuted: () => void
  playbackTimeSeconds: number
}) {
  const t = useTranslations("WatchHome")
  const advanceDurationSeconds =
    watchHomeTvSlideAdvanceDurationSeconds(activeSlide)

  return (
    <div
      className={cn(
        "absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-4 pb-4 sm:pb-8",
        WATCH_PAGE_RAIL_PADDING_CLASSES,
      )}
    >
      <div className="relative min-w-0 flex-1 text-white drop-shadow-[0_2px_16px_rgba(0,0,0,0.7)]">
        {leavingSlide ? (
          <WatchHomeTvOverlayContent
            key={`${leavingSlide.id}-leaving-copy`}
            mode="leaving"
            playbackTimeSeconds={0}
            slide={leavingSlide}
          />
        ) : null}
        <WatchHomeTvOverlayContent
          key={`${activeSlide.id}-entering-copy`}
          enterDelayOffsetMs={leavingSlide ? 430 : 0}
          mode="entering"
          playbackTimeSeconds={playbackTimeSeconds}
          slide={activeSlide}
        />
      </div>
      <div className="hidden shrink-0 items-center gap-4 text-white sm:flex">
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

  if (slide.label === "Featured") return t("featured")
  return videoLabels(videoLabelMessageKey(slide.label))
}

function WatchHomeTvOverlayContent({
  enterDelayOffsetMs = 0,
  mode,
  playbackTimeSeconds,
  slide,
}: {
  enterDelayOffsetMs?: number
  mode: "entering" | "leaving"
  playbackTimeSeconds: number
  slide: WatchHomeTvCarouselSlide
}) {
  // One entry per overlay item: eyebrow, title, primary action.
  const enterDelays = [0, 70, 140]
  const exitDelays = [0, 35, 70]
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
          {slide.title}
        </p>
      </div>
      <div className={itemClassName} style={delayStyle(2)}>
        <PrimaryAction
          slide={slide}
          playbackTimeSeconds={playbackTimeSeconds}
        />
      </div>
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

export function WatchHomeTvCarousel({
  sequence = null,
  slides,
}: WatchHomeTvCarouselProps) {
  const t = useTranslations("WatchHome")
  const carouselSlides = useMemo(
    () => watchHomeHeroSlidesToTvCarouselSlides(slides),
    [slides],
  )
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
    toggleMuted,
    videoRef,
  } = useWatchHomeTvCarousel(carouselSlides, sequence)
  const [subtitleCueText, setSubtitleCueText] = useState<string | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const [player, setPlayer] = useState<MuxPlayerRef | null>(null)
  usePauseForWatchModal(player, activeSlide?.id ?? null)
  const handlePlayerReady = useCallback((next: MuxPlayerRef | null) => {
    setPlayer((current) => (current === next ? current : next))
  }, [])
  // Chrome visibility is shell-level state that survives client-side
  // navigation, so arriving from a watch page whose player hid the header has
  // to restore it explicitly.
  useEffect(() => {
    if (typeof window === "undefined") return
    window.dispatchEvent(
      new CustomEvent<WatchPlayerChromeVisibilityDetail>(
        WATCH_PLAYER_CHROME_VISIBILITY_EVENT,
        { detail: { visible: true, opacity: 1 } },
      ),
    )
  }, [])

  if (!activeSlide) return null

  return (
    <WatchHomeTvCarouselRegion activeSlide={activeSlide}>
      <div className="relative mx-auto h-[66svh] w-full max-w-[1920px] overflow-hidden bg-black md:h-[min(100svh,56.25vw)]">
        <WatchHomeTvMedia
          activeSlide={activeSlide}
          isMuted={isMuted}
          leavingSlide={leavingSlide}
          mediaReady={mediaReady}
          onCanPlay={handleCanPlay}
          onEnded={handleEnded}
          onLoadedMetadata={handleLoadedMetadata}
          onPlayerReady={handlePlayerReady}
          onSubtitleCueTextChange={setSubtitleCueText}
          onTimeUpdate={handleTimeUpdate}
          videoRef={videoRef}
          wrapperRef={wrapperRef}
        />
        <WatchHomeTvOverlay
          activeSlide={activeSlide}
          isMuted={isMuted}
          leavingSlide={leavingSlide}
          onNext={advance}
          onToggleMuted={toggleMuted}
          playbackTimeSeconds={playbackTimeSeconds}
        />
        {subtitleCueText ? (
          <WatchHomeSubtitleOverlay cueText={subtitleCueText} />
        ) : null}
        <div className="absolute right-5 bottom-4 z-30 flex gap-2 sm:hidden">
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
      </div>
    </WatchHomeTvCarouselRegion>
  )
}
