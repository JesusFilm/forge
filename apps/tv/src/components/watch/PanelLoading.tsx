import { ActivityIndicator, StyleSheet, Text, View } from "react-native"

import { scale } from "../../lib/scale"
import { WATCH_THEME } from "./watchDetailTheme"
import { watchMenuStyles } from "./watchMenuStyles"

export function PanelLoading({ label }: { label: string }) {
  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      accessibilityLiveRegion="polite"
    >
      <ActivityIndicator size="small" color={WATCH_THEME.accent} />
      <Text style={[watchMenuStyles.status, styles.label]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: scale(20),
    minHeight: scale(84),
    gap: scale(14),
  },
  label: { flexShrink: 1, paddingHorizontal: 0 },
})
