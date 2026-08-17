/**
 * The root playback host (U6, KTD1/KTD17). It owns the app's ONE player and
 * its ONE video view, mounted above the stack and absolutely positioned at the
 * rect the current surface measured for it.
 *
 * The chrome rides in this layer too, not in the route. The host paints above
 * the stack by construction (KTD1), and the screens behind it are opaque
 * (`layout.screenContainer` in `src/styles/shared.ts`, plus the Stack's own
 * `contentStyle`), so a video view under the stack would be hidden and a video
 * view over it would cover the controls. One frame holding both preserves the
 * exact layering the component had before the hoist, and leaves U7 the bare
 * video view KTD17 asks for.
 */

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react"
import { Platform, StyleSheet, View } from "react-native"
import { VideoView, type VideoPlayerStatus } from "expo-video"

import { useManagedVideoPlayer } from "../../hooks/useManagedVideoPlayer"
import { getAuthSession } from "../../lib/authSession"
import { BLACK } from "../../lib/color"
import {
  getPlaybackRequestStore,
  type PlaybackRequest,
  type PlaybackRequestSnapshot,
} from "../../lib/miniPlayer/playbackRequest"
import { getMiniPlayerStore } from "../../lib/miniPlayer/store"
import { BACK_BUTTON_PROPS } from "../../lib/playerLayout"
import type { ProgressIdentity } from "../../lib/watchProgress/recorder"
import { FloatingBackButton } from "../ui/FloatingBackButton"
import { VideoPlayer } from "./VideoPlayer"

export function PlaybackHost() {
  const store = getPlaybackRequestStore()
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)

  // R25/KTD15, wired here rather than inside the player: this component is
  // mounted for the app's whole life, so the subject watch outlives every
  // session it has to end. attachAuthSession returns its own detach.
  useEffect(() => getMiniPlayerStore().attachAuthSession(getAuthSession()), [])

  // No request, no player: the app carries no native player (and no cold-launch
  // cost) until a surface asks for one, and releasing it is how a dismissed
  // session gives the decoder back.
  if (snapshot.request == null) return null
  return <ActivePlaybackHost snapshot={snapshot} request={snapshot.request} />
}

function ActivePlaybackHost({
  snapshot,
  request,
}: {
  snapshot: PlaybackRequestSnapshot
  request: PlaybackRequest
}) {
  const store = getPlaybackRequestStore()
  const progressIdentity = useMemo<ProgressIdentity | null>(() => {
    if (request.progressVideoId != null)
      return {
        videoId: request.progressVideoId,
        languageSlug: request.progressLanguageSlug,
      }
    if (request.progressVideoSlug != null)
      return {
        videoSlug: request.progressVideoSlug,
        languageSlug: request.progressLanguageSlug,
      }
    return null
  }, [
    request.progressVideoId,
    request.progressVideoSlug,
    request.progressLanguageSlug,
  ])

  const { player, isPlaying } = useManagedVideoPlayer(
    request.streamingUrl,
    (p) => {
      // Favor a fast first frame over deep prebuffer — JFP audience skews to
      // low-bandwidth networks. (Android-only fields are ignored on iOS.)
      p.bufferOptions = {
        minBufferForPlayback: 1,
        preferredForwardBufferDuration: 8,
        prioritizeTimeOverSizeThreshold: true,
      }
    },
    { progress: progressIdentity, ownsSession: true },
  )

  // Admission's first half (R1): has THIS video played at all. Reset per video,
  // because a window for a video that never started is AE10's regression.
  const startedRef = useRef(false)
  const videoKey = request.session
    ? `${request.session.videoId ?? ""}|${request.session.videoSlug}`
    : (request.streamingUrl ?? "")
  useEffect(() => {
    startedRef.current = false
  }, [videoKey])
  useEffect(() => {
    if (isPlaying) startedRef.current = true
  }, [isPlaying])

  useEffect(() => {
    store.setPlaybackFactsSource({
      // The live player, not the latch alone: a swap that keeps `playing` true
      // throughout emits no playing-change edge, and a latch that only an edge
      // sets would deny the arriving video its window for good.
      hasPlaybackStarted: () => {
        if (startedRef.current) return true
        try {
          return player.playing
        } catch {
          return false // Native player already released
        }
      },
      readPosition: () => {
        try {
          return player.currentTime
        } catch {
          return 0 // Native player already released
        }
      },
      readDuration: () => {
        try {
          return player.duration
        } catch {
          return 0
        }
      },
    })
    return () => store.setPlaybackFactsSource(null)
  }, [store, player])

  // R25: a change of signed-in subject stops playback. The store reports that
  // ending as "abandoned" and emits it from no other path, and the pause is not
  // covered by the teardown — an expanded screen keeps this host mounted.
  useEffect(() => {
    return getMiniPlayerStore().onEnd((event) => {
      if (event.reason !== "abandoned") return
      try {
        player.pause()
      } catch {
        // Native player already released
      }
    })
  }, [player])

  // Disable Mux's HLS subtitle tracks (SubtitleOverlay renders admin VTT
  // instead). Lives here, not in the chrome: R26 keeps the floating window
  // caption-free, and the track must stay null with no chrome mounted.
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

  // Subscribed once per PLAYER, not per source: resubscribing on a streamingUrl
  // change rebuilds mid-replaceAsync across the seed -> canonical swap, which
  // attributes a pre-swap error to the new source.
  useEffect(() => {
    const sub = player.addListener(
      "statusChange",
      ({ status }: { status: VideoPlayerStatus }) => {
        store.setLoadFailed(status === "error")
      },
    )
    return () => {
      try {
        sub.remove()
      } catch {
        // Player already released
      }
    }
  }, [store, player])

  // New source: clear the stop condition. Seeding from the CURRENT status
  // rather than a bare false covers a source that already failed before this
  // effect ran, which a listener alone never sees.
  useEffect(() => {
    let current: VideoPlayerStatus | null = null
    try {
      current = player.status
    } catch {
      // Player already released
    }
    store.setLoadFailed(current === "error")
  }, [store, player, request.streamingUrl])

  const rect = snapshot.rect
  // Detached: the surface that was drawing this video is gone. U7 gives the
  // view the corner frame here; until then the player keeps running with no
  // view, which is audio-only rather than a released decoder.
  if (rect == null) return null

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View
        style={[
          styles.frame,
          {
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
          },
        ]}
        pointerEvents="box-none"
      >
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          nativeControls={false}
          // iOS 16+ defaults this TRUE, which floats a Live Text "scan" button
          // over a paused/ended frame that contains text — a system control we
          // do not own, inside chrome we do.
          allowsVideoFrameAnalysis={false}
          contentFit="contain"
          allowsPictureInPicture
          // textureView composites in the RN view hierarchy on Android so the
          // controls/captions overlay reliably renders above the video surface
          // (SurfaceView otherwise punches through). No-op on iOS.
          surfaceType={Platform.OS === "android" ? "textureView" : undefined}
        />

        <VideoPlayer
          player={player}
          isPlaying={isPlaying}
          loadFailed={snapshot.loadFailed}
          streamingUrl={request.streamingUrl}
          posterUrl={request.posterUrl}
          subtitleVttSrc={request.subtitleVttSrc}
          fullscreen={request.fullscreen}
          onToggleFullscreen={request.onToggleFullscreen ?? undefined}
          resumeAtSeconds={request.resumeAtSeconds}
          autostart={request.autostart}
        />
      </View>

      {/* The screen's back affordance sits OVER the player, so it moves up with
          the video — outside the frame, so its safe-area maths still resolves
          against the window. The screen drops its own (usePlaybackFrameVisible). */}
      {snapshot.slotId != null && !request.fullscreen && (
        <FloatingBackButton {...BACK_BUTTON_PROPS} />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  frame: {
    position: "absolute",
    backgroundColor: BLACK,
    overflow: "hidden",
  },
})
