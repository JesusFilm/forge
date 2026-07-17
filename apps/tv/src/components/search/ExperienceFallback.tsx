import { LinearGradient } from "expo-linear-gradient"
import { StyleSheet, Text, View } from "react-native"

import { scale } from "../../lib/scale"
import {
  buildStripeGradient,
  experienceGradientForSlug,
} from "./experienceGradient"
import { SEARCH_THEME } from "./searchTheme"

// Stripe geometry is size-independent (fractional stops) — build it once.
const STRIPES = buildStripeGradient(18)
const GLOW = ["rgba(255,255,255,0.16)", "rgba(255,255,255,0)"] as const

type Props = {
  slug: string
  title: string
}

/**
 * Gradient placeholder for a thumbnail-less Experience result — ports apps/web's
 * VideoCard fallback (per-slug diagonal gradient + glow + stripes + centered
 * title; see experienceGradient.ts). The card renders its own title/kind below.
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
    paddingHorizontal: scale(24),
  },
  title: {
    fontFamily: "System",
    fontSize: Math.round(scale(34)),
    fontWeight: "700",
    letterSpacing: scale(-0.5),
    textAlign: "center",
    color: SEARCH_THEME.textDim(0.9),
  },
})
