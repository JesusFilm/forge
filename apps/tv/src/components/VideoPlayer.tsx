import { useCallback, useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
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
import { LinearGradient } from "expo-linear-gradient"
import Ionicons from "@expo/vector-icons/Ionicons"
import MaterialIcons from "@expo/vector-icons/MaterialIcons"
import { TVFocusGuideView } from "./TVFocusGuideView"
import { scale } from "../lib/scale"
import { SubtitleOverlay } from "./watch/SubtitleOverlay"
import { InPlayerMenu } from "./watch/InPlayerMenu"
import { useSessionPlayback } from "./watch/useSessionPlayback"
import { WATCH_THEME } from "./watch/watchDetailTheme"
import { focusTransform, useFocusAnimation } from "./watch/useFocusAnimation"
import { AnimatedFocusIcon } from "./watch/AnimatedFocusIcon"
import { composePlayerStatusChip } from "./watch/playerChrome"

type IconName = React.ComponentProps<typeof Ionicons>["name"]

// Caption resting/lifted offsets (reference dp; SubtitleOverlay scales them).
// Resting sits near the bottom edge; lifted clears the bottom chrome — the
// content layer's 46 bottom inset + times row (~37) + scrubber (36) + its
// 30 gap + the 98 play circle, plus breathing room.
const SUBTITLE_BOTTOM_RESTING = 64
const SUBTITLE_BOTTOM_LIFTED = 272

// ── Visual language (U8) ───────────────────────────────────────────────────
// The player chrome is the "Forge TV Video Page" handoff's player redesign
// (chats/chat2): full-bleed scrims, a glass Back pill + quiet status chip up
// top, eyebrow + title / circular glass transport / Language + Subtitles
// pills in a three-column bottom row, and a focusable scrubber with thumb +
// time bubble. It shares WATCH_THEME + useFocusAnimation with the details
// page so the screen → fullscreen transition reads as one surface — the two
// pills carry the SAME icons as the details page's pickers (globe / Aa).

// ── SVG-free Icon Components ───────────────────────────────────────────────

/** Two vertical bars — pure View-based pause icon */
function PauseIcon({
  size = 24,
  color = WATCH_THEME.accentText,
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
  color = WATCH_THEME.accentText,
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

// ── Chrome building blocks (U8) ─────────────────────────────────────────────
// Module-level components (NOT defined inside VideoPlayer) so their identity is
// stable across host re-renders — an inline component would remount per render
// and drop tvOS focus. Each owns its useFocusAnimation; the host only threads
// scheduleHide via onFocus and reads focus through callbacks where it must.

/** Rest→ink icon cross-fade. Icon colour is a prop (not an animatable style),
    so the flip is two stacked copies with opposing opacity — same trick as
    AnimatedFocusIcon, generalised to any glyph via a render prop. */
function FocusCrossfade({
  progress,
  size,
  render,
}: {
  progress: Animated.Value
  size: number
  render: (color: string) => ReactNode
}) {
  return (
    <View style={{ width: size, height: size }}>
      <Animated.View
        style={[
          styles.crossfadeLayer,
          {
            opacity: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 0],
            }),
          },
        ]}
      >
        {render(WATCH_THEME.text)}
      </Animated.View>
      <Animated.View style={[styles.crossfadeLayer, { opacity: progress }]}>
        {render(WATCH_THEME.focusInk)}
      </Animated.View>
    </View>
  )
}

/** Glass Back pill, top-left. The Pressable spans the full row width so the
    tvOS spatial engine can traverse DOWN into the transport column (same
    full-width-hit pattern as before the restyle); only the pill is visible. */
function BackPill({
  onPress,
  onFocusActivity,
  focusable,
  hasTVPreferredFocus,
  accessibilityLabel,
}: {
  onPress: () => void
  onFocusActivity: () => void
  focusable: boolean
  hasTVPreferredFocus: boolean
  accessibilityLabel: string
}) {
  const { setFocused, progress } = useFocusAnimation()
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => {
        setFocused(true)
        onFocusActivity()
      }}
      onBlur={() => setFocused(false)}
      hasTVPreferredFocus={hasTVPreferredFocus}
      focusable={focusable}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      style={styles.backHit}
    >
      <Animated.View
        style={[
          styles.backPill,
          {
            backgroundColor: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [WATCH_THEME.pillGlass, WATCH_THEME.focusFill],
            }),
            shadowOpacity: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 0.5],
            }),
            transform: focusTransform(progress),
          },
        ]}
      >
        <FocusCrossfade
          progress={progress}
          size={scale(24)}
          render={(color) => (
            <Ionicons name="chevron-back" size={scale(24)} color={color} />
          )}
        />
        <Animated.Text
          style={[
            styles.backText,
            {
              color: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [WATCH_THEME.text, WATCH_THEME.focusInk],
              }),
            },
          ]}
        >
          Back
        </Animated.Text>
      </Animated.View>
    </Pressable>
  )
}

/** 84px circular glass transport button (−10 / +10). White-fill focus. */
function CircleControl({
  icon,
  onPress,
  onFocusActivity,
  focusable,
  dimmed,
  accessibilityLabel,
}: {
  icon: "replay-10" | "forward-10"
  onPress: () => void
  onFocusActivity: () => void
  focusable: boolean
  dimmed: boolean
  accessibilityLabel: string
}) {
  const { setFocused, progress } = useFocusAnimation()
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => {
        setFocused(true)
        onFocusActivity()
      }}
      onBlur={() => setFocused(false)}
      focusable={focusable}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      style={dimmed && styles.controlDisabled}
    >
      <Animated.View
        style={[
          styles.circleBtn,
          {
            backgroundColor: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [WATCH_THEME.pillGlass, WATCH_THEME.focusFill],
            }),
            shadowOpacity: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 0.6],
            }),
            transform: focusTransform(progress),
          },
        ]}
      >
        <FocusCrossfade
          progress={progress}
          size={scale(38)}
          render={(color) => (
            <MaterialIcons name={icon} size={scale(38)} color={color} />
          )}
        />
      </Animated.View>
    </Pressable>
  )
}

/** 98px accent play/pause circle. Stays accent-filled when focused; the focus
    signal is a white ring (animated borderColor — constant width, no layout
    shift) + the shared lift/magnify, mirroring the details page's PlayPill. */
function PlayCircle({
  isPaused,
  onPress,
  onFocusActivity,
  focusable,
  dimmed,
  hasTVPreferredFocus,
}: {
  isPaused: boolean
  onPress: () => void
  onFocusActivity: () => void
  focusable: boolean
  dimmed: boolean
  hasTVPreferredFocus: boolean
}) {
  const { setFocused, progress } = useFocusAnimation()
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => {
        setFocused(true)
        onFocusActivity()
      }}
      onBlur={() => setFocused(false)}
      hasTVPreferredFocus={hasTVPreferredFocus}
      focusable={focusable}
      accessibilityLabel={isPaused ? "Play" : "Pause"}
      accessibilityRole="button"
      style={dimmed && styles.controlDisabled}
    >
      <Animated.View
        style={[
          styles.playBtn,
          {
            borderColor: progress.interpolate({
              inputRange: [0, 1],
              outputRange: ["rgba(255,255,255,0)", "rgba(255,255,255,0.85)"],
            }),
            transform: focusTransform(progress),
          },
        ]}
      >
        {isPaused ? (
          <PlayIcon size={scale(42)} color={WATCH_THEME.accentText} />
        ) : (
          <PauseIcon size={scale(42)} color={WATCH_THEME.accentText} />
        )}
      </Animated.View>
    </Pressable>
  )
}

/** Two-line glass menu pill, bottom-right — the in-player menu triggers
    (Language / Subtitles). Carries the SAME Ionicons as the details page's
    pickers (AnimatedFocusIcon) so the two surfaces read as one grammar. */
function MenuPill({
  icon,
  label,
  sub,
  onPress,
  onFocusActivity,
  focusable,
  dimmed,
}: {
  icon: IconName
  label: string
  sub: string | null
  onPress: () => void
  onFocusActivity: () => void
  focusable: boolean
  dimmed: boolean
}) {
  const { setFocused, progress } = useFocusAnimation()
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => {
        setFocused(true)
        onFocusActivity()
      }}
      onBlur={() => setFocused(false)}
      focusable={focusable}
      // Fold the visible sub-value into the label so VoiceOver and automated
      // D-pad drivers can read the state without activating the picker
      // (mirrors DetailsActionRow's SecondaryPill).
      accessibilityLabel={sub ? `${label}, ${sub}` : label}
      accessibilityRole="button"
      style={dimmed && styles.controlDisabled}
    >
      <Animated.View
        style={[
          styles.asPill,
          {
            backgroundColor: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [WATCH_THEME.pillGlass, WATCH_THEME.focusFill],
            }),
            shadowOpacity: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 0.5],
            }),
            transform: focusTransform(progress),
          },
        ]}
      >
        <AnimatedFocusIcon name={icon} progress={progress} size={scale(26)} />
        <View style={styles.asCap}>
          <Animated.Text
            style={[
              styles.asLabel,
              {
                color: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [WATCH_THEME.text, WATCH_THEME.focusInk],
                }),
              },
            ]}
            numberOfLines={1}
          >
            {label}
          </Animated.Text>
          {sub != null && (
            <Animated.Text
              style={[
                styles.asSub,
                {
                  color: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [WATCH_THEME.text62, "rgba(0,0,0,0.5)"],
                  }),
                },
              ]}
              numberOfLines={1}
            >
              {sub}
            </Animated.Text>
          )}
        </View>
      </Animated.View>
    </Pressable>
  )
}

/** Focusable scrubber. At rest it's the thin accent-filled track; focused, the
    track thickens and a white thumb + time bubble appear (the handoff's
    .pl-scrub states). Left/right seeking while focused is handled by the
    host's TV-event listener (focus is trapped horizontally by the wrapper, so
    the press can't move focus — it becomes a seek). */
function PlayerScrubber({
  progressPct,
  bufferedPct,
  bubbleText,
  onPress,
  onFocusChange,
  focusable,
  dimmed,
}: {
  progressPct: number
  bufferedPct: number
  bubbleText: string
  onPress: () => void
  onFocusChange: (focused: boolean) => void
  focusable: boolean
  dimmed: boolean
}) {
  const { setFocused, progress } = useFocusAnimation()
  return (
    <TVFocusGuideView trapFocusLeft trapFocusRight>
      <Pressable
        onPress={onPress}
        onFocus={() => {
          setFocused(true)
          onFocusChange(true)
        }}
        onBlur={() => {
          setFocused(false)
          onFocusChange(false)
        }}
        focusable={focusable}
        accessibilityLabel={`Seek bar, ${bubbleText}`}
        accessibilityRole="adjustable"
        style={[styles.scrubWrap, dimmed && styles.controlDisabled]}
      >
        <Animated.View
          style={[
            styles.scrubTrack,
            {
              height: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [scale(8), scale(13)],
              }),
            },
          ]}
        >
          <View style={[styles.scrubBuf, { width: `${bufferedPct}%` }]} />
          <View style={[styles.scrubFill, { width: `${progressPct}%` }]} />
        </Animated.View>
        <Animated.View
          style={[
            styles.scrubThumb,
            {
              left: `${progressPct}%`,
              transform: [
                {
                  scale: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 1],
                  }),
                },
              ],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.scrubBubble,
            {
              left: `${progressPct}%`,
              opacity: progress,
              transform: [
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [scale(6), 0],
                  }),
                },
              ],
            },
          ]}
        >
          <Text style={styles.scrubBubbleText}>{bubbleText}</Text>
        </Animated.View>
      </Pressable>
    </TVFocusGuideView>
  )
}

/** Pre-playback veil: dim layer + rotating accent ring. pointerEvents="none"
    so the focus engine and the autoplay retry keep working beneath it.
    Looped single timing + interpolation on the native driver — a looped
    Animated.sequence runs once on Fabric. */
function LoadingVeil() {
  const spin = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    )
    anim.start()
    return () => anim.stop()
  }, [spin])
  return (
    <View style={styles.veil} pointerEvents="none">
      <Animated.View
        style={[
          styles.veilRing,
          {
            transform: [
              {
                rotate: spin.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["0deg", "360deg"],
                }),
              },
            ],
          },
        ]}
      />
      <Text style={styles.veilText}>Starting playback…</Text>
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
  // Buffered head (seconds) from timeUpdate — drives the scrubber's buffer
  // hint. -1 from native means "unknown"; we clamp at render.
  const [buffered, setBuffered] = useState(0)
  // First playingChange(true) drops the loading veil for good — buffering
  // stalls later in playback must NOT bring the full veil back (U5's
  // statusChange path owns mid-play buffering UX).
  const [hasStarted, setHasStarted] = useState(false)

  // Per-control focus visuals live inside the chrome components
  // (useFocusAnimation). The host only tracks scrubber focus, via a ref,
  // because the TV-event listener turns left/right into seeks while the
  // scrubber owns focus.
  const scrubFocusedRef = useRef(false)

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
  // Seek handlers behind refs so the ref-stable TV-event callback can seek
  // (scrub-focused left/right) without re-binding on duration changes.
  const seekBackwardRef = useRef<() => void>(() => {})
  const seekForwardRef = useRef<() => void>(() => {})
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
  // path). Standard AccessibilityInfo reduce-motion subscription shape.
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
      // Scrubber-focused left/right = seek (U8). The scrubber wrapper traps
      // horizontal focus (it spans the full row), so the press can't move
      // focus — we translate it into a ±10s seek instead, matching the
      // handoff's scrub region behavior.
      if (scrubFocusedRef.current) {
        if (type === "left" || type === "swipeLeft") {
          seekBackwardRef.current()
          scheduleHideRef.current()
          return
        }
        if (type === "right" || type === "swipeRight") {
          seekForwardRef.current()
          scheduleHideRef.current()
          return
        }
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
      // In-player menu open: Back closes the MENU, not playback — without
      // this branch the menu was a trap (Back exited the video entirely).
      // menuOpenRef/closeMenu are declared below; the closure only runs
      // post-commit, and both identities are stable (ref + useCallback).
      if (menuOpenRef.current) {
        closeMenu()
        return true
      }
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

  // ── Frozen creation source (U7 — load-bearing) ──────────────────────
  // useVideoPlayer recreates (and RELEASES) the player whenever its source
  // argument changes — its dependency is JSON.stringify(source). Before this
  // unit the overlay was safe because VideoPlayerOverlay unmounts/remounts the
  // whole component per playVideo, so the source never changed in place. Live
  // dub-switching removes that safety: a session dub change would otherwise
  // recreate the player mid-play (black/stuck frame). So we FREEZE the source
  // passed to useVideoPlayer to the first value and route every later swap
  // through player.replaceAsync on the SAME instance (the effect below). The
  // player instance identity is therefore stable across a dub switch.
  //
  // Fix #6: Seed duration synchronously from the initializer. `sourceLoad`
  // can fire before the useEffect subscription mounts, especially on a
  // warmed player. Without seeding, duration stays 0 forever and the end
  // time displays "--:--". The listener below stays as the update path.
  const creationSource = useRef(streamingUrl).current
  const player = useVideoPlayer(creationSource, (p) => {
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

  // ── Session-driven playback (U7) ────────────────────────────────────
  // All session-only behavior — the in-player menu, the stale-session-safe
  // `menuActive` gate, the live dub-switch, the Mux auto-subtitle disabling, and
  // the active-VTT resolution — lives in this hook. It is INERT for
  // experience-card playback (no session): `menuActive` is false, the dub-switch
  // short-circuits on the frozen source, and `activeVttSrc` is null. The host
  // threads the shared auto-hide refs + seek guard + a one-shot reveal-focus
  // trigger so the hook can suppress/re-arm auto-hide on menu open/close and
  // clear the seek guard on a dub switch without reaching into module globals.
  const {
    menuActive,
    menuOpen,
    menuSection,
    menuOpenRef,
    openMenu,
    closeMenu,
    activeVttSrc,
    audioLabel,
    subtitleLabel,
  } = useSessionPlayback({
    player,
    streamingUrl,
    hideAnimRef,
    inactivityTimerRef,
    seekTargetRef,
    scheduleHideRef,
    onRequestRevealFocus: () => setRevealFocusPending(true),
  })

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
          // First confirmed playback drops the loading veil permanently (U8).
          setHasStarted(true)
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
      // Buffer head feeds the scrubber's buffer hint regardless of the seek
      // guard — it's not a playhead value, so stale emissions can't lie.
      if (
        typeof payload.bufferedPosition === "number" &&
        payload.bufferedPosition >= 0
      ) {
        setBuffered(payload.bufferedPosition)
      }
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
  const bufferedPct =
    duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0
  // Top-bar status chip + pill sub-caption (null hides each — no-session
  // playback shows neither, matching the gated CC button it replaces).
  const statusChip = composePlayerStatusChip(audioLabel, subtitleLabel)
  // Pill sub-captions mirror the details page: Language shows the active dub's
  // name; Subtitles shows the active track's name, or "Off".
  const subtitlePillSub = menuActive ? (subtitleLabel ?? "Off") : null
  const remainingLabel =
    duration > 0
      ? `−${formatTime(Math.max(0, duration - currentTime))}`
      : "--:--"

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
      isScreenReaderEnabledRef.current ||
      // U7: the in-player menu suppresses auto-hide — the chrome (and the menu
      // over it) must stay put while the viewer navigates the dub/subtitle list.
      menuOpenRef.current
    ) {
      return
    }
    // 3.5s per the handoff's player spec (was 3s pre-redesign).
    inactivityTimerRef.current = setTimeout(hideControls, 3500)
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
  seekBackwardRef.current = seekBackward
  seekForwardRef.current = seekForward

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

      {/* ── VTT subtitle layer (U7) ─────────────────────────────────────
          Passive absolute-positioned cue renderer (pointerEvents="none"
          internally), above the VideoView but below the chrome. Mounted only
          when the session is driving this overlay AND captions are on AND a VTT
          track resolves (activeVttSrc). For experience-card playback
          (menuActive false) activeVttSrc is null and nothing mounts. It MUST
          NOT touch the auto-hide state machine (it never does) — it only
          FOLLOWS controlsVisible: while the chrome is up, the caption slides
          above the bottom panel; when the chrome hides, it slides back down
          (mirrors the web + mobile fullscreen caption lift). */}
      {menuActive && activeVttSrc != null && (
        <SubtitleOverlay
          player={player}
          vttSrc={activeVttSrc}
          bottomOffset={
            controlsVisible ? SUBTITLE_BOTTOM_LIFTED : SUBTITLE_BOTTOM_RESTING
          }
          animate
        />
      )}

      {/* ── Scrims (U8) ──────────────────────────────────────────────────
          The handoff replaces the old glass panel with full-bleed top/bottom
          gradients that fade with the chrome (shared opacityAnim).
          collapsable={false} keeps them above the Android TV VideoView
          surface; pointerEvents="none" keeps them out of the focus engine. */}
      <Animated.View
        style={[styles.scrimTop, { opacity: opacityAnim }]}
        pointerEvents="none"
        collapsable={false}
      >
        <LinearGradient
          colors={[WATCH_THEME.scrim(0.78), WATCH_THEME.scrim(0)]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      </Animated.View>
      <Animated.View
        style={[styles.scrimBottom, { opacity: opacityAnim }]}
        pointerEvents="none"
        collapsable={false}
      >
        <LinearGradient
          colors={[
            WATCH_THEME.scrim(0),
            WATCH_THEME.scrim(0.55),
            WATCH_THEME.scrim(0.94),
          ]}
          locations={[0, 0.54, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      </Animated.View>

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

        {/* ── Top Bar (U8) ─────────────────────────────────────────────
            Glass Back pill (full-width hit region preserves the vertical
            spatial column down to the transport) + the quiet audio/CC
            status chip on the right. Fades with the shared opacityAnim;
            collapsable={false} for Android TV z-order. */}
        <Animated.View
          style={[styles.topBar, { opacity: opacityAnim }]}
          collapsable={false}
        >
          <BackPill
            onPress={onDismiss}
            onFocusActivity={scheduleHide}
            hasTVPreferredFocus={errorFocusPending}
            focusable={controlsFocusable}
            accessibilityLabel={
              subtitle != null ? `Back to ${subtitle}` : "Back"
            }
          />
          {statusChip != null && (
            <View style={styles.statusChip}>
              <Text style={styles.statusChipText} numberOfLines={1}>
                {statusChip}
              </Text>
            </View>
          )}
        </Animated.View>

        {/* Empty middle spacer — the full-width back hit above and
            centered play button below still share a spatial column, so
            tvOS's UIFocusEngine can traverse DOWN/UP between them. */}
        <View style={styles.spacer} />

        {/* ── Bottom Controls (U8) ─────────────────────────────────────
            Three-column row over the bottom scrim — eyebrow + title left,
            circular transport centered, Audio & Subtitles pill right — then
            the scrubber and the times row. Fades with the shared opacityAnim;
            collapsable={false} preserves z-order on Android TV. */}
        <Animated.View
          style={[styles.bottomPanel, { opacity: opacityAnim }]}
          collapsable={false}
        >
          <View style={styles.infoRow}>
            {/* Title column. On error, the error label replaces the title
                inline — keeps the layout stable, no separate error overlay.
                The subtitle prop renders as the accent eyebrow above. */}
            <View style={styles.titleCol}>
              {subtitle != null && !hasError && (
                <Text style={styles.eyebrow} numberOfLines={1}>
                  {subtitle}
                </Text>
              )}
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
            </View>

            {/* Transport: −10 / play-pause / +10. When hasError (U5) all
                are ghosted and unfocusable — layout preserved, the only
                meaningful action is Back.
                U4 focus-restore on reveal: each reveal flips
                `controlsFocusable` false→true, re-adding the play Pressable
                to UIFocusEngine as a "new" target so hasTVPreferredFocus
                takes effect per cycle. */}
            <View style={styles.transport}>
              <CircleControl
                icon="replay-10"
                onPress={() => {
                  seekBackward()
                  scheduleHide()
                }}
                onFocusActivity={scheduleHide}
                focusable={controlsFocusable && !hasError}
                dimmed={hasError}
                accessibilityLabel="Rewind 10 seconds"
              />
              <PlayCircle
                isPaused={isPaused}
                onPress={() => {
                  togglePlayPause()
                  scheduleHide()
                }}
                onFocusActivity={scheduleHide}
                hasTVPreferredFocus={shouldRequestFocus || revealFocusPending}
                focusable={controlsFocusable && !hasError}
                dimmed={hasError}
              />
              <CircleControl
                icon="forward-10"
                onPress={() => {
                  seekForward()
                  scheduleHide()
                }}
                onFocusActivity={scheduleHide}
                focusable={controlsFocusable && !hasError}
                dimmed={hasError}
                accessibilityLabel="Forward 10 seconds"
              />
            </View>

            {/* ── In-player menu triggers (U7→U8) ───────────────────────
                Separate Language / Subtitles pills (same icons as the
                details page's pickers), each opening its own menu section.
                Rendered ONLY when the session is driving this overlay
                (menuActive) — experience-card playback never shows them.
                No scheduleHide() on press: openMenu() sets
                menuOpenRef.current=true synchronously and scheduleHide
                early-returns while the menu is open. */}
            <View style={styles.rightCol}>
              {menuActive && (
                <>
                  <MenuPill
                    icon="globe-outline"
                    label="Language"
                    sub={audioLabel}
                    onPress={() => openMenu("language")}
                    onFocusActivity={scheduleHide}
                    focusable={controlsFocusable && !hasError}
                    dimmed={hasError}
                  />
                  <MenuPill
                    icon="text-outline"
                    label="Subtitles"
                    sub={subtitlePillSub}
                    onPress={() => openMenu("subtitles")}
                    onFocusActivity={scheduleHide}
                    focusable={controlsFocusable && !hasError}
                    dimmed={hasError}
                  />
                </>
              )}
            </View>
          </View>

          {/* Scrubber + times. The scrubber is focusable (Down from the
              transport lands here); while it owns focus, left/right are
              seeks (host TV-event listener) and Select toggles play. */}
          <PlayerScrubber
            progressPct={progress}
            bufferedPct={bufferedPct}
            bubbleText={formatTime(currentTime)}
            onPress={() => {
              togglePlayPause()
              scheduleHide()
            }}
            onFocusChange={(focused) => {
              scrubFocusedRef.current = focused
              if (focused) scheduleHide()
            }}
            focusable={controlsFocusable && !hasError}
            dimmed={hasError}
          />
          <View style={styles.timesRow}>
            <Text style={[styles.timeText, styles.timeCurrent]}>
              {formatTime(currentTime)}
            </Text>
            <Text style={styles.timeText}>{remainingLabel}</Text>
          </View>
        </Animated.View>

        {/* ── In-player language/subtitle menu (U7) ───────────────────────
            Absolute-fill scrim with its own trapFocus* TVFocusGuideView +
            autoFocus, so D-pad stays within the menu while open and the chrome
            behind it is unreachable. Rendered inside the overlay's content
            layer (not a Modal) so it shares the overlay's focus trap and the
            menu's writes feed the live dub-switch + subtitle layer above.
            Mounted only when the session drives this overlay AND the menu is
            open — never for experience-card playback. */}
        {menuActive && menuOpen && (
          <InPlayerMenu section={menuSection} onClose={closeMenu} />
        )}
      </TVFocusGuideView>

      {/* ── Loading veil (U8) ─────────────────────────────────────────────
          Mounted until the first confirmed playback (playingChange true),
          never on error (the inline error treatment owns that). Conditionally
          mounted — not faded — so it can never linger over the player. */}
      {!hasStarted && !hasError && <LoadingVeil />}
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
  // Pure black behind the video — the handoff's .player surface (the old
  // Crimson Gallery warm-stone bg read as a tint behind letterboxing).
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000000",
    zIndex: 1000,
  },

  // Flex column layout spanning the overlay so D-pad can move
  // between the top back button and bottom controls. Insets per the
  // handoff: 54 top, 80 sides, 46 bottom.
  contentLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    paddingTop: scale(54),
    paddingBottom: scale(46),
    paddingHorizontal: scale(80),
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

  // Stacked-copy icon cross-fade layers (FocusCrossfade).
  crossfadeLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Scrims ─────────────────────────────────────────────────────────────────
  scrimTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: scale(280),
  },
  scrimBottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: scale(520),
  },

  // ── Top Bar ────────────────────────────────────────────────────────────────
  // `backHit` (inside BackPill) is the full-width Pressable — invisible but
  // provides the spatial column that overlaps with the play button below, so
  // tvOS's UIFocusEngine can traverse DOWN from back to play via pure
  // spatial navigation. The status chip rides at the row's right edge.
  topBar: {
    flexDirection: "row",
    alignItems: "center",
  },
  backHit: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  backPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(8),
    height: scale(58),
    paddingLeft: scale(16),
    paddingRight: scale(24),
    borderRadius: scale(15),
    alignSelf: "flex-start",
    shadowColor: "#000000",
    shadowRadius: scale(22),
    shadowOffset: { width: 0, height: scale(9) },
  },
  backText: {
    fontFamily: "System",
    fontSize: Math.round(scale(21)),
    fontWeight: "600",
  },
  statusChip: {
    backgroundColor: "rgba(0,0,0,0.35)",
    paddingVertical: scale(10),
    paddingHorizontal: scale(18),
    borderRadius: scale(13),
    maxWidth: scale(640),
  },
  statusChipText: {
    fontFamily: "System",
    fontSize: Math.round(scale(19)),
    fontWeight: "600",
    color: WATCH_THEME.text66,
    letterSpacing: scale(0.2),
  },

  // ── Bottom Controls ────────────────────────────────────────────────────────
  bottomPanel: {
    width: "100%",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(24),
    marginBottom: scale(30),
  },
  titleCol: {
    flex: 1,
  },
  eyebrow: {
    fontFamily: "System",
    fontSize: Math.round(scale(18)),
    fontWeight: "700",
    letterSpacing: scale(2.9),
    textTransform: "uppercase",
    color: WATCH_THEME.accent,
    marginBottom: scale(8),
  },
  videoTitle: {
    fontFamily: "System",
    fontSize: Math.round(scale(42)),
    fontWeight: "800",
    letterSpacing: -scale(0.7),
    color: WATCH_THEME.text,
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: scale(3) },
    textShadowRadius: scale(22),
  },
  transport: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(22),
  },
  // Two side-by-side menu pills, right-aligned (Language · Subtitles).
  rightCol: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: scale(14),
  },

  // Error-state ghost treatment: controls remain mounted (so the spatial
  // layout doesn't collapse) but are visually recessed and unfocusable.
  controlDisabled: {
    opacity: 0.3,
  },

  circleBtn: {
    width: scale(84),
    height: scale(84),
    borderRadius: scale(42),
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000000",
    shadowRadius: scale(22),
    shadowOffset: { width: 0, height: scale(9) },
  },
  playBtn: {
    width: scale(98),
    height: scale(98),
    borderRadius: scale(49),
    backgroundColor: WATCH_THEME.accent,
    borderWidth: scale(4),
    alignItems: "center",
    justifyContent: "center",
    shadowColor: WATCH_THEME.accent,
    shadowRadius: scale(19),
    shadowOpacity: 0.55,
    shadowOffset: { width: 0, height: scale(7) },
  },
  asPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(12),
    height: scale(64),
    paddingHorizontal: scale(22),
    borderRadius: scale(16),
    shadowColor: "#000000",
    shadowRadius: scale(22),
    shadowOffset: { width: 0, height: scale(9) },
  },
  asCap: {
    alignItems: "flex-start",
    justifyContent: "center",
  },
  asLabel: {
    fontFamily: "System",
    fontSize: Math.round(scale(20)),
    fontWeight: "600",
  },
  asSub: {
    fontFamily: "System",
    fontSize: Math.round(scale(14)),
    fontWeight: "600",
    marginTop: scale(2),
  },

  // ── Scrubber ───────────────────────────────────────────────────────────────
  scrubWrap: {
    height: scale(36),
    justifyContent: "center",
  },
  scrubTrack: {
    width: "100%",
    borderRadius: scale(5),
    backgroundColor: "rgba(255,255,255,0.18)",
    overflow: "hidden",
  },
  scrubBuf: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: scale(5),
  },
  scrubFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: WATCH_THEME.accent,
    borderRadius: scale(5),
  },
  scrubThumb: {
    position: "absolute",
    top: "50%",
    width: scale(22),
    height: scale(22),
    borderRadius: scale(11),
    marginTop: -scale(11),
    marginLeft: -scale(11),
    backgroundColor: WATCH_THEME.focusFill,
    shadowColor: "#000000",
    shadowRadius: scale(14),
    shadowOpacity: 0.55,
    shadowOffset: { width: 0, height: scale(4) },
  },
  scrubBubble: {
    position: "absolute",
    bottom: scale(42),
    width: scale(110),
    marginLeft: -scale(55),
    alignItems: "center",
    paddingVertical: scale(7),
    borderRadius: scale(11),
    backgroundColor: "rgba(28,28,30,0.92)",
  },
  scrubBubbleText: {
    fontFamily: "System",
    fontSize: Math.round(scale(19)),
    fontWeight: "700",
    color: WATCH_THEME.text,
    fontVariant: ["tabular-nums"],
  },

  // ── Times ──────────────────────────────────────────────────────────────────
  timesRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: scale(10),
  },
  timeText: {
    fontFamily: "System",
    fontSize: Math.round(scale(20)),
    fontWeight: "600",
    color: "rgba(255,255,255,0.55)",
    fontVariant: ["tabular-nums"],
  },
  timeCurrent: {
    color: WATCH_THEME.text,
  },

  // ── Loading veil ───────────────────────────────────────────────────────────
  veil: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    alignItems: "center",
    justifyContent: "center",
    gap: scale(24),
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  veilRing: {
    width: scale(84),
    height: scale(84),
    borderRadius: scale(42),
    borderWidth: scale(5),
    borderColor: "rgba(255,255,255,0.18)",
    borderTopColor: WATCH_THEME.accent,
  },
  veilText: {
    fontFamily: "System",
    fontSize: Math.round(scale(21)),
    fontWeight: "500",
    color: "rgba(255,255,255,0.6)",
  },
})
