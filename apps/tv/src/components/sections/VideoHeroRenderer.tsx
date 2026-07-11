import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native"

import type { NormalizedBlock } from "../../lib/normalizer"
import { scale } from "../../lib/scale"
import { getMuxThumbnailUrl } from "../../lib/resolveImageUrl"
import { useVideoPlayerContext } from "../../contexts/VideoPlayerContext"
import { validateStreamingUrl } from "../../lib/validateUrl"
import { VideoBackdrop } from "../watch/VideoBackdrop"
import { HERO_PEEK, WATCH_THEME } from "../watch/watchDetailTheme"
import { useHeroOnScreen } from "./heroVisibility"

// ── Constants ────────────────────────────────────────────────────────────────

const { height: SCREEN_HEIGHT } = Dimensions.get("window")
// Full-bleed hero that stops short by HERO_PEEK so the next rail peeks above the
// fold — mirrors the Video Details hero (was 0.55 * height).
const HERO_HEIGHT = SCREEN_HEIGHT - HERO_PEEK

/** Used by the silent-focus Pressable below — see its inline comment. */
const noop = () => {}

// ── Types ────────────────────────────────────────────────────────────────────

export type VideoHeroRendererProps = {
  section: NormalizedBlock
}

// ── Component ────────────────────────────────────────────────────────────────

export function VideoHeroRenderer({ section }: VideoHeroRendererProps) {
  const { state: playerState } = useVideoPlayerContext()
  // Pauses the hero when it scrolls substantially off-screen (R10).
  const heroOnScreen = useHeroOnScreen()
  const heading = section.heading as string | null
  const subheading = section.subheading as string | null
  const streamingUrl = section.streamingUrl as string | null | undefined

  const hasValidStream =
    typeof streamingUrl === "string" && validateStreamingUrl(streamingUrl)
  // The VideoHeroBlock fragment carries no image field, so the poster is always
  // derived from the Mux stream (null when there is no usable stream).
  const posterUrl = getMuxThumbnailUrl(streamingUrl) ?? null

  return (
    <View style={styles.container}>
      {/* Cinematic backdrop: poster-hold → video crossfade, manual loop, and the
          decode-slot unmount while a fullscreen overlay is open (R11). Autoplays
          WITH SOUND (muted={false}) — a deliberate Apple-TV-style divergence from
          the muted siblings (R9). Its own scrims darken the lower-left. */}
      <VideoBackdrop
        streamingUrl={hasValidStream ? streamingUrl : null}
        posterUrl={posterUrl}
        overlayVisible={playerState.isVisible}
        bottomFadeColor={WATCH_THEME.below}
        muted={false}
        active={heroOnScreen}
      />

      {/* Silent-focus target: full-bleed invisible Pressable. As the topmost
          focusable it takes initial focus so the hero owns the first paint (no
          on-mount scroll pushing it off), and it catches D-pad UP to reveal the
          hero. NOT a play surface — noop press, no visible ring; the featured
          video is opened via a rail card (KTD7). android_ripple={null} kills the
          Android TV ripple. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        accessibilityLabel={heading ?? "Video hero"}
        onPress={noop}
        android_ripple={null}
      />

      {/* Text overlay */}
      <View style={styles.textContainer} pointerEvents="none">
        {heading != null && (
          <Text style={styles.title} numberOfLines={2}>
            {heading}
          </Text>
        )}
        {subheading != null && (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subheading}
          </Text>
        )}
      </View>
    </View>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    width: "100%",
    height: HERO_HEIGHT,
    overflow: "hidden",
  },
  textContainer: {
    position: "absolute",
    bottom: scale(48),
    left: scale(80),
    right: scale(80),
  },
  title: {
    fontFamily: "System",
    fontSize: Math.round(scale(78)),
    fontWeight: "800",
    color: WATCH_THEME.text,
    letterSpacing: -1,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 12,
  },
  subtitle: {
    fontFamily: "System",
    fontSize: Math.round(scale(24)),
    fontWeight: "400",
    color: WATCH_THEME.text82,
    marginTop: scale(8),
  },
})
