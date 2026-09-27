import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react"
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
import { clipPosterUri } from "../../hooks/useClipAutostart"
import { BLACK, TEXT_ON_OVERLAY, hexToRgba } from "../../lib/color"
import { EXPLORE_COPY } from "../../lib/explore/copy"
import { readSeconds } from "../../lib/explore/playerRead"
import { EXPLORE_FRAMING, bandAspect } from "../../lib/explore/framing"
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
/** The fade above the title, so the scrim has no hard top edge. */
const SCRIM_RAMP_HEIGHT = 40
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

  // The scrim starts at the title, not at the taller rail, so the dark band
  // is only as high as the text it keeps readable. It follows an expansion.
  const [scrimTop, setScrimTop] = useState(0)
  const [rowWidth, setRowWidth] = useState(0)
  const rowTop = useRef(0)
  const infoTop = useRef(0)
  const handleRowLayout = useCallback((e: LayoutChangeEvent) => {
    rowTop.current = e.nativeEvent.layout.y
    setRowWidth(Math.round(e.nativeEvent.layout.width))
    setScrimTop(Math.round(rowTop.current + infoTop.current))
  }, [])
  const handleInfoLayout = useCallback((e: LayoutChangeEvent) => {
    infoTop.current = e.nativeEvent.layout.y
    setScrimTop(Math.round(rowTop.current + infoTop.current))
  }, [])

  // In the band, captions sit on the frame's bottom edge, not above the whole
  // bottom block; they never go below the title, and they keep clear of the
  // rail, which reaches up into the frame on a phone.
  const [bandInset, setBandInset] = useState<number | null>(null)
  const [railLeft, setRailLeft] = useState<number | null>(null)
  const handleRailLayout = useCallback((e: LayoutChangeEvent) => {
    setRailLeft(Math.round(e.nativeEvent.layout.x))
  }, [])
  const band = EXPLORE_FRAMING === "band"
  const captionBottom =
    band && bandInset != null
      ? Math.max(bandInset, bottomHeight - scrimTop) + CAPTION_GAP
      : bottomHeight + CAPTION_GAP
  const captionRightInset =
    band && railLeft != null && rowWidth > 0
      ? rowWidth - railLeft + CAPTION_GAP
      : undefined

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {band && (
        <ClipBandBackdrop player={player} onFrameBottomInset={setBandInset} />
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
          bottomOffset={captionBottom}
          rightInset={captionRightInset}
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
          style={[StyleSheet.absoluteFill, { top: scrimTop }]}
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
          onLayout={handleRowLayout}
        >
          <View
            testID="clip-overlay-info"
            style={styles.info}
            onLayout={handleInfoLayout}
          >
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

          <View
            testID="clip-overlay-rail"
            style={styles.rail}
            onLayout={handleRailLayout}
          >
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
            <KeepWatchingButton
              posterUri={clipPosterUri(clip)}
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
}

/** A round button with its label under it. The whole stack is the target. */
function RailButton({ icon, label, onPress }: RailButtonProps) {
  const typography = useTypography()
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.railButton, pressed && feedback.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.railCircle}>
        <Ionicons name={icon} size={24} color={TEXT_ON_OVERLAY} />
      </View>
      <Text style={[styles.railLabel, typography.caption]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  )
}

/**
 * R16, lowest in the rail: the clip's own thumbnail in a circle, with a play
 * glyph. No visible label (owner, 2026-09-27); a screen reader still reads one.
 */
function KeepWatchingButton({
  posterUri,
  onPress,
}: {
  posterUri: string | null
  onPress: () => void
}) {
  return (
    <Pressable
      testID="clip-rail-keep-watching"
      onPress={onPress}
      style={({ pressed }) => [styles.railButton, pressed && feedback.pressed]}
      accessibilityRole="button"
      accessibilityLabel={EXPLORE_COPY.keepWatching}
      accessibilityHint={EXPLORE_COPY.keepWatchingHint}
    >
      <View testID="clip-keep-watching-circle" style={styles.thumbCircle}>
        {posterUri != null && (
          <Image
            source={posterUri}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            recyclingKey={posterUri}
          />
        )}
        <Ionicons
          name="play"
          size={24}
          color={TEXT_ON_OVERLAY}
          style={styles.playShadow}
        />
      </View>
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
 * KTD18's band: the video shows whole (`contain`) in a centred band, with
 * solid black above and below it (owner, 2026-09-27).
 */
function ClipBandBackdrop({
  player,
  onFrameBottomInset,
}: {
  player: VideoPlayer
  /** The lower bar's height: from the frame's bottom edge to the screen's. */
  onFrameBottomInset: (inset: number) => void
}) {
  const aspect = bandAspect(usePlayingSize(player))
  return (
    <View
      testID="clip-band-backdrop"
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View testID="clip-band-bar" style={styles.bandBar} />
      <View
        testID="clip-band-frame"
        style={[styles.bandFrame, { aspectRatio: aspect }]}
      />
      <View
        testID="clip-band-bar"
        style={styles.bandBar}
        onLayout={(e) =>
          onFrameBottomInset(Math.round(e.nativeEvent.layout.height))
        }
      />
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
  thumbCircle: {
    width: RAIL_BUTTON_SIZE,
    height: RAIL_BUTTON_SIZE,
    borderRadius: RAIL_BUTTON_SIZE / 2,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    // Shows only while the thumbnail loads, or when a clip has none.
    backgroundColor: hexToRgba(BLACK, 0.35),
  },
  // Keeps the white glyph visible over a very light thumbnail.
  playShadow: {
    textShadowColor: hexToRgba(BLACK, 0.6),
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
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
    backgroundColor: BLACK,
  },
  bandFrame: {
    width: "100%",
  },
})
