// Action row for the series screen — the DetailsActionRow template trimmed to
// the series action set (R7): [Play Trailer] [Language], one left-aligned,
// remote-navigable TVFocusGuideView (autoFocus) row under the title.
//
// Play Trailer (R4): rendered ONLY when the screen resolved a playable trailer
// dub — no dead action. Pressing it validates the hls then hands it to the
// fullscreen overlay via playVideo(hls, title) with NO setVideo and NO watch
// session — the documented no-session invariant (useSessionPlayback.ts):
// without a published session the overlay player stays clean (no in-player
// language/subtitle menu); language changes happen here on the series screen.
// Menu dismisses the overlay back to this screen (existing behavior).
//
// Focus: one-shot hasTVPreferredFocus on the FIRST pill — Play Trailer, or
// Language when no trailer exists — armed on mount, re-armed when the overlay
// dismisses (DetailsActionRow's isVisible-transition pattern), and re-armed
// whenever `refocusKey` increments (U4 uses it to restore focus after the
// language panel closes). Cleared the render after it applies so it doesn't
// fight subsequent user navigation.

import { useEffect, useMemo, useRef, useState } from "react"
import { Animated, Pressable, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useVideoPlayerContext } from "../../contexts/VideoPlayerContext"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { scale } from "../../lib/scale"
import { validateStreamingUrl } from "../../lib/validateUrl"
import { WATCH_THEME } from "../watch/watchDetailTheme"
import { focusTransform, useFocusAnimation } from "../watch/useFocusAnimation"
import { AnimatedFocusIcon } from "../watch/AnimatedFocusIcon"

type SeriesActionRowProps = {
  /**
   * The playable trailer's HLS URL (pickPlayableTrailer's pick), or null when
   * the series has none — in which case the Play Trailer pill is not rendered
   * and Language becomes the first/only pill.
   */
  trailerHls: string | null
  /** Series title, handed to the fullscreen overlay player's chrome. */
  title: string | null
  /**
   * Sub-caption on the Language pill — the currently selected language's
   * display name. Until U4 wires the series-language provider, the caller
   * passes the trailer dub's language (or "English").
   */
  languageName: string
  /** Opens the language selection panel. Optional until U4 wires the panel. */
  onLanguagePress?: () => void
  /**
   * Re-arm hook for U4: incrementing this number re-arms the first pill's
   * one-shot preferred focus (panel-close focus restore).
   */
  refocusKey?: number
}

export function SeriesActionRow({
  trailerHls,
  title,
  languageName,
  onLanguagePress,
  refocusKey = 0,
}: SeriesActionRowProps) {
  const { playVideo, state } = useVideoPlayerContext()

  // One-shot preferred focus on the first pill: armed on mount, re-armed when
  // the overlay closes and when refocusKey increments.
  const [firstPillPreferredFocus, setFirstPillPreferredFocus] = useState(true)
  const wasOverlayVisibleRef = useRef(state.isVisible)

  useEffect(() => {
    if (wasOverlayVisibleRef.current && !state.isVisible) {
      setFirstPillPreferredFocus(true)
    }
    wasOverlayVisibleRef.current = state.isVisible
  }, [state.isVisible])

  // Ref-compared (not a bare dep) so the initial value never double-arms the
  // mount shot; only a genuine increment re-arms.
  const prevRefocusKeyRef = useRef(refocusKey)
  useEffect(() => {
    if (refocusKey !== prevRefocusKeyRef.current) {
      prevRefocusKeyRef.current = refocusKey
      setFirstPillPreferredFocus(true)
    }
  }, [refocusKey])

  useEffect(() => {
    if (!firstPillPreferredFocus) return
    const id = setTimeout(() => setFirstPillPreferredFocus(false), 0)
    return () => clearTimeout(id)
  }, [firstPillPreferredFocus])

  const hasTrailer = trailerHls != null

  const handlePlayTrailer = () => {
    if (!trailerHls || !validateStreamingUrl(trailerHls)) return
    // No setVideo — see the no-session invariant in the header comment.
    playVideo(trailerHls, title ?? undefined)
  }

  return (
    <TVFocusGuideView autoFocus style={styles.row}>
      {hasTrailer ? (
        <TrailerPill
          onPress={handlePlayTrailer}
          hasTVPreferredFocus={firstPillPreferredFocus}
        />
      ) : null}
      <LanguagePill
        sub={languageName}
        onPress={() => onLanguagePress?.()}
        hasTVPreferredFocus={!hasTrailer && firstPillPreferredFocus}
      />
    </TVFocusGuideView>
  )
}

// ── Pills ───────────────────────────────────────────────────────────
//
// Mirrors DetailsActionRow's PlayPill / SecondaryPill (not exported there):
// focus eases in via useFocusAnimation's 0→1 `progress` — lift + magnify, and
// the highlight (Play's white ring; Language's glass→white fill) cross-fades.

const ICON_SIZE = Math.round(scale(30))

function TrailerPill({
  onPress,
  hasTVPreferredFocus,
}: {
  onPress: () => void
  hasTVPreferredFocus: boolean
}) {
  const { setFocused, progress } = useFocusAnimation()
  // Memoized: progress is a stable ref, so the interpolations are built once
  // rather than on every focus/blur re-render.
  const animatedStyle = useMemo(
    () => ({
      borderColor: progress.interpolate({
        inputRange: [0, 1],
        outputRange: ["rgba(255,255,255,0)", "rgba(255,255,255,0.9)"],
      }),
      transform: focusTransform(progress),
    }),
    [progress],
  )
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityRole="button"
      accessibilityLabel="Play Trailer"
    >
      <Animated.View style={[styles.playPill, animatedStyle]}>
        <Ionicons name="play" size={ICON_SIZE} color={WATCH_THEME.accentText} />
        <Text style={styles.playLabel}>Play Trailer</Text>
      </Animated.View>
    </Pressable>
  )
}

function LanguagePill({
  sub,
  onPress,
  hasTVPreferredFocus,
}: {
  sub: string
  onPress: () => void
  hasTVPreferredFocus: boolean
}) {
  const { setFocused, progress } = useFocusAnimation()
  const ink = useMemo(
    () =>
      progress.interpolate({
        inputRange: [0, 1],
        outputRange: [WATCH_THEME.text, WATCH_THEME.focusInk],
      }),
    [progress],
  )
  const subInk = useMemo(
    () =>
      progress.interpolate({
        inputRange: [0, 1],
        outputRange: [WATCH_THEME.text62, "rgba(0,0,0,0.5)"],
      }),
    [progress],
  )
  const animatedStyle = useMemo(
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
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityRole="button"
      // Fold the visible sub-value (current language) into the label so
      // VoiceOver and automated D-pad drivers can read the state without
      // activating the picker.
      accessibilityLabel={`Language, ${sub}`}
    >
      <Animated.View style={[styles.pill, animatedStyle]}>
        <AnimatedFocusIcon
          name="globe-outline"
          progress={progress}
          size={ICON_SIZE}
        />
        <View style={styles.cap}>
          <Animated.Text style={[styles.pillLabel, { color: ink }]}>
            Language
          </Animated.Text>
          <Animated.Text
            style={[styles.pillSub, { color: subInk }]}
            numberOfLines={1}
          >
            {sub}
          </Animated.Text>
        </View>
      </Animated.View>
    </Pressable>
  )
}

const PILL_HEIGHT = scale(76)
const PILL_RADIUS = scale(18)

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: scale(18),
    marginTop: scale(34),
  },

  // Play Trailer (primary, solid red). A constant-width transparent border
  // becomes a white ring as focus eases in (animating borderColor avoids any
  // layout shift).
  playPill: {
    height: PILL_HEIGHT,
    paddingLeft: scale(32),
    paddingRight: scale(40),
    borderRadius: PILL_RADIUS,
    backgroundColor: WATCH_THEME.accent,
    borderWidth: scale(3),
    flexDirection: "row",
    alignItems: "center",
    gap: scale(16),
    shadowColor: WATCH_THEME.accent,
    shadowRadius: scale(18),
    shadowOpacity: 0.55,
    shadowOffset: { width: 0, height: scale(10) },
  },
  playLabel: {
    fontFamily: "System",
    fontSize: Math.round(scale(28)),
    fontWeight: "700",
    color: WATCH_THEME.accentText,
  },

  // Language (glass → white-fill on focus).
  pill: {
    height: PILL_HEIGHT,
    paddingHorizontal: scale(26),
    borderRadius: PILL_RADIUS,
    flexDirection: "row",
    alignItems: "center",
    gap: scale(13),
    shadowColor: "#000000",
    shadowRadius: scale(22),
    shadowOffset: { width: 0, height: scale(14) },
  },
  pillLabel: {
    fontFamily: "System",
    fontSize: Math.round(scale(23)),
    fontWeight: "600",
  },
  pillSub: {
    fontFamily: "System",
    fontSize: Math.round(scale(15)),
    fontWeight: "600",
    marginTop: scale(2),
  },

  cap: {
    alignItems: "flex-start",
    justifyContent: "center",
  },
})
