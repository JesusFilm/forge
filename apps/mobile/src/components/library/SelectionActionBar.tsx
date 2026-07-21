import { Pressable, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Ionicons from "@expo/vector-icons/Ionicons"

import { ACCENT, TEXT_ON_OVERLAY, TEXT_PRIMARY } from "../../lib/color"
import { formatLibraryBytes } from "../../lib/libraryDownloads"
import { feedback } from "../../styles/shared"

const BAR_BG = "rgba(12, 12, 13, 0.94)"
const BAR_BORDER = "rgba(255, 255, 255, 0.09)"
const GHOST_BG = "rgba(255, 255, 255, 0.09)"

export interface SelectionActionBarProps {
  count: number
  combinedBytes: number
  hasFailed: boolean
  onRetryFailed: () => void
  onDeletePress: () => void
}

/** Bottom bar shown during selection, replacing the tab bar (R12/KTD8). */
export function SelectionActionBar({
  count,
  combinedBytes,
  hasFailed,
  onRetryFailed,
  onDeletePress,
}: SelectionActionBarProps) {
  const insets = useSafeAreaInsets()

  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom + 14 }]}>
      {hasFailed && (
        <Pressable
          onPress={onRetryFailed}
          style={({ pressed }) => [
            styles.button,
            styles.ghostButton,
            pressed && feedback.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Retry failed downloads"
        >
          <Ionicons name="refresh" size={17} color={TEXT_PRIMARY} />
          <Text style={styles.ghostText}>Retry failed</Text>
        </Pressable>
      )}
      <Pressable
        onPress={onDeletePress}
        disabled={count === 0}
        style={({ pressed }) => [
          styles.button,
          styles.dangerButton,
          count === 0 && styles.buttonDisabled,
          pressed && feedback.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={
          count > 0 ? `Delete ${count} selected videos` : "Delete"
        }
      >
        <Ionicons name="trash-outline" size={17} color={TEXT_ON_OVERLAY} />
        <Text style={styles.dangerText}>
          {count > 0
            ? `Delete ${count} · ${formatLibraryBytes(combinedBytes)}`
            : "Delete"}
        </Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 14,
    backgroundColor: BAR_BG,
    borderTopWidth: 1,
    borderTopColor: BAR_BORDER,
  },
  button: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  ghostButton: {
    backgroundColor: GHOST_BG,
  },
  dangerButton: {
    backgroundColor: ACCENT,
  },
  buttonDisabled: {
    opacity: 0.35,
  },
  ghostText: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontSize: 15.5,
    fontWeight: "700",
  },
  dangerText: {
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
    fontSize: 15.5,
    fontWeight: "700",
  },
})
