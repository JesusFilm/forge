import { StyleSheet, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { ACCENT } from "../../lib/color"
import type { SeriesSelectionState } from "../../lib/librarySelection"

const BORDER_COLOR = "rgba(255, 255, 255, 0.35)"

export interface SelectionCheckboxProps {
  /** true/false for a single row; a series header also has "mixed". */
  state: boolean | SeriesSelectionState
}

/** Shared circular checkbox for DownloadRow + SeriesGroupCard's selection mode (R11). */
export function SelectionCheckbox({ state }: SelectionCheckboxProps) {
  const checked = state === true || state === "all"
  const mixed = state === "some"

  return (
    <View
      style={[
        styles.box,
        checked && styles.boxChecked,
        mixed && styles.boxMixed,
      ]}
    >
      {checked && <Ionicons name="checkmark" size={14} color="#ffffff" />}
      {mixed && <Ionicons name="remove" size={14} color={ACCENT} />}
    </View>
  )
}

const styles = StyleSheet.create({
  box: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.8,
    borderColor: BORDER_COLOR,
    alignItems: "center",
    justifyContent: "center",
  },
  boxChecked: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  boxMixed: {
    borderColor: ACCENT,
  },
})
