import { StyleSheet, View } from "react-native"

import { useT } from "../../i18n/useT"
import { BLACK, hexToRgba } from "../../lib/color"
import { CircularSpinner } from "../ui/CircularSpinner"

/**
 * Dimmed veil + spinner over a player-shaped poster while the stream resolves.
 * Shared so the pre-stream state (PlayerPoster) and the pre-autostart state
 * (VideoPlayer) read as one continuous load rather than two different screens.
 */
export function PlayerLoadingVeil() {
  const t = useT("Player")
  return (
    <View
      pointerEvents="none"
      style={styles.veil}
      accessibilityRole="progressbar"
      accessibilityLabel={t("loadingVideoAriaLabel")}
    >
      <CircularSpinner />
    </View>
  )
}

const styles = StyleSheet.create({
  veil: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: hexToRgba(BLACK, 0.45),
  },
})
