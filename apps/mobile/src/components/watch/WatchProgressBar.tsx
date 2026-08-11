import { StyleSheet, View } from "react-native"

import { useWatchProgressEntry } from "../../hooks/useWatchProgressEntry"
import { ACCENT, hexToRgba } from "../../lib/color"
import { progressBarState } from "../../lib/watchProgress/thresholds"

/**
 * The shared continue-watching bar (KTD4/KTD6): a thin bottom overlay
 * inside the card frame, subscribed to the progress store by videoId.
 * Renders nothing under 1%, snaps to full at 90%+; signed-out renders
 * nothing (the store is empty, R10). pointerEvents none — never a tap
 * target; no new decoder surfaces.
 */
export function WatchProgressBar({
  videoId,
}: {
  videoId: string | null | undefined
}) {
  const entry = useWatchProgressEntry(videoId)
  const state = progressBarState(entry)
  if (!state.visible) return null

  return (
    <View pointerEvents="none" style={styles.track}>
      <View style={[styles.fill, { width: `${state.fillRatio * 100}%` }]} />
    </View>
  )
}

/**
 * Fold progress into the card's accessibilityLabel (mobile a11y
 * convention — a deliberate divergence from web's silent bar).
 */
export function progressAccessibilityText(
  entry:
    | { positionSeconds: number; durationSeconds: number }
    | null
    | undefined,
): string | null {
  const state = progressBarState(entry)
  if (!state.visible) return null
  if (state.completed) return "watched"
  return `${Math.round(state.fillRatio * 100)}% watched`
}

const styles = StyleSheet.create({
  track: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: hexToRgba("#ffffff", 0.3),
  },
  fill: {
    height: "100%",
    backgroundColor: ACCENT,
  },
})
