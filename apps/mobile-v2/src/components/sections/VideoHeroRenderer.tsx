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

import {
  ACCENT,
  BG_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_ON_OVERLAY,
  hexToRgba,
} from "../../lib/color"
import { feedback } from "../../styles/shared"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { pickThumbnailUrl } from "../../lib/types"
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
  /** Controlled mute state — managed by the parent so the toggle button can
   *  live in a layer above the scroll view. */
  muted?: boolean
  /** Called when the parent's mute button is pressed. */
  onMuteToggle?: () => void
  /** Reports the mute button's position (relative to the hero container) so the
   *  parent can place an invisible touch target in the overlay layer. */
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

  const thumbnailUrl = resolveImageUrl(pickThumbnailUrl(video?.images))
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

  // Sync controlled mute prop to the native player
  useEffect(() => {
    player.muted = mutedProp
  }, [mutedProp, player])

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
    if (video?.slug) {
      const sectionKey =
        (section.sectionKey as string | undefined) ?? video.slug
      router.push(`/video/${encodeURIComponent(sectionKey)}`)
    }
  }, [video, section, router])

  const computedHeight = heroHeight ?? screenWidth * 1.2

  return (
    <View
      ref={containerRef}
      style={[styles.container, { height: computedHeight }]}
    >
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

      {/* Gradient overlay — fades hero into base background */}
      <LinearGradient
        colors={[hexToRgba(BG_COLOR, 0), BG_COLOR]}
        locations={[0.4, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* Text content */}
      <View style={[styles.textContent, { paddingBottom: 32 }]}>
        {heading != null && (
          <View style={styles.headingRow}>
            <Text
              style={[styles.heading, typography.display]}
              accessibilityRole="header"
              numberOfLines={3}
            >
              {heading}
            </Text>
            {hasValidStream && onMuteToggle != null && (
              <View
                ref={muteButtonRef}
                onLayout={handleMuteButtonLayout}
                style={styles.muteButton}
              >
                <Text style={styles.muteIcon}>
                  {mutedProp ? "\uD83D\uDD07" : "\uD83D\uDD0A"}
                </Text>
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
  muteIcon: {
    fontSize: 20,
    color: TEXT_ON_OVERLAY,
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
