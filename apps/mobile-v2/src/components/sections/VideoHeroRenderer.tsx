import { useCallback, useEffect, useRef, useState } from "react"
import {
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"
import { BlurView } from "expo-blur"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { useEvent } from "expo"
import { useVideoPlayer, VideoView } from "expo-video"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useRouter } from "expo-router"

import { hexToRgba } from "../../lib/color"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { validateStreamingUrl } from "../../lib/validateUrl"
import { useTypography } from "../../hooks/useTypography"
import type { NormalizedBlock } from "../../lib/normalizer"

// ── Types ───────────────────────────────────────────────────────────────────

export interface VideoHeroRendererProps {
  section: NormalizedBlock
  heroHeight?: number
  /** When true, the video is paused by the parent (scrolled away). */
  paused?: boolean
  /** Blur/dim overlay opacity (0 = clear, 1 = fully blurred/dimmed). */
  blurOpacity?: number
}

// ── Constants ───────────────────────────────────────────────────────────────

const BG_COLOR = "#1c1917"
const ACCENT = "#CB333B"

// ── Component ───────────────────────────────────────────────────────────────

export function VideoHeroRenderer({
  section,
  heroHeight,
  paused,
  blurOpacity = 0,
}: VideoHeroRendererProps) {
  const heading = section.heading as string | null
  const subheading = section.subheading as string | null
  const ctaLabel = (section.ctaLabel as string | null)?.trim() ?? null
  const ctaLink = (section.ctaLink as string | null)?.trim() ?? null
  const streamingUrl = section.streamingUrl as string | null
  const video = section.video as
    | {
        documentId?: string
        title?: string
        slug?: string
        images?: {
          url?: string
          mobileCinematicHigh?: string
          videoStill?: string
        }
      }
    | null
    | undefined

  const thumbnailUrl = resolveImageUrl(
    video?.images?.mobileCinematicHigh ??
      video?.images?.videoStill ??
      video?.images?.url ??
      null,
  )
  const hasValidStream = validateStreamingUrl(streamingUrl)
  const hasCta = ctaLabel != null && ctaLink != null

  const insets = useSafeAreaInsets()
  const { width: screenWidth } = useWindowDimensions()
  const typography = useTypography()
  const router = useRouter()
  const appActiveRef = useRef(true)

  const [hasStarted, setHasStarted] = useState(false)
  const [muted, setMuted] = useState(true)

  const player = useVideoPlayer(hasValidStream ? streamingUrl : null, (p) => {
    p.muted = true
    p.loop = true
    p.play()
  })

  // Defensive cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        player.pause()
      } catch {
        // Native player already released
      }
    }
  }, [player])

  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  })

  // Dismiss thumbnail when autoplay starts
  useEffect(() => {
    if (isPlaying && !hasStarted) {
      setHasStarted(true)
    }
  }, [isPlaying, hasStarted])

  // Pause/resume based on paused prop
  useEffect(() => {
    if (paused == null) return
    if (paused) {
      player.pause()
    } else if (appActiveRef.current) {
      player.play()
    }
  }, [paused, player])

  // Pause/resume on app background/foreground
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      appActiveRef.current = nextState === "active"
      if (appActiveRef.current && !paused) {
        player.play()
      } else {
        try {
          player.pause()
        } catch {
          // Already released
        }
      }
    })
    return () => subscription.remove()
  }, [player, paused])

  const handleMuteToggle = useCallback(() => {
    const next = !muted
    player.muted = next
    setMuted(next)
  }, [muted, player])

  const handleCtaPress = useCallback(() => {
    if (video?.slug) {
      const sectionKey =
        (section.sectionKey as string | undefined) ?? video.slug
      router.push(`/video/${sectionKey}`)
    }
  }, [video, section, router])

  const computedHeight = heroHeight ?? screenWidth * 1.2

  return (
    <View style={[styles.container, { height: computedHeight }]}>
      {/* Video layer */}
      {hasValidStream ? (
        <>
          <VideoView
            player={player}
            style={StyleSheet.absoluteFill}
            nativeControls={false}
            contentFit="cover"
          />
          {!hasStarted && thumbnailUrl != null && (
            <Image
              source={thumbnailUrl}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              recyclingKey={`hero-thumb-${section.id as string}`}
              accessibilityLabel={video?.title ?? "Video thumbnail"}
            />
          )}
        </>
      ) : thumbnailUrl != null ? (
        <Image
          source={thumbnailUrl}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          recyclingKey={`hero-img-${section.id as string}`}
          accessibilityLabel={video?.title ?? "Hero image"}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.fallback]} />
      )}

      {/* Scroll-driven blur/dim overlay */}
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

      {/* Gradient overlay fading to background */}
      <LinearGradient
        colors={[hexToRgba(BG_COLOR, 0), hexToRgba(BG_COLOR, 0.85)]}
        locations={[0.4, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* Mute button — positioned below Dynamic Island */}
      {hasValidStream && (
        <Pressable
          style={[styles.muteButton, { top: insets.top + 12 }]}
          onPress={handleMuteToggle}
          accessibilityRole="button"
          accessibilityLabel={muted ? "Unmute video" : "Mute video"}
        >
          <Text style={styles.muteIcon}>
            {muted ? "\uD83D\uDD07" : "\uD83D\uDD0A"}
          </Text>
        </Pressable>
      )}

      {/* Text content */}
      <View style={[styles.textContent, { paddingBottom: 32 }]}>
        {heading != null && (
          <Text
            style={[styles.heading, typography.display]}
            accessibilityRole="header"
            numberOfLines={3}
          >
            {heading}
          </Text>
        )}
        {subheading != null && (
          <Text
            style={[styles.subheading, typography.bodySmall]}
            numberOfLines={2}
          >
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
            accessibilityRole="button"
            accessibilityLabel={ctaLabel}
          >
            <Text style={[styles.ctaText, typography.body]}>{ctaLabel}</Text>
          </Pressable>
        )}
      </View>
    </View>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    width: "100%",
    justifyContent: "flex-end",
  },
  fallback: {
    backgroundColor: BG_COLOR,
  },
  androidDim: {
    backgroundColor: "rgba(0, 0, 0, 0.6)",
  },
  muteButton: {
    position: "absolute",
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  },
  muteIcon: {
    fontSize: 20,
    color: "#ffffff",
  },
  textContent: {
    paddingHorizontal: 16,
  },
  heading: {
    fontWeight: "700",
    color: "#f5f5f4",
    fontFamily: "System",
    marginBottom: 4,
  },
  subheading: {
    fontWeight: "400",
    color: "#a8a29e",
    fontFamily: "System",
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
    backgroundColor: ACCENT,
    minHeight: 48,
    justifyContent: "center",
  },
  ctaButtonPressed: {
    opacity: 0.85,
  },
  ctaText: {
    fontWeight: "600",
    color: "#ffffff",
    fontFamily: "System",
  },
})
