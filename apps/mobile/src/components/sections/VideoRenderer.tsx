import { useEffect, useRef, useState } from "react"
import { useEvent } from "expo"
import { AppState, Image, StyleSheet, Text, View } from "react-native"
import { useVideoPlayer, VideoView } from "expo-video"

import type { VideoSection } from "../../lib/sectionModels"
import { useSectionVisible } from "./LazySectionContext"

export interface VideoRendererProps {
  section: VideoSection
}

/**
 * Renders an inline video section.
 *
 * Lifecycle is split between LazySection and this component:
 * - **Mount/unmount**: LazySection mounts this component when the section is
 *   within the mount buffer and unmounts it when far away, freeing the
 *   hardware decoder slot.
 * - **Play/pause**: This component reads `useSectionVisible()` from
 *   LazySectionContext to play only when the section is actually in the
 *   viewport (0 buffer). Sections in the mount buffer but not yet visible
 *   stay paused.
 */
export function VideoRenderer({ section }: VideoRendererProps) {
  const { title, streamingUrl, media, video } = section
  const thumbnailUrl = media?.url ?? video?.image?.url ?? null
  const thumbnailAlt =
    media?.alternativeText ?? video?.image?.alternativeText ?? title ?? "Video"

  const [hasStarted, setHasStarted] = useState(false)
  const visible = useSectionVisible()

  // Start paused and muted — play is gated on visibility via the effect below.
  // Videos autoplay muted when they enter the viewport; user can unmute
  // via native controls.
  const player = useVideoPlayer(streamingUrl, (p) => {
    p.muted = true
    p.loop = true
  })

  // Play/pause based on viewport visibility from LazySection.
  // expo-video 3.0.16: player.pause() fires but the native surface may
  // continue rendering. As a workaround, mute after a short delay when
  // off-screen so the user never hears a video they can't see. The 500ms
  // debounce avoids rapid mute/unmute flicker during fast scroll-throughs.
  // LazySection will fully unmount the component (and free the decoder
  // slot) once it's far enough away.
  const appActiveRef = useRef(true)
  useEffect(() => {
    if (visible && appActiveRef.current) {
      player.play()
    } else if (!visible) {
      try {
        player.pause()
      } catch {
        // Native player may already be released during unmount.
      }
    }
  }, [visible, player])

  // Debounced mute: if the video remains off-screen for 500ms, mute it.
  // This catches the expo-video bug where pause() doesn't stop audio.
  // Cleared immediately when the video re-enters the viewport.
  useEffect(() => {
    if (visible) return
    const timer = setTimeout(() => {
      player.muted = true
    }, 500)
    return () => clearTimeout(timer)
  }, [visible, player])

  // Defensive cleanup on unmount.
  useEffect(() => {
    return () => {
      try {
        player.pause()
      } catch {
        // Native player already released — nothing to pause.
      }
    }
  }, [player])

  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  })

  // Dismiss thumbnail when playback starts
  useEffect(() => {
    if (isPlaying && !hasStarted) {
      setHasStarted(true)
    }
  }, [isPlaying, hasStarted])

  // Pause/resume on app background/foreground
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      appActiveRef.current = nextState === "active"
      if (appActiveRef.current && visible) {
        player.play()
      } else {
        try {
          player.pause()
        } catch {
          // Native player may already be released.
        }
      }
    })
    return () => subscription.remove()
  }, [player, visible])

  return (
    <View style={styles.container}>
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
            <View style={styles.playButtonOverlay}>
              <Text style={styles.playIcon} accessibilityElementsHidden>
                ▶
              </Text>
            </View>
          </>
        )}
      </View>
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
    fontSize: 22, // Icon/badge size — intentionally excluded from typography scale
    color: "#ffffff",
    marginLeft: 4,
  },
})
