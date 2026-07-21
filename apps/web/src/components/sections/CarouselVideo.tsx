"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Image from "next/image"
import MuxVideo from "@forge/video-player/mux-video"
import { useWatchModalMediaRef } from "@/components/watch/WatchModalActivityProvider"
import { useTranslations } from "next-intl"
import type {
  FragmentOf,
  LegacyFragmentValue,
} from "@/lib/legacy-fragment-types"
import { formatDuration } from "@/lib/format-duration"
import { videoCarouselFragment } from "@/lib/fragments/video-carousel"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
} from "@/components/ui/carousel"
import {
  VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS,
  VideoThumbnailInteractionFrame,
} from "@/components/ui/video-thumbnail-interaction-frame"
import {
  CAROUSEL_BLEED_CLASSES,
  CAROUSEL_CONTENT_PADDING,
  CAROUSEL_END_SPACER,
} from "@/lib/content-width"
import { cn } from "@/lib/utils"

export { videoCarouselFragment }

type CarouselVideoProps = {
  data: FragmentOf<typeof videoCarouselFragment>
}

type CarouselItemData = NonNullable<
  NonNullable<FragmentOf<typeof videoCarouselFragment>["items"]>[number]
>

function FullscreenIcon({ isFullscreen }: { isFullscreen: boolean }) {
  return isFullscreen ? (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden
    >
      <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
    </svg>
  ) : (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden
    >
      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
    </svg>
  )
}

function MutedCenterIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-10 w-10"
      aria-hidden
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  )
}

function VolumeOnIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-5 w-5"
      aria-hidden
    >
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
    </svg>
  )
}

function PlayIcon({ isPlaying }: { isPlaying: boolean }) {
  return isPlaying ? (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-6 w-6"
      aria-hidden
    >
      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
    </svg>
  ) : (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-6 w-6"
      aria-hidden
    >
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

function MuxBackedCarouselVideoPlayer({
  src,
  poster,
}: {
  src: string
  poster?: string
}) {
  const t = useTranslations("HeroPlayerControls")
  const containerRef = useRef<HTMLDivElement>(null)
  const {
    media: video,
    mediaRef: videoRef,
    setMediaRef: setVideoRef,
  } = useWatchModalMediaRef<HTMLVideoElement>(src)
  const sliderRef = useRef<HTMLInputElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const lastAppliedSrcRef = useRef<string | null>(null)

  const [isMuted, setIsMuted] = useState(true)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const formatTime = useCallback(
    (seconds: number) =>
      Number.isFinite(seconds) && seconds >= 0
        ? formatDuration(seconds)
        : "0:00",
    [],
  )

  const syncPlaybackUi = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    const currentTime = video.currentTime ?? 0
    const duration = Number.isFinite(video.duration) ? video.duration : 0
    if (sliderRef.current) {
      sliderRef.current.max = String(duration)
      sliderRef.current.value = String(currentTime)
    }
    if (timeRef.current) {
      timeRef.current.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`
    }
  }, [formatTime, videoRef])

  // Mirror media events to local state.
  useEffect(() => {
    if (!video) return
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onVolume = () => setIsMuted(video.muted)
    const onTime = () => syncPlaybackUi()
    const onDuration = () => syncPlaybackUi()
    video.addEventListener("play", onPlay)
    video.addEventListener("pause", onPause)
    video.addEventListener("volumechange", onVolume)
    video.addEventListener("timeupdate", onTime)
    video.addEventListener("durationchange", onDuration)
    return () => {
      video.removeEventListener("play", onPlay)
      video.removeEventListener("pause", onPause)
      video.removeEventListener("volumechange", onVolume)
      video.removeEventListener("timeupdate", onTime)
      video.removeEventListener("durationchange", onDuration)
    }
  }, [syncPlaybackUi, video])

  // Auto-play on src change (preserves the videojs path's
  // `playOnSourceChange: true`).
  useEffect(() => {
    if (!video) return
    if (lastAppliedSrcRef.current === src) return
    lastAppliedSrcRef.current = src
    void video.play().catch(() => {
      /* ignore — autoplay may be blocked */
    })
  }, [src, video])

  useEffect(() => {
    const handleFullscreenChange = () => {
      const element = containerRef.current
      setIsFullscreen(element != null && document.fullscreenElement === element)
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange)
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange)
  }, [])

  const handlePlayPause = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      void video.play().catch(() => {
        /* ignore */
      })
      return
    }
    video.pause()
  }, [videoRef])

  const handleMuteToggle = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
  }, [videoRef])

  const handleSeek = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const video = videoRef.current
      if (!video) return
      video.currentTime = Number(event.target.value)
      syncPlaybackUi()
    },
    [syncPlaybackUi, videoRef],
  )

  const handleFullscreen = useCallback(() => {
    const element = containerRef.current
    if (!element) return
    if (document.fullscreenElement === element) {
      void document.exitFullscreen()
      return
    }
    void element.requestFullscreen()
  }, [])

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative block aspect-video overflow-hidden rounded-lg bg-black shadow-2xl shadow-stone-950/70">
        <div
          role="button"
          tabIndex={0}
          className="absolute inset-0 h-full w-full cursor-pointer"
          onClick={handlePlayPause}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              handlePlayPause()
            }
          }}
          aria-label={isPlaying ? t("pause") : t("play")}
        >
          <MuxVideo
            ref={setVideoRef}
            src={src}
            poster={poster}
            muted
            playsInline
            // Carousel inline player excluded from full Mux Data v1 (cost
            // control). Default applied in MuxVideo wrapper; restated here
            // for clarity at the call site.
            disableTracking
            className="absolute inset-0 h-full w-full object-cover"
          />
        </div>

        <button
          type="button"
          onClick={handleFullscreen}
          className="absolute top-4 right-4 z-30 flex h-10 w-10 items-center justify-center rounded-full bg-black/30 text-white transition hover:bg-black/50"
          aria-label={isFullscreen ? t("exitFullscreen") : t("enterFullscreen")}
        >
          <FullscreenIcon isFullscreen={isFullscreen} />
        </button>

        {isMuted && (
          <button
            type="button"
            onClick={handleMuteToggle}
            className="absolute top-1/2 left-1/2 z-30 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/30 p-6 text-white transition hover:bg-black/50"
            aria-label={t("unmute")}
          >
            <MutedCenterIcon />
          </button>
        )}

        {!isMuted && (
          <button
            type="button"
            onClick={handleMuteToggle}
            className="absolute top-4 left-4 z-30 flex h-10 w-10 items-center justify-center rounded-full bg-black/30 text-white transition hover:bg-black/50"
            aria-label={t("mute")}
          >
            <VolumeOnIcon />
          </button>
        )}

        <div className="absolute right-0 bottom-0 left-0 z-30 flex items-center gap-2 px-4 py-2">
          <button
            type="button"
            onClick={handlePlayPause}
            className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center text-white"
            aria-label={isPlaying ? t("pause") : t("play")}
          >
            <PlayIcon isPlaying={isPlaying} />
          </button>

          <input
            ref={sliderRef}
            type="range"
            min={0}
            max={100}
            defaultValue={0}
            step="any"
            onChange={handleSeek}
            className="h-1 flex-1 cursor-pointer appearance-none rounded bg-white/30 accent-white [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
            aria-label={t("seek")}
          />

          <span
            ref={timeRef}
            className="ml-1 min-w-[60px] shrink-0 text-right text-xs text-white"
          >
            0:00 / 0:00
          </span>
        </div>
      </div>
    </div>
  )
}

function CarouselVideoPlayer({
  src,
  poster,
}: {
  src: string
  poster?: string
}) {
  return <MuxBackedCarouselVideoPlayer src={src} poster={poster} />
}

function ThumbnailCard({
  item,
  isSelected,
  onClick,
}: {
  item: CarouselItemData
  isSelected: boolean
  onClick: () => void
}) {
  const t = useTranslations("WatchHome")
  const videoLabels = useTranslations("VideoLabels")
  const imageUrl = item.imageUrl ?? item.video?.images?.[0]?.url
  const title = item.titleOverride ?? item.video?.title ?? ""

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onClick()
        }
      }}
      aria-label={t("showVideo", { title })}
      className={cn(
        "group relative m-1 flex h-[240px] w-full cursor-pointer flex-col justify-end overflow-hidden rounded-lg",
        VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS,
      )}
      style={{
        backgroundColor: item.backgroundColor ?? "#1a1a1a",
      }}
    >
      {imageUrl && (
        <Image
          width={200}
          height={240}
          src={imageUrl}
          alt={title}
          className="absolute top-0 h-[150px] w-full overflow-hidden object-cover mask-[linear-gradient(to_bottom,rgba(0,0,0,1)_50%,transparent_100%)] mask-cover"
        />
      )}

      <div className="absolute top-1/2 left-1/2 hidden h-24 w-24 -translate-x-1/2 -translate-y-1/2 transform items-center justify-center rounded-full bg-stone-900/60 text-white group-hover:flex hover:bg-brand-red">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-20 w-20"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden
        >
          <path d="M8 5v14l11-7z" />
        </svg>
      </div>

      <VideoThumbnailInteractionFrame
        data-testid="carousel-video-thumbnail-frame"
        interactive={!isSelected}
        visible={isSelected}
      />

      <div className="p-4">
        <span className="text-xs font-medium tracking-wider text-white/60 uppercase">
          {videoLabels("shortFilm")}
        </span>
        <h3 className="line-clamp-3 text-base leading-tight font-bold text-white/90">
          {title}
        </h3>
      </div>
    </div>
  )
}

export function CarouselVideo({ data }: CarouselVideoProps) {
  const t = useTranslations("WatchHome")
  const { title, subtitle, carouselDescription, items } = data
  const validItems = items?.filter(
    (item: LegacyFragmentValue): item is NonNullable<typeof item> =>
      item != null,
  )

  const [selectedIndex, setSelectedIndex] = useState(0)

  if (!validItems?.length) return null

  const clampedIndex = Math.min(selectedIndex, validItems.length - 1)
  const selectedItem = validItems[clampedIndex]
  const posterUrl =
    selectedItem.imageUrl ?? selectedItem.video?.images?.[0]?.url ?? undefined

  const descriptionWords = carouselDescription?.split(" ") ?? []
  const boldPart = descriptionWords.slice(0, 4).join(" ")
  const restPart = descriptionWords.slice(4).join(" ")

  return (
    <div className="flex w-full flex-col gap-8">
      {(subtitle || title || carouselDescription) && (
        <div className="flex flex-col gap-1" data-testid="carousel-copy">
          {subtitle && (
            <h4 className="mb-0 text-sm font-semibold tracking-wider text-red-100/70 uppercase xl:mb-1 xl:text-base 2xl:text-lg">
              {subtitle}
            </h4>
          )}
          {title && (
            <h3 className="mb-0 text-2xl font-bold text-white text-balance xl:text-3xl 2xl:text-4xl">
              {title}
            </h3>
          )}
          {carouselDescription && (
            <p className="mt-2 text-lg leading-relaxed text-stone-200/80 xl:text-xl">
              <span className="font-bold text-white">{boldPart}</span>
              {restPart ? ` ${restPart}` : ""}
            </p>
          )}
        </div>
      )}

      {selectedItem.streamingUrl && (
        <CarouselVideoPlayer
          src={selectedItem.streamingUrl}
          poster={posterUrl}
        />
      )}

      <div className={CAROUSEL_BLEED_CLASSES}>
        <Carousel
          opts={{
            align: "start",
            loop: false,
          }}
          className="w-full"
        >
          <CarouselContent className={`-ml-5 ${CAROUSEL_CONTENT_PADDING}`}>
            {validItems.map((item: LegacyFragmentValue, index: number) => (
              <CarouselItem
                key={item.id ?? index}
                className="max-w-[200px] pl-5"
              >
                <ThumbnailCard
                  item={item}
                  isSelected={index === clampedIndex}
                  onClick={() => setSelectedIndex(index)}
                />
              </CarouselItem>
            ))}
            <CarouselItem className="basis-auto pl-0" aria-hidden="true">
              <div className={CAROUSEL_END_SPACER} />
            </CarouselItem>
          </CarouselContent>
          {validItems.length > 3 && (
            <>
              <CarouselPrevious
                className="hidden md:flex"
                label={t("previousVideoPreview")}
              />
              <CarouselNext
                className="hidden md:flex"
                label={t("nextVideoPreview")}
              />
            </>
          )}
        </Carousel>
      </div>
    </div>
  )
}
