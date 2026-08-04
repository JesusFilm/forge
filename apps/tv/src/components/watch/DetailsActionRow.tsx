// Video-details inline pills row (Claude Design handoff): [Play] [Language] [Subtitles]
// [Share] left-aligned under the title; WATCH_THEME, a TVFocusGuideView (autoFocus).
// Focus R7: Play gets one-shot hasTVPreferredFocus + re-arms as restore target on overlay dismiss. R5: Play validates hls (validateStreamingUrl) then playVideo; Share R18 opens the QR LinkModal.

import { useEffect, useMemo, useRef, useState } from "react"
import { Animated, Pressable, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useVideoPlayerContext } from "../../contexts/VideoPlayerContext"
import { useWatchSession } from "../../contexts/WatchSessionProvider"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { LinkModal } from "../LinkModal"
import { scale } from "../../lib/scale"
import { validateActionUrl, validateStreamingUrl } from "../../lib/validateUrl"
import { getResumePosition } from "../../lib/watchEvents/continueWatching"
import { buildShareUrl } from "./detailsHelpers"
import { WATCH_THEME } from "./watchDetailTheme"
import type { ActionRowPill } from "./actionRowScrollGlide"
import { useFocusVisual } from "../focus/useFocusVisual"
import { AnimatedFocusIcon } from "./AnimatedFocusIcon"

type IconName = React.ComponentProps<typeof Ionicons>["name"]

type DetailsActionRowProps = {
  title: string | null
  onOpenLanguage: () => void
  onOpenSubtitles: () => void
  // Pill-identified so the consumer can tell "focus left the row" from a
  // within-row hop: tvOS delivers the NEW pill's focus BEFORE the old pill's
  // blur, so a bare blur callback would cancel work the new focus just started
  // (verified in-sim on the scroll-to-top glide; contract in
  // actionRowScrollGlide.ts, which has the tests).
  onRowFocus?: (pill: ActionRowPill) => void
  onRowBlur?: (pill: ActionRowPill) => void
}

export function DetailsActionRow({
  title,
  onOpenLanguage,
  onOpenSubtitles,
  onRowFocus,
  onRowBlur,
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

  // Continue Watching: the saved resume point for this video, refreshed when
  // the overlay closes so a re-press resumes from the JUST-watched position.
  const [resumeAtSeconds, setResumeAtSeconds] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    const id = video?.documentId
    if (!id || state.isVisible) return
    void getResumePosition(id).then((position) => {
      if (!cancelled) setResumeAtSeconds(position)
    })
    return () => {
      cancelled = true
    }
  }, [video?.documentId, state.isVisible])

  const handlePlay = () => {
    const hls = activeVariant?.hls
    if (!hls || !validateStreamingUrl(hls)) return
    // Identity rides along for anonymous watch-event capture (feat-322):
    // admin Video documentId + the selected dub's documentId.
    playVideo(
      hls,
      title ?? undefined,
      undefined,
      video?.documentId
        ? {
            videoId: video.documentId,
            videoDubId: activeVariant?.documentId ?? null,
          }
        : undefined,
      resumeAtSeconds ?? undefined,
    )
  }

  // Share continuation URL → QR fallback: the public watch URL, validated
  // before use so the phone can pick the video up.
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
      {/* trapFocusUp: the hero VideoBackdrop's AVPlayer container hijacks an
          up-press while playing (focusable={false}/pointerEvents="none" don't
          contain it — tv-videoview-steals-dpad-focus-20260413.md), leaving no
          visible focus. The trap does not redirect that press: RCTTVView's
          shouldUpdateFocusInContext: returns NO when nextFocusedItem isn't
          inside this guide, so UIKit CANCELS the update and focus simply stays
          put — no onFocus/onBlur fires. That's why the scroll-restore below is
          keyed on focus ENTERING the row (from the content underneath), not on
          the trapped press itself: without it the trap would leave the hero
          stranded half-scrolled with no way up. */}
      <TVFocusGuideView autoFocus trapFocusUp style={styles.row}>
        <PlayPill
          onPress={handlePlay}
          hasTVPreferredFocus={playPreferredFocus}
          onFocus={() => onRowFocus?.("play")}
          onBlur={() => onRowBlur?.("play")}
        />
        <SecondaryPill
          icon="globe-outline"
          label="Language"
          sub={langSub}
          onPress={onOpenLanguage}
          onFocus={() => onRowFocus?.("language")}
          onBlur={() => onRowBlur?.("language")}
        />
        <SecondaryPill
          icon="text-outline"
          label="Subtitles"
          sub={subsSub}
          onPress={onOpenSubtitles}
          onFocus={() => onRowFocus?.("subtitles")}
          onBlur={() => onRowBlur?.("subtitles")}
        />
        {canShare ? (
          <SecondaryPill
            icon="share-outline"
            label="Share"
            onPress={() => openModal(shareUrl, "Scan to share on your phone")}
            onFocus={() => onRowFocus?.("share")}
            onBlur={() => onRowBlur?.("share")}
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
  onFocus,
  onBlur,
}: {
  onPress: () => void
  hasTVPreferredFocus: boolean
  onFocus?: () => void
  onBlur?: () => void
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
      onFocus={() => {
        setFocused(true)
        onFocus?.()
      }}
      onBlur={() => {
        setFocused(false)
        onBlur?.()
      }}
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
  onFocus,
  onBlur,
}: {
  icon: IconName
  label: string
  sub?: string | null
  onPress: () => void
  hasTVPreferredFocus?: boolean
  onFocus?: () => void
  onBlur?: () => void
}) {
  const { setFocused, progress, transform } = useFocusVisual("pill", {
    nativeDriver: false,
  })
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
      transform,
    }),
    [progress, transform],
  )
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => {
        setFocused(true)
        onFocus?.()
      }}
      onBlur={() => {
        setFocused(false)
        onBlur?.()
      }}
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
