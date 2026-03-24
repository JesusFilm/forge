import { useCallback, useEffect, useRef, useState } from "react"
import { BlurView } from "expo-blur"
import { useEvent } from "expo"
import { LinearGradient } from "expo-linear-gradient"
import {
  AppState,
  Dimensions,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useVideoPlayer, VideoView } from "expo-video"

import { useScrollY } from "../../contexts/ScrollOffsetContext"
import type { VideoHeroSection } from "../../lib/sectionModels"
import { useNavigateLink } from "../../lib/useNavigateLink"

// -- Shared overlay text content ----------------------------------------------

interface HeroTextContentProps {
  section: VideoHeroSection
}

/** Heading, subheading, and CTA shared between VideoHeroRenderer and VideoHeroOverlay. */
function HeroTextContent({ section }: HeroTextContentProps) {
  const { heading, subheading, ctaLabel, ctaLink } = section
  const trimmedCtaLabel = ctaLabel?.trim() || null
  const trimmedCtaLink = ctaLink?.trim() || null
  const hasCta = trimmedCtaLabel != null && trimmedCtaLink != null
  const onNavigate = useNavigateLink()

  const handleCtaPress = useCallback(() => {
    if (trimmedCtaLink) {
      onNavigate(trimmedCtaLink)
    }
  }, [trimmedCtaLink, onNavigate])

  return (
    <>
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
          style={({ pressed }) => [
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
    </>
  )
}

// -- VideoHeroRenderer --------------------------------------------------------

export interface VideoHeroRendererProps {
  section: VideoHeroSection
  heroHeight?: number
  hideOverlay?: boolean
  /** When true, the video is paused by the parent (user has scrolled away). */
  paused?: boolean
  /** Blur/dim overlay opacity (0 = clear, 1 = fully blurred/dimmed). */
  blurOpacity?: number
}

export function VideoHeroRenderer({
  section,
  heroHeight,
  hideOverlay,
  paused,
  blurOpacity = 0,
}: VideoHeroRendererProps) {
  const { streamingUrl, video } = section
  const thumbnailUrl = video.image?.url ?? null

  const [hasStarted, setHasStarted] = useState(false)
  const [isMuted, setIsMuted] = useState(true)
  const hasUnmutedOnce = useRef(false)
  const insets = useSafeAreaInsets()
  const appActiveRef = useRef(true)

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

  // Pause/resume based on the `paused` prop from FixedHeroLayout
  useEffect(() => {
    if (paused == null) return
    if (paused) {
      player.pause()
    } else if (appActiveRef.current) {
      player.play()
    }
  }, [paused, player])

  // Inline mode (non-fixed): use ScrollContext for visibility detection
  const containerRef = useRef<View>(null)
  const isVisibleRef = useRef(true)
  const viewportHeight = Dimensions.get("window").height

  useScrollY(
    useCallback(
      (_scrollOffset: number) => {
        if (paused != null) return

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
      [player, viewportHeight, paused],
    ),
  )

  // Pause/resume on app background/foreground
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      appActiveRef.current = nextState === "active"
      if (appActiveRef.current && !paused) {
        player.play()
      } else {
        player.pause()
      }
    })
    return () => subscription.remove()
  }, [player, paused])

  const handleMuteToggle = useCallback(() => {
    if (isMuted && !hasUnmutedOnce.current) {
      hasUnmutedOnce.current = true
      player.currentTime = 0
    }
    const newMuted = !isMuted
    player.muted = newMuted
    setIsMuted(newMuted)
  }, [isMuted, player])

  return (
    <View
      ref={containerRef}
      style={[styles.container, heroHeight != null && { height: heroHeight }]}
    >
      {streamingUrl ? (
        <>
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
          {/* Scroll-driven overlay: iOS = blur, Android = dim */}
          {blurOpacity > 0 && (
            <View
              style={[StyleSheet.absoluteFill, { opacity: blurOpacity }]}
              pointerEvents="none"
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
            >
              {Platform.OS === "ios" ? (
                <BlurView
                  intensity={50}
                  tint="dark"
                  style={StyleSheet.absoluteFill}
                />
              ) : (
                <View style={[StyleSheet.absoluteFill, styles.androidDim]} />
              )}
            </View>
          )}

          <Pressable
            style={[styles.muteButton, { top: insets.top + 16 }]}
            onPress={handleMuteToggle}
            accessibilityRole="button"
            accessibilityLabel={isMuted ? "Unmute video" : "Mute video"}
          >
            <Text
              style={styles.muteIcon}
              importantForAccessibility="no"
              accessibilityElementsHidden
            >
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

      {!hideOverlay && (
        <View style={styles.overlay}>
          <HeroTextContent section={section} />
        </View>
      )}
    </View>
  )
}

// -- VideoHeroOverlay (scroll content) ----------------------------------------

export interface VideoHeroOverlayProps {
  section: VideoHeroSection
}

/** Standalone overlay for use inside scroll content with gradient fade. */
export function VideoHeroOverlay({ section }: VideoHeroOverlayProps) {
  return (
    <LinearGradient
      colors={["transparent", "rgba(0, 0, 0, 0.8)"]}
      style={styles.overlayWrapper}
    >
      <View style={styles.overlayContent}>
        <HeroTextContent section={section} />
      </View>
    </LinearGradient>
  )
}

// -- Styles -------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    width: "100%",
    minHeight: 400,
    justifyContent: "flex-end",
  },
  fallbackBackground: {
    backgroundColor: "#1c1917",
  },
  androidDim: {
    backgroundColor: "rgba(0, 0, 0, 0.6)",
  },
  muteButton: {
    position: "absolute",
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
  overlayWrapper: {
    paddingTop: 80,
    overflow: "hidden",
  },
  overlayContent: {
    padding: 24,
    paddingBottom: 32,
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
