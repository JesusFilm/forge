// Action row for the video-details screen.
//
// Order: [Language] [Subtitles] [Play] [Share] [Download], with Play as the
// solid crimson circle anchor in the centre. Wrapped in a TVFocusGuideView so
// D-pad LEFT/RIGHT traverses the row and focus can't escape upward into the
// non-interactive backdrop.
//
// Focus (R7): Play receives a one-shot hasTVPreferredFocus on mount (cleared via
// useEffect) AND becomes the focus-restore target when the fullscreen overlay
// dismisses — when VideoPlayerContext goes visible → not-visible, we re-arm
// Play's preferred focus for one render.
//
// Play (R5): validate the active variant's hls via validateStreamingUrl, then
// playVideo(hls, title, subtitle).
//
// Share / Download (R18, R19): v1 capability probe is QR-or-hide. We build the
// continuation URL, validate it with validateActionUrl, and only render the
// action when valid; pressing it opens the QR LinkModal. (Native-intent probe is
// refined in U7-adjacent work.)

import { useEffect, useRef, useState } from "react"
import { Pressable, StyleSheet, Text } from "react-native"

import { useVideoPlayerContext } from "../../contexts/VideoPlayerContext"
import { useWatchSession } from "../../contexts/WatchSessionProvider"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { LinkModal } from "../LinkModal"
import { COLORS } from "../../lib/colors"
import { scale } from "../../lib/scale"
import { validateActionUrl, validateStreamingUrl } from "../../lib/validateUrl"
import { buildShareUrl } from "./detailsHelpers"

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
  const { video, activeVariant } = useWatchSession()

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
    // Clear on the next tick so the flag is one-shot (mirrors the mobile/TV
    // back-navigation focus-restore pattern).
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

  return (
    <>
      <TVFocusGuideView autoFocus style={styles.row}>
        <SecondaryAction label="Language" onPress={onOpenLanguage} />
        <SecondaryAction label="Subtitles" onPress={onOpenSubtitles} />

        <PlayAction
          onPress={handlePlay}
          hasTVPreferredFocus={playPreferredFocus}
        />

        {canShare ? (
          <SecondaryAction
            label="Share"
            onPress={() => openModal(shareUrl, "Scan to share on your phone")}
          />
        ) : null}
        {canShare ? (
          <SecondaryAction
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

function PlayAction({
  onPress,
  hasTVPreferredFocus,
}: {
  onPress: () => void
  hasTVPreferredFocus: boolean
}) {
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityRole="button"
      accessibilityLabel="Play"
      style={[styles.playButton, focused && styles.playButtonFocused]}
    >
      <Text style={styles.playIcon}>{"▶"}</Text>
    </Pressable>
  )
}

function SecondaryAction({
  label,
  onPress,
}: {
  label: string
  onPress: () => void
}) {
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.secondaryButton, focused && styles.secondaryButtonFocused]}
    >
      <Text style={styles.secondaryLabel}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: scale(80),
    paddingVertical: scale(24),
  },
  playButton: {
    width: scale(76),
    height: scale(76),
    borderRadius: scale(38),
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: scale(24),
  },
  playButtonFocused: {
    shadowColor: COLORS.primary,
    shadowRadius: scale(24),
    shadowOpacity: 1,
    shadowOffset: { width: 0, height: 0 },
    transform: [{ scale: 1.08 }],
  },
  playIcon: {
    fontFamily: "System",
    fontSize: scale(30),
    color: COLORS.text,
    marginLeft: scale(4), // optical centering of the triangle glyph
  },
  secondaryButton: {
    paddingHorizontal: scale(28),
    paddingVertical: scale(16),
    borderRadius: scale(28),
    backgroundColor: COLORS.surfaceContainerHigh,
    marginHorizontal: scale(8),
  },
  secondaryButtonFocused: {
    backgroundColor: COLORS.surfaceContainerHighest,
    shadowColor: COLORS.primary,
    shadowRadius: scale(16),
    shadowOpacity: 0.8,
    shadowOffset: { width: 0, height: 0 },
  },
  secondaryLabel: {
    fontFamily: "System",
    fontSize: scale(20),
    fontWeight: "600",
    color: COLORS.text,
  },
})
