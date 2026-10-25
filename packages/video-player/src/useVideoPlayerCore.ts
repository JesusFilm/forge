"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type RefObject,
} from "react"
import videojs from "video.js"
import type Player from "video.js/dist/types/player"

export const VIDEO_JS_OPTIONS = {
  autoplay: false,
  controls: false,
  loop: true,
  muted: true,
  fluid: false,
  fill: true,
  responsive: false,
  playsInline: true,
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00"
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const mins = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const paddedSecs = secs.toString().padStart(2, "0")
  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, "0")}:${paddedSecs}`
  }
  return `${mins}:${paddedSecs}`
}

export type VideoPlayerCoreOptions = {
  src: string
  poster?: string
  textTracks?: VideoPlayerTextTrack[]
  onPlayerReady?: (player: Player) => void
  autoplayOnViewport?: boolean
  playOnSourceChange?: boolean
  nativeControls?: boolean
}

export type VideoPlayerTextTrack = {
  src: string
  label: string
  languageCode: string
  kind?: "subtitles" | "captions" | "chapters"
  isDefault?: boolean
}

export type VideoPlayerCoreResult = {
  containerRef: RefObject<HTMLDivElement | null>
  videoRef: RefObject<HTMLVideoElement | null>
  sliderRef: RefObject<HTMLInputElement | null>
  timeRef: RefObject<HTMLSpanElement | null>
  isMuted: boolean
  isPlaying: boolean
  isFullscreen: boolean
  handlePlayPause: () => void
  handleMuteToggle: () => void
  handleSeek: (event: ChangeEvent<HTMLInputElement>) => void
  handleFullscreen: () => void
}

export function useVideoPlayerCore({
  src,
  poster,
  textTracks = [],
  onPlayerReady,
  autoplayOnViewport = false,
  playOnSourceChange = false,
  nativeControls = false,
}: VideoPlayerCoreOptions): VideoPlayerCoreResult {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const playerRef = useRef<Player | null>(null)
  const sliderRef = useRef<HTMLInputElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const durationRef = useRef(0)
  const userPausedRef = useRef(false)
  const sourceRef = useRef<string | null>(null)
  const onPlayerReadyRef = useRef(onPlayerReady)
  const remoteTextTracksRef = useRef<unknown[]>([])

  const [isMuted, setIsMuted] = useState(true)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    onPlayerReadyRef.current = onPlayerReady
  }, [onPlayerReady])

  const resetPlaybackUi = useCallback(() => {
    durationRef.current = 0
    if (sliderRef.current) {
      sliderRef.current.value = "0"
      sliderRef.current.max = "100"
    }
    if (timeRef.current) {
      timeRef.current.textContent = "0:00 / 0:00"
    }
    setIsPlaying(false)
  }, [])

  const syncPlaybackUi = useCallback(() => {
    const player = playerRef.current
    if (!player) return

    const currentTime = player.currentTime() ?? 0
    const duration = player.duration() ?? 0

    durationRef.current = duration

    if (sliderRef.current) {
      sliderRef.current.max = String(duration)
      sliderRef.current.value = String(currentTime)
    }

    if (timeRef.current) {
      timeRef.current.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`
    }
  }, [])

  const evaluateViewportAutoplay = useCallback(() => {
    if (!autoplayOnViewport) return

    const player = playerRef.current
    const element = containerRef.current
    if (!player || !element) return

    const rect = element.getBoundingClientRect()
    const inView = rect.top < window.innerHeight && rect.bottom > 0

    if (inView) {
      if (!userPausedRef.current && player.paused()) {
        void player.play()
      }
      return
    }

    if (!player.paused()) {
      player.pause()
    }
  }, [autoplayOnViewport])

  const applySource = useCallback(
    (nextSrc: string) => {
      const player = playerRef.current
      if (!player) return
      if (sourceRef.current === nextSrc) return

      sourceRef.current = nextSrc
      void player.src({ type: "application/x-mpegURL", src: nextSrc })
      resetPlaybackUi()

      if (playOnSourceChange) {
        userPausedRef.current = false
        void player.play()
        return
      }

      evaluateViewportAutoplay()
    },
    [evaluateViewportAutoplay, playOnSourceChange, resetPlaybackUi],
  )

  const clearRemoteTextTracks = useCallback(() => {
    const player = playerRef.current
    if (!player) return

    for (const track of remoteTextTracksRef.current) {
      player.removeRemoteTextTrack(track as never)
    }

    remoteTextTracksRef.current = []
  }, [])

  const applyTextTracks = useCallback(
    (nextTracks: VideoPlayerTextTrack[]) => {
      const player = playerRef.current
      if (!player) return

      clearRemoteTextTracks()

      if (nextTracks.length === 0) {
        return
      }

      remoteTextTracksRef.current = nextTracks.map((track) =>
        player.addRemoteTextTrack(
          {
            kind: track.kind ?? "subtitles",
            src: track.src,
            label: track.label,
            srclang: track.languageCode,
            default: track.isDefault ?? false,
          },
          false,
        ),
      )

      const activeTrack =
        nextTracks.find(
          (track) =>
            (track.kind ?? "subtitles") !== "chapters" && track.isDefault,
        ) ??
        nextTracks.find(
          (track) => (track.kind ?? "subtitles") !== "chapters",
        ) ??
        null
      const activeLanguage = activeTrack?.languageCode ?? null
      const playerTracks = Array.from(
        player.textTracks() as unknown as ArrayLike<TextTrack>,
      )

      for (const track of playerTracks) {
        if (!track) {
          continue
        }

        if (track.kind === "chapters") {
          track.mode = "hidden"
          continue
        }

        track.mode =
          activeLanguage != null && track.language === activeLanguage
            ? "showing"
            : "disabled"
      }
    },
    [clearRemoteTextTracks],
  )

  useEffect(() => {
    const videoEl = videoRef.current
    if (!videoEl) return

    const videoParent = videoEl.parentNode
    const videoNextSibling = videoEl.nextSibling
    const videoPlayerClasses = Array.from(videoEl.classList)
    const player = videojs(videoEl, {
      ...VIDEO_JS_OPTIONS,
      controls: nativeControls,
      poster,
    })
    // The official Video.js stylesheet scopes control accessibility text under
    // `.video-js`; preserve that class on the generated player root.
    player.el().classList.add("video-js", ...videoPlayerClasses)
    playerRef.current = player

    const handleDurationChange = () => {
      syncPlaybackUi()
    }

    const handlePlay = () => setIsPlaying(true)
    const handlePause = () => setIsPlaying(false)
    const handleVolumeChange = () => setIsMuted(player.muted() ?? true)

    player.on("durationchange", handleDurationChange)
    player.on("play", handlePlay)
    player.on("pause", handlePause)
    player.on("volumechange", handleVolumeChange)

    player.ready(() => {
      onPlayerReadyRef.current?.(player)
      if (sourceRef.current) {
        applySource(sourceRef.current)
      }
      evaluateViewportAutoplay()
    })

    return () => {
      player.off("durationchange", handleDurationChange)
      player.off("play", handlePlay)
      player.off("pause", handlePause)
      player.off("volumechange", handleVolumeChange)
      player.dispose()
      if (videoParent && !videoEl.isConnected) {
        if (videoNextSibling?.parentNode === videoParent) {
          videoParent.insertBefore(videoEl, videoNextSibling)
        } else {
          videoParent.appendChild(videoEl)
        }
      }
      playerRef.current = null
      sourceRef.current = null
      remoteTextTracksRef.current = []
    }
  }, [
    applySource,
    applyTextTracks,
    evaluateViewportAutoplay,
    nativeControls,
    syncPlaybackUi,
  ])

  useEffect(() => {
    applySource(src)
  }, [applySource, src])

  useEffect(() => {
    applyTextTracks(textTracks)
  }, [applyTextTracks, textTracks])

  useEffect(() => {
    if (!isPlaying) {
      return
    }

    let animationFrameId = requestAnimationFrame(function tick() {
      syncPlaybackUi()
      animationFrameId = requestAnimationFrame(tick)
    })

    return () => {
      cancelAnimationFrame(animationFrameId)
    }
  }, [isPlaying, syncPlaybackUi])

  useEffect(() => {
    const player = playerRef.current
    if (!player) return
    player.poster(poster ?? "")
  }, [poster])

  useEffect(() => {
    if (!autoplayOnViewport) return

    const handleScroll = () => {
      evaluateViewportAutoplay()
    }

    evaluateViewportAutoplay()
    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => {
      window.removeEventListener("scroll", handleScroll)
    }
  }, [autoplayOnViewport, evaluateViewportAutoplay])

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
    const player = playerRef.current
    if (!player) return

    if (player.paused()) {
      userPausedRef.current = false
      void player.play()
      return
    }

    userPausedRef.current = true
    player.pause()
  }, [])

  const handleMuteToggle = useCallback(() => {
    const player = playerRef.current
    if (!player) return
    player.muted(!player.muted())
  }, [])

  const handleSeek = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const player = playerRef.current
      if (!player) return
      player.currentTime(Number(event.target.value))
      syncPlaybackUi()
    },
    [syncPlaybackUi],
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

  return {
    containerRef,
    videoRef,
    sliderRef,
    timeRef,
    isMuted,
    isPlaying,
    isFullscreen,
    handlePlayPause,
    handleMuteToggle,
    handleSeek,
    handleFullscreen,
  }
}
