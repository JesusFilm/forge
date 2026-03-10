"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import videojs from "video.js"
import type Player from "video.js/dist/types/player"
import "video.js/dist/video-js.css"
import type { FragmentOf } from "@forge/graphql"
import { videoSectionFragment } from "@/lib/fragments/video-section"

export { videoSectionFragment }

type VideoProps = {
  data: FragmentOf<typeof videoSectionFragment>
}

const VIDEO_JS_OPTIONS = {
  autoplay: false,
  controls: false,
  loop: true,
  muted: true,
  fluid: false,
  fill: true,
  responsive: false,
  playsInline: true,
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

function VideoPlayer({
  src,
  poster,
  onPlayerReady,
}: {
  src: string
  poster?: string
  onPlayerReady: (player: Player) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const playerRef = useRef<Player | null>(null)

  const [isMuted, setIsMuted] = useState(true)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    if (!videoRef.current || !src) return

    const player = videojs(videoRef.current, {
      ...VIDEO_JS_OPTIONS,
      poster,
    })
    playerRef.current = player

    player.ready(() => {
      onPlayerReady(player)

      void player.src({ type: "application/x-mpegURL", src })

      player.on("timeupdate", () => {
        setCurrentTime(player.currentTime() ?? 0)
        setDuration(player.duration() ?? 0)
      })

      player.on("durationchange", () => {
        setDuration(player.duration() ?? 0)
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
  }, [src, poster, onPlayerReady])

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement != null)
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange)
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange)
  }, [])

  const handlePlayPause = useCallback(() => {
    const p = playerRef.current
    if (!p) return
    if (p.paused()) {
      void p.play()
    } else {
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
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void el.requestFullscreen()
    }
  }, [])

  const handleViewportAutoplay = useCallback(() => {
    const el = containerRef.current
    const p = playerRef.current
    if (!el || !p) return

    const rect = el.getBoundingClientRect()
    const inView = rect.top < window.innerHeight && rect.bottom > 0
    if (inView && p.paused()) {
      void p.play()
    } else if (!inView && !p.paused()) {
      p.pause()
    }
  }, [])

  useEffect(() => {
    window.addEventListener("scroll", handleViewportAutoplay, {
      passive: true,
    })
    return () => window.removeEventListener("scroll", handleViewportAutoplay)
  }, [handleViewportAutoplay])

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

        {/* Fullscreen toggle */}
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

        {/* Center mute overlay (shown when muted) */}
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

        {/* Small unmute indicator (shown when unmuted) */}
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

        {/* Bottom controls */}
        <div className="absolute right-0 bottom-0 left-0 z-30 flex items-center gap-2 px-4 py-2">
          {/* Play/Pause */}
          <button
            type="button"
            onClick={handlePlayPause}
            className="flex h-10 w-10 shrink-0 items-center justify-center text-white"
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

          {/* Progress */}
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={currentTime}
            onChange={handleSeek}
            className="h-1 flex-1 cursor-pointer appearance-none rounded bg-white/30 accent-white [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
            aria-label="Video progress"
          />

          {/* Time */}
          <span className="ml-1 min-w-[60px] shrink-0 text-right text-xs text-white">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>
      </div>
    </div>
  )
}

export function Video({ data }: VideoProps) {
  const { id, sectionKey, streamingUrl, title, subtitle, media, video } = data
  const posterUrl = media?.url ?? video?.image?.url ?? undefined
  const handlePlayerReady = useCallback(() => {}, [])

  if (!streamingUrl) return null

  return (
    <section
      id={id ?? undefined}
      data-section-key={sectionKey ?? undefined}
      data-testid="VideoSection"
      className="w-full"
    >
      <VideoPlayer
        src={streamingUrl}
        poster={posterUrl}
        onPlayerReady={handlePlayerReady}
      />
      {(title ?? subtitle) && (
        <div className="mt-4 space-y-1">
          {title && (
            <h3 className="text-lg font-semibold text-stone-100">{title}</h3>
          )}
          {subtitle && <p className="text-sm text-stone-400">{subtitle}</p>}
        </div>
      )}
    </section>
  )
}
