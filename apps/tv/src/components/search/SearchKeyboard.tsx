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
 * Grid search keyboard: 6-col A–Z (ABC shift flips case) over a shift/space/
 * delete/search action row, in SEARCH_THEME. Easier to scan on a 10-foot screen
 * than the old strip. Cells dispatch in the showing case; writes go via onChange.
 */
export function SearchKeyboard({ value, onChange, onSubmit }: Props) {
  // Lowercase default; persistent caps-lock-style toggle. Only future presses
  // are affected — already-typed characters in `value` stay as they were.
  const [isShifted, setIsShifted] = useState(false)

  const letterRows = useMemo(() => buildLetterRows(isShifted), [isShifted])
  const actionRow = useMemo(() => buildActionRow(isShifted), [isShifted])

  // Thin caller over applyKey (tested pure reducer): shift toggles case, submit
  // fires onSubmit, value-mutating actions forward their non-null next to onChange.
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

  // trapFocusLeft stops leftmost-column presses escaping offscreen. Right is NOT
  // trapped so D-pad-right from the rightmost column reaches the results pane;
  // up/down move between grid rows by geometry.
  return (
    <TVFocusGuideView
      style={styles.keyboard}
      trapFocusLeft
      trapFocusDown={false}
    >
      {letterRows.map((row, rowIdx) => (
        <View key={`letters-${rowIdx}`} style={styles.row}>
          {row.map((cell, colIdx) => (
            <KeyButton
              key={cell.id}
              cell={cell}
              // One-shot focus claim on the first letter, position-based so the
              // case toggle doesn't move it. Only first mount; later typing
              // leaves focus on the last-pressed key.
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
  // Focus pop via shared useFocusAnimation (like HomeCard): 0→1 progress feeds
  // focusTransform, stopping prior timing so a rapid sweep can't orphan it.
  // `focused` gates the static styles (white fill, ink). Keys only magnify, lift: 0.
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
