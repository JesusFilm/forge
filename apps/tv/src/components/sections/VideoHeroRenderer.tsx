import { useCallback, useState } from "react"
import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native"
import { useFocusEffect } from "expo-router"

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
  // Screen-focus gate (R15): false on forward-nav/Back. The stacked screen stays
  // mounted, so nav-away must release the decode slot (folded into overlayVisible
  // below), not just pause. useFocusEffect + local state make it reactive.
  const [isFocused, setIsFocused] = useState(true)
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true)
      return () => setIsFocused(false)
    }, []),
  )
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
      {/* Cinematic backdrop autoplaying WITH SOUND (R9). overlayVisible releases
          the decode slot on overlay-open (R11) or nav-away (so a pushed screen
          isn't starved); active gates the scroll-off pause (R10). */}
      <VideoBackdrop
        streamingUrl={hasValidStream ? streamingUrl : null}
        posterUrl={posterUrl}
        overlayVisible={playerState.isVisible || !isFocused}
        bottomFadeColor={WATCH_THEME.below}
        muted={false}
        active={heroOnScreen}
      />

      {/* Silent-focus target: as the topmost focusable it takes initial focus so
          the hero owns the first paint (no on-mount scroll) and catches D-pad UP.
          Not a play surface (noop press, no ring); the video opens via a rail card. */}
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
