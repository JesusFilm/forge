import { useCallback, useEffect, useRef, useState } from "react"
import { AppState, StyleSheet, View, useWindowDimensions } from "react-native"
import { Image } from "expo-image"
import { useVideoPlayer, VideoView } from "expo-video"
import { useEvent } from "expo"
import { BLACK } from "../../lib/color"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { PlayerControls } from "./PlayerControls"
import { SubtitleOverlay } from "./SubtitleOverlay"

type VideoPlayerProps = {
  streamingUrl: string | null
  posterUrl: string | null
  subtitleVttSrc?: string | null
  onPlayingChange?: (isPlaying: boolean) => void
}

export function VideoPlayer({
  streamingUrl,
  posterUrl,
  subtitleVttSrc = null,
  onPlayingChange,
}: VideoPlayerProps) {
  const { width: screenWidth } = useWindowDimensions()

  const [hasStarted, setHasStarted] = useState(false)
  const wasPlayingRef = useRef(false)
  const resolvedPoster = resolveImageUrl(posterUrl)
  const playerHeight = Math.round(screenWidth * (9 / 16))

  const initialUrl = useRef(streamingUrl)
  const player = useVideoPlayer(initialUrl.current, (p) => {
    p.muted = false
    p.loop = false
  })

  // Switching dubbing language restarts the video from the beginning and keeps
  // it playing (with sound). Seeking the freshly-loaded source to the previous
  // position stalls on a black frame, so we reset to 0 instead. Once the new
  // source is ready (sourceLoad / statusChange), unmute, rewind to the start,
  // and play — so a language change never leaves the player paused or black.
  useEffect(() => {
    if (!streamingUrl || streamingUrl === initialUrl.current) return
    initialUrl.current = streamingUrl
    let started = false

    const playFromStart = () => {
      if (started) return
      started = true
      try {
        player.muted = false
        player.currentTime = 0
        player.play()
      } catch {
        // Player released mid-switch
      }
    }

    const subs = [
      player.addListener("sourceLoad", playFromStart),
      player.addListener("statusChange", ({ status }) => {
        if (status === "readyToPlay") playFromStart()
      }),
    ]

    player.replaceAsync(streamingUrl).catch(() => {
      // Source failed to load — listeners are cleaned up on unmount
    })

    return () => subs.forEach((s) => s.remove())
  }, [streamingUrl, player])

  // Disable Mux's auto-generated subtitle tracks from the HLS manifest.
  // Admin CMS VTT subtitles are rendered by SubtitleOverlay instead.
  // AVPlayer can auto-select a track at any of: source load, tracks-available,
  // or device-locale match — force it back to null on every signal.
  useEffect(() => {
    const disable = () => {
      try {
        if (player.subtitleTrack != null) player.subtitleTrack = null
      } catch {
        // Player already released
      }
    }
    const subs = [
      player.addListener("availableSubtitleTracksChange", disable),
      player.addListener("subtitleTrackChange", disable),
      player.addListener("sourceLoad", disable),
      player.addListener("statusChange", disable),
    ]
    disable()
    return () => subs.forEach((s) => s.remove())
  }, [player])

  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  })

  useEffect(() => {
    if (isPlaying && !hasStarted) setHasStarted(true)
    onPlayingChange?.(isPlaying)
  }, [isPlaying, hasStarted, onPlayingChange])

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

      <SubtitleOverlay player={player} vttSrc={subtitleVttSrc} />

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
