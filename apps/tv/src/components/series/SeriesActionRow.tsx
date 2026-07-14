// Series action row (R7): [Play Trailer] [Language] in an autoFocus TVFocusGuideView.
// Play Trailer shows only when a trailer dub resolved, plays via playVideo with NO
// setVideo/session (no-session invariant in useSessionPlayback.ts); focus re-arms on refocusKey (U4).

import { useEffect, useMemo, useRef, useState } from "react"
import { Animated, Pressable, StyleSheet, Text } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useVideoPlayerContext } from "../../contexts/VideoPlayerContext"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { scale } from "../../lib/scale"
import { validateStreamingUrl } from "../../lib/validateUrl"
import { WATCH_THEME } from "../watch/watchDetailTheme"
import { useFocusVisual } from "../focus/useFocusVisual"
import { SecondaryPill } from "../watch/DetailsActionRow"

type SeriesActionRowProps = {
  /**
   * Playable trailer HLS (pickPlayableTrailer), or null when the series has
   * none — then Play Trailer is hidden and Language is the only pill.
   */
  trailerHls: string | null
  /** Series title, handed to the fullscreen overlay player's chrome. */
  title: string | null
  /**
   * Language pill sub-caption: the selected language's display name. Until U4
   * wires the provider, the caller passes the trailer dub's language (or "English").
   */
  languageName: string
  /** Opens the language selection panel. Optional until U4 wires the panel. */
  onLanguagePress?: () => void
  /**
   * Re-arm hook for U4: incrementing re-arms the first pill's one-shot
   * preferred focus (panel-close focus restore).
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
      <SecondaryPill
        icon="globe-outline"
        label="Language"
        sub={languageName}
        onPress={() => onLanguagePress?.()}
        hasTVPreferredFocus={!hasTrailer && firstPillPreferredFocus}
      />
    </TVFocusGuideView>
  )
}

// ── Pills ───────────────────────────────────────────────────────────
// TrailerPill mirrors DetailsActionRow's (non-exported) PlayPill: focus eases
// in via useFocusAnimation progress (lift + magnify + white-ring cross-fade).
// The Language pill is the shared SecondaryPill from DetailsActionRow.

const ICON_SIZE = Math.round(scale(30))

function TrailerPill({
  onPress,
  hasTVPreferredFocus,
}: {
  onPress: () => void
  hasTVPreferredFocus: boolean
}) {
  const { setFocused, progress, transform } = useFocusVisual("pill", {
    nativeDriver: false,
  })
  // Memoized: progress is a stable ref, so the interpolations are built once
  // rather than on every focus/blur re-render.
  const animatedStyle = useMemo(
    () => ({
      borderColor: progress.interpolate({
        inputRange: [0, 1],
        outputRange: ["rgba(255,255,255,0)", "rgba(255,255,255,0.9)"],
      }),
      transform,
    }),
    [progress, transform],
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
})
