import { useCallback, useEffect, useState, type ComponentProps } from "react"
import {
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import type { VideoPlayer } from "expo-video"

import { ClipDescription } from "./ClipDescription"
import { ClipProgressBar } from "./ClipProgressBar"
import { SubtitleOverlay } from "../watch/SubtitleOverlay"
import { ACCENT, BLACK, TEXT_ON_OVERLAY, hexToRgba } from "../../lib/color"
import { EXPLORE_COPY } from "../../lib/explore/copy"
import { readSeconds } from "../../lib/explore/playerRead"
import {
  BAND_BLUR_RADIUS,
  EXPLORE_FRAMING,
  bandAspect,
} from "../../lib/explore/framing"
import type { FeedClip } from "../../lib/explore/types"
import { clamp } from "../../lib/scrubber"
import { useTabBarClearance } from "../../lib/tabBar"
import { buildWatchShareUrl } from "../../lib/watchShareUrl"
import { useTypography } from "../../hooks/useTypography"
import { feedback } from "../../styles/shared"

export type ClipOverlayProps = {
  clip: FeedClip
  /** The active feed player. */
  player: VideoPlayer
  /** The saved Explore mute choice (R11). */
  muted: boolean
  /** Shows the play glyph (R10). The tap target itself is the feed's. */
  paused: boolean
  onToggleMute: () => void
  /** A scrub to an asset time. The feed players seek, so the load is no rebuffer. */
  onSeek: (seconds: number) => void
  /** The asset time the viewer reached, inside the clip window (R16). */
  onKeepWatching: (positionSeconds: number) => void
  /** Share or "more" opened. The feed pauses the clip (R44). */
  onOverlayOpen: () => void
  /** Share or "more" closed. The feed resumes only a clip that was playing. */
  onOverlayClose: () => void
}

/**
 * 0.54 is the least black that holds white text at 4.5:1 over a pure-white
 * frame; 0.6 keeps a margin. Black reaches the floor sooner than the app ground.
 */
const SCRIM_COLOR = hexToRgba(BLACK, 0.6)
/** The fade above the text, so the scrim has no hard top edge. */
const SCRIM_RAMP_HEIGHT = 96
const RAIL_BUTTON_SIZE = 48
const RAIL_LABEL_WIDTH = 76
const CAPTION_GAP = 8

/**
 * R13: a subtitle-only clip always shows its captions. A dubbed clip shows
 * them only while muted. With no track in the feed language, none show.
 */
function clipCaptionSource(clip: FeedClip, muted: boolean): string | null {
  if (clip.subtitleVttSrc == null) return null
  return clip.subtitleOnly || muted ? clip.subtitleVttSrc : null
}

/**
 * Mount only in the current slot (KTD20): the captions and the progress bar
 * read the active player.
 */
export function ClipOverlay({
  clip,
  player,
  muted,
  paused,
  onToggleMute,
  onSeek,
  onKeepWatching,
  onOverlayOpen,
  onOverlayClose,
}: ClipOverlayProps) {
  const typography = useTypography()
  const tabBarClearance = useTabBarClearance()
  const [bottomHeight, setBottomHeight] = useState(0)

  const captionSrc = clipCaptionSource(clip, muted)

  const handleShare = useCallback(() => {
    onOverlayOpen()
    // iOS settles when the sheet closes. Android settles as the chooser opens,
    // so there the feed's background pause holds the clip. Close once, either way.
    void Share.share({
      message: buildWatchShareUrl(clip.slug, clip.audioLanguageSlug),
      title: clip.title,
    })
      .catch(() => {})
      .finally(onOverlayClose)
  }, [
    clip.slug,
    clip.audioLanguageSlug,
    clip.title,
    onOverlayOpen,
    onOverlayClose,
  ])

  const handleKeepWatching = useCallback(() => {
    const { startSeconds, endSeconds } = clip.window
    const time = readSeconds(() => player.currentTime)
    onKeepWatching(
      time == null ? startSeconds : clamp(time, startSeconds, endSeconds),
    )
  }, [clip.window, player, onKeepWatching])

  const handleBottomLayout = useCallback((e: LayoutChangeEvent) => {
    setBottomHeight(Math.round(e.nativeEvent.layout.height))
  }, [])

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {EXPLORE_FRAMING === "band" && (
        <ClipBandBackdrop player={player} imageUrl={clip.imageUrl} />
      )}

      {paused && (
        <View
          testID="clip-paused-glyph"
          style={styles.glyphLayer}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <View style={styles.glyph}>
            <Ionicons name="play" size={40} color={TEXT_ON_OVERLAY} />
          </View>
        </View>
      )}

      {captionSrc != null && (
        <SubtitleOverlay
          player={player}
          vttSrc={captionSrc}
          bottomOffset={bottomHeight + CAPTION_GAP}
        />
      )}

      <View
        testID="clip-overlay-bottom"
        style={[styles.bottom, { paddingBottom: tabBarClearance }]}
        pointerEvents="box-none"
        onLayout={handleBottomLayout}
      >
        <View
          testID="clip-overlay-scrim"
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        >
          <LinearGradient
            colors={[hexToRgba(BLACK, 0), SCRIM_COLOR]}
            style={styles.scrimRamp}
          />
          <View
            testID="clip-overlay-scrim-solid"
            style={[StyleSheet.absoluteFill, styles.scrimSolid]}
          />
        </View>

        <View
          testID="clip-overlay-row"
          style={styles.row}
          pointerEvents="box-none"
        >
          <View testID="clip-overlay-info" style={styles.info}>
            <Text
              style={[styles.title, typography.titleSmall]}
              numberOfLines={2}
              accessibilityRole="header"
            >
              {clip.title}
            </Text>
            <ClipDescription
              description={clip.description}
              onExpand={onOverlayOpen}
              onCollapse={onOverlayClose}
            />
          </View>

          <View testID="clip-overlay-rail" style={styles.rail}>
            <RailButton
              icon={muted ? "volume-mute" : "volume-high"}
              label={muted ? EXPLORE_COPY.unmute : EXPLORE_COPY.mute}
              onPress={onToggleMute}
            />
            <RailButton
              icon="share-outline"
              label={EXPLORE_COPY.share}
              onPress={handleShare}
            />
            <RailButton
              testID="clip-rail-keep-watching"
              icon="play"
              label={EXPLORE_COPY.keepWatching}
              hint={EXPLORE_COPY.keepWatchingHint}
              fill={ACCENT}
              onPress={handleKeepWatching}
            />
          </View>
        </View>

        <ClipProgressBar
          player={player}
          clipWindow={clip.window}
          onSeek={onSeek}
        />
      </View>
    </View>
  )
}

type RailButtonProps = {
  icon: ComponentProps<typeof Ionicons>["name"]
  label: string
  onPress: () => void
  hint?: string
  fill?: string
  testID?: string
}

/** A round button with its label under it. The whole stack is the target. */
function RailButton({
  icon,
  label,
  onPress,
  hint,
  fill,
  testID,
}: RailButtonProps) {
  const typography = useTypography()
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [styles.railButton, pressed && feedback.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
    >
      <View
        style={[styles.railCircle, fill != null && { backgroundColor: fill }]}
      >
        <Ionicons name={icon} size={24} color={TEXT_ON_OVERLAY} />
      </View>
      <Text style={[styles.railLabel, typography.caption]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  )
}

/** The size of the track the player shows, or null until one loads. */
function usePlayingSize(player: VideoPlayer) {
  const [size, setSize] = useState(() => player.videoTrack?.size ?? null)
  useEffect(() => {
    setSize(player.videoTrack?.size ?? null)
    const sub = player.addListener("videoTrackChange", ({ videoTrack }) => {
      setSize(videoTrack?.size ?? null)
    })
    return () => sub.remove()
  }, [player])
  return size
}

/**
 * KTD18's band: the video shows whole (`contain`) in a centred band, and a
 * blurred copy of the clip's image fills the rows above and below it.
 */
function ClipBandBackdrop({
  player,
  imageUrl,
}: {
  player: VideoPlayer
  imageUrl: string | null
}) {
  const aspect = bandAspect(usePlayingSize(player))
  const fill =
    imageUrl == null ? null : (
      <Image
        source={imageUrl}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        blurRadius={BAND_BLUR_RADIUS}
        recyclingKey={imageUrl}
      />
    )
  return (
    <View
      testID="clip-band-backdrop"
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.bandBar}>{fill}</View>
      <View
        testID="clip-band-frame"
        style={[styles.bandFrame, { aspectRatio: aspect }]}
      />
      <View style={styles.bandBar}>{fill}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  glyphLayer: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  glyph: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: hexToRgba(BLACK, 0.45),
  },
  bottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  scrimRamp: {
    position: "absolute",
    left: 0,
    right: 0,
    top: -SCRIM_RAMP_HEIGHT,
    height: SCRIM_RAMP_HEIGHT,
  },
  scrimSolid: {
    backgroundColor: SCRIM_COLOR,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingLeft: 16,
    paddingRight: 8,
    gap: 8,
  },
  info: {
    flex: 1,
    gap: 2,
    paddingBottom: 4,
  },
  title: {
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
    fontWeight: "700",
  },
  rail: {
    alignItems: "center",
    gap: 12,
  },
  railButton: {
    alignItems: "center",
    minWidth: RAIL_BUTTON_SIZE,
    minHeight: RAIL_BUTTON_SIZE,
  },
  railCircle: {
    width: RAIL_BUTTON_SIZE,
    height: RAIL_BUTTON_SIZE,
    borderRadius: RAIL_BUTTON_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: hexToRgba(BLACK, 0.35),
  },
  railLabel: {
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
    fontWeight: "600",
    textAlign: "center",
    marginTop: 4,
    maxWidth: RAIL_LABEL_WIDTH,
  },
  bandBar: {
    flex: 1,
    overflow: "hidden",
  },
  bandFrame: {
    width: "100%",
  },
})
