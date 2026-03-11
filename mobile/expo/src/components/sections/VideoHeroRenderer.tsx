import { useCallback, useEffect, useRef, useState } from "react"
import { useEvent } from "expo"
import {
  AppState,
  Dimensions,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useVideoPlayer, VideoView } from "expo-video"

import { useScrollY } from "../../contexts/ScrollOffsetContext"
import type { VideoHeroSection } from "../../lib/sectionModels"
import { useNavigateLink } from "../../lib/useNavigateLink"

export interface VideoHeroRendererProps {
  section: VideoHeroSection
}

export function VideoHeroRenderer({ section }: VideoHeroRendererProps) {
  const { heading, subheading, ctaLabel, ctaLink, streamingUrl, video } =
    section
  const thumbnailUrl = video.image?.url ?? null
  const trimmedCtaLabel = ctaLabel?.trim() || null
  const trimmedCtaLink = ctaLink?.trim() || null
  const hasCta = trimmedCtaLabel != null && trimmedCtaLink != null

  const [hasStarted, setHasStarted] = useState(false)
  const onNavigate = useNavigateLink()
  const [isMuted, setIsMuted] = useState(true)
  const hasUnmutedOnce = useRef(false)

  const player = useVideoPlayer(streamingUrl ?? null, (p) => {
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
  const layoutRef = useRef({ y: 0, height: 0 })
  const isVisibleRef = useRef(true)
  const appActiveRef = useRef(true)
  const viewportHeight = Dimensions.get("window").height

  // Measure absolute position after layout
  const onLayout = useCallback(() => {
    containerRef.current?.measureInWindow((_x, y, _w, height) => {
      layoutRef.current = { y, height }
    })
  }, [])

  // Scroll-aware pause/resume
  useScrollY(
    useCallback(
      (_scrollY: number) => {
        // Re-measure on scroll to get updated absolute position
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

  const handleCtaPress = () => {
    if (trimmedCtaLink) {
      onNavigate(trimmedCtaLink)
    }
  }

  const handleMuteToggle = useCallback(() => {
    if (isMuted && !hasUnmutedOnce.current) {
      // First unmute: restart from beginning
      hasUnmutedOnce.current = true
      player.currentTime = 0
    }
    const newMuted = !isMuted
    player.muted = newMuted
    setIsMuted(newMuted)
  }, [isMuted, player])

  return (
    <View ref={containerRef} style={styles.container} onLayout={onLayout}>
      {streamingUrl ? (
        <>
          {/* @ts-expect-error React 19 vs RN component types */}
          <VideoView
            player={player}
            style={StyleSheet.absoluteFill}
            nativeControls={false}
            contentFit="cover"
          />
          {!hasStarted && thumbnailUrl && (
            <Image
              source={{ uri: thumbnailUrl }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              accessibilityLabel={
                video.image?.alternativeText ?? `${video.title} thumbnail`
              }
            />
          )}
          {/* Mute toggle — top right */}
          <Pressable
            style={styles.muteButton}
            onPress={handleMuteToggle}
            accessibilityRole="button"
            accessibilityLabel={isMuted ? "Unmute video" : "Mute video"}
          >
            <Text style={styles.muteIcon}>
              {isMuted ? "\u{1F507}" : "\u{1F50A}"}
            </Text>
          </Pressable>
        </>
      ) : thumbnailUrl ? (
        <Image
          source={{ uri: thumbnailUrl }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          accessibilityLabel={
            video.image?.alternativeText ?? `${video.title} thumbnail`
          }
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.fallbackBackground]} />
      )}

      <View style={styles.overlay}>
        {heading != null && (
          <Text
            style={styles.heading}
            accessibilityRole="header"
            numberOfLines={3}
          >
            {heading}
          </Text>
        )}
        {subheading != null && (
          <Text style={styles.subheading} numberOfLines={2}>
            {subheading}
          </Text>
        )}
        {hasCta && (
          <Pressable
            style={({ pressed }: { pressed: boolean }) => [
              styles.ctaButton,
              pressed && styles.ctaButtonPressed,
            ]}
            onPress={handleCtaPress}
            accessibilityRole="link"
            accessibilityLabel={trimmedCtaLabel}
          >
            <Text style={styles.ctaText}>{trimmedCtaLabel}</Text>
          </Pressable>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    minHeight: 400,
    justifyContent: "flex-end",
  },
  fallbackBackground: {
    backgroundColor: "#1c1917",
  },
  muteButton: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  },
  muteIcon: {
    fontSize: 18,
    color: "#ffffff",
  },
  overlay: {
    padding: 24,
    paddingBottom: 32,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  heading: {
    fontSize: 32,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 4,
  },
  subheading: {
    fontSize: 14,
    fontWeight: "400",
    color: "rgba(255, 255, 255, 0.7)",
    textTransform: "uppercase",
    letterSpacing: 2,
    marginTop: 4,
  },
  ctaButton: {
    marginTop: 16,
    alignSelf: "flex-start",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 6,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
  },
  ctaButtonPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.35)",
  },
  ctaText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
  },
})
