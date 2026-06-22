import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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

type IconName = React.ComponentProps<typeof Ionicons>["name"]

// Caption resting/lifted offsets (reference dp; SubtitleOverlay scales them).
// Resting sits near the bottom edge; lifted clears the full bottom chrome
// (inset + times + scrubber + gap + play circle) plus breathing room.
const SUBTITLE_BOTTOM_RESTING = 64
const SUBTITLE_BOTTOM_LIFTED = 272

// ── Visual language (U8) ───────────────────────────────────────────────────
// Player chrome per the "Forge TV Video Page" handoff. Shares WATCH_THEME +
// useFocusAnimation with the details page so screen → fullscreen reads as one
// surface; the pills carry the SAME icons as the details page's pickers.

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
// Module-level (NOT inside VideoPlayer) so identity is stable across host
// re-renders — an inline component would remount per render and drop tvOS
// focus. Each owns its useFocusAnimation; host threads scheduleHide via onFocus.

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
  // Memoized: progress is a stable ref, so the interpolation is built once
  // rather than on every host re-render (the host re-renders at ~1Hz from
  // timeUpdate) — same rationale as DetailsActionRow's pills.
  const restOpacity = useMemo(
    () => ({
      opacity: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 0],
      }),
    }),
    [progress],
  )
  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={[styles.crossfadeLayer, restOpacity]}>
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
  // Memoized: progress is a stable ref, so the interpolations are built once
  // rather than on every host re-render (1Hz timeUpdate) — matches
  // DetailsActionRow's pills.
  const pillStyle = useMemo(
    () => ({
      backgroundColor: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [WATCH_THEME.pillGlass, WATCH_THEME.focusFill],
      }),
      shadowOpacity: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 0.5],
      }),
      transform: focusTransform(progress),
    }),
    [progress],
  )
  const inkStyle = useMemo(
    () => ({
      color: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [WATCH_THEME.text, WATCH_THEME.focusInk],
      }),
    }),
    [progress],
  )
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
      <Animated.View style={[styles.backPill, pillStyle]}>
        <FocusCrossfade
          progress={progress}
          size={scale(24)}
          render={(color) => (
            <Ionicons name="chevron-back" size={scale(24)} color={color} />
          )}
        />
        <Animated.Text style={[styles.backText, inkStyle]}>Back</Animated.Text>
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
  // Memoized: interpolations built once per mount, not per 1Hz host render.
  const circleStyle = useMemo(
    () => ({
      backgroundColor: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [WATCH_THEME.pillGlass, WATCH_THEME.focusFill],
      }),
      shadowOpacity: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 0.6],
      }),
      transform: focusTransform(progress),
    }),
    [progress],
  )
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
      <Animated.View style={[styles.circleBtn, circleStyle]}>
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
  // Memoized: interpolations built once per mount, not per 1Hz host render.
  const ringStyle = useMemo(
    () => ({
      borderColor: progress.interpolate({
        inputRange: [0, 1],
        outputRange: ["rgba(255,255,255,0)", "rgba(255,255,255,0.85)"],
      }),
      transform: focusTransform(progress),
    }),
    [progress],
  )
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
      // selected=playing: machine-readable play state so automated D-pad
      // drivers can branch on accessibilityState instead of parsing the label.
      accessibilityState={{ selected: !isPaused }}
      style={dimmed && styles.controlDisabled}
    >
      <Animated.View style={[styles.playBtn, ringStyle]}>
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
  // Memoized: interpolations built once per mount, not per 1Hz host render.
  const pillStyle = useMemo(
    () => ({
      backgroundColor: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [WATCH_THEME.pillGlass, WATCH_THEME.focusFill],
      }),
      shadowOpacity: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 0.5],
      }),
      transform: focusTransform(progress),
    }),
    [progress],
  )
  const labelInk = useMemo(
    () => ({
      color: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [WATCH_THEME.text, WATCH_THEME.focusInk],
      }),
    }),
    [progress],
  )
  const subInk = useMemo(
    () => ({
      color: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [WATCH_THEME.text62, "rgba(0,0,0,0.5)"],
      }),
    }),
    [progress],
  )
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
      <Animated.View style={[styles.asPill, pillStyle]}>
        <AnimatedFocusIcon name={icon} progress={progress} size={scale(26)} />
        <View style={styles.asCap}>
          <Animated.Text style={[styles.asLabel, labelInk]} numberOfLines={1}>
            {label}
          </Animated.Text>
          {sub != null && (
            <Animated.Text style={[styles.asSub, subInk]} numberOfLines={1}>
              {sub}
            </Animated.Text>
          )}
        </View>
      </Animated.View>
    </Pressable>
  )
}

/** Focusable scrubber: thin track at rest; focused, it thickens with a white
    thumb + time bubble. Left/right seeking is handled by the host's TV-event
    listener — the wrapper traps horizontal focus, so a press becomes a seek. */
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
  // Memoized: interpolations built once per mount, not per 1Hz host render
  // (the percent-left position styles below NEED to rebuild each tick — only
  // the focus-driven interpolations are stable).
  const trackStyle = useMemo(
    () => ({
      height: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [scale(8), scale(13)],
      }),
    }),
    [progress],
  )
  const thumbScale = useMemo(
    () => ({
      transform: [
        {
          scale: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [0, 1],
          }),
        },
      ],
    }),
    [progress],
  )
  const bubbleRise = useMemo(
    () => ({
      opacity: progress,
      transform: [
        {
          translateY: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [scale(6), 0],
          }),
        },
      ],
    }),
    [progress],
  )
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
        <Animated.View style={[styles.scrubTrack, trackStyle]}>
          <View style={[styles.scrubBuf, { width: `${bufferedPct}%` }]} />
          <View style={[styles.scrubFill, { width: `${progressPct}%` }]} />
        </Animated.View>
        <Animated.View
          style={[styles.scrubThumb, { left: `${progressPct}%` }, thumbScale]}
        />
        <Animated.View
          style={[styles.scrubBubble, { left: `${progressPct}%` }, bubbleRise]}
        >
          <Text style={styles.scrubBubbleText}>{bubbleText}</Text>
        </Animated.View>
      </Pressable>
    </TVFocusGuideView>
  )
}

/** Pre-playback veil: dim layer + rotating accent ring. pointerEvents="none"
    so focus engine + autoplay retry keep working beneath it. Looped single
    timing + interpolation on native driver — a looped sequence runs once on Fabric. */
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
    // collapsable={false} keeps the veil above the Android TV VideoView
    // SurfaceView (same convention as the scrims/chrome layers). The label
    // gives automated drivers a stable node to poll for "player ready".
    <View
      style={styles.veil}
      pointerEvents="none"
      collapsable={false}
      accessibilityLabel="Loading, starting playback"
    >
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

  // Per-control focus visuals live in the chrome components. Host only tracks
  // scrubber focus (via ref) because the TV-event listener turns left/right
  // into seeks while the scrubber owns focus.
  const scrubFocusedRef = useRef(false)

  // Fix #5: One-shot flag — `hasTVPreferredFocus` true only on first render;
  // leaving it true re-steals focus on every state change (react-native-tvos#839).
  // In useEffect so StrictMode double-invoke doesn't consume it before first commit.
  const [shouldRequestFocus, setShouldRequestFocus] = useState(true)
  useEffect(() => {
    setShouldRequestFocus(false)
  }, [])

  // ── Auto-hide state machine (U1 foundation; wired in Units 2-7) ─────
  // Visibility + focusability drive the chrome fade. `status` mirrors expo-video's
  // VideoPlayerStatus so U5 can branch on buffering vs error. Accessibility state
  // gates auto-hide (screen reader) and snaps the fade (reduce motion).
  const [controlsVisible, setControlsVisible] = useState(true)
  const [controlsFocusable, setControlsFocusable] = useState(true)
  const [status, setStatus] = useState<VideoPlayerStatus>("idle")
  const [hasError, setHasError] = useState(false)
  const [isScreenReaderEnabled, setIsScreenReaderEnabled] = useState(false)
  const [isReduceMotionEnabled, setIsReduceMotionEnabled] = useState(false)

  // One-shot focus flags (I6): set by reveal/error entry, cleared after the
  // render that consumed it (mirrors Fix #5). The if-guard inside the useEffect
  // prevents the false→false invocation from looping.
  const [revealFocusPending, setRevealFocusPending] = useState(false)
  useEffect(() => {
    if (revealFocusPending) setRevealFocusPending(false)
  }, [revealFocusPending])
  const [errorFocusPending, setErrorFocusPending] = useState(false)
  useEffect(() => {
    if (errorFocusPending) setErrorFocusPending(false)
  }, [errorFocusPending])

  // Inactivity timer (I3) + shared Animated.Value for chrome opacity. Timer is
  // a ref so rapid D-pad resets don't re-render; opacityAnim is driven
  // imperatively from the hide/reveal helpers (Unit 2).
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const opacityAnim = useRef(new Animated.Value(1)).current

  // On unmount: clear pending inactivity timer + in-flight hide animation and
  // flip isMountedRef so late native emissions bail — prevents
  // setState-on-unmounted warnings from dangling expo-video callbacks (P1.2 + P2.3).
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
  // implementers (Units 2-3) — without them, subscriptions re-register on every
  // state change and churn the native emitter. Mirrors Fix #15's `onDismissRef`.
  const scheduleHideRef = useRef<() => void>(() => {})
  const revealControlsRef = useRef<() => void>(() => {})
  // Seek handlers behind refs so the ref-stable TV-event callback can seek
  // (scrub-focused left/right) without re-binding on duration changes.
  const seekBackwardRef = useRef<() => void>(() => {})
  const seekForwardRef = useRef<() => void>(() => {})
  const controlsVisibleRef = useRef(true)
  const isScreenReaderEnabledRef = useRef(false)
  const menuKeyEnabledRef = useRef(false)

  // Mirror gating state into refs so scheduleHide reads ground-truth when called
  // synchronously from native callbacks before React commits. Handlers eagerly
  // sync the ref BEFORE scheduleHideRef; useEffect mirrors are the post-commit fallback.
  const isPausedRef = useRef(false)
  const statusRef = useRef<VideoPlayerStatus>("idle")
  const hasErrorRef = useRef(false)
  const hideAnimRef = useRef<Animated.CompositeAnimation | null>(null)

  // isMountedRef guards external-emission handlers (native events, setTimeout)
  // from setState after unmount — Fix #24's try/catch only catches thrown
  // onDismiss, not the "callback fires on unmounted component" case. P2.3 / rel-2+3.
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
  // SR toggled mid-session: on → reveal-if-hidden + audible confirm; off →
  // rearm inactivity timer (else a brief VO on/off leaves chrome stuck visible).
  // srSeededRef skips the mount-time seed so side-effects don't fire on it.
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

  // Accessibility: seed + subscribe to screen-reader and reduce-motion. Auto-hide
  // is disabled while a screen reader is active (D13); reduce-motion snaps the
  // fade instantly (D8).
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

  // Foreground resume (D12 + U6): snap controls visible + restore a one-shot focus
  // claim (UIFocusEngine needs a target, rn-tvos#852). Error → focus back pill, skip
  // scheduleHide; else focus play/pause (P1.4, else orphans). Don't touch play/pause.
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

  // tvOS: claim the hardware Menu key so Expo Router's Stack doesn't auto-pop
  // before our BackHandler runs (U3). menuKeyEnabledRef tracks whether enable
  // succeeded so cleanup only releases when there's something to release.
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
  // Ref-stable callback reads refs so the native emitter doesn't re-register per
  // render. DENYLIST synthetic focus/pan events: an earlier whitelist (P2.2 pre-fix)
  // also dropped hardware media buttons, so anything not-synthetic = user intent.
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
      // Scrubber-focused left/right = seek (U8). The wrapper traps horizontal
      // focus, so the press can't move focus — translate it into a ±10s seek.
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
      // Siri-remote swipes don't fire Pressable.onFocus, so reset the D14 timer
      // here (arrows/Select already reset via onFocus/onPress). Hardware media
      // keys get the same treatment — they're user intent.
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

  // Hardware Menu (tvOS) + Back (Android TV) via BackHandler — rn-tvos bridges the
  // tvOS Menu event into 'hardwareBackPress', so one subscription covers both.
  // Returning `true` consumes it so Expo Router's Stack doesn't pop.
  useEffect(() => {
    const handler = () => {
      // In-player menu open: Back closes the MENU, not playback — else the menu
      // was a trap (Back exited the video). menuOpenRef/closeMenu declared below;
      // closure runs post-commit and both identities are stable.
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
  // useVideoPlayer recreates+RELEASES the player when its source changes. Live
  // dub-switching would recreate it mid-play (black/stuck frame), so FREEZE the
  // source to the first value and route later swaps through replaceAsync (effect
  // below) — instance identity stays stable across a dub switch.
  // Fix #6: seed duration synchronously from the initializer — sourceLoad can
  // fire before the subscription mounts, else duration stays 0 / end shows "--:--".
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

  // Fix #4: Seeking guard. While this ref holds a target, in-flight timeUpdate
  // events are ignored so a stale emission can't overwrite the optimistic seek
  // position. Cleared when a timeUpdate at or past the target arrives.
  const seekTargetRef = useRef<number | null>(null)

  // ── Session-driven playback (U7) ────────────────────────────────────
  // All session-only behavior (in-player menu, live dub-switch, VTT) lives here;
  // INERT for experience-card playback. Host threads shared auto-hide refs + seek
  // guard + reveal-focus trigger so the hook can re-arm auto-hide without globals.
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

  // Auto-play on mount. try-catch because on tvOS the player may not be ready when
  // the effect first fires. Retry once after a short delay if it didn't start,
  // but only if the user hasn't paused meanwhile.
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

  // playToEnd → auto-dismiss. Fix #15: deps [player]+opacityAnim, dismiss via ref.
  // Fix #24: wrap dismiss so a throw can't reach expo-video's dispatch. U6: if chrome
  // hidden, snap visible one paint first via setTimeout(0) (rAF's native-paint mapping under-specified on rn-tvos).
  useEffect(() => {
    const doDismiss = () => {
      // P2.3: don't fire dismiss against a dead tree — the parent's onDismiss
      // triggers navigation, which could race Expo Router's own unmount path.
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

  // Track playing state. Fix #25: guard cleanup. U2: drive the inactivity timer
  // (clear on pause, rearm on play). playingChange=true is the authoritative
  // "video started" signal, arming the INITIAL 3.5s countdown for D1.
  useEffect(() => {
    const subscription = player.addListener(
      "playingChange",
      ({ isPlaying }) => {
        // P2.3: ignore late-arriving native events after unmount.
        if (!isMountedRef.current) return
        // Sync the guard ref BEFORE scheduleHideRef so scheduleHide sees the
        // post-transition value — else the sync call runs before React commits
        // setIsPaused, the guard reads stale, bails, and the timer never arms.
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

  // Initial-arming fallback: if playingChange hasn't fired 2s after mount (e.g.
  // stream stalled during autoplay retry), call scheduleHide so controls don't
  // stick. It's idempotent, so the normal playingChange path wins if it fires first.
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
      // P2.3: ignore late-arriving native events after unmount (same guard
      // as playingChange/statusChange).
      if (!isMountedRef.current) return
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
      if (!isMountedRef.current) return
      setDuration(payload.duration)
      // A new source (live dub switch) starts with an empty buffer — without this
      // reset the scrubber paints the PREVIOUS source's buffered head until the
      // new source's first timeUpdate (the >= 0 filter keeps stale values through -1).
      setBuffered(0)
    })
    return () => {
      try {
        subscription.remove()
      } catch (e) {
        console.error("[VideoPlayer] sourceLoad cleanup failed:", e)
      }
    }
  }, [player])

  // U5: statusChange drives buffering timer-suspend + terminal error. No
  // 'buffering' value exists in VideoPlayerStatus, so 'loading' is the suspend
  // signal. Reads controlsVisibleRef (not state) to avoid stale-closure reads.
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
        // P1.2 / adversarial #4: stop any in-flight hide so its completion
        // callback doesn't flip controlsVisible=false after a force-reveal — else
        // an error landing mid-fade flashes "error UI then invisible".
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
        // Genuine network buffering: suspend the timer and force controls visible
        // if hidden so the user isn't staring at an invisible stall.
        // revealControlsRef's early-return makes it a no-op if already visible.
        if (inactivityTimerRef.current != null) {
          clearTimeout(inactivityTimerRef.current)
          inactivityTimerRef.current = null
        }
        if (!controlsVisibleRef.current) {
          revealControlsRef.current()
        }
        return
      }

      // Resume from buffering — restart the 3.5 s countdown.
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

  // Fix #9: Decide from React state (`isPaused`), not `player.playing` — rapid
  // D-pad selects all read the same native value in one event cycle and issue
  // redundant calls; React state is a monotonic source that toggles once per press.
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
  // Pill sub-captions mirror the details page: Language shows the active dub's
  // name; Subtitles shows the active track's name, or "Off". (The redundant
  // top-right status chip was removed — the pills already carry this state.)
  const subtitlePillSub = menuActive ? (subtitleLabel ?? "Off") : null
  const remainingLabel =
    duration > 0
      ? `−${formatTime(Math.max(0, duration - currentTime))}`
      : "--:--"

  // ── Auto-hide helpers (U2) ──────────────────────────────────────────
  // hideControls: release focusability BEFORE the 150ms fade (I7 — UIFocusEngine
  // releases controls before they're invisible), then controlsVisible=false.
  // Captures the anim in hideAnimRef so reveal/error can .stop() it (P1.2); `finished` guard skips the hide-complete update when stopped.
  const hideControls = () => {
    // Eager-clear the scrub-focus mirror BEFORE releasing focusability: onBlur
    // lands a tick after controlsFocusable flips, so a left/right press in the
    // 150ms fade window would otherwise seek on an invisibly-fading control.
    scrubFocusedRef.current = false
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

  // scheduleHide: idempotent timer arm — clears any in-flight timer, then arms a
  // new 3.5s only if state supports auto-hide (D3/D15 + D9/D10/D13 gates). Reads
  // refs (not render state) so native callbacks can drive it synchronously before
  // commit — else resume-from-pause / buffering→ready bail and stay disarmed.
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

  // revealControls: early-return when already visible to neutralize the catcher
  // vs TV-event double-dispatch race (U3). Doesn't reset opacityAnim first, so an
  // interrupted hide animates from mid-fade (no black flash). .stop()s any in-flight
  // hide so its completion can't clobber the reveal with setControlsVisible(false) (P1.2).
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
      {/* Video fills the screen behind everything. The pointerEvents="none"
          wrapper (tv-videoview-steals-dpad-focus pattern) blocks AVPlayerLayer on
          tvOS; here trapFocus* already contains D-pad, so focusable={false} suffices. */}
      <VideoView
        style={StyleSheet.absoluteFill}
        player={player}
        nativeControls={false}
        contentFit="contain"
        focusable={false}
      />

      {/* ── VTT subtitle layer (U7) ─────────────────────────────────────
          Passive cue renderer above VideoView, below chrome; mounts only when a
          session drives this overlay + captions on + activeVttSrc resolves.
          MUST NOT touch the auto-hide state machine — it only FOLLOWS
          controlsVisible (slides above the panel when chrome is up, back down when hidden). */}
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
          Full-bleed top/bottom gradients that fade with the chrome (shared
          opacityAnim). collapsable={false} keeps them above the Android TV
          VideoView; pointerEvents="none" keeps them out of the focus engine. */}
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

      {/* trapFocus* prevents focus escaping to the underlying Stack navigator
          (still mounted behind this overlay) — else UIFocusEngine may target the
          obscured page's focusable elements on a D-pad press. */}
      <TVFocusGuideView
        style={styles.contentLayer}
        trapFocusUp
        trapFocusDown
        trapFocusLeft
        trapFocusRight
      >
        {/* ── Invisible D-pad catcher (U3) ────────────────────────
            Gate on `!controlsFocusable` (not `!controlsVisible`) so it mounts at the
            start of the hide fade — UIFocusEngine keeps a target through the 150ms;
            `!controlsVisible` dropped D-pad input during the fade (P1.3). Select → reveal is primary; useTVEventHandler secondary. */}
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
            Glass Back pill; its full-width hit region preserves the spatial column
            down to the transport. Fades with opacityAnim; collapsable={false} for z-order. */}
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
        </Animated.View>

        {/* Empty middle spacer — the full-width back hit above and
            centered play button below still share a spatial column, so
            tvOS's UIFocusEngine can traverse DOWN/UP between them. */}
        <View style={styles.spacer} />

        {/* ── Bottom Controls (U8) ─────────────────────────────────────
            Three-column row over the bottom scrim (title / transport / pills),
            then scrubber + times. Fades with opacityAnim; collapsable={false} for z-order. */}
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

            {/* Transport: −10 / play-pause / +10. On hasError (U5) all are ghosted
                + unfocusable (Back is the only action). U4 focus-restore: each reveal
                flips controlsFocusable false→true so hasTVPreferredFocus re-fires per cycle. */}
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
                Language / Subtitles pills, each opening its menu section. Rendered
                ONLY when a session drives this overlay (menuActive). No scheduleHide()
                on press — openMenu() sets menuOpenRef synchronously and scheduleHide early-returns. */}
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
            <Text
              style={[styles.timeText, styles.timeCurrent]}
              accessibilityLabel={`Elapsed ${formatTime(currentTime)}`}
            >
              {formatTime(currentTime)}
            </Text>
            <Text
              style={styles.timeText}
              accessibilityLabel={`Remaining ${remainingLabel}`}
            >
              {remainingLabel}
            </Text>
          </View>
        </Animated.View>

        {/* ── In-player language/subtitle menu (U7) ───────────────────────
            Absolute-fill scrim with its own trapFocus* + autoFocus so D-pad stays
            within the menu. Inside the content layer (not a Modal) to share the
            overlay's focus trap; mounts only when a session drives this overlay AND open. */}
        {menuActive && menuOpen && (
          <InPlayerMenu section={menuSection} onClose={closeMenu} />
        )}
      </TVFocusGuideView>

      {/* ── Loading veil (U8) ─────────────────────────────────────────────
          Mounted until first confirmed playback, never on error; conditionally
          mounted (not faded) so it can't linger. Unmounts while the menu is open —
          the veil (zIndex 20) outranks contentLayer (10) and would dim the menu (its zIndex 50 can't escape its parent's context). */}
      {!hasStarted && !hasError && !menuOpen && <LoadingVeil />}
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

  // Invisible full-screen Pressable that owns focus while controls are hidden
  // (U3). absoluteFillObject covers the overlay above the flex layout; no
  // backgroundColor keeps VideoView visible — purely an input-capture surface.
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
  // `backHit` (inside BackPill) is the full-width invisible Pressable — its
  // spatial column overlaps the play button below so tvOS's UIFocusEngine can
  // traverse DOWN from back to play via pure spatial navigation.
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
