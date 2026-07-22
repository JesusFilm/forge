"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import MuxVideo from "@forge/video-player/mux-video"
import { useWatchModalMediaRef } from "@/components/watch/WatchModalActivityProvider"
import { useTranslations } from "next-intl"
import type { FragmentOf } from "@/lib/legacy-fragment-types"
import type { RouteVideo } from "@/lib/content"
import { formatDuration } from "@/lib/format-duration"
import { videoSectionFragment } from "@/lib/fragments/video-section"
import { WatchPlayerLoadingIndicator } from "@/components/watch/WatchPlayerLoadingIndicator"
import { resolvedBlockStreamingUrl } from "./video-dub"

export { videoSectionFragment }

type VideoProps = {
  data: FragmentOf<typeof videoSectionFragment>
  routeVideo?: RouteVideo | null
}

function FullscreenButton({
  isFullscreen,
  onClick,
}: {
  isFullscreen: boolean
  onClick: () => void
}) {
  const t = useTranslations("HeroPlayerControls")

  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute top-4 right-4 z-30 flex h-10 w-10 items-center justify-center rounded-full bg-black/30 text-white transition hover:bg-black/50"
      aria-label={isFullscreen ? t("exitFullscreen") : t("enterFullscreen")}
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
  )
}

function CenterUnmute({ onClick }: { onClick: () => void }) {
  const t = useTranslations("HeroPlayerControls")

  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute top-1/2 left-1/2 z-30 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/30 p-6 text-white transition hover:bg-black/50"
      aria-label={t("unmute")}
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
  )
}

function CornerMute({ onClick }: { onClick: () => void }) {
  const t = useTranslations("HeroPlayerControls")

  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute top-4 left-4 z-30 flex h-10 w-10 items-center justify-center rounded-full bg-black/30 text-white transition hover:bg-black/50"
      aria-label={t("mute")}
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
  )
}

function PlayPauseButton({
  isPlaying,
  onClick,
}: {
  isPlaying: boolean
  onClick: () => void
}) {
  const t = useTranslations("HeroPlayerControls")

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center text-white"
      aria-label={isPlaying ? t("pause") : t("play")}
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
  )
}

function MuxBackedVideoPlayer({
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
  const userPausedRef = useRef(false)

  const [isMuted, setIsMuted] = useState(true)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [loadingSrc, setLoadingSrc] = useState(src)
  if (loadingSrc !== src) {
    setLoadingSrc(src)
    setIsLoading(true)
  }

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

  // Mirror media events onto local state.
  useEffect(() => {
    if (!video) return
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onVolume = () => setIsMuted(video.muted)
    const onTime = () => syncPlaybackUi()
    const onDuration = () => syncPlaybackUi()
    const showLoading = () => setIsLoading(true)
    const hideLoading = () => setIsLoading(false)
    const hideLoadingIfReady = () => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        setIsLoading(false)
      }
    }
    video.addEventListener("play", onPlay)
    video.addEventListener("pause", onPause)
    video.addEventListener("volumechange", onVolume)
    video.addEventListener("timeupdate", onTime)
    video.addEventListener("durationchange", onDuration)
    video.addEventListener("loadstart", showLoading)
    video.addEventListener("waiting", showLoading)
    video.addEventListener("stalled", showLoading)
    video.addEventListener("seeking", showLoading)
    video.addEventListener("loadeddata", hideLoading)
    video.addEventListener("canplay", hideLoading)
    video.addEventListener("playing", hideLoading)
    video.addEventListener("seeked", hideLoadingIfReady)
    video.addEventListener("error", hideLoading)
    return () => {
      video.removeEventListener("play", onPlay)
      video.removeEventListener("pause", onPause)
      video.removeEventListener("volumechange", onVolume)
      video.removeEventListener("timeupdate", onTime)
      video.removeEventListener("durationchange", onDuration)
      video.removeEventListener("loadstart", showLoading)
      video.removeEventListener("waiting", showLoading)
      video.removeEventListener("stalled", showLoading)
      video.removeEventListener("seeking", showLoading)
      video.removeEventListener("loadeddata", hideLoading)
      video.removeEventListener("canplay", hideLoading)
      video.removeEventListener("playing", hideLoading)
      video.removeEventListener("seeked", hideLoadingIfReady)
      video.removeEventListener("error", hideLoading)
    }
  }, [syncPlaybackUi, video])

  // Viewport autoplay (preserves the videojs path's `autoplayOnViewport: true`).
  useEffect(() => {
    const evaluate = () => {
      const element = containerRef.current
      if (!video || !element) return
      const rect = element.getBoundingClientRect()
      const inView = rect.top < window.innerHeight && rect.bottom > 0
      if (inView) {
        if (!userPausedRef.current && video.paused) {
          void video.play().catch(() => {
            /* ignore autoplay rejection */
          })
        }
        return
      }
      if (!video.paused) {
        video.pause()
      }
    }
    evaluate()
    window.addEventListener("scroll", evaluate, { passive: true })
    return () => window.removeEventListener("scroll", evaluate)
  }, [video])

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
      userPausedRef.current = false
      void video.play().catch(() => {
        /* ignore */
      })
      return
    }
    userPausedRef.current = true
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
          className="absolute inset-0 h-full w-full cursor-pointer"
          onClick={handlePlayPause}
        >
          <MuxVideo
            ref={setVideoRef}
            src={src}
            poster={poster}
            muted
            playsInline
            // Inline section player excluded from full Mux Data v1 (cost
            // control). Default applied in MuxVideo wrapper; restated here
            // for clarity at the call site.
            disableTracking
            className="absolute inset-0 h-full w-full object-cover"
          />
        </div>

        <FullscreenButton
          isFullscreen={isFullscreen}
          onClick={handleFullscreen}
        />

        {isLoading ? (
          <div
            data-testid="video-player-loading"
            className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center"
          >
            <WatchPlayerLoadingIndicator />
          </div>
        ) : null}

        {isMuted && <CenterUnmute onClick={handleMuteToggle} />}
        {!isMuted && <CornerMute onClick={handleMuteToggle} />}

        <div className="absolute right-0 bottom-0 left-0 z-30 flex items-center gap-2 px-4 py-2">
          <PlayPauseButton isPlaying={isPlaying} onClick={handlePlayPause} />

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

export function VideoPlayer({ src, poster }: { src: string; poster?: string }) {
  return <MuxBackedVideoPlayer src={src} poster={poster} />
}

export function Video({ data, routeVideo }: VideoProps) {
  const { id, sectionKey, media, videoRef, useRouteVideo } = data
  const resolvedStreamingUrl =
    useRouteVideo === true
      ? (routeVideo?.streamingUrl ?? null)
      : resolvedBlockStreamingUrl(data)
  const posterUrl =
    useRouteVideo === true
      ? (routeVideo?.imageUrl ?? undefined)
      : (media?.url ?? videoRef?.images?.[0]?.url ?? undefined)

  if (!resolvedStreamingUrl) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[Video] Missing streaming URL for video section", {
        sectionKey,
        useRouteVideo,
      })
    }
    return null
  }

  return (
    <section
      id={id ?? undefined}
      data-section-key={sectionKey ?? undefined}
      data-testid="VideoSection"
      className="w-full"
    >
      <VideoPlayer src={resolvedStreamingUrl} poster={posterUrl} />
    </section>
  )
}
