import { useEffect, useRef } from "react"
import { Animated, Pressable, StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"

import type { SearchResult } from "../../lib/queries"
import { BLACK, SURFACE_COLOR, TEXT_BODY, hexToRgba } from "../../lib/color"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { ExperienceFallback } from "./ExperienceFallback"

type SearchResultCardProps = {
  result: SearchResult
  index?: number
  onSelect: (result: SearchResult) => void
  /** Fired on touch-down to warm the detail query before navigation. */
  onPressIn?: (result: SearchResult) => void
}

export function SearchResultCard({
  result,
  index = 0,
  onSelect,
  onPressIn,
}: SearchResultCardProps) {
  const validatedImageUrl = resolveImageUrl(result.imageUrl)
  const opacity = useRef(new Animated.Value(0)).current
  const scale = useRef(new Animated.Value(0.92)).current

  useEffect(() => {
    const delay = index * 60
    const anim = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 280,
        delay,
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        delay,
        useNativeDriver: true,
        tension: 80,
        friction: 9,
      }),
    ])
    anim.start()
    return () => anim.stop()
  }, [opacity, scale, index])

  return (
    <Animated.View
      style={[styles.cardOuter, { opacity, transform: [{ scale }] }]}
    >
      <Pressable
        onPress={() => onSelect(result)}
        onPressIn={onPressIn ? () => onPressIn(result) : undefined}
        accessibilityRole="button"
        accessibilityLabel={`${result.title}: ${result.snippet}`}
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      >
        <View style={styles.thumbnailContainer}>
          {validatedImageUrl ? (
            <Image
              source={validatedImageUrl}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              recyclingKey={`search-${result.id}`}
            />
          ) : result.type === "EXPERIENCE" ? (
            <ExperienceFallback slug={result.slug} title={result.title} />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
              <Text style={styles.placeholderIcon}>▶</Text>
            </View>
          )}

          <LinearGradient
            colors={[hexToRgba(BLACK, 0), "rgba(0,0,0,0.25)", BLACK]}
            locations={[0, 0.5, 1]}
            style={StyleSheet.absoluteFill}
          />

          <View style={styles.textOverlay}>
            <Text style={styles.title} numberOfLines={2}>
              {result.title}
            </Text>
            {result.snippet ? (
              <Text style={styles.snippet} numberOfLines={2}>
                {result.snippet}
              </Text>
            ) : null}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  cardOuter: {
    flex: 1,
    margin: 6,
  },
  card: {
    borderRadius: 16,
    overflow: "hidden",
  },
  cardPressed: {
    opacity: 0.85,
  },
  thumbnailContainer: {
    aspectRatio: 4 / 3,
    width: "100%",
    backgroundColor: SURFACE_COLOR,
  },
  placeholder: {
    backgroundColor: SURFACE_COLOR,
    justifyContent: "center",
    alignItems: "center",
  },
  placeholderIcon: {
    fontSize: 32,
    color: "rgba(255,255,255,0.3)",
  },
  textOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 12,
    gap: 4,
  },
  title: {
    color: "#ffffff",
    fontFamily: "System",
    fontWeight: "700",
    fontSize: 14,
    lineHeight: 18,
  },
  snippet: {
    color: TEXT_BODY,
    fontFamily: "System",
    fontSize: 12,
    lineHeight: 16,
  },
})
