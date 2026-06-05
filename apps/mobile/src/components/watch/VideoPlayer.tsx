import { useCallback, useEffect, useRef, useState } from "react"
import { AppState, StyleSheet, View, useWindowDimensions } from "react-native"
import { Image } from "expo-image"
import { useVideoPlayer, VideoView } from "expo-video"
import { useEvent } from "expo"
import { BLACK } from "../../lib/color"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { extractMuxPlaybackId } from "../../lib/muxThumbnail"
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

  // The source passed to useVideoPlayer must be FROZEN. useVideoPlayer recreates
  // (and releases) the player whenever this value changes — its dependency is
  // JSON.stringify(source). Source swaps must go through replaceAsync on the
  // SAME player instead; a changing creation source would release the player
  // mid-replace (FunctionCallException) and strand a fresh, paused player on the
  // new asset — the "black screen, stuck on language switch" bug.
  const creationSource = useRef(streamingUrl).current
  const player = useVideoPlayer(creationSource, (p) => {
    p.muted = false
    p.loop = false
    // Favor a fast first frame on cellular over a deep prebuffer — JFP's
    // audience skews to low-bandwidth networks. (Android-only fields are
    // ignored on iOS.)
    p.bufferOptions = {
      minBufferForPlayback: 1,
      preferredForwardBufferDuration: 8,
      prioritizeTimeOverSizeThreshold: true,
    }
  })

  // The source currently loaded into the player, tracked separately from the
  // frozen creationSource so swap decisions can compare against it.
  const loadedUrlRef = useRef(streamingUrl)

  useEffect(() => {
    if (!streamingUrl || streamingUrl === loadedUrlRef.current) return

    // Decide swap vs no-swap by Mux playback ID, not raw URL string: the
    // optimistic seed URL is rebuilt from a playbackId while the resolved
    // variant carries the stored `hls`, so the same asset can have two
    // different URL strings. Reloading the same asset would needlessly
    // restart playback.
    const currentId = extractMuxPlaybackId(loadedUrlRef.current)
    const nextId = extractMuxPlaybackId(streamingUrl)
    loadedUrlRef.current = streamingUrl
    if (currentId != null && nextId != null && currentId === nextId) return

    // Preserve playback across the swap: replace() does not carry the playing
    // state to the new source, so a language switch mid-play would otherwise
    // strand a paused frame. Resume once the new source has loaded if we were
    // playing before.
    const wasPlaying = player.playing
    const resume = () => {
      if (!wasPlaying) return
      try {
        player.play()
      } catch {
        // Player already released.
      }
    }

    // replaceAsync loads off the main thread (replace() blocks the UI thread
    // for HLS on iOS). Fall back to the synchronous path if it rejects.
    void player
      .replaceAsync(streamingUrl)
      .then(resume)
      .catch(() => {
        try {
          player.replace(streamingUrl, true)
          resume()
        } catch {
          // Player already released.
        }
      })
  }, [streamingUrl, player])

  // Disable Mux's auto-generated subtitle tracks from the HLS manifest.
  // Admin CMS VTT subtitles are rendered by SubtitleOverlay instead.
  // AVPlayer can auto-select a track at source load, tracks-available, or a
  // device-locale match — these three signals cover every re-selection. (A
  // fourth statusChange listener was dropped: it fired on every buffer/seek
  // tick for the same effect the targeted events already cover.)
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
    ]
    disable()
    return () => subs.forEach((s) => s.remove())
  }, [player])

  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  })

  // Mirror isPlaying into a ref so the AppState listener can register once on
  // [player] and read the current value, instead of tearing down and
  // re-adding the subscription on every play/pause (which left a window where
  // a background event could be missed).
  const isPlayingRef = useRef(isPlaying)
  useEffect(() => {
    isPlayingRef.current = isPlaying
  }, [isPlaying])

  useEffect(() => {
    if (isPlaying && !hasStarted) setHasStarted(true)
    onPlayingChange?.(isPlaying)
  }, [isPlaying, hasStarted, onPlayingChange])

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        if (wasPlayingRef.current) {
          try {
            player.play()
          } catch {
            // Already released
          }
        }
      } else {
        wasPlayingRef.current = isPlayingRef.current
        try {
          player.pause()
        } catch {
          // Already released
        }
      }
    })
    return () => subscription.remove()
  }, [player])

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
