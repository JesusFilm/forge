import { useCallback, useEffect, useRef, useState } from "react"
import { useEvent } from "expo"
import {
  AppState,
  Dimensions,
  Image,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useVideoPlayer, VideoView } from "expo-video"

import { useScrollY } from "../../contexts/ScrollOffsetContext"
import type { VideoSection } from "../../lib/sectionModels"

export interface VideoRendererProps {
  section: VideoSection
}

export function VideoRenderer({ section }: VideoRendererProps) {
  const { title, subtitle, streamingUrl, media, video } = section
  const thumbnailUrl = media?.url ?? video?.image?.url ?? null
  const thumbnailAlt =
    media?.alternativeText ?? video?.image?.alternativeText ?? title ?? "Video"

  const [hasStarted, setHasStarted] = useState(false)

  const player = useVideoPlayer(streamingUrl, (p) => {
    p.muted = true
    p.loop = true
    p.play()
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

  // Track component position for scroll-aware visibility
  const containerRef = useRef<View>(null)
  const isVisibleRef = useRef(false)
  const appActiveRef = useRef(true)
  const viewportHeight = Dimensions.get("window").height

  // Measure absolute position after layout and auto-play if visible
  const onLayout = useCallback(() => {
    containerRef.current?.measureInWindow((_x, windowY, _w, h) => {
      const visible = windowY + h > 0 && windowY < viewportHeight
      isVisibleRef.current = visible
      if (visible && appActiveRef.current) {
        player.play()
      }
    })
  }, [player, viewportHeight])

  // Scroll-aware pause/resume
  useScrollY(
    useCallback(
      (_scrollY: number) => {
        containerRef.current?.measureInWindow((_x, windowY, _w, h) => {
          const visible = windowY + h > 0 && windowY < viewportHeight
          if (visible !== isVisibleRef.current) {
            isVisibleRef.current = visible
            if (visible && appActiveRef.current) {
              player.play()
            } else if (!visible) {
              player.pause()
            }
          }
        })
      },
      [player, viewportHeight],
    ),
  )

  // Pause/resume on app background/foreground
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      appActiveRef.current = nextState === "active"
      if (appActiveRef.current && isVisibleRef.current) {
        player.play()
      } else {
        player.pause()
      }
    })
    return () => subscription.remove()
  }, [player])

  return (
    // @ts-expect-error React 19 vs RN component types
    <View ref={containerRef} style={styles.container} onLayout={onLayout}>
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
