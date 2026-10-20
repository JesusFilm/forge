import {
  useCallback,
  useEffect,
  useMemo,
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
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import type { VideoPlayer } from "expo-video"

import { ClipDescription } from "./ClipDescription"
import { ClipProgressBar } from "./ClipProgressBar"
import { PausedGlyph } from "./PausedGlyph"
import { SubtitleOverlay } from "../watch/SubtitleOverlay"
import { GlassSurface } from "../ui/GlassSurface"
import { clipPosterUri } from "../../hooks/useClipAutostart"
import { useTextDirection } from "../../i18n/textDirection"
import { useT } from "../../i18n/useT"
import type { CaptionBox } from "../../lib/captionBox"
import { BLACK, TEXT_ON_OVERLAY, hexToRgba } from "../../lib/color"
import { EXPLORE_FAST_RATE } from "../../lib/explore/fastHold"
import { readSeconds } from "../../lib/explore/playerRead"
import { bandAspect, clipFraming } from "../../lib/explore/framing"
import { usePlayingSize } from "../../hooks/usePlayingSize"
import type { FeedClip } from "../../lib/explore/types"
import { canUseLiquidGlass } from "../../lib/liquidGlass"
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
  /** Shows the play glyph (R10). A tap on the glyph calls `onResume`; a tap
   *  anywhere else reaches the feed's own target. */
  paused: boolean
  onResume: () => void
  /** Shows the 2x cue: the viewer holds a side of the playing clip. */
  fast: boolean
  onToggleMute: () => void
  /** A scrub to an asset time. The feed players seek, so the load is no rebuffer. */
  onSeek: (seconds: number) => void
  /** The asset time the viewer reached, inside the clip window (R16). */
  onKeepWatching: (positionSeconds: number) => void
  /** The share sheet opened. The feed pauses the clip (R44). */
  onOverlayOpen: () => void
  /** The share sheet closed. The feed resumes only a clip that was playing. */
  onOverlayClose: () => void
  /** The band's region (KTD18), so the feed draws its video views in it. */
  onVideoRegion: (region: ExploreVideoRegion) => void
  /** The clip's poster veil shows, and it frames the poster by its own shape. */
  veiled: boolean
}

/** Insets from the page's top and bottom edges: safe area to clip title. */
export type ExploreVideoRegion = { top: number; bottom: number }

/**
 * 0.54 is the least black that holds white text at 4.5:1 over a pure-white
 * frame; 0.6 keeps a margin. Black reaches the floor sooner than the app ground.
 */
const SCRIM_COLOR = hexToRgba(BLACK, 0.6)
/** The fade above the title, so the scrim has no hard top edge. */
const SCRIM_RAMP_HEIGHT = 40
const RAIL_BUTTON_SIZE = 48
/** The glass that shows around the Keep watching thumbnail. */
const KEEP_WATCHING_RIM = 3
const CAPTION_GAP = 8
/** A portrait clip's captions sit this much higher over it (owner, 2026-09-28). */
const PORTRAIT_CAPTION_LIFT = 15
/** The 2x cue's space under the safe area. */
const FAST_CUE_GAP = 12

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
  onResume,
  fast,
  onToggleMute,
  onSeek,
  onKeepWatching,
  onOverlayOpen,
  onOverlayClose,
  onVideoRegion,
  veiled,
}: ClipOverlayProps) {
  const typography = useTypography()
  const t = useT("Explore")
  const titleDirection = useTextDirection().text(clip.titleLang)
  const tabBarClearance = useTabBarClearance()
  const safeTop = useSafeAreaInsets().top
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

  // The band sits centred from the safe area to the title, so it reads as
  // centred over the content below it (owner, 2026-09-27). "More" does not
  // move it: the region holds while the description is open.
  const [regionBottom, setRegionBottom] = useState(0)
  const bottomBox = useRef(0)
  const rowTop = useRef(0)
  const infoTop = useRef(0)
  const descriptionOpen = useRef(false)
  const updateRegion = useCallback(() => {
    if (descriptionOpen.current || bottomBox.current <= 0) return
    setRegionBottom(
      Math.round(bottomBox.current - rowTop.current - infoTop.current),
    )
  }, [])
  // "More" no longer pauses the clip (owner, 2026-09-27, changing R44): the
  // clip plays on, with its sound, while the description is open.
  const handleExpand = useCallback(() => {
    descriptionOpen.current = true
  }, [])
  const handleCollapse = useCallback(() => {
    descriptionOpen.current = false
  }, [])

  const handleBottomLayout = useCallback(
    (e: LayoutChangeEvent) => {
      bottomBox.current = Math.round(e.nativeEvent.layout.height)
      setBottomHeight(bottomBox.current)
      updateRegion()
    },
    [updateRegion],
  )

  // The scrim starts at the title, not at the taller rail, so the dark band
  // is only as high as the text it keeps readable. It follows an expansion.
  const [scrimTop, setScrimTop] = useState(0)
  const [rowWidth, setRowWidth] = useState(0)
  const [rowY, setRowY] = useState(0)
  const handleRowLayout = useCallback(
    (e: LayoutChangeEvent) => {
      rowTop.current = e.nativeEvent.layout.y
      setRowY(Math.round(rowTop.current))
      setRowWidth(Math.round(e.nativeEvent.layout.width))
      setScrimTop(Math.round(rowTop.current + infoTop.current))
      updateRegion()
    },
    [updateRegion],
  )
  const handleInfoLayout = useCallback(
    (e: LayoutChangeEvent) => {
      infoTop.current = e.nativeEvent.layout.y
      setScrimTop(Math.round(rowTop.current + infoTop.current))
      updateRegion()
    },
    [updateRegion],
  )

  // Captions sit just above the title, the scrim's top (owner, 2026-09-28), or
  // on the band frame's bottom edge when that is higher. Mute and Share reach
  // up beside them, so they narrow when they would cover either button.
  const [lowerBar, setLowerBar] = useState<number | null>(null)
  const [railLeft, setRailLeft] = useState<number | null>(null)
  const [railY, setRailY] = useState(0)
  const [railWidth, setRailWidth] = useState(0)
  const handleRailLayout = useCallback((e: LayoutChangeEvent) => {
    setRailLeft(Math.round(e.nativeEvent.layout.x))
    setRailY(Math.round(e.nativeEvent.layout.y))
    setRailWidth(Math.round(e.nativeEvent.layout.width))
  }, [])
  const [muteFrame, setMuteFrame] = useState<RailFrame | null>(null)
  const [shareFrame, setShareFrame] = useState<RailFrame | null>(null)
  const handleMuteLayout = useCallback((e: LayoutChangeEvent) => {
    setMuteFrame(railFrame(e))
  }, [])
  const handleShareLayout = useCallback((e: LayoutChangeEvent) => {
    setShareFrame(railFrame(e))
  }, [])
  const playingSize = usePlayingSize(player)
  const band = clipFraming(playingSize) === "band"
  const bandInset = lowerBar == null ? null : lowerBar + regionBottom
  const aboveTitle = bottomHeight - scrimTop
  const captionFloor = band
    ? Math.max(bandInset ?? 0, aboveTitle)
    : aboveTitle + PORTRAIT_CAPTION_LIFT
  const captionBottom = captionFloor + CAPTION_GAP
  // feat-695 R11: the rail mirrors to the left in a right-to-left layout. Its
  // measured x is physical there too, so the inset side is where it sits.
  const railOnLeft = railLeft != null && railLeft + railWidth / 2 < rowWidth / 2
  const captionSideInset =
    railLeft != null && rowWidth > 0
      ? railOnLeft
        ? railLeft + railWidth + CAPTION_GAP
        : rowWidth - railLeft + CAPTION_GAP
      : undefined
  // The inset applies only when the caption would cover Mute or Share (owner,
  // 2026-09-28). Until both are measured, it always applies.
  const captionInsetBoxes = useMemo(() => {
    if (railLeft == null || muteFrame == null || shareFrame == null) {
      return undefined
    }
    const toCaptionBox = (frame: RailFrame): CaptionBox => {
      const top = bottomHeight - (rowY + railY + frame.y)
      return {
        left: railLeft + frame.x,
        right: railLeft + frame.x + frame.width,
        bottom: top - frame.height,
        top,
      }
    }
    return [toCaptionBox(muteFrame), toCaptionBox(shareFrame)]
  }, [bottomHeight, rowY, railY, railLeft, muteFrame, shareFrame])

  // Reported for every clip: each feed view picks its own framing, and the
  // next clip may be landscape even when this one fills the screen.
  useEffect(() => {
    if (regionBottom > 0) onVideoRegion({ top: safeTop, bottom: regionBottom })
  }, [safeTop, regionBottom, onVideoRegion])
  const regionStyle =
    band && regionBottom > 0 ? { top: safeTop, bottom: regionBottom } : null

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Unmeasured, the band would centre on the wrong region. Veiled, it
          still lays out for the captions, but its bars would cut the poster. */}
      {regionStyle != null && (
        <ClipBandBackdrop
          aspect={bandAspect(playingSize)}
          regionTop={safeTop}
          regionBottom={regionBottom}
          hidden={veiled}
          onLowerBarHeight={setLowerBar}
        />
      )}

      <PausedGlyph paused={paused} style={regionStyle} onPress={onResume} />

      {fast && (
        <View
          testID="clip-fast-cue"
          style={[styles.fastCue, { top: safeTop + FAST_CUE_GAP }]}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <View style={styles.fastPill}>
            <Text style={[styles.fastLabel, typography.bodySmall]}>
              {`${EXPLORE_FAST_RATE}×`}
            </Text>
            <Ionicons name="play-forward" size={16} color={TEXT_ON_OVERLAY} />
          </View>
        </View>
      )}

      {captionSrc != null && (
        <SubtitleOverlay
          player={player}
          vttSrc={captionSrc}
          bottomOffset={captionBottom}
          sideInset={captionSideInset}
          insetSide={railOnLeft ? "left" : "right"}
          sideInsetBoxes={captionInsetBoxes}
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
              style={[
                styles.title,
                typography.titleSmall,
                titleDirection.style,
              ]}
              numberOfLines={2}
              accessibilityRole="header"
              accessibilityLanguage={titleDirection.accessibilityLanguage}
            >
              {clip.title}
            </Text>
            <ClipDescription
              description={clip.description}
              descriptionLang={clip.descriptionLang}
              onExpand={handleExpand}
              onCollapse={handleCollapse}
            />
          </View>

          <View
            testID="clip-overlay-rail"
            style={styles.rail}
            onLayout={handleRailLayout}
          >
            <RailButton
              testID="clip-rail-mute"
              icon={muted ? "volume-mute" : "volume-high"}
              label={muted ? t("unmute") : t("mute")}
              actionName={muted ? "explore-unmute" : "explore-mute"}
              onPress={onToggleMute}
              onLayout={handleMuteLayout}
            />
            <RailButton
              testID="clip-rail-share"
              icon="share-outline"
              label={t("share")}
              actionName="explore-share"
              onPress={handleShare}
              onLayout={handleShareLayout}
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
          veiled={veiled}
        />
      </View>
    </View>
  )
}

/** A rail button's frame, in the rail. */
type RailFrame = { x: number; y: number; width: number; height: number }

function railFrame(e: LayoutChangeEvent): RailFrame {
  const { x, y, width, height } = e.nativeEvent.layout
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  }
}

type RailButtonProps = {
  testID: string
  icon: ComponentProps<typeof Ionicons>["name"]
  label: string
  /** The RUM tap name, fixed in every language (KTD15). */
  actionName: string
  onPress: () => void
  onLayout: (e: LayoutChangeEvent) => void
}

/** A round button. Its label is for screen readers only (owner, 2026-10-19),
 *  as Keep watching's already was. */
function RailButton({
  testID,
  icon,
  label,
  actionName,
  onPress,
  onLayout,
}: RailButtonProps) {
  const glass = canUseLiquidGlass()
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onLayout={onLayout}
      style={({ pressed }) => railButtonStyle(glass, pressed)}
      accessibilityRole="button"
      accessibilityLabel={label}
      {...{ "dd-action-name": actionName }}
    >
      <GlassSurface
        style={styles.railCircle}
        fallback={{ kind: "fill", style: styles.railFill }}
        interactive
      >
        <Ionicons name={icon} size={24} color={TEXT_ON_OVERLAY} />
      </GlassSurface>
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
  const t = useT("Explore")
  const glass = canUseLiquidGlass()
  return (
    <Pressable
      testID="clip-rail-keep-watching"
      onPress={onPress}
      style={({ pressed }) => railButtonStyle(glass, pressed)}
      accessibilityRole="button"
      accessibilityLabel={t("keepWatchingAriaLabel")}
      accessibilityHint={t("keepWatchingAriaHint")}
      {...{ "dd-action-name": "explore-keep-watching" }}
    >
      <GlassSurface
        style={styles.railCircle}
        fallback={{ kind: "fill", style: styles.railFill }}
        interactive
      >
        <View
          testID="clip-keep-watching-circle"
          style={[styles.thumbCircle, glass && styles.thumbInRim]}
        >
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
      </GlassSurface>
    </Pressable>
  )
}

/** On glass the circle takes Apple's press response instead: an opacity below
 *  1 stops the glass. */
function railButtonStyle(glass: boolean, pressed: boolean) {
  return [styles.railButton, !glass && pressed && feedback.pressed]
}

/**
 * KTD18's band: the video shows whole (`contain`) in a centred band, with
 * solid black above and below it (owner, 2026-09-27).
 */
function ClipBandBackdrop({
  aspect,
  regionTop,
  regionBottom,
  hidden,
  onLowerBarHeight,
}: {
  /** The playing track's width over height. */
  aspect: number
  /** The region's insets from the page's top and bottom edges. */
  regionTop: number
  regionBottom: number
  /** Draws nothing, but keeps its layout and still reports the lower bar. */
  hidden: boolean
  /** From the frame's bottom edge to the region's. */
  onLowerBarHeight: (height: number) => void
}) {
  return (
    <View
      testID="clip-band-backdrop"
      style={[StyleSheet.absoluteFill, hidden && styles.bandHidden]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={[styles.bandEdge, { height: regionTop }]} />
      <View testID="clip-band-region" style={styles.bandRegion}>
        <View testID="clip-band-bar" style={styles.bandBar} />
        <View
          testID="clip-band-frame"
          style={[styles.bandFrame, { aspectRatio: aspect }]}
        />
        <View
          testID="clip-band-bar"
          style={styles.bandBar}
          onLayout={(e) =>
            onLowerBarHeight(Math.round(e.nativeEvent.layout.height))
          }
        />
      </View>
      <View style={[styles.bandEdge, { height: regionBottom }]} />
    </View>
  )
}

const styles = StyleSheet.create({
  // A playback cue: the glyph points forward in every layout (feat-695 R12).
  fastCue: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    direction: "ltr",
  },
  fastPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: hexToRgba(BLACK, 0.45),
  },
  fastLabel: {
    color: TEXT_ON_OVERLAY,
    fontWeight: "700",
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
  // Without rail labels the circles' edge lines up with the progress bar's.
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 16,
    gap: 8,
  },
  info: {
    flex: 1,
    gap: 2,
    paddingBottom: 4,
  },
  title: {
    color: TEXT_ON_OVERLAY,
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
  },
  // Behind the Keep watching thumbnail, it shows only while the image loads,
  // or when a clip has none.
  railFill: {
    backgroundColor: hexToRgba(BLACK, 0.35),
  },
  thumbCircle: {
    width: RAIL_BUTTON_SIZE,
    height: RAIL_BUTTON_SIZE,
    borderRadius: RAIL_BUTTON_SIZE / 2,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbInRim: {
    width: RAIL_BUTTON_SIZE - 2 * KEEP_WATCHING_RIM,
    height: RAIL_BUTTON_SIZE - 2 * KEEP_WATCHING_RIM,
    borderRadius: RAIL_BUTTON_SIZE / 2 - KEEP_WATCHING_RIM,
  },
  // Keeps the white glyph visible over a very light thumbnail.
  playShadow: {
    textShadowColor: hexToRgba(BLACK, 0.6),
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  bandEdge: {
    backgroundColor: BLACK,
  },
  bandHidden: {
    opacity: 0,
  },
  bandRegion: {
    flex: 1,
  },
  bandBar: {
    flex: 1,
    backgroundColor: BLACK,
  },
  // A frame taller than the region (a portrait clip) fits its height instead.
  bandFrame: {
    width: "100%",
    maxHeight: "100%",
  },
})
