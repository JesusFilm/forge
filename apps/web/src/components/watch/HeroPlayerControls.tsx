"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
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
  overlayAnchor,
}: {
  player: MuxPlayerRef | null
  playerRef: React.RefObject<MuxPlayerRef | null>
  wrapperRef: React.RefObject<HTMLDivElement | null>
  /**
   * Out-of-flow anchor (zero-height div right after the sticky hero) into
   * which the chrome control bar is portaled, so the bar slides up with the
   * body section instead of being trapped at the sticky hero's pinned
   * bottom and covered by the sliding body. The parent always renders the
   * anchor div before this component mounts (gated on `chromeRevealed`),
   * so this is null for one render at most before the ref callback fires.
   */
  overlayAnchor: HTMLDivElement | null
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
  const [timelineDragging, setTimelineDragging] = useState(false)
  // Local scrub position (0..1) used by the visual thumb during a drag so
  // the cursor can lead the player's actual seek-resolved time without
  // visible lag. `null` outside of a drag — falls back to currentTime.
  const [scrubPct, setScrubPct] = useState<number | null>(null)
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
  const timelineDraggingRef = useRef(false)
  // Remembers playback state at scrub-start so we can resume on pointerup if
  // the user was playing before the drag began.
  const wasPlayingBeforeScrubRef = useRef(false)
  // Latest scrub position seen by pointermove. The actual `player.currentTime`
  // write is throttled via rAF to at most one seek per animation frame —
  // pointermove fires at 60-120 Hz on most browsers, and HLS / Mux Player
  // cannot process that many seeks per second without visible jerk.
  const scrubPctRef = useRef<number | null>(null)
  const scrubRafRef = useRef<number | null>(null)
  // Snapshot of the timeline's bounding rect captured at pointerdown. Re-using
  // this for the entire drag prevents thumb oscillation when the volume
  // slider opens mid-drag and shrinks the flex-1 timeline — re-reading
  // getBoundingClientRect on every move would otherwise return a moving
  // target. Cleared on pointerup / lostPointerCapture.
  const scrubRectRef = useRef<DOMRect | null>(null)
  // Cancel any pending rAF on unmount to avoid a stray seek after teardown.
  // Co-located with the ref to match the file convention (see playingRef
  // above). If the user was scrubbing when controls unmount, also resume
  // playback so the player isn't left paused indefinitely.
  useEffect(() => {
    // Snapshot the playerRef at effect-mount; it's a stable RefObject so its
    // identity won't change, and reading the same handle in cleanup mirrors
    // what the unmount tear-down should target.
    const ref = playerRef
    return () => {
      if (scrubRafRef.current != null) {
        window.cancelAnimationFrame(scrubRafRef.current)
        scrubRafRef.current = null
      }
      const p = ref.current
      if (wasPlayingBeforeScrubRef.current && p?.paused) {
        wasPlayingBeforeScrubRef.current = false
        p.play()?.catch(() => {})
      }
    }
  }, [playerRef])
  useEffect(() => {
    volumeDraggingRef.current = volumeDragging
  }, [volumeDragging])
  useEffect(() => {
    timelineDraggingRef.current = timelineDragging
  }, [timelineDragging])

  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
    // Don't auto-hide while paused, while user hovers controls, or while user
    // is actively dragging either the volume slider or the timeline — losing
    // either mid-drag drops pointer capture and leaves the drag flag stuck.
    if (
      !playingRef.current ||
      hoveringControlsRef.current ||
      volumeDraggingRef.current ||
      timelineDraggingRef.current
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

  // Reveal chrome on any user interaction inside the player wrapper OR on
  // the overlay anchor (where the chrome bar is portaled). Native listeners
  // only see events bubbling through their own DOM subtree; without binding
  // to the anchor, hovering / keyboard-focusing the portaled chrome bar
  // never triggers reveal, and the bar can't be re-summoned after auto-hide.
  useEffect(() => {
    const reveal = () => showControls()
    const targets = [wrapperRef.current, overlayAnchor].filter(
      (t): t is HTMLDivElement => t != null,
    )
    for (const target of targets) {
      target.addEventListener("pointermove", reveal)
      target.addEventListener("touchmove", reveal)
      target.addEventListener("touchstart", reveal)
      target.addEventListener("click", reveal)
      target.addEventListener("keydown", reveal)
    }
    return () => {
      for (const target of targets) {
        target.removeEventListener("pointermove", reveal)
        target.removeEventListener("touchmove", reveal)
        target.removeEventListener("touchstart", reveal)
        target.removeEventListener("click", reveal)
        target.removeEventListener("keydown", reveal)
      }
    }
  }, [wrapperRef, overlayAnchor, showControls])

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
      // Read the ref (synchronously updated in pointerdown's commit-phase
      // effect) instead of the closed-over `volumeDragging` state, mirroring
      // the timeline pattern. Using state here would either (a) make this
      // callback resubscribe each render, or (b) leak a stale `false` into
      // the first move after pointerdown.
      if (!volumeDraggingRef.current) return
      setPlayerVolume(computeVolumeFromClientX(e.clientX))
    },
    [computeVolumeFromClientX, setPlayerVolume],
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

  // Compute the 0..1 scrub fraction for a clientX within the timeline rect.
  // Clamped at the edges so dragging past the bar's bounds still produces a
  // valid percentage rather than a wild seek target. During an active drag
  // we use the rect snapshotted at pointerdown so layout shifts (e.g. the
  // volume slider opening and shrinking the flex-1 timeline) don't make the
  // thumb oscillate under the cursor.
  const computeScrubPct = useCallback((clientX: number): number => {
    const snapshot = scrubRectRef.current
    if (snapshot && snapshot.width > 0) {
      return Math.min(
        1,
        Math.max(0, (clientX - snapshot.left) / snapshot.width),
      )
    }
    const track = timelineRef.current
    if (!track) return 0
    const rect = track.getBoundingClientRect()
    if (rect.width <= 0) return 0
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }, [])

  // Apply a scrub fraction directly — single seek, no coalescing. Used at
  // pointerdown (one-off click), pointerup (final position), and inside the
  // rAF callback that flushes the latest pointermove target.
  const seekToPct = useCallback(
    (pct: number) => {
      const p = playerRef.current
      if (!p || !duration) return
      p.currentTime = pct * duration
    },
    [playerRef, duration],
  )

  // Coalesce seeks to at-most-one-per-frame. pointermove can fire 60-120 Hz;
  // HLS / Mux Player cannot honor that many `currentTime` writes per second
  // without visible stalling — the thumb (driven by `timeupdate`) lags behind
  // the cursor. The local `scrubPct` state drives the visual thumb at full
  // pointer rate while the seek itself runs at frame rate.
  const scheduleCoalescedSeek = useCallback(() => {
    if (scrubRafRef.current != null) return
    scrubRafRef.current = window.requestAnimationFrame(() => {
      scrubRafRef.current = null
      const pct = scrubPctRef.current
      if (pct == null) return
      // Read the player + duration directly inside the rAF callback rather
      // than going through the closed-over `seekToPct`. Collapses the closure
      // chain so a `durationchange` between rAF schedule and fire doesn't
      // cause a stale-duration seek.
      const p = playerRef.current
      if (!p) return
      const d = p.duration
      if (!Number.isFinite(d) || d <= 0) return
      p.currentTime = pct * d
    })
  }, [playerRef])

  // Pointer-driven scrub: pointerdown captures the pointer, pauses playback
  // (resumed on release if it was playing), and seeks to the click point.
  // pointermove follows the pointer with instant visual feedback and
  // throttled actual seeks. pointerup releases capture and resumes playback.
  // Mirrors the volume slider's setPointerCapture pattern so the drag
  // survives the cursor leaving the timeline rect.
  const handleTimelinePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const p = playerRef.current
      if (!p) return
      // Snapshot playback state, then pause for a stable scrubbing experience —
      // without this, playback advances past the scrub target while the user
      // is still dragging.
      wasPlayingBeforeScrubRef.current = !p.paused
      if (!p.paused) p.pause()
      // Snapshot the timeline rect for the duration of the drag — see
      // scrubRectRef declaration. Done before the first computeScrubPct so
      // both pointerdown and subsequent pointermoves share the same frame
      // of reference.
      scrubRectRef.current = e.currentTarget.getBoundingClientRect()
      // Dual-write: ref first (so the synchronous pointermove that some
      // browsers fire immediately after pointerdown sees the live `true`
      // before the commit-phase effect runs), then state for render-visible
      // attrs (data-dragging, thumb opacity, displayTime).
      timelineDraggingRef.current = true
      setTimelineDragging(true)
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // pointer may have been released before capture acquired
      }
      const pct = computeScrubPct(e.clientX)
      scrubPctRef.current = pct
      setScrubPct(pct)
      seekToPct(pct)
    },
    [playerRef, computeScrubPct, seekToPct],
  )

  const handleTimelinePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!timelineDraggingRef.current) return
      const pct = computeScrubPct(e.clientX)
      // Visual update fires every move — instant cursor-following thumb.
      scrubPctRef.current = pct
      setScrubPct(pct)
      // Actual `currentTime =` write is throttled to one per animation frame.
      scheduleCoalescedSeek()
    },
    [computeScrubPct, scheduleCoalescedSeek],
  )

  const handleTimelinePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Atomic snapshot+zero so the synchronous lostPointerCapture re-fire
      // from releasePointerCapture (Chrome/Firefox dispatch it synchronously)
      // doesn't see a stale `true` and double-fire play().
      const wasPlaying = wasPlayingBeforeScrubRef.current
      wasPlayingBeforeScrubRef.current = false
      const wasDragging = timelineDraggingRef.current
      // Cancel any pending coalesced seek; we'll apply the final position
      // synchronously below so the player ends up exactly where the user
      // released, not wherever the last rAF happened to fire.
      if (scrubRafRef.current != null) {
        window.cancelAnimationFrame(scrubRafRef.current)
        scrubRafRef.current = null
      }
      const finalPct = scrubPctRef.current
      scrubPctRef.current = null
      scrubRectRef.current = null
      timelineDraggingRef.current = false
      const p = playerRef.current
      // Apply the final seek BEFORE clearing drag state so displayTime stays
      // pinned to the scrub thumb until `timeupdate` fires — otherwise the
      // thumb visibly snaps back to the stale `currentTime` for one frame.
      if (wasDragging && finalPct != null && p) seekToPct(finalPct)
      setTimelineDragging(false)
      setScrubPct(null)
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
      if (!wasDragging) return
      if (!p) return
      // Gate on live `p.paused` too — if the user pressed space-bar mid-drag,
      // p.paused will reflect that and we won't override their intent. play()
      // rejection (e.g. iOS autoplay gate) is rare here since the user gesture
      // initiated the scrub; swallow silently.
      if (wasPlaying && p.paused) {
        p.play()?.catch(() => {})
      }
    },
    [playerRef, seekToPct],
  )

  // If the OS revokes pointer capture mid-drag (page hidden, touch preempted,
  // container collapses), pointerup never fires — reset the drag flag, drop
  // any pending coalesced seek, and resume playback if the user was playing
  // before, so the player doesn't sit stuck-paused with the auto-hide guard
  // latched on.
  const handleTimelineLostPointerCapture = useCallback(() => {
    if (scrubRafRef.current != null) {
      window.cancelAnimationFrame(scrubRafRef.current)
      scrubRafRef.current = null
    }
    scrubPctRef.current = null
    scrubRectRef.current = null
    timelineDraggingRef.current = false
    setTimelineDragging(false)
    setScrubPct(null)
    const p = playerRef.current
    if (!p) return
    if (wasPlayingBeforeScrubRef.current && p.paused) {
      wasPlayingBeforeScrubRef.current = false
      p.play()?.catch(() => {})
    }
  }, [playerRef])

  const handleTimelineKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const p = playerRef.current
      if (!p) return
      // Drop keyboard seeks while a pointer drag is in flight — otherwise
      // arrow / Home / End / PageUp / PageDown writes get clobbered by the
      // next rAF flush or pointerup's final seek.
      if (timelineDraggingRef.current) return
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

  // During a drag, the thumb and the time readout both track the local scrub
  // position rather than the player's `currentTime` (which only updates after
  // the seek resolves). This is what makes the cursor "lead" the player
  // without visible lag.
  const displayTime =
    timelineDragging && scrubPct != null ? scrubPct * duration : currentTime
  const progressPct =
    duration > 0 ? Math.min(100, (displayTime / duration) * 100) : 0

  // Chrome control bar — portaled into the overlay anchor (just below the
  // sticky hero) so it rides on the body section's top edge as the body
  // slides up over the pinned hero, matching the title-overlay behavior.
  const chromeBar = (
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
        aria-valuenow={Math.floor(displayTime)}
        aria-valuetext={`${formatTime(displayTime)} of ${formatTime(duration)}`}
        data-testid="hero-chrome-timeline"
        data-dragging={timelineDragging ? "true" : "false"}
        onPointerDown={handleTimelinePointerDown}
        onPointerMove={handleTimelinePointerMove}
        onPointerUp={handleTimelinePointerUp}
        onPointerCancel={handleTimelinePointerUp}
        onLostPointerCapture={handleTimelineLostPointerCapture}
        onKeyDown={handleTimelineKey}
        className="group relative h-1 flex-1 cursor-pointer touch-pan-y rounded-full bg-white/20 focus:ring-2 focus:ring-white/60 focus:outline-none"
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
          className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#cb333b] shadow transition group-hover:opacity-100 group-focus:opacity-100 ${
            timelineDragging ? "opacity-100" : "opacity-0"
          }`}
          style={{ left: `${progressPct}%` }}
        />
      </div>

      <div
        data-testid="hero-chrome-time"
        data-current-time={Math.floor(displayTime)}
        data-duration={Math.floor(duration)}
        className="shrink-0 text-sm font-medium tabular-nums text-white drop-shadow md:text-base"
      >
        {formatTime(displayTime)} / {formatTime(duration)}
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
  )

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
      {overlayAnchor != null ? createPortal(chromeBar, overlayAnchor) : null}
    </>
  )
}
