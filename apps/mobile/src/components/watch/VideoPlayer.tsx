import { useCallback, useEffect, useRef, useState } from "react"
import { AppState, StyleSheet, View, useWindowDimensions } from "react-native"
import { Image } from "expo-image"
import { useVideoPlayer, VideoView } from "expo-video"
import { useEvent } from "expo"
import { useNavigation } from "expo-router"
import { BLACK } from "../../lib/color"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { PlayerControls } from "./PlayerControls"

type VideoPlayerProps = {
  streamingUrl: string | null
  posterUrl: string | null
  onPlayingChange?: (isPlaying: boolean) => void
}

export function VideoPlayer({
  streamingUrl,
  posterUrl,
  onPlayingChange,
}: VideoPlayerProps) {
  const { width: screenWidth } = useWindowDimensions()
  const navigation = useNavigation()

  const [hasStarted, setHasStarted] = useState(false)
  const wasPlayingRef = useRef(false)
  const resolvedPoster = resolveImageUrl(posterUrl)
  const playerHeight = Math.round(screenWidth * (9 / 16))

  const initialUrl = useRef(streamingUrl)
  const player = useVideoPlayer(initialUrl.current, (p) => {
    p.muted = false
    p.loop = false
  })

  useEffect(() => {
    if (streamingUrl && streamingUrl !== initialUrl.current) {
      initialUrl.current = streamingUrl
      player.replace(streamingUrl)
    }
  }, [streamingUrl, player])

  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  })

  useEffect(() => {
    if (isPlaying && !hasStarted) setHasStarted(true)
    onPlayingChange?.(isPlaying)
  }, [isPlaying, hasStarted, onPlayingChange])

  useEffect(() => {
    return navigation.addListener("blur", () => {
      try {
        player.pause()
      } catch {
        // Player already released
      }
    })
  }, [navigation, player])

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        if (wasPlayingRef.current) {
          player.play()
        }
      } else {
        wasPlayingRef.current = isPlaying
        try {
          player.pause()
        } catch {
          // Already released
        }
      }
    })
    return () => subscription.remove()
  }, [player, isPlaying])

  useEffect(() => {
    return () => {
      try {
        player.pause()
      } catch {
        // Native player already released
      }
    }
  }, [player])

  const videoViewRef = useRef<React.ComponentRef<typeof VideoView>>(null)

  const handleFullscreen = useCallback(() => {
    videoViewRef.current?.enterFullscreen()
  }, [])

  return (
    <View style={[styles.container, { height: playerHeight }]}>
      <VideoView
        ref={videoViewRef}
        player={player}
        style={StyleSheet.absoluteFill}
        nativeControls={false}
        contentFit="contain"
        allowsFullscreen
        allowsPictureInPicture
      />

      {!hasStarted && resolvedPoster != null && (
        <Image
          source={resolvedPoster}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          recyclingKey="watch-poster"
          accessibilityLabel="Video thumbnail"
        />
      )}

      <PlayerControls player={player} onFullscreen={handleFullscreen} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    backgroundColor: BLACK,
  },
})
