/**
 * The surface-side half of the hoisted player (U6, KTD17): a transparent view
 * that reserves the player's layout box, measures itself in window
 * coordinates, and publishes what the root player should be playing.
 *
 * It renders no video and creates no player — that is the point. A screen that
 * used to mount `VideoPlayer` mounts this instead, and the root host draws its
 * one video view (plus the chrome) into the rect measured here.
 */

import { useEffect, useRef, useSyncExternalStore } from "react"
import {
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native"
import { Image } from "expo-image"

import { BLACK } from "../../lib/color"
import {
  getPlaybackRequestStore,
  type PlaybackRequest,
  type PlaybackSessionDescriptor,
} from "../../lib/miniPlayer/playbackRequest"
import { PLAYER_HEIGHT_RATIO } from "../../lib/playerLayout"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import type { ProgressIdentity } from "../../lib/watchProgress/recorder"
import { PlayerPoster } from "./PlayerPoster"

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
}: PlayerSlotProps) {
  const store = getPlaybackRequestStore()
  const { width: screenWidth, height: screenHeight } = useWindowDimensions()
  const viewRef = useRef<View | null>(null)
  const slotIdRef = useRef<number | null>(null)

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
  const isDrawn =
    snapshot.slotId != null && snapshot.slotId === slotIdRef.current

  const handleLayout = (_event: LayoutChangeEvent) => {
    const id = slotIdRef.current
    const node = viewRef.current
    if (id == null || node == null) return
    // Window coordinates, not the layout event's parent-relative ones: the host
    // draws into a container that fills the window.
    node.measureInWindow((x, y, width, height) => {
      if (slotIdRef.current !== id) return
      store.setSlotRect(id, { x, y, width, height })
    })
  }

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
      onLayout={handleLayout}
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
