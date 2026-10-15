import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { AccessibilityInfo, Animated, AppState, Easing } from "react-native"
import { useEvent } from "expo"
import type { VideoPlayer, VideoPlayerStatus } from "expo-video"
import { shouldArmHideTimer } from "../lib/autoHide"
import {
  createControlsVisibleStore,
  nextControlsState,
  type ControlsEvent,
  type ControlsVisibleReader,
} from "../lib/controlsVisibility"

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
  /** The table's `visible` value, changed at hide start and on reveal; the
   *  player glass reads it (feat-699 KTD5). Not React state, so a change
   *  re-renders only its readers. Read it with `useControlsGlassVisible`. */
  visibleStore: ControlsVisibleReader
  /** Hide chrome if currently visible (no-op if already hidden). */
  hide: () => void
  /** Reveal only if currently hidden (immediate, e.g. on press-in). */
  revealIfHidden: () => void
  /** Ground-truth visibility (the store, not the lagging render state) so a
   *  tap landing mid-fade reads "hiding" and is routed to reveal, not hide. */
  isVisibleNow: () => boolean
  /** A control was used — keep chrome up and restart the idle timer. */
  noteInteraction: () => void
  isPlaying: boolean
}

/**
 * Auto-hiding controls ("chrome") state machine, ported from apps/tv's
 * VideoPlayer (minus TV focus). Correctness contract: gating refs synced before
 * guards, hide anim .stop()-ed on reveal, callbacks finished/isMountedRef-guarded.
 * @see docs/solutions/design-patterns/rntvos-video-overlay-async-native-event-patterns-2026-04-23.md
 */
export function useControlsVisibility(player: VideoPlayer): ControlsVisibility {
  const [controlsVisible, setControlsVisible] = useState(true)
  const [mounted, setMounted] = useState(true)
  const opacityAnim = useRef(new Animated.Value(1)).current
  // Ground-truth visibility AND the published glass value, one object so the
  // two cannot disagree. Every write goes through `step` and the table.
  const [visibleStore] = useState(() => createControlsVisibleStore(true))

  const isPausedRef = useRef(false)
  const statusRef = useRef<VideoPlayerStatus>("idle")
  const screenReaderRef = useRef(false)
  const reduceMotionRef = useRef(false)
  const hideAnimRef = useRef<Animated.CompositeAnimation | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMountedRef = useRef(true)
  const scheduleHideRef = useRef<() => void>(() => {})
  const revealRef = useRef<() => void>(() => {})
  const snapRevealRef = useRef<() => void>(() => {})

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const step = useCallback(
    (event: ControlsEvent) => {
      const next = nextControlsState(
        { visible: visibleStore.get(), mounted: true },
        event,
      )
      visibleStore.set(next.visible)
      return next
    },
    [visibleStore],
  )

  const hideNow = useCallback(() => {
    clearTimer()
    // hideStart: mark logically hidden NOW, before the fade resolves. The
    // timer-driven path calls hideNow directly; without this the store stays
    // "visible" through the fade, making revealIfHidden() a no-op mid-fade.
    step("hideStart")
    if (hideAnimRef.current != null) {
      hideAnimRef.current.stop()
      hideAnimRef.current = null
    }
    // hideDone: unmount only if still logically hidden. A reveal/interaction
    // during the fade flips the store back true, making this completion stale —
    // it then keeps the chrome mounted (mount-after-fade, DeleteConfirmSheet:74-92).
    const finishHide = () => {
      const next = step("hideDone")
      setControlsVisible(next.visible)
      setMounted(next.mounted)
    }
    if (reduceMotionRef.current) {
      opacityAnim.setValue(0)
      finishHide()
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
      if (finished) finishHide()
      hideAnimRef.current = null
    })
  }, [clearTimer, opacityAnim, step])

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
    const next = step("reveal")
    setMounted(next.mounted)
    setControlsVisible(next.visible)
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
  }, [clearTimer, opacityAnim, scheduleHide, step])

  const hide = useCallback(() => {
    if (!visibleStore.get()) return
    hideNow()
  }, [hideNow, visibleStore])

  const revealIfHidden = useCallback(() => {
    if (!visibleStore.get()) reveal()
  }, [reveal, visibleStore])

  const isVisibleNow = useCallback(() => visibleStore.get(), [visibleStore])

  // Show at full opacity at once and re-arm: a control press, and the return
  // from background. Stopping an in-flight hide fade keeps its completion
  // callback from unmounting the chrome the viewer just brought back.
  const snapReveal = useCallback(() => {
    const stoppedFade = hideAnimRef.current
    if (stoppedFade != null) {
      stoppedFade.stop()
      hideAnimRef.current = null
    }
    const next = step("reveal")
    setMounted(next.mounted)
    setControlsVisible(next.visible)
    opacityAnim.setValue(1)
    if (stoppedFade != null) {
      // The stopped fade reports its native position late and overwrites the
      // 1; a plate that re-renders then draws a dim glyph. Reset in the reply.
      opacityAnim.stopAnimation(() => {
        if (visibleStore.get() && hideAnimRef.current == null) {
          opacityAnim.setValue(1)
        }
      })
    }
    scheduleHide()
  }, [opacityAnim, scheduleHide, step, visibleStore])

  scheduleHideRef.current = scheduleHide
  revealRef.current = reveal
  snapRevealRef.current = snapReveal

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
      (payload: { status: VideoPlayerStatus }) => {
        if (!isMountedRef.current) return
        const next = payload.status
        statusRef.current = next
        if (next === "loading") {
          clearTimer()
          if (!visibleStore.get()) revealRef.current()
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
  }, [player, clearTimer, visibleStore])

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
        // Guard the setState-causing reveal/scheduleHide against a late event
        // after unmount (mirrors the statusChange listener's isMountedRef gate).
        if (!isMountedRef.current) return
        screenReaderRef.current = v
        if (v) {
          if (!visibleStore.get()) revealRef.current()
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
  }, [visibleStore])

  // Foreground resume: through the table like any reveal, so the glass value
  // comes back with the chrome (feat-699 AE1).
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (!isMountedRef.current || next !== "active") return
      snapRevealRef.current()
    })
    return () => {
      try {
        sub.remove()
      } catch {
        // noop
      }
    }
  }, [])

  // Initial-arming fallback: if playingChange never fires (stalled autoplay),
  // still arm the hide after a short delay. scheduleHide is idempotent.
  useEffect(() => {
    const t = setTimeout(() => scheduleHideRef.current(), MOUNT_FALLBACK_MS)
    return () => clearTimeout(t)
  }, [])

  // Unmount: flip the mounted guard and tear down the timer + animation so no
  // late callback runs setState on an unmounted component.
  useEffect(() => {
    // StrictMode re-runs this setup on the same instance after the cleanup.
    isMountedRef.current = true
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
    visibleStore,
    hide,
    revealIfHidden,
    isVisibleNow,
    noteInteraction: snapReveal,
    isPlaying,
  }
}

/** Reads the published glass value; a change re-renders only the caller. */
export function useControlsGlassVisible(store: ControlsVisibleReader): boolean {
  return useSyncExternalStore(store.subscribe, store.get)
}
