"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Image from "next/image"
import videojs from "video.js"
import type Player from "video.js/dist/types/player"
import "video.js/dist/video-js.css"
import type { FragmentOf } from "@forge/graphql"
import { videoCarouselFragment } from "@/lib/fragments/video-carousel"
import { VIDEO_JS_OPTIONS, formatTime } from "./Video"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
} from "@/components/ui/carousel"

export { videoCarouselFragment }

type CarouselVideoProps = {
  data: FragmentOf<typeof videoCarouselFragment>
}

type CarouselItemData = NonNullable<
  FragmentOf<typeof videoCarouselFragment>["items"]
>[number]

function CarouselVideoPlayer({
  src,
  poster,
}: {
  src: string
  poster?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const playerRef = useRef<Player | null>(null)
  const sliderRef = useRef<HTMLInputElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const durationRef = useRef(0)
  const userPausedRef = useRef(false)

  const [isMuted, setIsMuted] = useState(true)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    if (!videoRef.current) return

    const player = videojs(videoRef.current, {
      ...VIDEO_JS_OPTIONS,
      poster,
    })
    playerRef.current = player

    player.ready(() => {
      void player.src({ type: "application/x-mpegURL", src })

      player.on("durationchange", () => {
        const dur = player.duration() ?? 0
        durationRef.current = dur
        if (sliderRef.current) sliderRef.current.max = String(dur)
      })

      player.on("play", () => setIsPlaying(true))
      player.on("pause", () => setIsPlaying(false))
      player.on("volumechange", () => setIsMuted(player.muted() ?? true))
    })

    return () => {
      if (playerRef.current) {
        playerRef.current.dispose()
        playerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialize once on mount
  }, [])

  useEffect(() => {
    const p = playerRef.current
    if (!p || !src) return
    p.src({ type: "application/x-mpegURL", src })
    if (sliderRef.current) sliderRef.current.value = "0"
    if (timeRef.current) timeRef.current.textContent = "0:00 / 0:00"
    durationRef.current = 0
    void p.play()
  }, [src])

  useEffect(() => {
    let rafId: number
    const tick = () => {
      const p = playerRef.current
      if (p && !p.paused()) {
        const t = p.currentTime() ?? 0
        const d = p.duration() ?? durationRef.current
        if (sliderRef.current) sliderRef.current.value = String(t)
        if (timeRef.current) {
          timeRef.current.textContent = `${formatTime(t)} / ${formatTime(d)}`
        }
      }
      rafId = requestAnimationFrame(tick)
    }
    if (isPlaying) {
      rafId = requestAnimationFrame(tick)
    }
    return () => cancelAnimationFrame(rafId)
  }, [isPlaying])

  useEffect(() => {
    const handleFullscreenChange = () => {
      const el = containerRef.current
      setIsFullscreen(el != null && document.fullscreenElement === el)
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange)
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange)
  }, [])

  const handlePlayPause = useCallback(() => {
    const p = playerRef.current
    if (!p) return
    if (p.paused()) {
      userPausedRef.current = false
      void p.play()
    } else {
      userPausedRef.current = true
      p.pause()
    }
  }, [])

  const handleMuteToggle = useCallback(() => {
    const p = playerRef.current
    if (!p) return
    p.muted(!p.muted())
  }, [])

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const p = playerRef.current
    if (!p) return
    p.currentTime(Number(e.target.value))
  }, [])

  const handleFullscreen = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    if (document.fullscreenElement === el) {
      void document.exitFullscreen()
    } else {
      void el.requestFullscreen()
    }
  }, [])

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative block aspect-video overflow-hidden rounded-lg bg-black shadow-2xl shadow-stone-950/70">
        <div
          className="absolute inset-0 h-full w-full cursor-pointer"
          onClick={handlePlayPause}
        >
          <video
            className="video-js vjs-fluid vjs-default-skin absolute inset-0 h-full w-full object-cover"
            ref={videoRef}
            playsInline
          />
        </div>

        <button
          type="button"
          onClick={handleFullscreen}
          className="absolute top-4 right-4 z-30 flex h-10 w-10 items-center justify-center rounded-full bg-black/30 text-white transition hover:bg-black/50"
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        >
          {isFullscreen ? (
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
          )}
        </button>

        {isMuted && (
          <button
            type="button"
            onClick={handleMuteToggle}
            className="absolute top-1/2 left-1/2 z-30 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/30 p-6 text-white transition hover:bg-black/50"
            aria-label="Unmute video"
          >
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
          </button>
        )}

        {!isMuted && (
          <button
            type="button"
            onClick={handleMuteToggle}
            className="absolute top-4 left-4 z-30 flex h-10 w-10 items-center justify-center rounded-full bg-black/30 text-white transition hover:bg-black/50"
            aria-label="Mute video"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-5 w-5"
              aria-hidden
            >
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
            </svg>
          </button>
        )}

        <div className="absolute right-0 bottom-0 left-0 z-30 flex items-center gap-2 px-4 py-2">
          <button
            type="button"
            onClick={handlePlayPause}
            className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center text-white"
            aria-label={isPlaying ? "Pause video" : "Play video"}
          >
            {isPlaying ? (
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
            )}
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
            aria-label="Video progress"
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

function ThumbnailCard({
  item,
  isSelected,
  onClick,
}: {
  item: CarouselItemData
  isSelected: boolean
  onClick: () => void
}) {
  const imageUrl = item.imageUrl ?? item.video?.image?.url
  const title = item.titleOverride ?? item.video?.title ?? ""

  return (
    <div
      onClick={onClick}
      className={`group relative m-1 flex h-[240px] w-full cursor-pointer flex-col justify-end overflow-hidden rounded-lg ${
        isSelected ? "outline-4 outline-white" : ""
      }`}
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

      <div className="absolute top-1/2 left-1/2 hidden h-24 w-24 -translate-x-1/2 -translate-y-1/2 transform items-center justify-center rounded-full bg-stone-900/60 text-white group-hover:flex hover:bg-red-500">
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

      <div className="p-4">
        <span className="text-xs font-medium tracking-wider text-white/60 uppercase">
          Short Video
        </span>
        <h3 className="line-clamp-3 text-base leading-tight font-bold text-white/90">
          {title}
        </h3>
      </div>
    </div>
  )
}

export function CarouselVideo({ data }: CarouselVideoProps) {
  const { title, subtitle, carouselDescription, items } = data
  const validItems = items?.filter(
    (item): item is NonNullable<typeof item> => item != null,
  )

  const [selectedIndex, setSelectedIndex] = useState(0)

  if (!validItems?.length) return null

  const selectedItem = validItems[selectedIndex]
  const posterUrl =
    selectedItem.imageUrl ?? selectedItem.video?.image?.url ?? undefined

  const descriptionWords = carouselDescription?.split(" ") ?? []
  const boldPart = descriptionWords.slice(0, 4).join(" ")
  const restPart = descriptionWords.slice(4).join(" ")

  return (
    <div className="flex w-full flex-col gap-8">
      {(subtitle || title || carouselDescription) && (
        <div className="flex flex-col gap-1">
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

      <CarouselVideoPlayer src={selectedItem.streamingUrl} poster={posterUrl} />

      <Carousel
        opts={{
          align: "start",
          loop: false,
        }}
        className="w-full"
      >
        <CarouselContent className="-ml-5">
          {validItems.map((item, index) => (
            <CarouselItem key={item.id ?? index} className="max-w-[200px] pl-5">
              <ThumbnailCard
                item={item}
                isSelected={index === selectedIndex}
                onClick={() => setSelectedIndex(index)}
              />
            </CarouselItem>
          ))}
        </CarouselContent>
        {validItems.length > 3 && (
          <>
            <CarouselPrevious className="hidden md:flex" />
            <CarouselNext className="hidden md:flex" />
          </>
        )}
      </Carousel>
    </div>
  )
}
