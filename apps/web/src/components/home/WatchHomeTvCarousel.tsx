"use client"

import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import {
  memo,
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
import { Play, Volume2, VolumeX } from "lucide-react"
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
  WATCH_HOME_TV_IMAGE_SLIDE_ADVANCE_SECONDS,
  WATCH_HOME_TV_TIMELINE_FUTURE_COUNT,
  useWatchHomeTvCarousel,
  watchHomeTvAdvanceTargetSeconds,
  type WatchHomeTvCarouselSlide,
} from "@/components/home/useWatchHomeTvCarousel"
import { videoLabelMessageKey } from "@/lib/video-labels"
import {
  useWatchHomeHeroFittedHeight,
  useWatchHomeHeroScrollPause,
} from "@/components/home/useWatchHomeHero"
import { WATCH_MUTED_INTRO_HEIGHT_CLASS } from "@/lib/watch-home-hero-fit"
import {
  WATCH_HERO_PRIMARY_ACTION_CLASS,
  WatchHeroOverlay,
} from "@/components/watch/WatchHeroOverlay"
import { resolveMuxHeroPosterUrlAtMaxWidth } from "@/lib/url"
import { WATCH_HERO_BODY_OVERLAP_CSS } from "@/lib/watch-hero-preview-overlap"
import { WATCH_PRODUCTION_PLAYER_OVERLAY_BACKGROUND } from "@/lib/watch-production-overlays"
import { getWebVttCueText } from "@/lib/webvtt"

type WatchHomeTvCarouselProps = {
  slides: WatchHomeHeroSlide[]
  sequence?: WatchHomeCarouselSequenceData | null
  /**
   * Pin the intro and let the body scroll over it. False for an authored hero
   * block placed mid-page: it renders inside the body zone, so it has nothing
   * above it to pin against and nothing to be covered by.
   */
  pinned?: boolean
}

function WatchHomeTvCarouselRegion({
  activeSlide,
  children,
  pinned,
}: {
  activeSlide: WatchHomeTvCarouselSlide
  children: ReactNode
  pinned: boolean
}) {
  return (
    <section
      aria-label={activeSlide.title}
      // Pinned, like the watch-page hero: the body scrolls UP over the intro
      // instead of the intro scrolling away, and `z-0` keeps it below the body
      // zone that covers it. An authored hero placed mid-page is NOT pinned —
      // it sits inside that body zone, so pinning it would leave it stuck at
      // the top under content that measures as covering all of it.
      className={cn("bg-black", pinned ? "sticky top-0 z-0" : "relative")}
      data-testid="watch-home-tv-carousel"
      data-pinned={pinned ? "true" : "false"}
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
    // Frame-first for the hero, authored-first for the card below. The admin
    // library holds only mobile derivatives for these videos (measured 640x300
    // for `mobileCinematicHigh`), which a full-bleed intro upscales about
    // fourfold; the Mux frame is 1280x720 from the same warm derivative the
    // watch-page hero requests. At card size the authored image has pixels to
    // spare, so it stays preferred there.
    // `||`, not `??`: a present-but-blank `imageUrl` is a real admin shape,
    // and `??` would both keep it and suppress the Mux tier below it.
    const posterUrl =
      resolveMuxHeroPosterUrlAtMaxWidth(slide.playbackId) ||
      slide.imageUrl ||
      muxThumbnail

    return {
      kind: "video",
      id: slide.coreId,
      title: slide.title,
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
      // The watch page's primary hero action, so both surfaces show the same
      // pill; `min-w-0 max-w-full` keeps a long title from stretching it.
      className={cn(WATCH_HERO_PRIMARY_ACTION_CLASS, "min-w-0 max-w-full")}
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
      // The hero frame stays on the 1920px content rail so the overlay copy
      // lines up with the rest of the page, but the media itself bleeds to the
      // viewport edges the way the watch-page hero does. `<main>` carries
      // `overflow-x-clip` (see WatchHomePage/WatchHomeExperiencePage), so the
      // 100vw span never adds horizontal scroll.
      style={
        {
          "--watch-hero-body-overlap": WATCH_HERO_BODY_OVERLAP_CSS,
        } as CSSProperties
      }
      className={cn(
        "absolute top-0 left-1/2 isolate z-0 w-screen max-w-none -translate-x-1/2 overflow-hidden bg-black",
        // While muted the media reaches below the frame's flow bottom so the
        // video continues behind the panel that covers it, the way a watch
        // page's hero runs on under its body. Unmuting drops it, exactly as
        // revealing that hero's chrome drops its overlap to zero.
        isMuted
          ? "bottom-[calc(-1_*_var(--watch-hero-body-overlap))]"
          : "bottom-0",
      )}
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
      {/* Muted preview wears the exact scrim the watch-page hero uses for its
          own muted state (`hero-player-muted-backdrop`), so the home intro and
          the inner pages read identically while sound is off. Unmuting drops
          the flat dim — same as the hero revealing its chrome — and falls back
          to the legibility gradients the overlay copy needs. */}
      <div
        aria-hidden
        data-testid="watch-home-tv-muted-backdrop"
        className={cn(
          "pointer-events-none absolute inset-0 z-30 [background:var(--watch-player-muted-backdrop)] transition-opacity duration-500 motion-reduce:transition-none",
          isMuted ? "opacity-100" : "opacity-0",
        )}
        style={
          {
            "--watch-player-muted-backdrop":
              WATCH_PRODUCTION_PLAYER_OVERLAY_BACKGROUND,
          } as CSSProperties
        }
      />
      <div
        aria-hidden
        data-testid="watch-home-tv-unmuted-scrim"
        className={cn(
          "pointer-events-none absolute inset-0 z-30 bg-[linear-gradient(180deg,rgba(0,0,0,0.18),rgba(0,0,0,0)_36%,rgba(0,0,0,0.35)_70%,rgba(0,0,0,0.72)_100%)] transition-opacity duration-500 motion-reduce:transition-none",
          isMuted ? "opacity-0" : "opacity-100",
        )}
      />
      <div
        aria-hidden
        data-testid="watch-home-tv-unmuted-scrim"
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 z-30 w-3/5 bg-[linear-gradient(90deg,rgba(0,0,0,0.48)_0%,rgba(0,0,0,0)_100%)] transition-opacity duration-500 motion-reduce:transition-none",
          isMuted ? "opacity-0" : "opacity-100",
        )}
      />
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
  activeIndex,
  activeSlide,
  isMuted,
  leavingSlide,
  onSelectSlide,
  onToggleMuted,
  playbackTimeSeconds,
  slides,
}: {
  activeIndex: number
  activeSlide: WatchHomeTvCarouselSlide
  isMuted: boolean
  leavingSlide: WatchHomeTvCarouselSlide | null
  onSelectSlide: (slideId: string) => void
  onToggleMuted: () => void
  playbackTimeSeconds: number
  slides: readonly WatchHomeTvCarouselSlide[]
}) {
  const t = useTranslations("WatchHome")
  const advanceDurationSeconds =
    watchHomeTvSlideAdvanceDurationSeconds(activeSlide)

  return (
    <div
      className={cn(
        "absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-4 pb-4 sm:pb-8 compact-landscape:pb-4",
        WATCH_PAGE_RAIL_PADDING_CLASSES,
      )}
      data-testid="watch-home-tv-overlay"
    >
      <div className="min-w-0 flex-1 text-white drop-shadow-[0_2px_16px_rgba(0,0,0,0.7)]">
        <div className="relative">
          {leavingSlide ? (
            <WatchHomeTvOverlayContent
              key={`${leavingSlide.id}-leaving-copy`}
              mode="leaving"
              slide={leavingSlide}
            />
          ) : null}
          <WatchHomeTvOverlayContent
            key={`${activeSlide.id}-entering-copy`}
            enterDelayOffsetMs={leavingSlide ? 430 : 0}
            mode="entering"
            slide={activeSlide}
          />
        </div>
        <div
          data-testid="watch-home-tv-actions"
          className="mt-3 flex flex-nowrap items-center gap-x-3 sm:mt-4 sm:gap-x-5 compact-landscape:mt-1 compact-landscape:gap-x-3"
        >
          <PrimaryAction
            slide={activeSlide}
            playbackTimeSeconds={playbackTimeSeconds}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={isMuted ? t("unmutePreview") : t("mutePreview")}
            onClick={onToggleMuted}
            className="group/mute relative isolate h-11 w-11 overflow-hidden rounded-full border-0 bg-black/55 text-white shadow-lg shadow-black/30 ring-0 hover:scale-105 hover:bg-black/70 hover:text-white focus-visible:bg-black/70 focus-visible:text-white focus-visible:ring-2 focus-visible:ring-white/80 active:scale-95 md:h-13 md:w-13"
          >
            {isMuted ? (
              <VolumeX className="relative z-10 size-7" aria-hidden />
            ) : (
              <Volume2 className="relative z-10 size-7" aria-hidden />
            )}
            <span
              aria-hidden
              data-testid="watch-home-mute-bevel"
              className="pointer-events-none absolute inset-0 z-20 rounded-[inherit] mix-blend-overlay shadow-[inset_0_0_0_1px_rgba(255,255,255,0.28)] transition-shadow duration-200 group-hover/mute:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.48)]"
            />
          </Button>
          <div className="ml-auto flex shrink-0 items-center text-white sm:hidden">
            <WatchHomeVideoTimeline
              activeIndex={activeIndex}
              advanceDurationSeconds={advanceDurationSeconds}
              animationKey={activeSlide.id}
              onSelectSlide={onSelectSlide}
              size="compact"
              slides={slides}
            />
          </div>
        </div>
      </div>
      <div className="hidden shrink-0 items-center gap-4 text-white sm:flex">
        <WatchHomeVideoTimeline
          activeIndex={activeIndex}
          advanceDurationSeconds={advanceDurationSeconds}
          animationKey={activeSlide.id}
          onSelectSlide={onSelectSlide}
          size="large"
          slides={slides}
        />
      </div>
    </div>
  )
}

function watchHomeTvSlideAdvanceDurationSeconds(
  slide: WatchHomeTvCarouselSlide,
) {
  if (!slide.src) return WATCH_HOME_TV_IMAGE_SLIDE_ADVANCE_SECONDS
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
  slide,
}: {
  enterDelayOffsetMs?: number
  mode: "entering" | "leaving"
  slide: WatchHomeTvCarouselSlide
}) {
  // One entry per rotating copy item. The action row stays mounted outside
  // this keyed subtree so a slide advance cannot steal keyboard focus.
  const enterDelays = [0, 70]
  const exitDelays = [0, 35]
  const itemClassName =
    mode === "entering" ? "watch-home-copy-enter" : "watch-home-copy-exit"
  // Positioning only — WatchHeroOverlay owns the copy stack itself.
  const wrapperClassName =
    mode === "leaving"
      ? "pointer-events-none absolute bottom-0 left-0 w-full sm:gap-4"
      : "relative sm:gap-4"
  const delayStyle = (index: number) => {
    const delay =
      mode === "entering"
        ? enterDelayOffsetMs + enterDelays[index]
        : exitDelays[index]
    return { "--watch-home-copy-delay": `${delay}ms` } as CSSProperties
  }

  return (
    // The watch page's hero copy block, reused: same eyebrow, same title
    // treatment. What differs is passed in — the title is a `p` here because
    // the page heading lives outside the carousel. Player actions stay in an
    // unkeyed sibling so focus survives automatic slide changes.
    <WatchHeroOverlay
      className={wrapperClassName}
      ariaHidden={mode === "leaving"}
      label={<WatchHomeTvSlideLabel slide={slide} />}
      labelSlot={{ className: itemClassName, style: delayStyle(0) }}
      title={slide.title}
      titleAs="p"
      titleTestId={
        mode === "entering" ? "watch-home-tv-active-title" : undefined
      }
      titleSlot={{
        className: cn(itemClassName, "line-clamp-3 sm:line-clamp-2"),
        style: delayStyle(1),
      }}
    />
  )
}

function watchHomeVideoTimelineItems(
  activeIndex: number,
  slides: readonly WatchHomeTvCarouselSlide[],
) {
  if (slides.length === 0 || activeIndex < 0 || activeIndex >= slides.length) {
    return []
  }

  const items: Array<{
    offset: number
    slide: WatchHomeTvCarouselSlide
  }> = []
  const seenSlideIds = new Set<string>()
  const addItem = (offset: number) => {
    const index = activeIndex + offset
    if (index < 0 || index >= slides.length) return
    const slide = slides[index]
    if (!slide || seenSlideIds.has(slide.id)) return
    seenSlideIds.add(slide.id)
    items.push({ offset, slide })
  }

  addItem(-1)
  addItem(0)
  for (
    let offset = 1;
    offset <= WATCH_HOME_TV_TIMELINE_FUTURE_COUNT;
    offset++
  ) {
    addItem(offset)
  }

  return items
}

function WatchHomePlaybackProgressRing({
  advanceDurationSeconds,
  animationKey,
  showResetRing,
  size,
}: {
  advanceDurationSeconds: number
  animationKey: string
  showResetRing: boolean
  size: "large" | "compact"
}) {
  const radius = size === "large" ? 26 : 20
  const circumference = 2 * Math.PI * radius
  const svgSize = size === "large" ? 60 : 46
  const center = svgSize / 2
  return (
    <svg
      aria-hidden
      data-testid="watch-home-current-progress"
      className="pointer-events-none absolute inset-1/2 z-30 -translate-x-1/2 -translate-y-1/2 -rotate-90 overflow-visible"
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
          data-testid="watch-home-progress-reset"
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
  )
}

const WatchHomeVideoTimeline = memo(function WatchHomeVideoTimeline({
  activeIndex,
  advanceDurationSeconds,
  animationKey,
  onSelectSlide,
  size,
  slides,
}: {
  activeIndex: number
  advanceDurationSeconds: number
  animationKey: string
  onSelectSlide: (slideId: string) => void
  size: "large" | "compact"
  slides: readonly WatchHomeTvCarouselSlide[]
}) {
  const t = useTranslations("WatchHome")
  const items = useMemo(() => {
    const timelineItems = watchHomeVideoTimelineItems(activeIndex, slides)

    return size === "compact"
      ? timelineItems.filter(({ offset }) => offset === 0 || offset === 1)
      : timelineItems
  }, [activeIndex, size, slides])
  const completedRef = useRef(false)
  const focusedSlideIdRef = useRef<string | null>(null)
  const previousAnimationKeyRef = useRef(animationKey)
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const [showResetRing, setShowResetRing] = useState(false)
  const buttonClassName =
    size === "large" ? "h-12 w-12 rounded-full" : "h-9 w-9 rounded-full"
  const imageSize = size === "large" ? "48px" : "36px"

  useEffect(() => {
    const focusedSlideId = focusedSlideIdRef.current
    if (
      !focusedSlideId ||
      items.some(({ slide }) => slide.id === focusedSlideId) ||
      document.activeElement !== document.body
    ) {
      return
    }

    timelineRef.current
      ?.querySelector<HTMLButtonElement>('[aria-current="true"]')
      ?.focus({ preventScroll: true })
  }, [items])

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
    <div
      ref={timelineRef}
      data-size={size}
      data-testid="watch-home-video-timeline"
      className={cn(
        "flex shrink-0 items-center",
        size === "large" ? "gap-2.5" : "gap-1.5",
      )}
    >
      {items.map(({ offset, slide }) => {
        const isCurrent = offset === 0
        const thumbnailUrl = slide.thumbnailUrl || slide.posterUrl

        return (
          <div
            key={slide.id}
            data-offset={offset}
            data-testid="watch-home-video-circle"
            className="relative grid shrink-0 place-items-center"
          >
            {isCurrent ? (
              <WatchHomePlaybackProgressRing
                advanceDurationSeconds={advanceDurationSeconds}
                animationKey={animationKey}
                showResetRing={showResetRing}
                size={size}
              />
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-current={isCurrent ? "true" : undefined}
              aria-disabled={isCurrent ? "true" : undefined}
              aria-label={
                isCurrent ? slide.title : t("showVideo", { title: slide.title })
              }
              onBlur={() => {
                focusedSlideIdRef.current = null
              }}
              onFocus={() => {
                focusedSlideIdRef.current = slide.id
              }}
              onClick={() => {
                if (!isCurrent) onSelectSlide(slide.id)
              }}
              className={cn(
                buttonClassName,
                "group relative isolate overflow-hidden border-0 bg-black/35 p-0 text-white shadow-[0_4px_18px_rgba(0,0,0,0.35)] transition-[opacity,transform] hover:scale-105 hover:bg-black/45 focus-visible:ring-2 focus-visible:ring-white",
                !isCurrent && "opacity-65 hover:opacity-100",
              )}
            >
              <Play className="relative z-0 size-5 fill-current" aria-hidden />
              {thumbnailUrl ? (
                <>
                  <Image
                    src={thumbnailUrl}
                    alt=""
                    fill
                    loading="lazy"
                    sizes={imageSize}
                    className="z-10 object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  <span
                    aria-hidden
                    className={cn(
                      "absolute inset-0 z-20 transition-colors",
                      isCurrent
                        ? "bg-black/5"
                        : "bg-black/20 group-hover:bg-black/5",
                    )}
                  />
                </>
              ) : null}
              <span
                aria-hidden
                data-testid="watch-home-video-bevel"
                className="pointer-events-none absolute inset-0 z-30 rounded-[inherit] mix-blend-overlay shadow-[inset_0_0_0_1px_rgba(255,255,255,0.28)] transition-shadow duration-200 group-hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.48)]"
              />
            </Button>
          </div>
        )
      })}
    </div>
  )
})

export function WatchHomeTvCarousel({
  pinned = true,
  sequence = null,
  slides,
}: WatchHomeTvCarouselProps) {
  const carouselSlides = useMemo(
    () => watchHomeHeroSlidesToTvCarouselSlides(slides),
    [slides],
  )
  const {
    activeIndex,
    activeSlide,
    handleCanPlay,
    handleEnded,
    handleLoadedMetadata,
    handleTimeUpdate,
    isMuted,
    leavingSlide,
    mediaReady,
    playbackTimeSeconds,
    selectSlide,
    slides: timelineSlides,
    toggleMuted,
    videoRef,
  } = useWatchHomeTvCarousel(carouselSlides, sequence)
  const [subtitleCueText, setSubtitleCueText] = useState<string | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  // Separate from wrapperRef: that one is on the media layer, which reaches
  // below the frame while muted. Coverage must be measured against the frame
  // the viewer actually sees.
  const heroFrameRef = useRef<HTMLDivElement | null>(null)
  const [player, setPlayer] = useState<MuxPlayerRef | null>(null)
  usePauseForWatchModal(player, activeSlide?.id ?? null)
  const fittedHeroHeight = useWatchHomeHeroFittedHeight(pinned && isMuted)
  useWatchHomeHeroScrollPause({
    enabled: pinned,
    fittedHeight: fittedHeroHeight,
    heroRef: heroFrameRef,
    player,
    videoRef,
  })
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
    <WatchHomeTvCarouselRegion activeSlide={activeSlide} pinned={pinned}>
      {/* Two things this frame does NOT do. It has no `overflow-hidden` — the
          media layer below deliberately spans the full viewport width and
          clips itself. And while muted it stands shorter than the 16:9 frame
          by the same ceiling `HeroPlayer` pulls its episode rail up by, so the
          muted intro reads at the height an inner watch page's muted preview
          does; unmuting expands it back, the way revealing the hero's chrome
          drops that overlap to zero. */}
      <div
        ref={heroFrameRef}
        style={
          {
            // Measured fit wins once hydrated; the classes below are the
            // pre-hydration estimate it refines (and the fallback when the
            // page has no categories rail to measure).
            ...(fittedHeroHeight != null
              ? { height: `${fittedHeroHeight}px` }
              : {}),
          } as CSSProperties
        }
        className={cn(
          "relative mx-auto w-full max-w-[1920px] bg-black transition-[height] duration-[700ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          isMuted
            ? // Short enough for the categories rail to sit fully inside the
              // first viewport, floored so a squat window keeps a usable intro
              // rather than collapsing it. `min(…, 56.25vw)` also keeps the
              // watch-page behaviour where the overlap stops biting once the
              // 16:9 frame already leaves room below.
              WATCH_MUTED_INTRO_HEIGHT_CLASS
            : "h-[66svh] md:h-[min(100svh,56.25vw)]",
        )}
      >
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
          activeIndex={activeIndex}
          activeSlide={activeSlide}
          isMuted={isMuted}
          leavingSlide={leavingSlide}
          onSelectSlide={selectSlide}
          onToggleMuted={toggleMuted}
          playbackTimeSeconds={playbackTimeSeconds}
          slides={timelineSlides}
        />
        {subtitleCueText ? (
          <WatchHomeSubtitleOverlay cueText={subtitleCueText} />
        ) : null}
      </div>
    </WatchHomeTvCarouselRegion>
  )
}
