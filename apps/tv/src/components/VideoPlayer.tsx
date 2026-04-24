import { useCallback, useEffect, useRef, useState } from "react"
import {
  AccessibilityInfo,
  Animated,
  AppState,
  BackHandler,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  // @ts-expect-error TVEventControl is provided by react-native-tvos but not in the base RN types that CI type-checks against.
  TVEventControl,
  // @ts-expect-error useTVEventHandler is provided by react-native-tvos but not in the base RN types that CI type-checks against.
  useTVEventHandler,
  View,
} from "react-native"
import { useVideoPlayer, VideoView, type VideoPlayerStatus } from "expo-video"
import { TVFocusGuideView } from "./TVFocusGuideView"
import { COLORS, hexToRgba } from "../lib/colors"
import { scale } from "../lib/scale"

// ── Shared Visual Tokens ───────────────────────────────────────────────────
// Player chrome uses the app-wide Crimson Gallery tokens (see ../lib/colors).
// The warm-salmon palette previously pinned here (from an early Stitch
// mockup) has been retired — the player now visually matches the rest of
// the TV app (HomeHero, FocusableCard, etc.).
const TRACK_BG = COLORS.surfaceContainerHighest // progress track fill
const GLASS_BG = hexToRgba(COLORS.surfaceContainer, 0.8) // frosted-glass panel

// ── SVG-free Icon Components ───────────────────────────────────────────────

/** Two vertical bars — pure View-based pause icon */
function PauseIcon({
  size = 24,
  color = COLORS.text,
}: {
  size?: number
  color?: string
}) {
  const barWidth = Math.round(size * 0.25)
  const barHeight = Math.round(size * 0.7)
  const gap = Math.round(size * 0.2)
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        gap,
      }}
    >
      <View
        style={{
          width: barWidth,
          height: barHeight,
          backgroundColor: color,
          borderRadius: 2,
        }}
      />
      <View
        style={{
          width: barWidth,
          height: barHeight,
          backgroundColor: color,
          borderRadius: 2,
        }}
      />
    </View>
  )
}

/** Right-pointing triangle — pure View-based play icon */
function PlayIcon({
  size = 24,
  color = COLORS.text,
}: {
  size?: number
  color?: string
}) {
  const triangleSize = Math.round(size * 0.5)
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: triangleSize,
          borderTopWidth: Math.round(triangleSize * 0.65),
          borderBottomWidth: Math.round(triangleSize * 0.65),
          borderLeftColor: color,
          borderTopColor: "transparent",
          borderBottomColor: "transparent",
          marginLeft: Math.round(size * 0.1),
        }}
      />
    </View>
  )
}

// ── Types ───────────────────────────────────────────────────────────────────

export type VideoPlayerProps = {
  streamingUrl: string
  title?: string
  subtitle?: string
  onDismiss: () => void
}

// ── Component ───────────────────────────────────────────────────────────────

export function VideoPlayer({
  streamingUrl,
  title,
  subtitle,
  onDismiss,
}: VideoPlayerProps) {
  const [isPaused, setIsPaused] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  // Focus states for each interactive element
  const [backFocused, setBackFocused] = useState(false)
  const [playFocused, setPlayFocused] = useState(false)
  const [rewindFocused, setRewindFocused] = useState(false)
  const [forwardFocused, setForwardFocused] = useState(false)

  // Fix #5: One-shot flag so `hasTVPreferredFocus` is only true on the
  // first render. Moved out of the render body into useEffect so React
  // StrictMode's double-invoke doesn't consume the flag before first
  // commit (dev-only regression). Leaving it true on every render would
  // re-steal focus on every state change (react-native-tvos#839).
  const [shouldRequestFocus, setShouldRequestFocus] = useState(true)
  useEffect(() => {
    setShouldRequestFocus(false)
  }, [])

  // ── Auto-hide state machine (U1 foundation; wired in Units 2-7) ─────
  // Visibility + focusability drive the chrome fade. `status` mirrors the
  // expo-video VideoPlayerStatus enum so Unit 5 can branch on buffering
  // vs error. Accessibility state gates auto-hide entirely (screen reader)
  // and switches the fade to a snap (reduce motion).
  const [controlsVisible, setControlsVisible] = useState(true)
  const [controlsFocusable, setControlsFocusable] = useState(true)
  const [status, setStatus] = useState<VideoPlayerStatus>("idle")
  const [hasError, setHasError] = useState(false)
  const [isScreenReaderEnabled, setIsScreenReaderEnabled] = useState(false)
  const [isReduceMotionEnabled, setIsReduceMotionEnabled] = useState(false)

  // One-shot focus flags (I6). Each is set true by reveal entry / error
  // entry respectively and cleared after the render that consumed it,
  // mirroring Fix #5's `hasTVPreferredFocus` pattern. The if-guard inside
  // the useEffect prevents the false→false invocation from looping.
  const [revealFocusPending, setRevealFocusPending] = useState(false)
  useEffect(() => {
    if (revealFocusPending) setRevealFocusPending(false)
  }, [revealFocusPending])
  const [errorFocusPending, setErrorFocusPending] = useState(false)
  useEffect(() => {
    if (errorFocusPending) setErrorFocusPending(false)
  }, [errorFocusPending])

  // Inactivity timer (I3) and shared Animated.Value for chrome opacity.
  // The timer uses a ref so rapid D-pad resets don't trigger re-renders;
  // `opacityAnim` is populated once per mount and driven imperatively
  // from hide/reveal helpers (Unit 2).
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const opacityAnim = useRef(new Animated.Value(1)).current

  // Clear any pending inactivity timer + in-flight hide animation on
  // unmount, and flip isMountedRef so late-arriving native emissions
  // bail out. This prevents setState-on-unmounted warnings from
  // dangling expo-video callbacks (P1.2 + P2.3).
  useEffect(() => {
    return () => {
      isMountedRef.current = false
      if (inactivityTimerRef.current != null) {
        clearTimeout(inactivityTimerRef.current)
        inactivityTimerRef.current = null
      }
      if (hideAnimRef.current != null) {
        hideAnimRef.current.stop()
        hideAnimRef.current = null
      }
    }
  }, [])

  // Stable handler refs bridge subscription owners (this unit) and handler
  // implementers (Units 2-3). Without this pattern, subscriptions would
  // re-register every time the handlers closed over fresh state, churning
  // the underlying native event emitter. Mirrors Fix #15's `onDismissRef`.
  const scheduleHideRef = useRef<() => void>(() => {})
  const revealControlsRef = useRef<() => void>(() => {})
  const controlsVisibleRef = useRef(true)
  const isScreenReaderEnabledRef = useRef(false)
  const menuKeyEnabledRef = useRef(false)

  // Mirror the gating state into refs so scheduleHide reads ground-truth
  // values when invoked synchronously from native event callbacks (e.g.
  // playingChange, statusChange) — before React has committed the state
  // updates those callbacks just queued. useEffect mirrors update post-
  // commit and serve as the fall-back; the handlers eagerly sync the
  // relevant ref BEFORE calling scheduleHideRef so the new gating value
  // is already in place when the guard runs.
  const isPausedRef = useRef(false)
  const statusRef = useRef<VideoPlayerStatus>("idle")
  const hasErrorRef = useRef(false)
  const hideAnimRef = useRef<Animated.CompositeAnimation | null>(null)

  // isMountedRef guards the handlers of external emissions (expo-video
  // native events, setTimeout callbacks) from invoking setState after
  // the component has unmounted. Fix #24's try/catch only catches
  // thrown onDismiss — it does NOT cover the "callback fires on an
  // unmounted component" case. Set to false once in the unmount effect
  // below. P2.3 / reliability rel-2 + rel-3.
  const isMountedRef = useRef(true)

  // Keep mirror refs in sync with their state so Unit 3's useTVEventHandler
  // callback can read current values without re-binding on every render.
  useEffect(() => {
    controlsVisibleRef.current = controlsVisible
  }, [controlsVisible])
  useEffect(() => {
    isScreenReaderEnabledRef.current = isScreenReaderEnabled
  }, [isScreenReaderEnabled])
  useEffect(() => {
    isPausedRef.current = isPaused
  }, [isPaused])
  useEffect(() => {
    statusRef.current = status
  }, [status])
  useEffect(() => {
    hasErrorRef.current = hasError
  }, [hasError])

  // ── Screen-reader transition side-effects (U7) ──────────────────────
  // When SR toggles mid-session, the chrome has to respond:
  //   - on  → reveal if currently hidden (the user just gained access
  //     to controls they couldn't navigate) + audible confirmation.
  //   - off → rearm the inactivity timer so chrome eventually retreats
  //     again; without this, a passive viewer who briefly toggled VO
  //     on-then-off would be stuck with permanent controls until they
  //     pressed D-pad.
  // The `srSeededRef` guard skips the first invocation so we don't fire
  // side-effects on the mount-time seed from AccessibilityInfo.
  const srSeededRef = useRef(false)
  useEffect(() => {
    if (!srSeededRef.current) {
      srSeededRef.current = true
      return
    }
    if (isScreenReaderEnabled) {
      if (!controlsVisibleRef.current) {
        revealControlsRef.current()
      }
      AccessibilityInfo.announceForAccessibility("Player controls visible")
    } else {
      scheduleHideRef.current()
    }
  }, [isScreenReaderEnabled])

  // Accessibility: seed + subscribe to screen-reader and reduce-motion
  // state. Auto-hide is disabled while a screen reader is active (D13);
  // reduce-motion switches the fade to an instant snap (D8 reduce-motion
  // path). Mirror the subscription shape already used by HomeHero.
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setIsReduceMotionEnabled)
    AccessibilityInfo.isScreenReaderEnabled().then(setIsScreenReaderEnabled)
    const rmSub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setIsReduceMotionEnabled,
    )
    const srSub = AccessibilityInfo.addEventListener(
      "screenReaderChanged",
      setIsScreenReaderEnabled,
    )
    return () => {
      try {
        rmSub.remove()
      } catch (e) {
        console.error("[VideoPlayer] reduceMotion cleanup failed:", e)
      }
      try {
        srSub.remove()
      } catch (e) {
        console.error("[VideoPlayer] screenReader cleanup failed:", e)
      }
    }
  }, [])

  // Foreground resume (D12 + U6): on AppState 'active', always snap
  // controls visible, restore a one-shot focus claim (so tvOS
  // UIFocusEngine has a target — matches react-native-tvos #852), and
  // rearm a fresh 3 s timer.
  //   - `hasError` branch: skip scheduleHide entirely (error state
  //     keeps chrome visible permanently) AND route focus to the back
  //     pill via errorFocusPending since it is the only meaningful
  //     control in the error state.
  //   - Non-error branch: route focus to play/pause via
  //     revealFocusPending (P1.4 / julik-5). Without this flag, the
  //     catcher unmounts on foreground but hasTVPreferredFocus has no
  //     signal to claim focus on play/pause — UIFocusEngine orphans.
  //   - `isPaused` branch: handled IMPLICITLY. scheduleHide's internal
  //     guard bails on isPausedRef (Unit 2), so calling it here through
  //     scheduleHideRef is a no-op when the player is paused. No
  //     explicit guard needed.
  // Playback resume behaviour is out of scope per the plan's deferred
  // items — we don't touch player.play()/pause() here.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") return
      // Stop any in-flight hide so its completion callback doesn't
      // flip controlsVisible=false after we just force-revealed.
      if (hideAnimRef.current != null) {
        hideAnimRef.current.stop()
        hideAnimRef.current = null
      }
      setControlsVisible(true)
      setControlsFocusable(true)
      opacityAnim.setValue(1)
      if (hasErrorRef.current) {
        setErrorFocusPending(true)
      } else {
        setRevealFocusPending(true)
        scheduleHideRef.current()
      }
    })
    return () => {
      try {
        sub.remove()
      } catch (e) {
        console.error("[VideoPlayer] AppState cleanup failed:", e)
      }
    }
  }, [opacityAnim])

  // tvOS: claim the hardware Menu key so Expo Router's Stack does not
  // auto-pop before our BackHandler path runs (Unit 3 wires the handler).
  // menuKeyEnabledRef bookkeeps whether enable succeeded so cleanup only
  // runs when there is something to release.
  useEffect(() => {
    if (!Platform.isTV) return
    try {
      TVEventControl.enableTVMenuKey()
      menuKeyEnabledRef.current = true
    } catch (e) {
      console.error("[VideoPlayer] enableTVMenuKey failed:", e)
    }
    return () => {
      if (!menuKeyEnabledRef.current) return
      try {
        TVEventControl.disableTVMenuKey()
      } catch (e) {
        console.error("[VideoPlayer] disableTVMenuKey failed:", e)
      }
      menuKeyEnabledRef.current = false
    }
  }, [])

  // ── TV event routing (U3) ──────────────────────────────────────────
  // Ref-stable TV-event callback reads controlsVisibleRef and
  // isScreenReaderEnabledRef so the underlying native emitter doesn't
  // re-register on every render (which would drop events during rapid
  // state changes). Used for directional / Select / media-key input;
  // hardware Menu goes through BackHandler below (single-channel, no
  // double-fire).
  //
  // IMPORTANT: we DENYLIST synthetic focus/pan events on the hidden-
  // state branch. react-native-tvos emits synthetic `focus`/`blur`/
  // `pan*` events when the engine reassigns focus — including when
  // the catcher mounts with hasTVPreferredFocus. An earlier strict-
  // whitelist approach (P2.2 pre-fix) excluded these correctly but
  // ALSO excluded hardware media buttons (playPause/fastForward/
  // rewind) that some Android TV remotes and Siri remote gen-1 emit,
  // silently dropping them while chrome was hidden. Denylist flips
  // that: anything not-synthetic is treated as user intent.
  const onTVEvent = useCallback(
    (evt: { eventType?: string } | null | undefined) => {
      if (evt == null) return
      const type = evt.eventType
      if (type == null) return
      const isSyntheticFocusEvent =
        type === "focus" ||
        type === "blur" ||
        type === "pan" ||
        type === "panBegin" ||
        type === "panEnd"
      if (isSyntheticFocusEvent) return

      if (!controlsVisibleRef.current && !isScreenReaderEnabledRef.current) {
        revealControlsRef.current()
        return
      }
      // Visible state: Siri-remote swipes don't fire Pressable.onFocus,
      // so they won't reset the timer via the usual D14 path. Catch them
      // here so every D-pad activity resets the timer as D14 requires.
      // Arrow / Select events already reset via Pressable onFocus/onPress.
      // Same treatment for hardware media keys — they're user intent.
      if (
        type.indexOf("swipe") === 0 ||
        type === "playPause" ||
        type === "fastForward" ||
        type === "rewind"
      ) {
        scheduleHideRef.current()
      }
    },
    [],
  )
  useTVEventHandler(onTVEvent)

  // Hardware Menu (tvOS) + hardware Back (Android TV) via BackHandler.
  // react-native-tvos's BackHandler bridges the tvOS Menu event into
  // 'hardwareBackPress', so one subscription covers both platforms.
  // Returning `true` consumes the event and prevents Expo Router's Stack
  // from popping (combined with TVEventControl.enableTVMenuKey on tvOS).
  useEffect(() => {
    const handler = () => {
      if (!controlsVisibleRef.current && !isScreenReaderEnabledRef.current) {
        revealControlsRef.current()
        return true
      }
      onDismissRef.current()
      return true
    }
    const sub = BackHandler.addEventListener("hardwareBackPress", handler)
    return () => {
      try {
        sub.remove()
      } catch (e) {
        console.error("[VideoPlayer] BackHandler cleanup failed:", e)
      }
    }
  }, [])

  // Fix #6: Seed duration synchronously from the initializer. `sourceLoad`
  // can fire before the useEffect subscription mounts, especially on a
  // warmed player. Without seeding, duration stays 0 forever and the end
  // time displays "--:--". The listener below stays as the update path.
  const player = useVideoPlayer(streamingUrl, (p) => {
    p.timeUpdateEventInterval = 1
    if (typeof p.duration === "number" && p.duration > 0) {
      setDuration(p.duration)
    }
  })

  // Fix #15: Stable onDismiss via ref so the playToEnd listener isn't
  // re-registered every parent render (which would open a window where
  // playToEnd events are dropped).
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  // Fix #4: Seeking guard. While this ref holds a positive value, in-flight
  // `timeUpdate` events are ignored so the optimistic seek position isn't
  // overwritten by a stale native emission. Cleared when a timeUpdate at
  // or past the target arrives.
  const seekTargetRef = useRef<number | null>(null)

  // Auto-play on mount. Wrap in try-catch because on tvOS the player may
  // not be ready when the effect first fires (expo-video silently ignores
  // play() in the setup callback; the separate useEffect can also race).
  // Retry once after a short delay if the first attempt doesn't start,
  // but only if the user hasn't paused in the meantime.
  useEffect(() => {
    let cancelled = false
    try {
      player.play()
    } catch {
      // Player not ready yet
    }
    const retry = setTimeout(() => {
      if (cancelled) return
      try {
        if (!player.playing) {
          player.play()
        }
      } catch {
        // Still not ready or already released
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(retry)
    }
  }, [player])

  // Listen to playToEnd for auto-dismiss.
  // Fix #15: Depends only on [player] (+ opacityAnim for U6); dismiss is
  // read through a ref.
  // Fix #24: Wrap the dismiss call so a throwing onDismiss doesn't
  // propagate into expo-video's native event dispatch path.
  // U6: If the chrome is hidden when the video ends, snap it visible for
  // one paint before dispatching onDismiss. Intent is imperceptible
  // technical continuity (no black frame) — NOT a visible flash.
  // setTimeout(0) is used rather than requestAnimationFrame because rAF's
  // mapping to the native paint thread is less well-specified under
  // react-native-tvos; if on-device QA ever shows a black frame on a
  // hidden-to-dismissed transition, switch to requestAnimationFrame.
  useEffect(() => {
    const doDismiss = () => {
      // P2.3: if the component has since unmounted, don't fire the
      // dismiss callback against a dead tree. The parent's onDismiss
      // typically triggers navigation, which could race with Expo
      // Router's own unmount path.
      if (!isMountedRef.current) return
      try {
        onDismissRef.current()
      } catch (e) {
        console.error("[VideoPlayer] onDismiss threw:", e)
      }
    }
    const subscription = player.addListener("playToEnd", () => {
      if (!isMountedRef.current) return
      if (!controlsVisibleRef.current) {
        setControlsVisible(true)
        setControlsFocusable(true)
        opacityAnim.setValue(1)
        setTimeout(doDismiss, 0)
        return
      }
      doDismiss()
    })
    return () => {
      try {
        subscription.remove()
      } catch (e) {
        console.error("[VideoPlayer] playToEnd cleanup failed:", e)
      }
    }
  }, [player, opacityAnim])

  // Track playing state changes.
  // Fix #25: Guard cleanup for consistency with the unmount-pause guard.
  // U2: also drive the inactivity timer — clear on pause, rearm on play.
  // playingChange=isPlaying=true is the authoritative "video actually
  // started" signal, so it arms the INITIAL 3 s countdown for D1 (see the
  // separate 2 s mount fallback below).
  useEffect(() => {
    const subscription = player.addListener(
      "playingChange",
      ({ isPlaying }) => {
        // P2.3: ignore late-arriving native events after unmount.
        if (!isMountedRef.current) return
        // Sync the guard ref BEFORE calling scheduleHideRef so the
        // scheduleHide closure sees the post-transition value. Without
        // this, the synchronous call happens before React commits the
        // setIsPaused update, and scheduleHide's `isPausedRef.current`
        // guard reads the pre-transition value → bails → timer never
        // arms. Same pattern applied to statusChange below.
        isPausedRef.current = !isPlaying
        setIsPaused(!isPlaying)
        if (isPlaying) {
          scheduleHideRef.current()
        } else if (inactivityTimerRef.current != null) {
          clearTimeout(inactivityTimerRef.current)
          inactivityTimerRef.current = null
        }
      },
    )
    return () => {
      try {
        subscription.remove()
      } catch (e) {
        console.error("[VideoPlayer] playingChange cleanup failed:", e)
      }
    }
  }, [player])

  // Initial-arming fallback: if playingChange hasn't fired 2 s after mount
  // (e.g. the stream stalled during autoplay retry), call scheduleHide
  // anyway so controls don't stick indefinitely. scheduleHide is
  // idempotent, so the normal playingChange path wins if it fires first.
  useEffect(() => {
    const fallback = setTimeout(() => {
      scheduleHideRef.current()
    }, 2000)
    return () => clearTimeout(fallback)
  }, [])

  // Track time updates.
  // Fix #4: Skip state updates while a seek is in flight — don't let stale
  // pre-seek timeUpdate events overwrite the optimistic position.
  useEffect(() => {
    const subscription = player.addListener("timeUpdate", (payload) => {
      const target = seekTargetRef.current
      if (target != null) {
        if (payload.currentTime >= target - 0.1) {
          // Native caught up — release the guard and accept real updates.
          seekTargetRef.current = null
          setCurrentTime(payload.currentTime)
        }
        return
      }
      setCurrentTime(payload.currentTime)
    })
    return () => {
      try {
        subscription.remove()
      } catch (e) {
        console.error("[VideoPlayer] timeUpdate cleanup failed:", e)
      }
    }
  }, [player])

  // Track duration from sourceLoad (update path only — initial value is
  // seeded in the useVideoPlayer initializer above).
  useEffect(() => {
    const subscription = player.addListener("sourceLoad", (payload) => {
      setDuration(payload.duration)
    })
    return () => {
      try {
        subscription.remove()
      } catch (e) {
        console.error("[VideoPlayer] sourceLoad cleanup failed:", e)
      }
    }
  }, [player])

  // U5: expo-video statusChange — drives buffering timer-suspend and
  // the terminal error state. Status enum is the expo-video
  // VideoPlayerStatus literal union ('idle' | 'loading' | 'readyToPlay' |
  // 'error'); no 'buffering' value exists, so 'loading' is the
  // buffering/suspend signal. Uses `controlsVisibleRef.current` (not the
  // state) to avoid stale-closure reads of visibility inside the
  // long-lived subscription callback.
  useEffect(() => {
    const subscription = player.addListener("statusChange", (payload) => {
      // P2.3: ignore late-arriving native events after unmount.
      if (!isMountedRef.current) return
      const next = payload.status
      // Sync status ref before any scheduleHideRef call below — see the
      // playingChange listener's comment for why this ordering matters.
      statusRef.current = next
      setStatus(next)

      // Terminal error — force chrome visible permanently, focus the
      // back pill. hasError gates all subsequent scheduleHide calls.
      if (next === "error") {
        hasErrorRef.current = true
        setHasError(true)
        if (inactivityTimerRef.current != null) {
          clearTimeout(inactivityTimerRef.current)
          inactivityTimerRef.current = null
        }
        // P1.2 / adversarial #4: stop any in-flight hide so its
        // completion callback doesn't flip controlsVisible=false after
        // we just force-revealed. Without this, an error landing mid-
        // fade yields a fleeting "error UI then invisible" flash.
        if (hideAnimRef.current != null) {
          hideAnimRef.current.stop()
          hideAnimRef.current = null
        }
        setControlsVisible(true)
        setControlsFocusable(true)
        opacityAnim.setValue(1)
        // P2.1: clear any pending reveal-focus so only the back-pill's
        // errorFocusPending claim is live this render. Otherwise a
        // same-tick reveal could double-claim hasTVPreferredFocus.
        setRevealFocusPending(false)
        setErrorFocusPending(true)
        return
      }

      if (next === "loading") {
        // In-flight seek stall: ignore — Fix #4 already handles the UI
        // side and the stall is expected. Without this guard the timer
        // would suspend (and force-reveal) on every 10 s skip press.
        if (seekTargetRef.current !== null) return
        // Genuine network buffering: clear timer (suspend), and force
        // controls visible if currently hidden so the user isn't left
        // staring at an invisible stall. revealControlsRef's early-return
        // de-dup makes this a no-op if already visible.
        if (inactivityTimerRef.current != null) {
          clearTimeout(inactivityTimerRef.current)
          inactivityTimerRef.current = null
        }
        if (!controlsVisibleRef.current) {
          revealControlsRef.current()
        }
        return
      }

      // Resume from buffering — restart the 3 s countdown.
      if (next === "readyToPlay") {
        scheduleHideRef.current()
        return
      }

      // 'idle' — initial mount default; nothing to do at runtime.
    })
    return () => {
      try {
        subscription.remove()
      } catch (e) {
        console.error("[VideoPlayer] statusChange cleanup failed:", e)
      }
    }
  }, [player, opacityAnim])

  // Pause on unmount — guard against the known benign case where
  // expo-video's native shared object is released before React's effect
  // cleanup fires. Re-raise anything else so real bugs aren't silenced.
  useEffect(() => {
    return () => {
      try {
        player.pause()
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (!msg.toLowerCase().includes("shared object")) {
          console.error("[VideoPlayer] unmount pause failed:", e)
        }
      }
    }
  }, [player])

  // Fix #9: Decide from React state (`isPaused`), not `player.playing`.
  // Rapid D-pad selects all see the same native value within one event
  // cycle and issue redundant calls; using React state gives us a single
  // monotonic source that toggles once per press.
  const togglePlayPause = () => {
    if (isPaused) {
      player.play()
    } else {
      player.pause()
    }
  }

  const seekBackward = () => {
    const newTime = Math.max(0, player.currentTime - 10)
    seekTargetRef.current = newTime
    player.currentTime = newTime
    setCurrentTime(newTime)
  }

  const seekForward = () => {
    if (duration <= 0) return
    // Fix #8: Clamp to `duration - 0.5` instead of `duration` so landing
    // on the exact endpoint doesn't fire `playToEnd` and involuntarily
    // dismiss the player while the user is still watching.
    const newTime = Math.min(
      Math.max(0, duration - 0.5),
      player.currentTime + 10,
    )
    seekTargetRef.current = newTime
    player.currentTime = newTime
    setCurrentTime(newTime)
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  // ── Auto-hide helpers (U2) ──────────────────────────────────────────
  // hideControls: releases focusability → runs the 150 ms ease-out fade
  // (or snap under reduce-motion) → flips controlsVisible to false so
  // Unit 3's catcher mounts. I7 ordering — focusable off BEFORE the fade
  // starts so UIFocusEngine releases the controls before they're invisible.
  //
  // Captures the Animated.CompositeAnimation handle in hideAnimRef so
  // reveal / error paths can .stop() it, preventing the completion
  // callback from flipping controlsVisible=false after we just force-
  // revealed (P1.2 / adversarial #4). The completion callback is guarded
  // by `finished` — when the animation is stopped, finished=false and we
  // do NOT apply the "hide complete" state update.
  const hideControls = () => {
    setControlsFocusable(false)
    if (isReduceMotionEnabled) {
      opacityAnim.setValue(0)
      setControlsVisible(false)
      return
    }
    hideAnimRef.current = Animated.timing(opacityAnim, {
      toValue: 0,
      duration: 150,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    })
    hideAnimRef.current.start(({ finished }) => {
      if (finished) {
        setControlsVisible(false)
      }
      hideAnimRef.current = null
    })
  }

  // scheduleHide: idempotent timer arm. Clears any in-flight timer first,
  // then only arms a new 3 s if the state supports auto-hide (D3/D15 plus
  // D9 buffering, D10 error, D13 screen reader gates).
  //
  // Reads ground-truth values from refs (not render-closure state) so that
  // native event callbacks (playingChange, statusChange) can drive this
  // synchronously before their setState queue has committed. Without the
  // ref reads, the resume-from-pause and buffering→ready paths would see
  // stale guard values and bail, leaving auto-hide permanently disarmed.
  const scheduleHide = () => {
    if (inactivityTimerRef.current != null) {
      clearTimeout(inactivityTimerRef.current)
      inactivityTimerRef.current = null
    }
    if (
      isPausedRef.current ||
      statusRef.current === "loading" ||
      statusRef.current === "error" ||
      hasErrorRef.current ||
      isScreenReaderEnabledRef.current
    ) {
      return
    }
    inactivityTimerRef.current = setTimeout(hideControls, 3000)
  }

  // revealControls: early-return when already visible to neutralize the
  // catcher-onPress vs useTVEventHandler-select double-dispatch race in
  // Unit 3. Does NOT reset opacityAnim before animating — any in-flight
  // hide animates smoothly from its current mid-fade value, avoiding a
  // black flash when the user interrupts a hide. Before starting the
  // reveal we .stop() any in-flight hide animation so its completion
  // callback doesn't clobber our just-revealed state with a stale
  // setControlsVisible(false) (P1.2 / reliability rel-1 / julik-9).
  const revealControls = () => {
    if (controlsVisibleRef.current) return
    if (hideAnimRef.current != null) {
      hideAnimRef.current.stop()
      hideAnimRef.current = null
    }
    setControlsVisible(true)
    setRevealFocusPending(true)
    setControlsFocusable(true)
    if (isReduceMotionEnabled) {
      opacityAnim.setValue(1)
    } else {
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 100,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start()
    }
    scheduleHide()
  }

  // Expose the latest implementations to subscribers registered in Unit 1
  // (AppState handler) and Unit 3 (event handlers) via stable refs —
  // mirrors Fix #15's `onDismissRef` assignment pattern.
  scheduleHideRef.current = scheduleHide
  revealControlsRef.current = revealControls

  return (
    <View style={styles.overlay}>
      {/* Video fills the entire screen behind everything.
          The pointerEvents="none" wrapper from the documented pattern
          (tv-videoview-steals-dpad-focus) blocks AVPlayerLayer rendering
          on tvOS. In this overlay context, TVFocusGuideView with
          trapFocus* already contains D-pad navigation, so focusable={false}
          alone is sufficient. */}
      <VideoView
        style={StyleSheet.absoluteFill}
        player={player}
        nativeControls={false}
        contentFit="contain"
        focusable={false}
      />

      {/* Controls have their own glass backgrounds (GLASS_BG on the
          controls panel, semi-transparent on the back button pill), so
          no full-screen scrim is needed. */}

      {/* trapFocus* props prevent focus from escaping to the underlying
          Stack navigator (which is still mounted behind this overlay).
          Without trapping, UIFocusEngine may consider the obscured page's
          focusable elements as potential targets when the user presses
          D-pad. */}
      <TVFocusGuideView
        style={styles.contentLayer}
        trapFocusUp
        trapFocusDown
        trapFocusLeft
        trapFocusRight
      >
        {/* ── Invisible D-pad catcher (U3) ────────────────────────
            Rendered whenever the real controls are non-focusable AND
            no screen reader is active. Gating on `!controlsFocusable`
            (not `!controlsVisible`) means the catcher mounts at the
            start of the hide transition — synchronously with the
            setControlsFocusable(false) call — so UIFocusEngine has a
            valid target throughout the 150 ms fade. Gating on
            `!controlsVisible` was the previous behavior and it dropped
            D-pad input during the fade (the catcher only mounted after
            the animation completed). See P1.3 / julik-1.
            The catcher's Select → revealControls is the primary reveal
            path on tvOS; useTVEventHandler handles arrows/swipes as a
            secondary channel. Lives inside contentLayer (above
            VideoView on Android TV per I9). */}
        {!controlsFocusable && !isScreenReaderEnabled && (
          <Pressable
            onPress={revealControls}
            hasTVPreferredFocus
            focusable
            accessibilityLabel="Show player controls"
            accessibilityRole="button"
            collapsable={false}
            style={styles.catcher}
          />
        )}

        {/* ── Top Bar ──────────────────────────────────────────────── */}
        {/* Animated.View wraps the top pill so it fades with the shared
            opacityAnim. collapsable={false} keeps the RN view in the
            native hierarchy above the Android TV VideoView surface. */}
        <Animated.View
          style={[styles.topBar, { opacity: opacityAnim }]}
          collapsable={false}
        >
          {/* Full-width Pressable is the focusable/hit region (needed
              for tvOS spatial focus traversal to reach play below). The
              inner View is the visible pill, which hugs its text content. */}
          <Pressable
            onPress={onDismiss}
            onFocus={() => {
              setBackFocused(true)
              scheduleHide()
            }}
            onBlur={() => setBackFocused(false)}
            hasTVPreferredFocus={errorFocusPending}
            focusable={controlsFocusable}
            accessibilityLabel={
              subtitle != null ? `Back to ${subtitle}` : "Back"
            }
            accessibilityRole="button"
            style={styles.backButtonHit}
          >
            <View
              style={[
                styles.backButtonPill,
                backFocused && styles.backButtonPillFocused,
              ]}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.backButtonText,
                  backFocused && styles.backButtonTextFocused,
                ]}
              >
                {"←  Back" + (subtitle ? ` to ${subtitle}` : "")}
              </Text>
            </View>
          </Pressable>
        </Animated.View>

        {/* Empty middle spacer — the full-width backButtonHit above and
            centered play button below still share a spatial column, so
            tvOS's UIFocusEngine can traverse DOWN/UP between them. */}
        <View style={styles.spacer} />

        {/* ── Bottom Controls Panel ──────────────────────────────── */}
        {/* Animated.View wraps the bottom panel so it fades with the
            shared opacityAnim. collapsable={false} preserves z-order on
            Android TV above the VideoView surface. */}
        <Animated.View
          style={[styles.controlsContainer, { opacity: opacityAnim }]}
          collapsable={false}
        >
          {/* Title area. On error, the error label replaces the title
              inline — keeps the bottom-panel layout stable and avoids
              introducing a separate error overlay. Subtitle stays so
              the user retains context about what failed. */}
          <View style={styles.titleRow}>
            {hasError ? (
              <Text style={styles.videoTitle} numberOfLines={2}>
                Playback failed — press Back to exit.
              </Text>
            ) : (
              title != null && (
                <Text style={styles.videoTitle} numberOfLines={1}>
                  {title}
                </Text>
              )
            )}
            {subtitle != null && (
              <Text style={styles.videoSubtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            )}
          </View>

          {/* Playback controls: rewind, play/pause, forward.
              When hasError (U5), all three are ghosted (opacity 0.3) and
              unfocusable — the spatial layout is preserved so the user's
              mental model ("back is top-left") doesn't shift, but the
              only meaningful action is Back. */}
          <View style={styles.controlsRow}>
            {/* Rewind 10s */}
            <Pressable
              onPress={() => {
                seekBackward()
                scheduleHide()
              }}
              onFocus={() => {
                setRewindFocused(true)
                scheduleHide()
              }}
              onBlur={() => setRewindFocused(false)}
              focusable={controlsFocusable && !hasError}
              accessibilityLabel="Rewind 10 seconds"
              accessibilityRole="button"
              style={[
                styles.skipButton,
                rewindFocused && styles.skipButtonFocused,
                hasError && styles.controlDisabled,
              ]}
            >
              <Text
                style={[
                  styles.skipText,
                  rewindFocused && styles.skipTextFocused,
                ]}
              >
                {"↺ 10"}
              </Text>
            </Pressable>

            {/* Play / Pause.
                U4 focus-restore on reveal: we rely on mitigation (b) from
                the plan — each reveal flips `controlsFocusable` false→true,
                which re-adds this Pressable to UIFocusEngine as a "new"
                focus target, letting hasTVPreferredFocus take effect per
                cycle. If device QA shows focus doesn't transfer, fall back
                to mitigation (a) by adding `key={revealCycleCount}`. */}
            <Pressable
              onPress={() => {
                togglePlayPause()
                scheduleHide()
              }}
              onFocus={() => {
                setPlayFocused(true)
                scheduleHide()
              }}
              onBlur={() => setPlayFocused(false)}
              hasTVPreferredFocus={shouldRequestFocus || revealFocusPending}
              focusable={controlsFocusable && !hasError}
              accessibilityLabel={isPaused ? "Play" : "Pause"}
              accessibilityRole="button"
              style={[
                styles.playPauseButton,
                playFocused && styles.playPauseButtonFocused,
                hasError && styles.controlDisabled,
              ]}
            >
              {isPaused ? (
                <PlayIcon size={scale(28)} color={COLORS.text} />
              ) : (
                <PauseIcon size={scale(28)} color={COLORS.text} />
              )}
            </Pressable>

            {/* Forward 10s */}
            <Pressable
              onPress={() => {
                seekForward()
                scheduleHide()
              }}
              onFocus={() => {
                setForwardFocused(true)
                scheduleHide()
              }}
              onBlur={() => setForwardFocused(false)}
              focusable={controlsFocusable && !hasError}
              accessibilityLabel="Forward 10 seconds"
              accessibilityRole="button"
              style={[
                styles.skipButton,
                forwardFocused && styles.skipButtonFocused,
                hasError && styles.controlDisabled,
              ]}
            >
              <Text
                style={[
                  styles.skipText,
                  forwardFocused && styles.skipTextFocused,
                ]}
              >
                {"10 ↻"}
              </Text>
            </Pressable>
          </View>

          {/* Progress bar */}
          <View style={styles.progressContainer}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress}%` }]} />
            </View>
            <View style={styles.timeRow}>
              <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
              <Text style={styles.timeText}>
                {duration > 0 ? formatTime(duration) : "--:--"}
              </Text>
            </View>
          </View>
        </Animated.View>
      </TVFocusGuideView>
    </View>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.surface,
    zIndex: 1000,
  },

  // Flex column layout spanning the overlay so D-pad can move
  // between the top back button and bottom controls
  contentLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    paddingTop: scale(40),
    paddingBottom: scale(40),
    paddingHorizontal: scale(48),
  },

  spacer: {
    flex: 1,
  },

  // Invisible full-screen Pressable that owns focus while controls are
  // hidden — see the U3 block in the render tree. `absoluteFillObject`
  // lifts it above the sibling flex layout so it covers the entire
  // overlay, and the absence of backgroundColor keeps the underlying
  // VideoView visible. No visible treatment — this element is purely
  // an input capture surface.
  catcher: {
    ...StyleSheet.absoluteFillObject,
  },

  // ── Top Bar ────────────────────────────────────────────────────────────────
  // `backButtonHit` is the full-width Pressable — invisible but provides
  // the spatial column that overlaps with the play button below, so
  // tvOS's UIFocusEngine can traverse DOWN from back to play via pure
  // spatial navigation. `backButtonPill` is the visible compact pill
  // containing the "← Back" text, hugging its content on the left.
  topBar: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  backButtonHit: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  backButtonPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: scale(20),
    paddingVertical: scale(12),
    borderRadius: scale(12),
    backgroundColor: hexToRgba(COLORS.surfaceContainer, 0.6),
    alignSelf: "flex-start",
  },
  backButtonPillFocused: {
    backgroundColor: COLORS.surfaceContainerHigh,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: scale(30),
    elevation: 8,
    transform: [{ scale: 1.05 }],
  },
  backButtonText: {
    fontFamily: "System",
    fontSize: scale(20),
    color: COLORS.text,
    fontWeight: "500",
  },
  backButtonTextFocused: {
    color: COLORS.text,
  },

  // ── Bottom Controls ────────────────────────────────────────────────────────
  // NOTE: `backdrop-filter` isn't available in RN StyleSheet — we rely on
  // background opacity against the scrim to get the frosted-glass look.
  controlsContainer: {
    backgroundColor: GLASS_BG,
    borderRadius: scale(16),
    paddingHorizontal: scale(32),
    paddingVertical: scale(24),
  },

  titleRow: {
    marginBottom: scale(20),
  },
  videoTitle: {
    fontFamily: "System",
    fontSize: scale(24),
    fontWeight: "600",
    color: COLORS.text,
  },
  videoSubtitle: {
    fontFamily: "System",
    fontSize: scale(16),
    color: COLORS.muted,
    marginTop: scale(4),
  },

  // ── Playback Controls ──────────────────────────────────────────────────────
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: scale(32),
    marginBottom: scale(20),
  },

  // Error-state ghost treatment: controls remain mounted (so the spatial
  // layout doesn't collapse) but are visually recessed and unfocusable.
  controlDisabled: {
    opacity: 0.3,
  },

  skipButton: {
    width: scale(52),
    height: scale(52),
    borderRadius: scale(26),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: hexToRgba(COLORS.surface, 0),
  },
  skipButtonFocused: {
    backgroundColor: hexToRgba(COLORS.primary, 0.15),
    transform: [{ scale: 1.1 }],
  },
  skipText: {
    fontFamily: "System",
    fontSize: scale(18),
    fontWeight: "600",
    color: COLORS.primary,
  },
  skipTextFocused: {
    color: COLORS.text,
  },

  playPauseButton: {
    width: scale(64),
    height: scale(64),
    borderRadius: scale(32),
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: scale(16),
    elevation: 8,
  },
  playPauseButtonFocused: {
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: scale(30),
    elevation: 12,
    transform: [{ scale: 1.1 }],
  },

  // ── Progress Bar ───────────────────────────────────────────────────────────
  progressContainer: {
    width: "100%",
  },
  progressTrack: {
    height: scale(6),
    backgroundColor: TRACK_BG,
    borderRadius: scale(3),
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: COLORS.primary,
    borderRadius: scale(3),
  },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: scale(8),
  },
  timeText: {
    fontFamily: "System",
    fontSize: scale(14),
    color: COLORS.muted,
    fontVariant: ["tabular-nums"],
  },
})
