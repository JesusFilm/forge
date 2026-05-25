import { useEffect, useRef } from "react"
import { Animated, Pressable, StyleSheet, Text } from "react-native"
import { Image } from "expo-image"
import Ionicons from "@expo/vector-icons/Ionicons"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { SURFACE_COLOR, TEXT_ON_OVERLAY, TEXT_PRIMARY } from "../../lib/color"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { useTypography } from "../../hooks/useTypography"
import { HORIZONTAL_PADDING } from "../../styles/shared"

type MiniPlayerBarProps = {
  visible: boolean
  posterUrl: string | null
  title: string | null
  isPlaying: boolean
  onPlayPause: () => void
  onPress: () => void
}

export function MiniPlayerBar({
  visible,
  posterUrl,
  title,
  isPlaying,
  onPlayPause,
  onPress,
}: MiniPlayerBarProps) {
  const insets = useSafeAreaInsets()
  const typography = useTypography()
  const resolvedPoster = resolveImageUrl(posterUrl)

  const opacity = useRef(new Animated.Value(0)).current
  const translateY = useRef(new Animated.Value(60)).current

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: visible ? 1 : 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: visible ? 0 : 60,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start()
  }, [visible, opacity, translateY])

  if (!visible) return null

  return (
    <Animated.View
      style={[
        styles.container,
        { bottom: insets.bottom + 8, opacity, transform: [{ translateY }] },
      ]}
    >
      <Pressable
        style={styles.bar}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Return to ${title ?? "video"}`}
      >
        {resolvedPoster != null && (
          <Image
            source={resolvedPoster}
            style={styles.thumbnail}
            contentFit="cover"
            recyclingKey="mini-player-thumb"
          />
        )}
        <Text style={[styles.title, typography.bodySmall]} numberOfLines={1}>
          {title ?? "Now Playing"}
        </Text>
        <Pressable
          onPress={onPlayPause}
          style={styles.playButton}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? "Pause" : "Play"}
          hitSlop={8}
        >
          <Ionicons
            name={isPlaying ? "pause" : "play"}
            size={20}
            color={TEXT_ON_OVERLAY}
          />
        </Pressable>
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: HORIZONTAL_PADDING,
    right: HORIZONTAL_PADDING,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: SURFACE_COLOR,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  thumbnail: {
    width: 40,
    height: 40,
    borderRadius: 6,
  },
  title: {
    flex: 1,
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "600",
  },
  playButton: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },
})
