import { useEffect, useRef, useState } from "react"
import {
  AccessibilityInfo,
  Animated,
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  // @ts-expect-error TVEventControl is provided by react-native-tvos but not in the base RN types that CI type-checks against.
  TVEventControl,
  // @ts-expect-error TVFocusGuideView is provided by react-native-tvos but not in the base RN types that CI type-checks against.
  TVFocusGuideView,
  View,
} from "react-native"
import { useVideoPlayer, VideoView } from "expo-video"
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
  const [status, setStatus] = useState<
    "idle" | "loading" | "readyToPlay" | "error"
  >("idle")
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

  // Clear any pending inactivity timer on unmount — prevents setState-on-
  // unmounted warnings and dangling callbacks holding the component closure.
  useEffect(() => {
    return () => {
      if (inactivityTimerRef.current != null) {
        clearTimeout(inactivityTimerRef.current)
        inactivityTimerRef.current = null
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

  // Keep mirror refs in sync with their state so Unit 3's useTVEventHandler
  // callback can read current values without re-binding on every render.
  useEffect(() => {
    controlsVisibleRef.current = controlsVisible
  }, [controlsVisible])
  useEffect(() => {
    isScreenReaderEnabledRef.current = isScreenReaderEnabled
  }, [isScreenReaderEnabled])

  // Scaffolding references — these identifiers are populated/consumed by
  // Units 2-7 (auto-hide logic, status subscription, fade snapping, event
  // routing). The `void` statements keep lint happy until each unit lands;
  // they have zero runtime cost.
  void controlsFocusable
  void status
  void setStatus
  void setHasError
  void isReduceMotionEnabled
  void revealControlsRef

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

  // Foreground resume (D12): on AppState 'active', always snap controls
  // visible and rearm a fresh 5s timer. Skip the rearm in error / paused
  // states (those keep chrome visible permanently or until user action,
  // per Unit 6's approach). Playback resume behavior is out of scope.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") return
      setControlsVisible(true)
      setControlsFocusable(true)
      opacityAnim.setValue(1)
      if (!hasError) {
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
  }, [opacityAnim, hasError])

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
  // Fix #15: Depends only on [player]; dismiss is read through a ref.
  // Fix #24: Wrap the dismiss call so a throwing onDismiss doesn't
  // propagate into expo-video's native event dispatch path.
  useEffect(() => {
    const subscription = player.addListener("playToEnd", () => {
      try {
        onDismissRef.current()
      } catch (e) {
        console.error("[VideoPlayer] onDismiss threw:", e)
      }
    })
    return () => {
      try {
        subscription.remove()
      } catch (e) {
        console.error("[VideoPlayer] playToEnd cleanup failed:", e)
      }
    }
  }, [player])

  // Track playing state changes.
  // Fix #25: Guard cleanup for consistency with the unmount-pause guard.
  useEffect(() => {
    const subscription = player.addListener(
      "playingChange",
      ({ isPlaying }) => {
        setIsPaused(!isPlaying)
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
        {/* ── Top Bar ──────────────────────────────────────────────── */}
        <View style={styles.topBar}>
          {/* Full-width Pressable is the focusable/hit region (needed
              for tvOS spatial focus traversal to reach play below). The
              inner View is the visible pill, which hugs its text content. */}
          <Pressable
            onPress={onDismiss}
            onFocus={() => setBackFocused(true)}
            onBlur={() => setBackFocused(false)}
            hasTVPreferredFocus={errorFocusPending}
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
        </View>

        {/* Empty middle spacer — the full-width backButtonHit above and
            centered play button below still share a spatial column, so
            tvOS's UIFocusEngine can traverse DOWN/UP between them. */}
        <View style={styles.spacer} />

        {/* ── Bottom Controls Panel ──────────────────────────────── */}
        <View style={styles.controlsContainer}>
          {/* Title area */}
          <View style={styles.titleRow}>
            {title != null && (
              <Text style={styles.videoTitle} numberOfLines={1}>
                {title}
              </Text>
            )}
            {subtitle != null && (
              <Text style={styles.videoSubtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            )}
          </View>

          {/* Playback controls: rewind, play/pause, forward */}
          <View style={styles.controlsRow}>
            {/* Rewind 10s */}
            <Pressable
              onPress={seekBackward}
              onFocus={() => setRewindFocused(true)}
              onBlur={() => setRewindFocused(false)}
              style={[
                styles.skipButton,
                rewindFocused && styles.skipButtonFocused,
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

            {/* Play / Pause */}
            <Pressable
              onPress={togglePlayPause}
              onFocus={() => setPlayFocused(true)}
              onBlur={() => setPlayFocused(false)}
              hasTVPreferredFocus={shouldRequestFocus || revealFocusPending}
              style={[
                styles.playPauseButton,
                playFocused && styles.playPauseButtonFocused,
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
              onPress={seekForward}
              onFocus={() => setForwardFocused(true)}
              onBlur={() => setForwardFocused(false)}
              style={[
                styles.skipButton,
                forwardFocused && styles.skipButtonFocused,
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
        </View>
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
