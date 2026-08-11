import { StyleSheet, View } from "react-native"

import { BLACK, hexToRgba } from "../../lib/color"
import { CircularSpinner } from "../ui/CircularSpinner"

/**
 * Dimmed veil + spinner over a player-shaped poster while the stream resolves.
 * Shared so the pre-stream state (PlayerPoster) and the pre-autostart state
 * (VideoPlayer) read as one continuous load rather than two different screens.
 */
export function PlayerLoadingVeil() {
  return (
    <View
      pointerEvents="none"
      style={styles.veil}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading video"
    >
      <CircularSpinner />
    </View>
  )
}

const styles = StyleSheet.create({
  veil: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: hexToRgba(BLACK, 0.45),
  },
})
