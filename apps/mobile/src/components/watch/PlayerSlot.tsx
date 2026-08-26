/**
 * The surface-side half of the hoisted player (U6, KTD17): a transparent view
 * that reserves the player's layout box, measures itself in window
 * coordinates, and publishes what the root player should be playing.
 *
 * It renders no video and creates no player — that is the point. A screen that
 * used to mount `VideoPlayer` mounts this instead, and the root host draws its
 * one video view (plus the chrome) into the rect measured here.
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react"
import { StyleSheet, View, useWindowDimensions } from "react-native"
import { Image } from "expo-image"

import { BLACK } from "../../lib/color"
import { datadogLog } from "../../lib/datadog"
import {
  getPlaybackRequestStore,
  type PlaybackRequest,
  type PlaybackSessionDescriptor,
  type ProgressFeed,
} from "../../lib/miniPlayer/playbackRequest"
import type { VideoPlayerCast } from "./VideoPlayer"
import { PLAYER_HEIGHT_RATIO } from "../../lib/playerLayout"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import type { ProgressIdentity } from "../../lib/watchProgress/recorder"
import { PlayerPoster } from "./PlayerPoster"

// ~2s at 60fps. Long enough for a slow cold open to attach the native node,
// short enough that a genuinely unmeasurable slot stops asking.
export const MEASURE_RETRY_FRAMES = 120

type PlayerSlotProps = {
  /** Null while the surface has no stream yet, which is a state it OWNS rather
   *  than a reason to unmount: dropping the slot hands the player to the route
   *  beneath, and its unmount reads as a committed back press. */
  streamingUrl: string | null
  posterUrl: string | null
  subtitleVttSrc?: string | null
  /** True while the route has expanded the player to its in-tree fullscreen. */
  fullscreen?: boolean
  onToggleFullscreen?: () => void
  /** Per-side horizontal inset the parent applies to the inline player, so the
   *  16:9 height is computed from the reduced width (no letterbox). Ignored in
   *  fullscreen. Default 0. */
  horizontalInset?: number
  /** Progress-recording identity (KTD5). Absent = no recording. */
  progressIdentity?: ProgressIdentity | null
  resumeAtSeconds?: number | null
  autostart?: boolean
  /** What this video's mini-player session would be. Omitted on a surface that
   *  never originates one — the series trailer (AE14) and R19's routes. */
  session?: PlaybackSessionDescriptor | null
  /** True while a stream is still being resolved, for the placeholder this
   *  paints with no `streamingUrl`. A null source ALSO means "resolved, nothing
   *  playable", where a spinner would promise a stream that never comes. */
  loading?: boolean
  /** True while a cast session drives playback (KTD4). It freezes the root
   *  adapter and refuses this video a floating window. */
  castActive?: boolean
  /** The screen's cast wiring, forwarded to the root chrome (KTD4). */
  cast?: VideoPlayerCast | null
  /** Filled by the host with the root adapter's progress facade, so the
   *  screen's cast recorder can write through it (KTD6). */
  progressFeedRef?: { current: ProgressFeed | null } | null
}

export function PlayerSlot({
  streamingUrl,
  posterUrl,
  subtitleVttSrc = null,
  fullscreen = false,
  onToggleFullscreen,
  horizontalInset = 0,
  progressIdentity = null,
  resumeAtSeconds = null,
  autostart = false,
  session = null,
  loading = false,
  castActive = false,
  cast = null,
  progressFeedRef = null,
}: PlayerSlotProps) {
  const store = getPlaybackRequestStore()
  const { width: screenWidth, height: screenHeight } = useWindowDimensions()
  const viewRef = useRef<View | null>(null)
  const slotIdRef = useRef<number | null>(null)
  const rectPublishedRef = useRef(false)

  const request: PlaybackRequest = {
    streamingUrl,
    posterUrl,
    subtitleVttSrc,
    fullscreen,
    autostart,
    resumeAtSeconds,
    progressVideoId: progressIdentity?.videoId ?? null,
    progressVideoSlug: progressIdentity?.videoSlug ?? null,
    progressLanguageSlug: progressIdentity?.languageSlug ?? null,
    onToggleFullscreen: onToggleFullscreen ?? null,
    castActive,
    cast,
    progressFeedRef,
    session,
  }
  const requestRef = useRef(request)
  requestRef.current = request

  useEffect(() => {
    const id = store.attachSlot(requestRef.current)
    slotIdRef.current = id
    return () => {
      slotIdRef.current = null
      // The committed back press. A swipe released without committing never
      // unmounts this screen, so it can never publish a session.
      store.detachSlot(id)
    }
  }, [store])

  // Every render, gated by the store's field-wise compare: the props are built
  // from route state that re-renders for reasons the player does not care about.
  useEffect(() => {
    const id = slotIdRef.current
    if (id != null) store.updateSlot(id, requestRef.current)
  })

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  // The RECT, not just the attachment: the host draws nothing until it has one,
  // so treating "attached" as drawn would drop this poster over a black box.
  const isDrawn =
    snapshot.slotId != null &&
    snapshot.slotId === slotIdRef.current &&
    snapshot.rect != null

  const measureIntoStore = useCallback(() => {
    const id = slotIdRef.current
    const node = viewRef.current
    if (id == null || node == null) return
    // Window coordinates, not the layout event's parent-relative ones: the host
    // draws into a container that fills the window.
    node.measureInWindow((x, y, width, height) => {
      if (slotIdRef.current !== id || width <= 0 || height <= 0) return
      rectPublishedRef.current = true
      store.setSlotRect(id, { x, y, width, height })
    })
  }, [store])

  // `measureInWindow` SILENTLY drops its callback when the native node is not
  // attached yet, and `onLayout` fires once — so one unlucky cold open leaves
  // the host with no rect, drawing nothing, forever. Retry on later frames.
  useEffect(() => {
    let attempts = 0
    let live = true
    let frame: number | null = requestAnimationFrame(function pump() {
      frame = null
      if (!live || rectPublishedRef.current || slotIdRef.current == null) return
      measureIntoStore()
      if (++attempts >= MEASURE_RETRY_FRAMES) {
        // The end of every recovery path: the host draws nothing, and the
        // viewer keeps this slot's poster — or its black ground with no poster.
        datadogLog.warn("player_slot.measure_exhausted", {
          "player_slot.frames": MEASURE_RETRY_FRAMES,
          "player_slot.has_poster": requestRef.current.posterUrl != null,
          "player_slot.fullscreen": requestRef.current.fullscreen,
        })
        return
      }
      frame = requestAnimationFrame(pump)
    })
    return () => {
      // Belt to the cancel's braces, and it must not be the attempt counter:
      // a frame already in flight would then read exhaustion and log a failure
      // that teardown caused.
      live = false
      if (frame != null) cancelAnimationFrame(frame)
      frame = null
    }
  }, [measureIntoStore])

  const playerHeight = Math.round(
    (screenWidth - horizontalInset * 2) * PLAYER_HEIGHT_RATIO,
  )
  const resolvedPoster = resolveImageUrl(posterUrl)

  return (
    <View
      ref={viewRef}
      // Android collapses a childless View out of the hierarchy, and a
      // collapsed view measures nothing.
      collapsable={false}
      onLayout={measureIntoStore}
      style={[
        styles.slot,
        fullscreen
          ? {
              position: "absolute",
              top: 0,
              left: 0,
              width: screenWidth,
              height: screenHeight,
              zIndex: 1000,
            }
          : { height: playerHeight },
      ]}
    >
      {streamingUrl == null ? (
        // Owning the player with nothing to hand it. The host draws no video
        // here, so this stands in for the frame rather than covering it.
        <PlayerPoster
          posterUrl={posterUrl}
          horizontalInset={horizontalInset}
          loading={loading}
        />
      ) : (
        /* Only when the root player is elsewhere: the series trailer while a
           window holds playback (AE14), and the frame before the first measure. */
        !isDrawn &&
        resolvedPoster != null && (
          <Image
            source={resolvedPoster}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            recyclingKey="player-slot-poster"
            accessibilityLabel="Video thumbnail"
          />
        )
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  slot: {
    width: "100%",
    backgroundColor: BLACK,
  },
})
