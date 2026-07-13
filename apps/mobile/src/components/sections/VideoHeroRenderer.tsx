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
import { useRouter } from "expo-router"
import Ionicons from "@expo/vector-icons/Ionicons"

import {
  ACCENT,
  BG_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_ON_OVERLAY,
  hexToRgba,
} from "../../lib/color"
import { feedback } from "../../styles/shared"
import { resolveThumbnailUrl } from "../../lib/resolveThumbnailUrl"
import { validateStreamingUrl } from "../../lib/validateUrl"
import { useTypography } from "../../hooks/useTypography"
import type { AdminBlock } from "../../lib/queries"
import { useVideoThumbnail } from "../../contexts/ExperienceProvider"

// ── Types ───────────────────────────────────────────────────────────────────

export interface VideoHeroRendererProps {
  section: AdminBlock
  heroHeight?: number
  paused?: boolean
  blurOpacity?: number
  muted?: boolean
  onMuteToggle?: () => void
  onMuteButtonLayout?: (x: number, y: number, w: number, h: number) => void
}

// ── Component ───────────────────────────────────────────────────────────────

export function VideoHeroRenderer({
  section,
  heroHeight,
  paused,
  blurOpacity = 0,
  muted: mutedProp = true,
  onMuteToggle,
  onMuteButtonLayout,
}: VideoHeroRendererProps) {
  const s = section as Record<string, unknown>
  const heading = s.heading as string | null
  const subheading = s.subheading as string | null
  const ctaLabel = (s.ctaLabel as string | null)?.trim() ?? null
  const ctaLink = (s.ctaLink as string | null)?.trim() ?? null
  const streamingUrl = s.streamingUrl as string | null
  const sectionKey = s.sectionKey as string | null
  const videoId = s.videoId as string | null

  const resolvedThumb = useVideoThumbnail(videoId)
  const thumbnailUrl = resolveThumbnailUrl(resolvedThumb, streamingUrl)
  const hasValidStream = validateStreamingUrl(streamingUrl)
  const hasCta =
    ctaLabel != null && ctaLabel !== "" && ctaLink != null && ctaLink !== ""

  const { width: screenWidth } = useWindowDimensions()
  const typography = useTypography()
  const router = useRouter()
  const appActiveRef = useRef(true)

  const [hasStarted, setHasStarted] = useState(false)

  const player = useVideoPlayer(hasValidStream ? streamingUrl : null, (p) => {
    p.muted = true
    p.loop = true
    p.play()
  })

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

  useEffect(() => {
    if (isPlaying && !hasStarted) {
      setHasStarted(true)
    }
  }, [isPlaying, hasStarted])

  useEffect(() => {
    if (paused == null) return
    if (paused) {
      player.pause()
    } else if (appActiveRef.current) {
      player.play()
    }
  }, [paused, player])

  useEffect(() => {
    player.muted = mutedProp
  }, [mutedProp, player])

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

  const containerRef = useRef<View>(null)
  const muteButtonRef = useRef<View>(null)

  const handleMuteButtonLayout = useCallback(() => {
    if (onMuteButtonLayout && containerRef.current && muteButtonRef.current) {
      muteButtonRef.current.measureLayout(
        containerRef.current,
        (x, y, w, h) => onMuteButtonLayout(x, y, w, h),
        () => {
          if (__DEV__)
            console.warn(
              "[VideoHeroRenderer] measureLayout failed for mute button",
            )
        },
      )
    }
  }, [onMuteButtonLayout])

  const handleCtaPress = useCallback(() => {
    if (sectionKey) {
      router.push(`/video/${encodeURIComponent(sectionKey)}`)
    }
  }, [sectionKey, router])

  const computedHeight = heroHeight ?? screenWidth * 1.2

  return (
    <View
      ref={containerRef}
      style={[styles.container, { height: computedHeight }]}
    >
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
              recyclingKey="hero-thumb"
              accessibilityLabel={heading ?? "Video thumbnail"}
            />
          )}
        </>
      ) : thumbnailUrl != null ? (
        <Image
          source={thumbnailUrl}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          recyclingKey="hero-img"
          accessibilityLabel={heading ?? "Hero image"}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.fallback]} />
      )}

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

      <LinearGradient
        colors={[hexToRgba(BG_COLOR, 0), BG_COLOR]}
        locations={[0.4, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <View style={[styles.textContent, { paddingBottom: 32 }]}>
        {heading != null && (
          <View style={styles.headingRow}>
            <Text
              style={[styles.heading, typography.display]}
              accessibilityRole="header"
            >
              {heading}
            </Text>
            {hasValidStream && onMuteToggle != null && (
              <View
                ref={muteButtonRef}
                onLayout={handleMuteButtonLayout}
                style={styles.muteButton}
              >
                <Ionicons
                  name={mutedProp ? "volume-mute" : "volume-high"}
                  size={20}
                  color={TEXT_ON_OVERLAY}
                />
              </View>
            )}
          </View>
        )}
        {subheading != null && (
          <Text style={[styles.subheading, typography.bodySmall]}>
            {subheading}
          </Text>
        )}
        {hasCta && (
          <Pressable
            style={({ pressed }) => [
              styles.ctaButton,
              pressed && feedback.pressed,
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
  textContent: {
    paddingHorizontal: 16,
  },
  headingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 4,
  },
  heading: {
    flex: 1,
    fontWeight: "700",
    color: TEXT_PRIMARY,
    fontFamily: "System",
  },
  muteButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  subheading: {
    fontWeight: "400",
    color: TEXT_SECONDARY,
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
  ctaText: {
    fontWeight: "600",
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
  },
})
