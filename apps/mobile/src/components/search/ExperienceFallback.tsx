import { LinearGradient } from "expo-linear-gradient"
import { StyleSheet, Text, View } from "react-native"

import {
  buildStripeGradient,
  experienceGradientForSlug,
} from "./experienceGradient"

// Stripe geometry is size-independent (fractional stops) — build it once.
const STRIPES = buildStripeGradient(10)
const GLOW = ["rgba(255,255,255,0.16)", "rgba(255,255,255,0)"] as const

type Props = {
  slug: string
  title: string
}

/**
 * Gradient placeholder for a thumbnail-less Experience result — ports apps/web's
 * VideoCard fallback (per-slug diagonal gradient + glow + stripes + centered
 * title; see experienceGradient.ts). Card scrim + bottom text still layer above.
 */
export function ExperienceFallback({ slug, title }: Props) {
  const palette = experienceGradientForSlug(slug)
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient
        colors={palette}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={GLOW}
        start={{ x: 0.15, y: 0.1 }}
        end={{ x: 0.8, y: 0.8 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={STRIPES.colors}
        locations={STRIPES.locations}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.center}>
        <Text style={styles.title} numberOfLines={3}>
          {title}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    // Leave room for the card's bottom title/snippet overlay.
    paddingBottom: 44,
  },
  title: {
    color: "rgba(255,255,255,0.9)",
    fontFamily: "System",
    fontWeight: "700",
    fontSize: 20,
    lineHeight: 24,
    textAlign: "center",
  },
})
