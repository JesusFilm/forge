import { useEffect, useRef, useState } from "react"
import { useEvent } from "expo"
import {
  AppState,
  Image,
  type LayoutChangeEvent,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useVideoPlayer, VideoView } from "expo-video"

import type { VideoSection } from "../../lib/sectionModels"
import { useScrollOffset } from "./ScrollOffsetContext"

export interface VideoRendererProps {
  section: VideoSection
}

export function VideoRenderer({ section }: VideoRendererProps) {
  const { title, subtitle, streamingUrl, media, video } = section
  const thumbnailUrl = media?.url ?? video?.image?.url ?? null
  const thumbnailAlt =
    media?.alternativeText ?? video?.image?.alternativeText ?? title ?? "Video"

  const [hasStarted, setHasStarted] = useState(false)
  const [layoutY, setLayoutY] = useState<number | null>(null)
  const [layoutHeight, setLayoutHeight] = useState(0)
  const wasVisibleRef = useRef(false)

  const { scrollY, viewportHeight } = useScrollOffset()

  const player = useVideoPlayer(streamingUrl, (p) => {
    p.muted = true
    p.loop = true
  })

  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  })

  // Dismiss thumbnail when autoplay starts
  useEffect(() => {
    if (isPlaying && !hasStarted) {
      setHasStarted(true)
    }
  }, [isPlaying, hasStarted])

  // Visibility-based autoplay
  useEffect(() => {
    if (layoutY == null || viewportHeight === 0 || layoutHeight === 0) return

    const elementTop = layoutY - scrollY
    const elementBottom = elementTop + layoutHeight
    const visibleTop = Math.max(elementTop, 0)
    const visibleBottom = Math.min(elementBottom, viewportHeight)
    const visibleHeight = Math.max(0, visibleBottom - visibleTop)
    const isVisible = visibleHeight >= layoutHeight * 0.5

    if (isVisible && !wasVisibleRef.current) {
      player.play()
      wasVisibleRef.current = true
    } else if (!isVisible && wasVisibleRef.current) {
      player.pause()
      wasVisibleRef.current = false
    }
  }, [scrollY, viewportHeight, layoutY, layoutHeight, player])

  // Pause/resume on app background/foreground
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && wasVisibleRef.current) {
        player.play()
      } else if (nextState !== "active") {
        player.pause()
      }
    })
    return () => subscription.remove()
  }, [player])

  const handleLayout = (e: LayoutChangeEvent) => {
    setLayoutY(e.nativeEvent.layout.y)
    setLayoutHeight(e.nativeEvent.layout.height)
  }

  return (
    // @ts-expect-error React 19 vs RN component types
    <View style={styles.container} onLayout={handleLayout}>
      {/* @ts-expect-error React 19 vs RN component types */}
      <View style={styles.playerContainer}>
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          nativeControls
          allowsFullscreen
          allowsPictureInPicture
          contentFit="contain"
        />
        {!hasStarted && thumbnailUrl && (
          <>
            <Image
              source={{ uri: thumbnailUrl }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              accessibilityLabel={thumbnailAlt}
            />
            {/* @ts-expect-error React 19 vs RN component types */}
            <View style={styles.playButtonOverlay}>
              {/* @ts-expect-error RN Text vs React 19 ReactNode */}
              <Text style={styles.playIcon} accessibilityElementsHidden>
                ▶
              </Text>
            </View>
          </>
        )}
      </View>
      {title != null && (
        // @ts-expect-error RN Text vs React 19 ReactNode
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
      )}
      {subtitle != null && (
        // @ts-expect-error RN Text vs React 19 ReactNode
        <Text style={styles.subtitle} numberOfLines={2}>
          {subtitle}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
    paddingHorizontal: 16,
  },
  playerContainer: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#1c1917",
    justifyContent: "center",
    alignItems: "center",
  },
  playButtonOverlay: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  playIcon: {
    fontSize: 22,
    color: "#ffffff",
    marginLeft: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1a1a",
    marginTop: 12,
  },
  subtitle: {
    fontSize: 14,
    color: "#666666",
    marginTop: 4,
  },
})
