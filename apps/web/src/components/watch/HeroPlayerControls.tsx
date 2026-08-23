"use client"

import { AudioLines, Captions } from "lucide-react"
import { useTranslations } from "next-intl"
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react"
import { createPortal } from "react-dom"
import type { MuxPlayerRef } from "@forge/video-player"

import { WATCH_PAGE_RAIL_PADDING_CLASSES } from "@/lib/content-width"
import { useIsFullscreen } from "@/lib/use-is-fullscreen"
import {
  readWatchVolumePreference,
  writeWatchVolumePreference,
} from "@/lib/watch-volume-preference"
import { WATCH_PLAYER_CONTROLS_SOFT_BACKDROP_BACKGROUND } from "@/lib/watch-production-overlays"
import {
  WATCH_PLAYER_CHROME_REVEAL_EVENT,
  WATCH_PLAYER_PLAYBACK_STATE_EVENT,
  type WatchPlayerChromeVisibilityDetail,
  type WatchPlayerPlaybackStateDetail,
} from "@/lib/watch-player-chrome-events"
import { ChromeButton, formatTime } from "./ChromeButton"
import {
  ChromeMutedIcon,
  ChromeVolumeIcon,
  EnterFullscreenIcon,
  ExitFullscreenIcon,
  PauseIcon,
  PlayIcon,
} from "./chrome-icons"
import {
  buildMuxStoryboardJsonUrl,
  findStoryboardTile,
  parseMuxStoryboard,
  type MuxStoryboard,
} from "./mux-storyboard"

const TOP_SCROLL_CHROME_REVEAL_THRESHOLD_PX = 8
const CHROME_IDLE_HIDE_DELAY_MS = 4000
const CHROME_INITIAL_POINTER_LOCK_MS = 5000

type ChromeVisibility = "dim" | "hidden" | "bright"

type WebKitFullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}

type WebKitFullscreenWrapper = HTMLDivElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
}

type WebKitFullscreenVideo = HTMLVideoElement & {
  webkitDisplayingFullscreen?: boolean
  webkitEnterFullscreen?: () => void
  webkitExitFullscreen?: () => void
}

function getWebKitFullscreenVideo(
  player: MuxPlayerRef | null,
): WebKitFullscreenVideo | null {
  if (!player) return null

  if (player instanceof HTMLVideoElement) {
    return player as WebKitFullscreenVideo
  }

  const host = player as unknown as { shadowRoot?: ShadowRoot | null }
  const video = host.shadowRoot?.querySelector("video")
  return video instanceof HTMLVideoElement
    ? (video as WebKitFullscreenVideo)
    : null
}

export function HeroPlayerControls({
  player,
  playerRef,
  wrapperRef,
  overlayAnchor,
  playbackId,
  playbackLoading = false,
  onLanguageClick,
  languageCode,
  subtitleLanguageCode,
  subtitleEnabled = subtitleLanguageCode != null,
  showLanguageButton,
  showSubtitleButton,
  onVisibilityChange,
  onWatchNextInteraction,
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
  playbackId?: string
  playbackLoading?: boolean
  /** Click handler for the in-chrome audio and subtitle controls. */
  onLanguageClick?: () => void
  /** Active audio language code displayed beside the in-chrome voice icon. */
  languageCode?: string | null
  /** Active subtitle language code; null when subtitles are disabled. */
  subtitleLanguageCode?: string | null
  /** Whether a subtitle track is active, including tracks without a display code. */
  subtitleEnabled?: boolean
  /**
   * Whether to render the in-chrome audio button. The parent applies the
   * same gate it uses for the top-right globe (>= 2 playable variants AND
   * a callback is provided), so both surfaces appear together.
   */
  showLanguageButton?: boolean
  /** Whether the current video exposes subtitle options. */
  showSubtitleButton?: boolean
  onVisibilityChange?: (detail: WatchPlayerChromeVisibilityDetail) => void
  onWatchNextInteraction?: () => void
}) {
  const t = useTranslations("HeroPlayerControls")
  const languagePickerT = useTranslations("LanguagePickerModal")
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const appliedVolumePreferencePlayerRef = useRef<MuxPlayerRef | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [bufferedPct, setBufferedPct] = useState(0)
  // Shared with HeroPlayer via the useIsFullscreen hook — same source of
  // truth prevents the dual-listener desync that could leave the portal
  // target pointing at overlayAnchor while HeroPlayer thinks we're in
  // fullscreen.
  const isFullscreen = useIsFullscreen()
  // Mirror wrapperRef.current in state so the portal-target swap below can
  // read it without touching a ref during render (React Compiler rejects
  // that). wrapperRef attaches in the parent on mount, so the effect runs
  // once and the value stays stable for the component's lifetime.
  const [wrapperEl, setWrapperEl] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    setWrapperEl(wrapperRef.current)
  }, [wrapperRef])
  const [chromeVisibility, setChromeVisibility] =
    useState<ChromeVisibility>("dim")
  const [hoveringControls, setHoveringControls] = useState(false)
  const [volumeOpen, setVolumeOpen] = useState(false)
  const [volumeDragging, setVolumeDragging] = useState(false)
  const [timelineDragging, setTimelineDragging] = useState(false)
  const [previewPct, setPreviewPct] = useState<number | null>(null)
  const [storyboard, setStoryboard] = useState<MuxStoryboard | null>(null)
  const [pendingSeekTime, setPendingSeekTime] = useState<number | null>(null)
  // Local scrub position (0..1) used by the visual thumb during a drag so
  // the cursor can lead the player's actual seek-resolved time without
  // visible lag. `null` outside of a drag — falls back to currentTime.
  const [scrubPct, setScrubPct] = useState<number | null>(null)
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const volumeTrackRef = useRef<HTMLDivElement | null>(null)
  const hideTimerRef = useRef<number | null>(null)
  const chromeVisibilityRef = useRef<ChromeVisibility>("dim")
  const pointerRevealLockedRef = useRef(true)
  const pointerRevealLockTimerRef = useRef<number | null>(null)
  const volumePreferenceRestoreCountRef = useRef(0)
  const applyingVolumePreferenceRef = useRef(false)
  useEffect(() => {
    chromeVisibilityRef.current = chromeVisibility
  }, [chromeVisibility])

  const chromeOpacity =
    chromeVisibility === "bright" ? 1 : chromeVisibility === "dim" ? 1 : 0
  const chromeVisible = chromeVisibility !== "hidden"
  const chromeOpacityClass =
    chromeVisibility === "bright"
      ? "opacity-100"
      : chromeVisibility === "dim"
        ? "opacity-100"
        : "opacity-0"
  const subtitleHeading = languagePickerT("subtitlesHeading")
  const subtitleStateLabel = !showSubtitleButton
    ? languagePickerT("notAvailable")
    : subtitleEnabled
      ? `${languagePickerT("toggleOn")}${subtitleLanguageCode ? ` (${subtitleLanguageCode})` : ""}`
      : languagePickerT("toggleOff")
  const subtitleTooltip = `${subtitleHeading}: ${subtitleStateLabel}`
  const playLabel = playing ? t("pause") : t("play")
  const muteLabel = muted || volume === 0 ? t("unmute") : t("mute")
  const audioLanguageLabel = languageCode
    ? `${t("changeAudioLanguage")}: ${languageCode}`
    : t("changeAudioLanguage")
  const fullscreenLabel = isFullscreen
    ? t("exitFullscreen")
    : t("enterFullscreen")
  const visibleSubtitleState = subtitleEnabled
    ? (subtitleLanguageCode ?? languagePickerT("toggleOn"))
    : null

  useEffect(() => {
    onVisibilityChange?.({
      visible: chromeVisible,
      opacity: chromeOpacity,
    })
  }, [chromeOpacity, chromeVisible, onVisibilityChange])

  useEffect(() => {
    if (chromeVisible) return
    setPreviewPct(null)
  }, [chromeVisible])

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent<WatchPlayerPlaybackStateDetail>(
        WATCH_PLAYER_PLAYBACK_STATE_EVENT,
        { detail: { playing, muted, preview: false } },
      ),
    )
  }, [muted, playing])

  useEffect(() => {
    return () => {
      window.dispatchEvent(
        new CustomEvent<WatchPlayerPlaybackStateDetail>(
          WATCH_PLAYER_PLAYBACK_STATE_EVENT,
          { detail: { playing: false, muted: true, preview: false } },
        ),
      )
    }
  }, [])

  // Refs let scheduleHide read the latest hovering state without
  // resubscribing the wrapper-level mousemove listener on every render.
  // Writes happen in commit-phase effects so concurrent rendering replays
  // can't leave the refs in interim/abandoned states.
  const hoveringControlsRef = useRef(false)
  const focusWithinControlsRef = useRef(false)
  const [pointerIdle, setPointerIdle] = useState(false)
  const pointerIdleTimerRef = useRef<number | null>(null)
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
  const pendingSeekTimeRef = useRef<number | null>(null)
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

  useEffect(() => {
    pendingSeekTimeRef.current = pendingSeekTime
  }, [pendingSeekTime])

  useEffect(() => {
    pointerRevealLockedRef.current = true
    pointerRevealLockTimerRef.current = window.setTimeout(() => {
      pointerRevealLockedRef.current = false
      pointerRevealLockTimerRef.current = null
    }, CHROME_INITIAL_POINTER_LOCK_MS)
    return () => {
      if (pointerRevealLockTimerRef.current != null) {
        window.clearTimeout(pointerRevealLockTimerRef.current)
        pointerRevealLockTimerRef.current = null
      }
      pointerRevealLockedRef.current = false
    }
  }, [])

  const scheduleHide = useCallback((delayMs = CHROME_IDLE_HIDE_DELAY_MS) => {
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
    // Don't auto-dim while user hovers controls, or while user
    // is actively dragging either the volume slider or the timeline — losing
    // either mid-drag drops pointer capture and leaves the drag flag stuck.
    if (
      hoveringControlsRef.current ||
      focusWithinControlsRef.current ||
      volumeDraggingRef.current ||
      timelineDraggingRef.current
    ) {
      return
    }
    hideTimerRef.current = window.setTimeout(() => {
      setChromeVisibility("hidden")
      hideTimerRef.current = null
    }, delayMs)
  }, [])

  const revealControls = useCallback(
    ({ pointerDriven = false }: { pointerDriven?: boolean } = {}) => {
      if (pointerDriven && pointerRevealLockedRef.current) return false
      setChromeVisibility("bright")
      scheduleHide()
      return true
    },
    [scheduleHide],
  )

  const revealDimmedControls = useCallback(
    ({ pointerDriven = false }: { pointerDriven?: boolean } = {}) => {
      if (pointerDriven && pointerRevealLockedRef.current) return false
      setChromeVisibility("dim")
      scheduleHide()
      return true
    },
    [scheduleHide],
  )

  const schedulePointerIdle = useCallback(() => {
    if (pointerIdleTimerRef.current != null) {
      window.clearTimeout(pointerIdleTimerRef.current)
      pointerIdleTimerRef.current = null
    }

    if (!playing) {
      setPointerIdle(false)
      return
    }

    pointerIdleTimerRef.current = window.setTimeout(() => {
      setPointerIdle(true)
      pointerIdleTimerRef.current = null
    }, CHROME_IDLE_HIDE_DELAY_MS)
  }, [playing])

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      setPointerIdle(false)
      schedulePointerIdle()
      if (pointerRevealLockedRef.current) return

      const wrapper = wrapperRef.current
      if (wrapper) {
        const rect = wrapper.getBoundingClientRect()
        const hasMeasurableRect = rect.width > 0 && rect.height > 0
        const insideWrapper =
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom
        if (hasMeasurableRect && !insideWrapper) return
      }

      const currentVisibility = chromeVisibilityRef.current
      if (currentVisibility === "bright") {
        scheduleHide()
        return
      }

      if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
        return
      }
      revealDimmedControls({ pointerDriven: true })
    },
    [revealDimmedControls, scheduleHide, schedulePointerIdle, wrapperRef],
  )

  const persistPlayerVolumePreference = useCallback((p: MuxPlayerRef) => {
    writeWatchVolumePreference({
      muted: !!p.muted,
      volume: p.volume,
    })
  }, [])

  const applyStoredVolumePreference = useCallback(() => {
    const p = playerRef.current
    const preference = readWatchVolumePreference()
    if (!p || !preference) return false

    applyingVolumePreferenceRef.current = true
    try {
      if (p.volume !== preference.volume) {
        p.volume = preference.volume
      }
      if (p.muted !== preference.muted) {
        p.muted = preference.muted
      }
    } finally {
      queueMicrotask(() => {
        applyingVolumePreferenceRef.current = false
      })
    }
    setVolume(preference.volume)
    setMuted(preference.muted)
    return true
  }, [playerRef])

  useEffect(() => {
    const p = playerRef.current
    if (!p) return
    if (appliedVolumePreferencePlayerRef.current === p) return

    appliedVolumePreferencePlayerRef.current = p
    volumePreferenceRestoreCountRef.current = 0
    if (applyStoredVolumePreference()) {
      volumePreferenceRestoreCountRef.current = 1
    }
  }, [applyStoredVolumePreference, player, playerRef])

  useEffect(() => {
    if (!player || typeof player.addEventListener !== "function") return

    const sync = (persist = false) => {
      setPlaying(!player.paused)
      setMuted(!!player.muted)
      const v = player.volume
      setVolume(Number.isFinite(v) ? v : 1)
      if (persist && !applyingVolumePreferenceRef.current) {
        persistPlayerVolumePreference(player)
      }
      const nextCurrentTime = player.currentTime
      setCurrentTime(nextCurrentTime)
      const pending = pendingSeekTimeRef.current
      if (
        pending != null &&
        Number.isFinite(nextCurrentTime) &&
        Math.abs(nextCurrentTime - pending) <= 0.5
      ) {
        pendingSeekTimeRef.current = null
        setPendingSeekTime(null)
      }
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
    const syncMedia = () => sync()
    const syncLoadedMetadata = () => {
      if (volumePreferenceRestoreCountRef.current < 2) {
        if (applyStoredVolumePreference()) {
          volumePreferenceRestoreCountRef.current += 1
        }
      }
      sync()
    }
    const syncVolume = () => sync(true)
    const events = [
      "timeupdate",
      "durationchange",
      "play",
      "pause",
      "progress",
    ] as const
    events.forEach((e) => player.addEventListener(e, syncMedia))
    player.addEventListener("loadedmetadata", syncLoadedMetadata)
    player.addEventListener("volumechange", syncVolume)
    return () => {
      events.forEach((e) => player.removeEventListener(e, syncMedia))
      player.removeEventListener("loadedmetadata", syncLoadedMetadata)
      player.removeEventListener("volumechange", syncVolume)
    }
  }, [applyStoredVolumePreference, persistPlayerVolumePreference, player])

  useEffect(() => {
    setStoryboard(null)
    if (!playbackId) return

    const controller = new AbortController()
    const loadStoryboard = async () => {
      try {
        const response = await fetch(buildMuxStoryboardJsonUrl(playbackId), {
          signal: controller.signal,
        })
        if (!response.ok) return
        const parsed = parseMuxStoryboard(await response.json())
        if (!controller.signal.aborted) setStoryboard(parsed)
      } catch {
        if (!controller.signal.aborted) setStoryboard(null)
      }
    }

    void loadStoryboard()
    return () => controller.abort()
  }, [playbackId])

  // Fullscreen state now comes from useIsFullscreen() above — no
  // component-local listener needed.

  // When hover state changes, reschedule (or cancel) the hide timer. Pointer
  // movement also calls scheduleHide after reveal, which keeps the bright/
  // hidden cycle working repeatedly.
  useEffect(() => {
    if (chromeVisibilityRef.current === "hidden") return
    scheduleHide(
      chromeVisibilityRef.current === "dim"
        ? CHROME_INITIAL_POINTER_LOCK_MS
        : CHROME_IDLE_HIDE_DELAY_MS,
    )
    return () => {
      if (hideTimerRef.current != null) {
        window.clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
      }
    }
  }, [chromeVisibility, hoveringControls, scheduleHide])

  useEffect(() => {
    schedulePointerIdle()
    return () => {
      if (pointerIdleTimerRef.current != null) {
        window.clearTimeout(pointerIdleTimerRef.current)
        pointerIdleTimerRef.current = null
      }
    }
  }, [schedulePointerIdle])

  // Reveal chrome on any user interaction inside the player wrapper OR on
  // the overlay anchor (where the chrome bar is portaled). Native listeners
  // only see events bubbling through their own DOM subtree; without binding
  // to the anchor, hovering / keyboard-focusing the portaled chrome bar
  // never triggers reveal, and the bar can't be brightened after auto-dim.
  useEffect(() => {
    const reveal = () => revealControls()
    const revealFromPointer = () => {
      revealControls({ pointerDriven: true })
    }
    const targets = [wrapperRef.current, overlayAnchor].filter(
      (t): t is HTMLDivElement => t != null,
    )
    for (const target of targets) {
      target.addEventListener("touchmove", reveal)
      target.addEventListener("touchstart", reveal)
      target.addEventListener("click", reveal)
      target.addEventListener("keydown", reveal)
      target.addEventListener("focusin", reveal)
    }
    window.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    })
    window.addEventListener(WATCH_PLAYER_CHROME_REVEAL_EVENT, revealFromPointer)
    return () => {
      for (const target of targets) {
        target.removeEventListener("touchmove", reveal)
        target.removeEventListener("touchstart", reveal)
        target.removeEventListener("click", reveal)
        target.removeEventListener("keydown", reveal)
        target.removeEventListener("focusin", reveal)
      }
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener(
        WATCH_PLAYER_CHROME_REVEAL_EVENT,
        revealFromPointer,
      )
    }
  }, [wrapperRef, overlayAnchor, revealControls, handlePointerMove])

  // If chrome auto-dimmed while the user was watching, scrolling back to the
  // absolute top should restore the full hero affordance: player controls
  // and the header chrome that listens to the visibility event.
  useEffect(() => {
    const revealAtTop = () => {
      if (window.scrollY > TOP_SCROLL_CHROME_REVEAL_THRESHOLD_PX) return
      revealControls()
    }
    window.addEventListener("scroll", revealAtTop, { passive: true })
    return () => window.removeEventListener("scroll", revealAtTop)
  }, [revealControls])

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
    persistPlayerVolumePreference(p)
  }, [persistPlayerVolumePreference, playerRef])

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
      persistPlayerVolumePreference(p)
    },
    [persistPlayerVolumePreference, playerRef],
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
  // drag flag explicitly so auto-dim can resume and the next pointerdown
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
    const doc = document as WebKitFullscreenDocument
    const wrapperEl = wrapper as WebKitFullscreenWrapper
    const videoEl = getWebKitFullscreenVideo(playerRef.current)
    if (videoEl?.webkitDisplayingFullscreen) {
      videoEl.webkitExitFullscreen?.()
      return
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
      const requestFullscreen =
        wrapperEl.requestFullscreen ?? wrapperEl.webkitRequestFullscreen
      if (requestFullscreen) {
        const req = requestFullscreen.call(wrapperEl)
        if (req && typeof req.then === "function") {
          req.catch((err: unknown) => {
            console.warn("[HeroPlayer] requestFullscreen rejected", err)
          })
        }
        return
      }
      videoEl?.webkitEnterFullscreen?.()
    }
  }, [playerRef, wrapperRef])

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
      const nextTime = pct * duration
      pendingSeekTimeRef.current = nextTime
      setPendingSeekTime(nextTime)
      p.currentTime = nextTime
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
      const nextTime = pct * d
      pendingSeekTimeRef.current = nextTime
      setPendingSeekTime(nextTime)
      p.currentTime = nextTime
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
      setPreviewPct(pct)
      seekToPct(pct)
    },
    [playerRef, computeScrubPct, seekToPct],
  )

  const handleTimelinePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const pct = computeScrubPct(e.clientX)
      setPreviewPct(pct)
      if (!timelineDraggingRef.current) return
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
      if (finalPct != null) setPreviewPct(finalPct)
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

  const handleTimelinePointerLeave = useCallback(() => {
    if (timelineDraggingRef.current) return
    setPreviewPct(null)
  }, [])

  const handleTimelineBlur = useCallback(() => {
    if (timelineDraggingRef.current) return
    setPreviewPct(null)
  }, [])

  // If the OS revokes pointer capture mid-drag (page hidden, touch preempted,
  // container collapses), pointerup never fires — reset the drag flag, drop
  // any pending coalesced seek, and resume playback if the user was playing
  // before, so the player doesn't sit stuck-paused with the auto-dim guard
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
      let nextTime: number | null = null
      if (e.key === "ArrowRight") {
        nextTime = Math.min(duration, cur + arrowStep)
      } else if (e.key === "ArrowLeft") {
        nextTime = Math.max(0, cur - arrowStep)
      } else if (e.key === "PageUp") {
        nextTime = Math.min(duration, cur + pageStep)
      } else if (e.key === "PageDown") {
        nextTime = Math.max(0, cur - pageStep)
      } else if (e.key === "Home") {
        nextTime = 0
      } else if (e.key === "End") {
        nextTime = duration
      }
      if (nextTime != null) {
        pendingSeekTimeRef.current = nextTime
        setPendingSeekTime(nextTime)
        setPreviewPct(Math.min(1, Math.max(0, nextTime / duration)))
        p.currentTime = nextTime
      }
    },
    [playerRef, duration],
  )

  // During a drag, the thumb and the time readout both track the local scrub
  // position rather than the player's `currentTime` (which only updates after
  // the seek resolves). This is what makes the cursor "lead" the player
  // without visible lag.
  const displayTime =
    timelineDragging && scrubPct != null
      ? scrubPct * duration
      : (pendingSeekTime ?? currentTime)
  const progressPct =
    duration > 0 ? Math.min(100, (displayTime / duration) * 100) : 0
  const previewTime =
    previewPct != null && duration > 0 ? previewPct * duration : null
  const previewTile =
    storyboard && previewTime != null
      ? findStoryboardTile(storyboard, previewTime)
      : null
  const previewStoryboard = previewTile ? storyboard : null
  const previewLeftPct =
    previewPct == null ? 0 : Math.min(96, Math.max(4, previewPct * 100))
  const previewWidthPx = previewStoryboard ? previewStoryboard.tileWidth / 2 : 0
  const previewHeightPx = previewStoryboard
    ? previewStoryboard.tileHeight / 2
    : 0

  const handleTimelineFocus = useCallback(() => {
    if (duration <= 0) return
    setPreviewPct(Math.min(1, Math.max(0, displayTime / duration)))
  }, [displayTime, duration])

  // Dark gradient that sits BEHIND the chrome bar so the white icons stay
  // legible. It used to live inside the sticky hero wrapper, but the
  // chrome bar is portaled to `overlayAnchor` and scrolls up with the
  // body section — leaving the gradient stranded at the bottom of the
  // pinned hero where it darkened nothing. Portaling the gradient
  // alongside the chrome keeps it under the controls at every scroll
  // position.
  const chromeBackdrop = (
    <div
      aria-hidden="true"
      data-testid="hero-player-chrome-backdrop"
      className={`pointer-events-none absolute bottom-0 left-1/2 z-0 h-[28vh] min-h-36 w-screen max-w-none -translate-x-1/2 [background:var(--watch-player-controls-backdrop)] transition-opacity duration-300 ${
        chromeOpacityClass
      }`}
      style={
        {
          "--watch-player-controls-backdrop":
            WATCH_PLAYER_CONTROLS_SOFT_BACKDROP_BACKGROUND,
        } as CSSProperties
      }
    />
  )

  // Chrome control bar — portaled into the overlay anchor (just below the
  // sticky hero) so it rides on the body section's top edge as the body
  // slides up over the pinned hero, matching the title-overlay behavior.
  const chromeBar = (
    <div
      data-testid="hero-player-custom-chrome"
      data-visible={chromeVisible ? "true" : "false"}
      data-bright={chromeVisibility === "bright" ? "true" : "false"}
      data-visibility={chromeVisibility}
      onPointerEnter={() => {
        if (revealControls({ pointerDriven: true })) {
          setHoveringControls(true)
        }
      }}
      onPointerDownCapture={onWatchNextInteraction}
      onKeyDownCapture={onWatchNextInteraction}
      onPointerMove={(event) => {
        event.stopPropagation()
        setPointerIdle(false)
        schedulePointerIdle()
        if (revealControls({ pointerDriven: true })) {
          setHoveringControls(true)
        }
      }}
      onPointerLeave={() => setHoveringControls(false)}
      onFocusCapture={() => {
        focusWithinControlsRef.current = true
        if (hideTimerRef.current != null) {
          window.clearTimeout(hideTimerRef.current)
          hideTimerRef.current = null
        }
      }}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget
        if (
          nextTarget instanceof Node &&
          event.currentTarget.contains(nextTarget)
        ) {
          return
        }
        focusWithinControlsRef.current = false
        scheduleHide()
      }}
      className={`absolute inset-x-0 bottom-0 z-10 flex w-full flex-wrap items-center gap-x-1 gap-y-0 pb-3 transition-opacity duration-300 md:flex-nowrap md:gap-x-4 md:pb-7 ${WATCH_PAGE_RAIL_PADDING_CLASSES} ${
        chromeOpacityClass
      }`}
    >
      <ChromeButton
        onClick={togglePlay}
        ariaLabel={playLabel}
        testId="hero-chrome-play"
        tooltipAlign="start"
      >
        {playbackLoading ? (
          <span
            aria-hidden="true"
            data-testid="hero-chrome-loading"
            className="h-5 w-5 rounded-full border-2 border-white/25 border-t-white/95 motion-safe:animate-spin"
          />
        ) : playing ? (
          <PauseIcon />
        ) : (
          <PlayIcon />
        )}
      </ChromeButton>

      <div
        ref={timelineRef}
        role="slider"
        tabIndex={0}
        aria-label={t("seek")}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, Math.floor(duration))}
        aria-valuenow={Math.floor(displayTime)}
        aria-valuetext={t("seekValue", {
          current: formatTime(displayTime),
          total: formatTime(duration),
        })}
        data-testid="hero-chrome-timeline"
        data-dragging={timelineDragging ? "true" : "false"}
        onPointerDown={handleTimelinePointerDown}
        onPointerMove={handleTimelinePointerMove}
        onPointerUp={handleTimelinePointerUp}
        onPointerCancel={handleTimelinePointerUp}
        onPointerLeave={handleTimelinePointerLeave}
        onLostPointerCapture={handleTimelineLostPointerCapture}
        onFocus={handleTimelineFocus}
        onBlur={handleTimelineBlur}
        onKeyDown={handleTimelineKey}
        className="group/timeline relative order-first flex h-5 min-w-0 basis-full cursor-pointer touch-pan-y items-center focus-visible:outline-none md:order-none md:h-8 md:flex-1 md:basis-auto"
      >
        {previewTile && previewStoryboard ? (
          <div
            data-testid="hero-chrome-timeline-preview"
            className="pointer-events-none absolute bottom-5 z-20 overflow-hidden rounded-md shadow-2xl ring-1 ring-white/20 md:bottom-7"
            style={
              {
                "--hero-preview-left": `clamp(${previewWidthPx / 2}px, ${previewLeftPct}%, calc(100% - ${
                  previewWidthPx / 2
                }px))`,
                left: "var(--hero-preview-left)",
                width: `${previewWidthPx}px`,
                transform: "translateX(-50%)",
              } as CSSProperties
            }
          >
            <div
              className="relative overflow-hidden"
              style={{
                width: `${previewWidthPx}px`,
                height: `${previewHeightPx}px`,
              }}
            >
              <div
                aria-hidden="true"
                className="origin-top-left"
                style={{
                  width: `${previewStoryboard.tileWidth}px`,
                  height: `${previewStoryboard.tileHeight}px`,
                  backgroundImage: `url("${previewStoryboard.url}")`,
                  backgroundPosition: `-${previewTile.x}px -${previewTile.y}px`,
                  transform: "scale(0.5)",
                }}
              />
              <div
                data-testid="hero-chrome-timeline-preview-time"
                className="absolute right-1 bottom-1 rounded bg-black/65 px-1.5 py-0.5 text-[11px] leading-none font-semibold tabular-nums text-white shadow-sm backdrop-blur-[2px]"
                style={{
                  textShadow: "0 1px 2px rgba(0,0,0,0.75)",
                }}
              >
                {formatTime(previewTime ?? 0)}
              </div>
            </div>
          </div>
        ) : null}
        <div className="relative h-1 w-full rounded-full bg-white/20 transition-colors duration-150 group-hover/timeline:bg-white/30 group-focus-visible/timeline:bg-white/30 group-focus-visible/timeline:ring-1 group-focus-visible/timeline:ring-brand-red/70 group-focus-visible/timeline:ring-offset-2 group-focus-visible/timeline:ring-offset-black/40">
          <div
            className="absolute inset-y-0 left-0 rounded-l-full bg-white/40"
            style={{ width: `${bufferedPct}%` }}
          />
          <div
            className="absolute inset-y-0 left-0 rounded-l-full bg-brand-red"
            style={{ width: `${progressPct}%` }}
          />
          <div
            className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-red shadow transition group-hover/timeline:opacity-100 group-focus-visible/timeline:opacity-100 ${
              timelineDragging || previewPct != null
                ? "opacity-100"
                : "opacity-0"
            }`}
            style={{ left: `${progressPct}%` }}
          />
        </div>
      </div>

      <div
        data-testid="hero-chrome-time"
        data-current-time={Math.floor(displayTime)}
        data-duration={Math.floor(duration)}
        className="shrink-0 text-xs font-medium tabular-nums text-white drop-shadow md:text-base"
      >
        <span className="md:hidden">
          {formatTime(displayTime)}/{formatTime(duration)}
        </span>
        <span className="hidden md:inline">
          {formatTime(displayTime)} / {formatTime(duration)}
        </span>
      </div>

      <div
        className="relative ml-auto flex shrink-0 items-center"
        onMouseEnter={() => setVolumeOpen(true)}
        onMouseLeave={() => setVolumeOpen(false)}
        onFocus={() => setVolumeOpen(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setVolumeOpen(false)
          }
        }}
      >
        <div
          data-testid="hero-chrome-volume-container"
          data-open={volumeOpen || volumeDragging ? "true" : "false"}
          className={`overflow-hidden transition-[width,margin] duration-200 ease-out ${
            volumeOpen || volumeDragging ? "mr-2 w-24" : "mr-0 w-0"
          }`}
        >
          <div
            ref={volumeTrackRef}
            role="slider"
            tabIndex={0}
            aria-label={t("volume")}
            data-testid="hero-chrome-volume-slider"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((muted ? 0 : volume) * 100)}
            aria-valuetext={t("volumeValue", {
              percent: Math.round((muted ? 0 : volume) * 100),
            })}
            onPointerDown={handleVolumePointerDown}
            onPointerMove={handleVolumePointerMove}
            onPointerUp={handleVolumePointerUp}
            onPointerCancel={handleVolumePointerUp}
            onLostPointerCapture={handleVolumeLostPointerCapture}
            onKeyDown={handleVolumeKey}
            className="group relative h-1 w-full cursor-pointer touch-none rounded-full bg-white/20 transition-colors duration-150 hover:bg-white/30 focus:bg-white/30 focus:ring-2 focus:ring-white/60 focus:outline-none"
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
        <ChromeButton
          onClick={toggleMute}
          ariaLabel={muteLabel}
          testId="hero-chrome-mute"
        >
          {muted || volume === 0 ? <ChromeMutedIcon /> : <ChromeVolumeIcon />}
        </ChromeButton>
      </div>

      <div
        data-testid="hero-chrome-language-controls"
        className="flex shrink-0 items-center gap-1 md:gap-4"
      >
        {showLanguageButton && onLanguageClick ? (
          <ChromeButton
            onClick={onLanguageClick}
            ariaLabel={audioLanguageLabel}
            testId="hero-chrome-language"
            className={
              languageCode
                ? "w-auto min-w-10 gap-1 px-1 md:w-auto md:min-w-12 md:gap-1.5 md:px-2"
                : undefined
            }
          >
            <AudioLines aria-hidden className="h-5 w-5 md:h-6 md:w-6" />
            {languageCode ? (
              <span
                data-testid="hero-chrome-language-code"
                className="text-[10px] font-bold tracking-[0.1em] md:tracking-[0.14em]"
              >
                {languageCode}
              </span>
            ) : null}
          </ChromeButton>
        ) : null}

        {onLanguageClick ? (
          <ChromeButton
            onClick={onLanguageClick}
            ariaLabel={subtitleTooltip}
            testId="hero-chrome-subtitles"
            disabled={!showSubtitleButton}
            className={
              visibleSubtitleState
                ? "w-auto min-w-10 gap-1 px-1 md:w-auto md:min-w-12 md:gap-1.5 md:px-2"
                : undefined
            }
          >
            <Captions
              aria-hidden
              className={`h-5 w-5 md:h-6 md:w-6 ${
                subtitleEnabled && showSubtitleButton
                  ? "fill-current [&_path]:stroke-neutral-900"
                  : ""
              }`}
            />
            {visibleSubtitleState ? (
              <span
                data-testid="hero-chrome-subtitle-language-code"
                className="text-[10px] font-bold tracking-[0.1em] md:tracking-[0.14em]"
              >
                {visibleSubtitleState}
              </span>
            ) : null}
          </ChromeButton>
        ) : null}

        <ChromeButton
          onClick={toggleFullscreen}
          ariaLabel={fullscreenLabel}
          testId="hero-chrome-fullscreen"
        >
          {isFullscreen ? <ExitFullscreenIcon /> : <EnterFullscreenIcon />}
        </ChromeButton>
      </div>
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
          playing && pointerIdle ? "cursor-none" : "cursor-default"
        }`}
      />
      {/* Chrome stays pointer-active even when dimmed so agent-driven and
          keyboard interactions reach the controls — pointer movement
          brings it back to the dim rail, while hovering the controls
          themselves brings it back to opacity-100.
          Backdrop + chrome bar share one portal so the gradient travels
          with the controls as the body section slides up.

          In fullscreen the portal target swaps to the hero wrapper itself
          (the element the browser puts in fullscreen). The default target
          — overlayAnchor — sits OUTSIDE the wrapper and is hidden by the
          browser's fullscreen render, which is why the chrome disappeared
          on entering fullscreen. Both targets render the chromeBar at the
          bottom edge via `absolute bottom-0`, so the visual position is
          identical in either mode. */}
      {(() => {
        const target = isFullscreen ? wrapperEl : overlayAnchor
        if (target == null) return null
        return createPortal(
          <>
            {chromeBackdrop}
            {chromeBar}
          </>,
          target,
        )
      })()}
    </>
  )
}
