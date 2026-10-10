import { LinearGradient } from "expo-linear-gradient"
import { StyleSheet, View } from "react-native"

import {
  buildStripeGradient,
  experienceGradientForSlug,
} from "./experienceGradient"

// Stripe geometry is size-independent (fractional stops) — build it once.
const STRIPES = buildStripeGradient(10)
const GLOW = ["rgba(255,255,255,0.16)", "rgba(255,255,255,0)"] as const

type Props = {
  slug: string
}

/**
 * Gradient placeholder for a thumbnail-less Experience result — ports apps/web's
 * VideoCard fallback (per-slug diagonal gradient + glow + stripes; see
 * experienceGradient.ts). Art ONLY: the card draws the title below the
 * thumbnail, so a title here would render it twice.
 */
export function ExperienceFallback({ slug }: Props) {
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
    </View>
  )
}
