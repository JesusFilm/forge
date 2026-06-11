// The Home screen's Focus-Driven Showcase — a purely presentational canvas
// painting whichever rail card the showcase reducer last committed (R10/R11).
//
// NON-INTERACTIVE by design: no Pressable, focusable={false},
// pointerEvents="none" — the rails below own 100% of Home's focus
// (tv-focus-driven-hero-patterns-20260420.md). Image-only, no VideoView:
// tvOS decode slots are scarce and even a paused background VideoView holds
// one (KTD: dwell-to-preview stays deferred).

import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { Dimensions, StyleSheet, Text, View } from "react-native"

import { COLORS, hexToRgba } from "../../lib/colors"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { scale } from "../../lib/scale"
import type { WatchHomeCard } from "../../lib/watchHome/model"

/**
 * 0.62 of the window: tall enough for cinematic artwork, short enough that
 * the first rail's header and card tops peek above the fold beneath the
 * sticky home header — the scroll affordance.
 */
export const SHOWCASE_HEIGHT_RATIO = 0.62

const SHOWCASE_HEIGHT = Math.round(
  Dimensions.get("window").height * SHOWCASE_HEIGHT_RATIO,
)

/** Crossfade between artworks as focus moves across cards. */
const IMAGE_TRANSITION_MS = 250

type ShowcaseCanvasProps = {
  /** Null while the model loads — renders the background color only. */
  card: WatchHomeCard | null
}

export function ShowcaseCanvas({ card }: ShowcaseCanvasProps) {
  // CMS-sourced URL is untrusted — sanitize before it reaches expo-image
  // (same gate as EpisodeRail's poster).
  const imageUrl =
    card?.imageUrl != null ? resolveImageUrl(card.imageUrl) : null

  return (
    <View style={styles.canvas} focusable={false} pointerEvents="none">
      {card != null ? (
        <>
          {imageUrl != null ? (
            <Image
              source={{ uri: imageUrl }}
              // backgroundColor doubles as the loading placeholder — the
              // surface-container tone paints until the artwork decodes.
              style={[StyleSheet.absoluteFill, styles.artwork]}
              contentFit="cover"
              transition={IMAGE_TRANSITION_MS}
              accessibilityLabel={card.imageAlt}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.artworkFallback]} />
          )}

          {/* Bottom + left scrims so the copy block reads over artwork. One
              gradient per layer; hexToRgba (never "transparent") to avoid
              dark banding. collapsable={false} keeps them discrete native
              views on Android TV. */}
          <LinearGradient
            colors={[
              hexToRgba(COLORS.surface, 0.96),
              hexToRgba(COLORS.surface, 0.45),
              hexToRgba(COLORS.surface, 0),
            ]}
            locations={[0, 0.3, 0.62]}
            start={{ x: 0.5, y: 1 }}
            end={{ x: 0.5, y: 0 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
            collapsable={false}
          />
          <LinearGradient
            colors={[
              hexToRgba(COLORS.surface, 0.88),
              hexToRgba(COLORS.surface, 0.4),
              hexToRgba(COLORS.surface, 0),
            ]}
            locations={[0, 0.32, 0.6]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
            collapsable={false}
          />

          <View style={styles.copy} pointerEvents="none" collapsable={false}>
            <Text style={styles.eyebrow} numberOfLines={1}>
              {card.label}
            </Text>
            <Text style={styles.title} numberOfLines={2}>
              {card.title}
            </Text>
            {card.description != null ? (
              <Text style={styles.description} numberOfLines={3}>
                {card.description}
              </Text>
            ) : null}
            {card.metaLabel != null ? (
              <Text style={styles.meta} numberOfLines={1}>
                {card.metaLabel}
              </Text>
            ) : null}
          </View>
        </>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  canvas: {
    height: SHOWCASE_HEIGHT,
    backgroundColor: COLORS.surface,
    overflow: "hidden",
  },
  artwork: {
    backgroundColor: COLORS.surfaceContainer,
  },
  artworkFallback: {
    backgroundColor: COLORS.surfaceContainer,
  },
  // Absolute positioning is fine here — nothing in the showcase is focusable.
  copy: {
    position: "absolute",
    left: scale(80),
    bottom: scale(48),
    maxWidth: scale(900),
  },
  eyebrow: {
    fontFamily: "System",
    fontSize: Math.round(scale(20)),
    fontWeight: "700",
    letterSpacing: scale(2),
    textTransform: "uppercase",
    color: COLORS.primary,
    marginBottom: scale(12),
  },
  title: {
    fontFamily: "System",
    fontSize: Math.round(scale(58)),
    fontWeight: "700",
    letterSpacing: -scale(0.8),
    color: COLORS.text,
  },
  description: {
    fontFamily: "System",
    fontSize: Math.round(scale(24)),
    lineHeight: Math.round(scale(34)),
    color: COLORS.muted,
    marginTop: scale(14),
  },
  meta: {
    fontFamily: "System",
    fontSize: Math.round(scale(20)),
    fontWeight: "600",
    color: COLORS.muted,
    marginTop: scale(14),
  },
})
