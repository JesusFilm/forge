"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { MuxPlayerRef } from "@forge/video-player"

import { ChromeButton, formatTime } from "./ChromeButton"
import {
  ChromeMutedIcon,
  ChromeVolumeIcon,
  EnterFullscreenIcon,
  ExitFullscreenIcon,
  PauseIcon,
  PlayIcon,
} from "./chrome-icons"

export function HeroPlayerControls({
  player,
  playerRef,
  wrapperRef,
}: {
  player: MuxPlayerRef | null
  playerRef: React.RefObject<MuxPlayerRef | null>
  wrapperRef: React.RefObject<HTMLDivElement | null>
}) {
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [bufferedPct, setBufferedPct] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [hoveringControls, setHoveringControls] = useState(false)
  const [volumeOpen, setVolumeOpen] = useState(false)
  const [volumeDragging, setVolumeDragging] = useState(false)
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const volumeTrackRef = useRef<HTMLDivElement | null>(null)
  const hideTimerRef = useRef<number | null>(null)

  // Refs let scheduleHide read the latest playing/hovering state without
  // resubscribing the wrapper-level mousemove listener on every render.
  // Writes happen in commit-phase effects so concurrent rendering replays
  // can't leave the refs in interim/abandoned states.
  const playingRef = useRef(false)
  const hoveringControlsRef = useRef(false)
  useEffect(() => {
    playingRef.current = playing
  }, [playing])
  useEffect(() => {
    hoveringControlsRef.current = hoveringControls
  }, [hoveringControls])

  const volumeDraggingRef = useRef(false)
  useEffect(() => {
    volumeDraggingRef.current = volumeDragging
  }, [volumeDragging])

  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
    // Don't auto-hide while playing-paused, while user hovers controls, or
    // while user is actively dragging the volume slider — losing the slider
    // mid-drag drops pointer capture and leaves volumeDragging stuck.
    if (
      !playingRef.current ||
      hoveringControlsRef.current ||
      volumeDraggingRef.current
    ) {
      return
    }
    hideTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false)
      hideTimerRef.current = null
    }, 3000)
  }, [])

  const showControls = useCallback(() => {
    setControlsVisible(true)
    scheduleHide()
  }, [scheduleHide])

  useEffect(() => {
    if (!player || typeof player.addEventListener !== "function") return

    const sync = () => {
      setPlaying(!player.paused)
      setMuted(!!player.muted)
      const v = player.volume
      setVolume(Number.isFinite(v) ? v : 1)
      setCurrentTime(player.currentTime)
      const d = player.duration
      setDuration(Number.isFinite(d) ? d : 0)
      const b = player.buffered
      if (b && b.length > 0 && d && Number.isFinite(d) && d > 0) {
        try {
          const end = b.end(b.length - 1)
          setBufferedPct(Math.min(100, (end / d) * 100))
        } catch {
          // TimeRanges can throw InvalidStateError mid-seek; ignore until next progress.
        }
      } else {
        setBufferedPct(0)
      }
    }

    sync()
    const events = [
      "timeupdate",
      "durationchange",
      "loadedmetadata",
      "play",
      "pause",
      "volumechange",
      "progress",
    ] as const
    events.forEach((e) => player.addEventListener(e, sync))
    return () => {
      events.forEach((e) => player.removeEventListener(e, sync))
    }
  }, [player])

  useEffect(() => {
    const handleFsChange = () => {
      const fsEl =
        document.fullscreenElement ??
        (document as Document & { webkitFullscreenElement?: Element | null })
          .webkitFullscreenElement
      setIsFullscreen(!!fsEl)
    }
    document.addEventListener("fullscreenchange", handleFsChange)
    document.addEventListener("webkitfullscreenchange", handleFsChange)
    return () => {
      document.removeEventListener("fullscreenchange", handleFsChange)
      document.removeEventListener("webkitfullscreenchange", handleFsChange)
    }
  }, [])

  // When playing/hovering state changes, reschedule (or cancel) the hide
  // timer. The mousemove listener also calls scheduleHide on every move,
  // which is what actually keeps the auto-hide working repeatedly. Cleanup
  // also covers unmount — scheduleHide cancels any pending timer.
  useEffect(() => {
    scheduleHide()
    return () => {
      if (hideTimerRef.current != null) {
        window.clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
      }
    }
  }, [playing, hoveringControls, scheduleHide])

  // Reveal chrome on any user interaction inside the player wrapper.
  // pointermove unifies mouse + pen + touch; keydown keeps chrome up while
  // arrow-key seeking the timeline or volume slider.
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const reveal = () => showControls()
    wrapper.addEventListener("pointermove", reveal)
    wrapper.addEventListener("touchmove", reveal)
    wrapper.addEventListener("touchstart", reveal)
    wrapper.addEventListener("click", reveal)
    wrapper.addEventListener("keydown", reveal)
    return () => {
      wrapper.removeEventListener("pointermove", reveal)
      wrapper.removeEventListener("touchmove", reveal)
      wrapper.removeEventListener("touchstart", reveal)
      wrapper.removeEventListener("click", reveal)
      wrapper.removeEventListener("keydown", reveal)
    }
  }, [wrapperRef, showControls])

  // Hide the OS cursor when chrome auto-hides — sibling cursor styles aren't
  // enough to win over mux-player's own shadow-DOM styling, so set cursor on
  // the wrapper element directly. Cursor inherits to descendants by default.
  // Snapshot any prior cursor value so cleanup restores the wrapper to the
  // state it was in (rather than clobbering an external writer's value).
  const wrapperCursorRef = useRef<string | null>(null)
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    if (wrapperCursorRef.current === null) {
      wrapperCursorRef.current = wrapper.style.cursor
    }
    wrapper.style.cursor = controlsVisible ? wrapperCursorRef.current : "none"
    return () => {
      if (wrapperCursorRef.current !== null) {
        wrapper.style.cursor = wrapperCursorRef.current
      }
    }
  }, [controlsVisible, wrapperRef])

  const togglePlay = useCallback(() => {
    const p = playerRef.current
    if (!p) return
    if (p.paused) {
      p.play()?.catch((err: unknown) => {
        console.warn("[HeroPlayer] play() rejected", err)
      })
    } else {
      p.pause()
    }
  }, [playerRef])

  const toggleMute = useCallback(() => {
    const p = playerRef.current
    if (!p) return
    // If volume was dragged to 0, clicking unmute bumps it back to a usable level.
    if (p.muted && p.volume === 0) {
      p.volume = 0.5
    }
    p.muted = !p.muted
  }, [playerRef])

  const setPlayerVolume = useCallback(
    (vol: number) => {
      const p = playerRef.current
      if (!p) return
      const clamped = Math.min(1, Math.max(0, vol))
      p.volume = clamped
      // Mute/unmute heuristic — intentional YouTube-style behavior:
      //   * Volume === 0 implies muted (treat as muted regardless of how it
      //     got there — drag, keyboard, or click on a 0-volume slider).
      //   * Any positive volume implies unmuted (so dragging the slider is
      //     always audible — overrides a prior explicit mute).
      // The trade-off is that an explicitly-muted user who later interacts
      // with the slider hears sound. Product-validated decision; if user
      // research flips, swap to a 0->positive transition guard.
      if (clamped === 0 && !p.muted) {
        p.muted = true
      } else if (clamped > 0 && p.muted) {
        p.muted = false
      }
    },
    [playerRef],
  )

  const computeVolumeFromClientX = useCallback((clientX: number): number => {
    const track = volumeTrackRef.current
    if (!track) return 0
    const rect = track.getBoundingClientRect()
    if (rect.width <= 0) return 0
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }, [])

  const handleVolumePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation()
      setVolumeDragging(true)
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // pointer may have been released before capture acquired
      }
      setPlayerVolume(computeVolumeFromClientX(e.clientX))
    },
    [computeVolumeFromClientX, setPlayerVolume],
  )

  const handleVolumePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!volumeDragging) return
      setPlayerVolume(computeVolumeFromClientX(e.clientX))
    },
    [volumeDragging, computeVolumeFromClientX, setPlayerVolume],
  )

  const handleVolumePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      setVolumeDragging(false)
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
    },
    [],
  )

  // If the OS revokes pointer capture (page hidden, touch preempted,
  // container collapses) the regular pointerup never fires — reset the
  // drag flag explicitly so auto-hide can resume and the next pointerdown
  // works correctly.
  const handleVolumeLostPointerCapture = useCallback(() => {
    setVolumeDragging(false)
  }, [])

  const handleVolumeKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const p = playerRef.current
      if (!p) return
      const step = e.shiftKey ? 0.1 : 0.05
      // Use the displayed volume (0 while muted) as the base so keyboard
      // adjustments operate on what the user sees, not a hidden value.
      const base = p.muted ? 0 : p.volume
      if (e.key === "ArrowRight" || e.key === "ArrowUp") {
        e.preventDefault()
        setPlayerVolume(base + step)
      } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        e.preventDefault()
        setPlayerVolume(base - step)
      }
    },
    [playerRef, setPlayerVolume],
  )

  const toggleFullscreen = useCallback(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null
      webkitExitFullscreen?: () => Promise<void> | undefined
    }
    const wrapperEl = wrapper as HTMLDivElement & {
      webkitRequestFullscreen?: () => Promise<void> | undefined
    }
    const isFs = !!(document.fullscreenElement ?? doc.webkitFullscreenElement)
    if (isFs) {
      const exit = document.exitFullscreen?.() ?? doc.webkitExitFullscreen?.()
      if (exit && typeof exit.then === "function") {
        exit.catch((err: unknown) => {
          console.warn("[HeroPlayer] exitFullscreen rejected", err)
        })
      }
    } else {
      const req =
        wrapperEl.requestFullscreen?.() ?? wrapperEl.webkitRequestFullscreen?.()
      if (req && typeof req.then === "function") {
        req.catch((err: unknown) => {
          console.warn("[HeroPlayer] requestFullscreen rejected", err)
        })
      }
    }
  }, [wrapperRef])

  const seekToClientX = useCallback(
    (clientX: number) => {
      const p = playerRef.current
      const track = timelineRef.current
      if (!p || !track || !duration) return
      const rect = track.getBoundingClientRect()
      const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      p.currentTime = pct * duration
    },
    [playerRef, duration],
  )

  const handleTimelineClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      seekToClientX(e.clientX)
    },
    [seekToClientX],
  )

  const handleTimelineKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const p = playerRef.current
      if (!p) return
      // Always preventDefault for the keys we own so the slider role doesn't
      // produce silent no-ops while duration is still loading.
      const ownedKeys = [
        "ArrowRight",
        "ArrowLeft",
        "Home",
        "End",
        "PageUp",
        "PageDown",
      ] as const
      if (!ownedKeys.includes(e.key as (typeof ownedKeys)[number])) return
      e.preventDefault()
      if (!duration) return
      const arrowStep = e.shiftKey ? 10 : 5
      const pageStep = 30
      const cur = p.currentTime
      if (e.key === "ArrowRight") {
        p.currentTime = Math.min(duration, cur + arrowStep)
      } else if (e.key === "ArrowLeft") {
        p.currentTime = Math.max(0, cur - arrowStep)
      } else if (e.key === "PageUp") {
        p.currentTime = Math.min(duration, cur + pageStep)
      } else if (e.key === "PageDown") {
        p.currentTime = Math.max(0, cur - pageStep)
      } else if (e.key === "Home") {
        p.currentTime = 0
      } else if (e.key === "End") {
        p.currentTime = duration
      }
    },
    [playerRef, duration],
  )

  const progressPct =
    duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0

  return (
    <>
      {/* Click target only — the canonical "Play/Pause" affordance for AT
          users is the chrome's hero-chrome-play button. aria-hidden keeps
          this surface out of the accessibility tree so it doesn't duplicate. */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        data-testid="hero-player-click-surface"
        data-playing={playing ? "true" : "false"}
        onClick={togglePlay}
        className={`absolute inset-0 z-0 focus:outline-none ${
          controlsVisible ? "cursor-pointer" : "cursor-none"
        }`}
      />
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/85 via-black/45 to-transparent transition-opacity duration-300 ${
          controlsVisible ? "opacity-100" : "opacity-0"
        }`}
      />
      {/* Chrome stays pointer-active even when invisible so agent-driven and
          keyboard interactions reach the controls — the wrapper-level reveal
          listeners then bring it back to opacity-100 on the next interaction. */}
      <div
        data-testid="hero-player-custom-chrome"
        data-visible={controlsVisible ? "true" : "false"}
        onMouseEnter={() => setHoveringControls(true)}
        onMouseLeave={() => setHoveringControls(false)}
        className={`absolute bottom-0 left-1/2 z-10 flex w-3/5 -translate-x-1/2 items-center gap-3 pb-6 transition-opacity duration-300 md:gap-4 md:pb-7 ${
          controlsVisible ? "opacity-100" : "opacity-0"
        }`}
      >
        <ChromeButton
          onClick={togglePlay}
          ariaLabel={playing ? "Pause" : "Play"}
          testId="hero-chrome-play"
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </ChromeButton>

        <div
          ref={timelineRef}
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, Math.floor(duration))}
          aria-valuenow={Math.floor(currentTime)}
          aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
          data-testid="hero-chrome-timeline"
          onClick={handleTimelineClick}
          onKeyDown={handleTimelineKey}
          className="group relative h-1 flex-1 cursor-pointer rounded-full bg-white/20 focus:ring-2 focus:ring-white/60 focus:outline-none"
        >
          <div
            className="absolute inset-y-0 left-0 rounded-l-full bg-white/40"
            style={{ width: `${bufferedPct}%` }}
          />
          <div
            className="absolute inset-y-0 left-0 rounded-l-full bg-[#cb333b]"
            style={{ width: `${progressPct}%` }}
          />
          <div
            className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#cb333b] opacity-0 shadow transition group-hover:opacity-100 group-focus:opacity-100"
            style={{ left: `${progressPct}%` }}
          />
        </div>

        <div
          data-testid="hero-chrome-time"
          data-current-time={Math.floor(currentTime)}
          data-duration={Math.floor(duration)}
          className="shrink-0 text-sm font-medium tabular-nums text-white drop-shadow md:text-base"
        >
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>

        <div
          className="relative flex shrink-0 items-center"
          onMouseEnter={() => setVolumeOpen(true)}
          onMouseLeave={() => setVolumeOpen(false)}
          onFocus={() => setVolumeOpen(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setVolumeOpen(false)
            }
          }}
        >
          <ChromeButton
            onClick={toggleMute}
            ariaLabel={muted || volume === 0 ? "Unmute" : "Mute"}
            testId="hero-chrome-mute"
          >
            {muted || volume === 0 ? <ChromeMutedIcon /> : <ChromeVolumeIcon />}
          </ChromeButton>
          <div
            data-testid="hero-chrome-volume-container"
            data-open={volumeOpen || volumeDragging ? "true" : "false"}
            className={`overflow-hidden transition-[width,margin] duration-200 ease-out ${
              volumeOpen || volumeDragging ? "ml-2 w-24" : "ml-0 w-0"
            }`}
          >
            <div
              ref={volumeTrackRef}
              role="slider"
              tabIndex={0}
              aria-label="Volume"
              data-testid="hero-chrome-volume-slider"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round((muted ? 0 : volume) * 100)}
              aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)} percent`}
              onPointerDown={handleVolumePointerDown}
              onPointerMove={handleVolumePointerMove}
              onPointerUp={handleVolumePointerUp}
              onPointerCancel={handleVolumePointerUp}
              onLostPointerCapture={handleVolumeLostPointerCapture}
              onKeyDown={handleVolumeKey}
              className="group relative h-1 w-full cursor-pointer touch-none rounded-full bg-white/20 focus:ring-2 focus:ring-white/60 focus:outline-none"
            >
              <div
                className="absolute inset-y-0 left-0 rounded-l-full bg-white"
                style={{ width: `${(muted ? 0 : volume) * 100}%` }}
              />
              <div
                className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow transition ${
                  muted || volume === 0
                    ? "opacity-0"
                    : "opacity-0 group-hover:opacity-100 group-focus:opacity-100"
                }`}
                style={{ left: `${(muted ? 0 : volume) * 100}%` }}
              />
            </div>
          </div>
        </div>

        <ChromeButton
          onClick={toggleFullscreen}
          ariaLabel={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          testId="hero-chrome-fullscreen"
        >
          {isFullscreen ? <ExitFullscreenIcon /> : <EnterFullscreenIcon />}
        </ChromeButton>
      </div>
    </>
  )
}
