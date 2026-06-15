import Ionicons from "@expo/vector-icons/Ionicons"
import { useMemo, useState } from "react"
import { Animated, Pressable, StyleSheet, Text, View } from "react-native"

import { scale } from "../../lib/scale"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { focusTransform, useFocusAnimation } from "../watch/useFocusAnimation"
import {
  applyKey,
  buildActionRow,
  buildLetterRows,
  type KeyAction,
  type KeyCell,
  KEY_GAP,
  KEY_RADIUS,
  KEY_SIZE,
  KEY_WIDTH_WIDE,
} from "./keyGrid"
import { SEARCH_THEME } from "./searchTheme"

type Props = {
  value: string
  onChange: (next: string) => void
  onSubmit: () => void
}

/**
 * Grid search keyboard — a 6-column A–Z block (lowercase by default, an ABC
 * shift toggle flips case) over an action row of shift · space · delete ·
 * search, styled in the redesign's SEARCH_THEME (near-black keys, white-fill
 * focus). Replaces the single-row letter strip; the grid is easier to scan
 * and traverse on a 10-foot screen.
 *
 * Letter cells dispatch the character in the showing case (see keyGrid), so
 * the typed query preserves case. All value writes route through onChange,
 * which the parent sanitizes at the write site.
 */
export function SearchKeyboard({ value, onChange, onSubmit }: Props) {
  // Lowercase default; persistent caps-lock-style toggle. Only future presses
  // are affected — already-typed characters in `value` stay as they were.
  const [isShifted, setIsShifted] = useState(false)

  const letterRows = useMemo(() => buildLetterRows(isShifted), [isShifted])
  const actionRow = useMemo(() => buildActionRow(isShifted), [isShifted])

  // Thin caller over applyKey (the tested pure reducer): shift toggles the
  // keyboard case (no value change); submit fires onSubmit; every
  // value-mutating action forwards its non-null next value to onChange.
  // Guarded no-ops (space/backspace on empty) return null and fall through.
  const dispatch = (action: KeyAction) => {
    if (action.kind === "shift") {
      setIsShifted((prev) => !prev)
      return
    }
    if (action.kind === "submit") {
      onSubmit()
      return
    }
    const next = applyKey(value, action)
    if (next != null) onChange(next)
  }

  // trapFocusLeft / trapFocusRight keep horizontal D-pad travel inside the
  // grid (a past-the-edge press stays put rather than escaping to offscreen
  // chrome). trapFocusDown stays open so D-pad-down from the bottom row exits
  // to the results region below; mid-grid down moves to the next row by
  // geometry. Up has nothing focusable above it (the query line is static).
  return (
    <TVFocusGuideView
      style={styles.keyboard}
      trapFocusLeft
      trapFocusRight
      trapFocusDown={false}
    >
      {letterRows.map((row, rowIdx) => (
        <View key={`letters-${rowIdx}`} style={styles.row}>
          {row.map((cell, colIdx) => (
            <KeyButton
              key={cell.id}
              cell={cell}
              // One-shot focus claim on entry: the first letter ("a"/"A").
              // Position-based so the case toggle doesn't move it. Only
              // consulted on first mount; later typing leaves focus on the
              // last-pressed key.
              hasTVPreferredFocus={rowIdx === 0 && colIdx === 0}
              onPress={() => dispatch(cell.action)}
            />
          ))}
        </View>
      ))}

      <View style={styles.row}>
        {actionRow.map((cell) => (
          <KeyButton
            key={cell.id}
            cell={cell}
            hasTVPreferredFocus={false}
            onPress={() => dispatch(cell.action)}
          />
        ))}
      </View>
    </TVFocusGuideView>
  )
}

function KeyButton({
  cell,
  hasTVPreferredFocus,
  onPress,
}: {
  cell: KeyCell
  hasTVPreferredFocus: boolean
  onPress: () => void
}) {
  // Focus pop via the shared useFocusAnimation hook (same as HomeCard /
  // WatchOptionRow): one 0→1 progress feeds focusTransform, which stops the
  // prior timing before starting the next so a rapid D-pad sweep can't orphan
  // animations. `focused` gates the non-animated focus styles (white fill,
  // ink color). Keys only magnify (no lift), so lift: 0.
  const { focused, setFocused, progress } = useFocusAnimation()

  const keyTransform = useMemo(
    () => focusTransform(progress, { lift: 0, magnify: 1.1 }),
    [progress],
  )

  const inkColor = focused ? SEARCH_THEME.keyFocusText : SEARCH_THEME.keyText

  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityRole="button"
      accessibilityLabel={cell.accessibilityLabel ?? cell.label}
    >
      <Animated.View
        style={[
          styles.key,
          cell.wide === true && styles.keyWide,
          focused && styles.keyFocused,
          { transform: keyTransform },
        ]}
      >
        {cell.action.kind === "backspace" ? (
          <Ionicons
            name="backspace-outline"
            size={scale(28)}
            color={inkColor}
          />
        ) : (
          <Text style={[styles.keyLabel, { color: inkColor }]}>
            {cell.label}
          </Text>
        )}
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  keyboard: {
    flexDirection: "column",
    gap: scale(KEY_GAP),
    // Left-aligned block; the grid is narrower than the full content width.
    alignItems: "flex-start",
  },
  row: {
    flexDirection: "row",
    gap: scale(KEY_GAP),
  },
  key: {
    width: scale(KEY_SIZE),
    height: scale(KEY_SIZE),
    borderRadius: scale(KEY_RADIUS),
    backgroundColor: SEARCH_THEME.keyBg,
    alignItems: "center",
    justifyContent: "center",
  },
  keyWide: {
    width: scale(KEY_WIDTH_WIDE),
  },
  keyFocused: {
    backgroundColor: SEARCH_THEME.keyFocusBg,
    // Design: 0 12px 28px -10px rgba(0,0,0,.7).
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: scale(12) },
    shadowRadius: scale(14),
    shadowOpacity: 0.7,
    elevation: 8,
  },
  keyLabel: {
    fontFamily: "System",
    fontSize: Math.round(scale(26)),
    fontWeight: "600",
  },
})
