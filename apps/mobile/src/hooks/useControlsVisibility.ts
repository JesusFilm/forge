import { useCallback, useEffect, useRef, useState } from "react"
import { AccessibilityInfo, Animated, AppState, Easing } from "react-native"
import { useEvent } from "expo"
import type { VideoPlayer } from "expo-video"
import { shouldArmHideTimer } from "../lib/autoHide"

const HIDE_DELAY_MS = 3000
const FADE_OUT_MS = 150
const FADE_IN_MS = 100
const MOUNT_FALLBACK_MS = 2000

export type ControlsVisibility = {
  /** True while chrome should be on screen (drives the Animated opacity). */
  controlsVisible: boolean
  /** True while the chrome layer should be mounted — stays true through the
   *  fade-out and flips false only once the fade completes, so fully-hidden
   *  chrome stops intercepting touches. */
  mounted: boolean
  opacityAnim: Animated.Value
  /** Tap on the video body: hide if visible, reveal if hidden. */
  toggle: () => void
  /** Hide chrome if currently visible (no-op if already hidden). */
  hide: () => void
  /** Reveal only if currently hidden (immediate, e.g. on press-in). */
  revealIfHidden: () => void
  /** A control was used — keep chrome up and restart the idle timer. */
  noteInteraction: () => void
  isPlaying: boolean
}

/**
 * Auto-hiding controls ("chrome") state machine, ported from
 * apps/tv/src/components/VideoPlayer.tsx (minus the TV focus machinery).
 *
 * Correctness contract (see
 * docs/solutions/design-patterns/rntvos-video-overlay-async-native-event-patterns-2026-04-23.md):
 * gating values are mirrored into refs and synced BEFORE the guard runs so
 * native callbacks read ground truth; the in-flight hide animation handle is
 * captured and `.stop()`-ed at every force-reveal; the completion callback is
 * `finished`-guarded; every external-emitter callback is `isMountedRef`-guarded;
 * reduce-motion snaps instead of animating.
 */
export function useControlsVisibility(player: VideoPlayer): ControlsVisibility {
  const [controlsVisible, setControlsVisible] = useState(true)
  const [mounted, setMounted] = useState(true)
  const opacityAnim = useRef(new Animated.Value(1)).current

  const isPausedRef = useRef(false)
  const statusRef = useRef<string>("idle")
  const screenReaderRef = useRef(false)
  const reduceMotionRef = useRef(false)
  const controlsVisibleRef = useRef(true)
  const hideAnimRef = useRef<Animated.CompositeAnimation | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMountedRef = useRef(true)
  const scheduleHideRef = useRef<() => void>(() => {})
  const revealRef = useRef<() => void>(() => {})

  useEffect(() => {
    controlsVisibleRef.current = controlsVisible
  }, [controlsVisible])

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const hideNow = useCallback(() => {
    clearTimer()
    if (hideAnimRef.current != null) {
      hideAnimRef.current.stop()
      hideAnimRef.current = null
    }
    if (reduceMotionRef.current) {
      opacityAnim.setValue(0)
      setControlsVisible(false)
      setMounted(false)
      return
    }
    const anim = Animated.timing(opacityAnim, {
      toValue: 0,
      duration: FADE_OUT_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    })
    hideAnimRef.current = anim
    anim.start(({ finished }) => {
      if (finished) {
        setControlsVisible(false)
        // Unmount only after the fade completes so hidden chrome stops
        // intercepting drags/taps (mirrors MiniPlayerBar's mount-after-fade).
        setMounted(false)
      }
      hideAnimRef.current = null
    })
  }, [clearTimer, opacityAnim])

  const scheduleHide = useCallback(() => {
    clearTimer()
    if (
      !shouldArmHideTimer({
        isPaused: isPausedRef.current,
        status: statusRef.current,
        screenReaderEnabled: screenReaderRef.current,
      })
    ) {
      return
    }
    timerRef.current = setTimeout(hideNow, HIDE_DELAY_MS)
  }, [clearTimer, hideNow])

  const reveal = useCallback(() => {
    clearTimer()
    if (hideAnimRef.current != null) {
      hideAnimRef.current.stop()
      hideAnimRef.current = null
    }
    controlsVisibleRef.current = true
    setMounted(true)
    setControlsVisible(true)
    if (reduceMotionRef.current) {
      opacityAnim.setValue(1)
    } else {
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: FADE_IN_MS,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start()
    }
    scheduleHide()
  }, [clearTimer, opacityAnim, scheduleHide])

  const toggle = useCallback(() => {
    if (controlsVisibleRef.current) {
      controlsVisibleRef.current = false
      hideNow()
    } else {
      reveal()
    }
  }, [hideNow, reveal])

  const hide = useCallback(() => {
    if (!controlsVisibleRef.current) return
    controlsVisibleRef.current = false
    hideNow()
  }, [hideNow])

  const revealIfHidden = useCallback(() => {
    if (!controlsVisibleRef.current) reveal()
  }, [reveal])

  const noteInteraction = useCallback(() => {
    controlsVisibleRef.current = true
    setMounted(true)
    setControlsVisible(true)
    scheduleHide()
  }, [scheduleHide])

  scheduleHideRef.current = scheduleHide
  revealRef.current = reveal

  // isPlaying drives the timer: arm on play, clear on pause/end.
  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  })
  useEffect(() => {
    isPausedRef.current = !isPlaying
    if (isPlaying) scheduleHideRef.current()
    else clearTimer()
  }, [isPlaying, clearTimer])

  // statusChange: suspend the timer + force-reveal while buffering; re-arm
  // once ready. Sync statusRef before any scheduleHide call (ground truth).
  useEffect(() => {
    const sub = player.addListener(
      "statusChange",
      (payload: { status: string }) => {
        if (!isMountedRef.current) return
        const next = payload.status
        statusRef.current = next
        if (next === "loading") {
          clearTimer()
          if (!controlsVisibleRef.current) revealRef.current()
          return
        }
        if (next === "readyToPlay") scheduleHideRef.current()
      },
    )
    return () => {
      try {
        sub.remove()
      } catch {
        // player already released
      }
    }
  }, [player, clearTimer])

  // Accessibility: seed + subscribe. Screen reader disables auto-hide and
  // force-reveals; reduce-motion snaps the fade.
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      reduceMotionRef.current = v
    })
    AccessibilityInfo.isScreenReaderEnabled().then((v) => {
      screenReaderRef.current = v
    })
    const rm = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (v) => {
        reduceMotionRef.current = v
      },
    )
    const sr = AccessibilityInfo.addEventListener(
      "screenReaderChanged",
      (v) => {
        screenReaderRef.current = v
        if (v) {
          if (!controlsVisibleRef.current) revealRef.current()
        } else {
          scheduleHideRef.current()
        }
      },
    )
    return () => {
      try {
        rm.remove()
      } catch {
        // noop
      }
      try {
        sr.remove()
      } catch {
        // noop
      }
    }
  }, [])

  // Foreground resume: snap controls visible and re-arm.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") return
      if (hideAnimRef.current != null) {
        hideAnimRef.current.stop()
        hideAnimRef.current = null
      }
      controlsVisibleRef.current = true
      setMounted(true)
      setControlsVisible(true)
      opacityAnim.setValue(1)
      scheduleHideRef.current()
    })
    return () => {
      try {
        sub.remove()
      } catch {
        // noop
      }
    }
  }, [opacityAnim])

  // Initial-arming fallback: if playingChange never fires (stalled autoplay),
  // still arm the hide after a short delay. scheduleHide is idempotent.
  useEffect(() => {
    const t = setTimeout(() => scheduleHideRef.current(), MOUNT_FALLBACK_MS)
    return () => clearTimeout(t)
  }, [])

  // Unmount: flip the mounted guard and tear down the timer + animation so no
  // late callback runs setState on an unmounted component.
  useEffect(() => {
    return () => {
      isMountedRef.current = false
      if (timerRef.current != null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      if (hideAnimRef.current != null) {
        hideAnimRef.current.stop()
        hideAnimRef.current = null
      }
    }
  }, [])

  return {
    controlsVisible,
    mounted,
    opacityAnim,
    toggle,
    hide,
    revealIfHidden,
    noteInteraction,
    isPlaying,
  }
}
