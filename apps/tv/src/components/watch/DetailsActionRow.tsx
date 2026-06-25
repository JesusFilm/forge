// Video-details inline pills row (Claude Design handoff): [Play] [Language] [Subtitles]
// [Share] [Download] left-aligned under the title; WATCH_THEME, a TVFocusGuideView (autoFocus).
// Focus R7: Play gets one-shot hasTVPreferredFocus + re-arms as restore target on overlay dismiss. R5: Play validates hls (validateStreamingUrl) then playVideo; Share/Download R18/R19 open the QR LinkModal.

import { useEffect, useMemo, useRef, useState } from "react"
import { Animated, Pressable, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useVideoPlayerContext } from "../../contexts/VideoPlayerContext"
import { useWatchSession } from "../../contexts/WatchSessionProvider"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { LinkModal } from "../LinkModal"
import { scale } from "../../lib/scale"
import { validateActionUrl, validateStreamingUrl } from "../../lib/validateUrl"
import { buildShareUrl } from "./detailsHelpers"
import { WATCH_THEME } from "./watchDetailTheme"
import { focusTransform, useFocusAnimation } from "./useFocusAnimation"
import { AnimatedFocusIcon } from "./AnimatedFocusIcon"

type IconName = React.ComponentProps<typeof Ionicons>["name"]

type DetailsActionRowProps = {
  title: string | null
  onOpenLanguage: () => void
  onOpenSubtitles: () => void
}

export function DetailsActionRow({
  title,
  onOpenLanguage,
  onOpenSubtitles,
}: DetailsActionRowProps) {
  const { playVideo, state } = useVideoPlayerContext()
  const { video, activeVariant, subtitleEnabled } = useWatchSession()

  // One-shot preferred focus on Play: armed on mount, and re-armed whenever the
  // overlay closes so focus returns to Play (R7). Cleared the render after it
  // applies so it doesn't fight subsequent user navigation.
  const [playPreferredFocus, setPlayPreferredFocus] = useState(true)
  const wasOverlayVisibleRef = useRef(state.isVisible)

  useEffect(() => {
    if (wasOverlayVisibleRef.current && !state.isVisible) {
      setPlayPreferredFocus(true)
    }
    wasOverlayVisibleRef.current = state.isVisible
  }, [state.isVisible])

  useEffect(() => {
    if (!playPreferredFocus) return
    const id = setTimeout(() => setPlayPreferredFocus(false), 0)
    return () => clearTimeout(id)
  }, [playPreferredFocus])

  const handlePlay = () => {
    const hls = activeVariant?.hls
    if (!hls || !validateStreamingUrl(hls)) return
    playVideo(hls, title ?? undefined, undefined)
  }

  // Share / Download continuation URL → QR fallback. Same public watch URL for
  // both in v1 (the phone page exposes share + download); validated before use.
  const shareUrl = buildShareUrl(video, activeVariant?.languageSlug ?? null)
  const canShare = shareUrl != null && validateActionUrl(shareUrl)

  const [modalUrl, setModalUrl] = useState<string | null>(null)
  const [modalHeading, setModalHeading] = useState<string>(
    "Scan to continue on your phone",
  )
  const openModal = (url: string | null, heading: string) => {
    if (!validateActionUrl(url)) return
    setModalHeading(heading)
    setModalUrl(url)
  }

  // Secondary-pill sub-labels from real session data. The play button is just the
  // icon + "Play" (the mockup's "Day 1 · 3:42 left" resume state has no JFP
  // equivalent — no watch-progress tracking).
  const langSub = activeVariant?.languageName ?? null
  const subsSub = subtitleEnabled ? "On" : "Off"

  return (
    <>
      <TVFocusGuideView autoFocus style={styles.row}>
        <PlayPill
          onPress={handlePlay}
          hasTVPreferredFocus={playPreferredFocus}
        />
        <SecondaryPill
          icon="globe-outline"
          label="Language"
          sub={langSub}
          onPress={onOpenLanguage}
        />
        <SecondaryPill
          icon="text-outline"
          label="Subtitles"
          sub={subsSub}
          onPress={onOpenSubtitles}
        />
        {canShare ? (
          <SecondaryPill
            icon="share-outline"
            label="Share"
            onPress={() => openModal(shareUrl, "Scan to share on your phone")}
          />
        ) : null}
        {canShare ? (
          <SecondaryPill
            icon="download-outline"
            label="Download"
            onPress={() =>
              openModal(shareUrl, "Scan to download on your phone")
            }
          />
        ) : null}
      </TVFocusGuideView>

      {modalUrl != null ? (
        <LinkModal
          url={modalUrl}
          visible
          onClose={() => setModalUrl(null)}
          urlValidator={validateActionUrl}
          qrHeading={modalHeading}
        />
      ) : null}
    </>
  )
}

// ── Buttons ─────────────────────────────────────────────────────────
// Focus eases in via useFocusAnimation's 0→1 `progress`: the pill lifts + magnifies
// and its highlight cross-fades over ~180ms. SecondaryPill is exported for reuse
// (SeriesActionRow's Language pill).

const ICON_SIZE = Math.round(scale(30))

function PlayPill({
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
      accessibilityLabel="Play"
    >
      <Animated.View style={[styles.playPill, animatedStyle]}>
        <Ionicons name="play" size={ICON_SIZE} color={WATCH_THEME.accentText} />
        <Text style={styles.playLabel}>Play</Text>
      </Animated.View>
    </Pressable>
  )
}

export function SecondaryPill({
  icon,
  label,
  sub,
  onPress,
  hasTVPreferredFocus,
}: {
  icon: IconName
  label: string
  sub?: string | null
  onPress: () => void
  hasTVPreferredFocus?: boolean
}) {
  const { setFocused, progress } = useFocusAnimation()
  // Memoized: progress is a stable ref, so the interpolations are built once
  // rather than on every focus/blur re-render.
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
      // Fold the visible sub-value (current language / "On"/"Off") into the
      // label so VoiceOver and automated D-pad drivers can read the state
      // without activating the picker.
      accessibilityLabel={sub ? `${label}, ${sub}` : label}
    >
      <Animated.View style={[styles.pill, animatedStyle]}>
        <AnimatedFocusIcon name={icon} progress={progress} size={ICON_SIZE} />
        <View style={styles.cap}>
          <Animated.Text style={[styles.pillLabel, { color: ink }]}>
            {label}
          </Animated.Text>
          {sub ? (
            <Animated.Text
              style={[styles.pillSub, { color: subInk }]}
              numberOfLines={1}
            >
              {sub}
            </Animated.Text>
          ) : null}
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

  // Play (primary, solid red). A constant-width transparent border becomes a
  // white ring as focus eases in (animating borderColor avoids any layout shift).
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
    // Resting crimson drop shadow — the play button is the page anchor.
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

  // Secondary (glass → white-fill on focus). backgroundColor + shadowOpacity are
  // animated; the dark drop shadow (color/radius/offset) is static and revealed
  // by the opacity ramp.
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
