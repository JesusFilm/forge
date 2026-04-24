import { StyleSheet, Text, View } from "react-native"

import { COLORS } from "../../lib/colors"
import { scale } from "../../lib/scale"
import { FocusableCard } from "../FocusableCard"
import { TVFocusGuideView } from "../TVFocusGuideView"

type Props = {
  value: string
  onChange: (next: string) => void
  onSubmit: () => void
  /**
   * When true, the ⏎ (Search) key claims focus on mount instead of
   * the default "A" key. U6 uses this to return focus here after
   * empty-results state so the user can edit-and-resubmit in one
   * press (see plan R24 + doc-review P1 resolution).
   */
  submitKeyPreferredFocus?: boolean
}

/**
 * Action a key performs when pressed. Defines the dispatcher contract
 * between a key row and the keyboard's onChange / onSubmit props.
 */
type KeyAction =
  | { kind: "char"; char: string }
  | { kind: "backspace" }
  | { kind: "submit" }
  | { kind: "space" }

type KeyCell = {
  label: string
  action: KeyAction
  /** Accessibility label overrides the visible glyph when the glyph is symbolic. */
  accessibilityLabel?: string
  /** Wider than a normal key (space key). */
  wide?: boolean
}

// Frequency-optimized top row: 7 most common English letters. Users
// who recognize the shortcut save D-pad presses; the alphabetical
// grid below remains the predictable fallback for users who don't.
// See brainstorm R5 and plan Key Technical Decisions.
const FREQUENCY_ROW: KeyCell[] = [
  { label: "E", action: { kind: "char", char: "E" } },
  { label: "T", action: { kind: "char", char: "T" } },
  { label: "A", action: { kind: "char", char: "A" } },
  { label: "O", action: { kind: "char", char: "O" } },
  { label: "I", action: { kind: "char", char: "I" } },
  { label: "N", action: { kind: "char", char: "N" } },
  { label: "S", action: { kind: "char", char: "S" } },
]

const ALPHA_ROWS: KeyCell[][] = [
  ["A", "B", "C", "D", "E", "F", "G"],
  ["H", "I", "J", "K", "L", "M", "N"],
  ["O", "P", "Q", "R", "S", "T", "U"],
  ["V", "W", "X", "Y", "Z", "'", "."],
].map((row) =>
  row.map((c) => ({ label: c, action: { kind: "char", char: c } })),
)

const NUMERIC_ROWS: KeyCell[][] = [
  ["0", "1", "2", "3", "4", "5", "6"],
  ["7", "8", "9"],
].map((row) =>
  row.map((n) => ({ label: n, action: { kind: "char", char: n } })),
)

const ACTION_ROW: KeyCell[] = [
  {
    label: "␣",
    action: { kind: "space" },
    accessibilityLabel: "Space",
    wide: true,
  },
  { label: "⌫", action: { kind: "backspace" }, accessibilityLabel: "Delete" },
  { label: "⏎", action: { kind: "submit" }, accessibilityLabel: "Search" },
]

export function SearchKeyboard({
  value,
  onChange,
  onSubmit,
  submitKeyPreferredFocus,
}: Props) {
  const dispatch = (action: KeyAction) => {
    switch (action.kind) {
      case "char":
        onChange(value + action.char)
        return
      case "space":
        onChange(value + " ")
        return
      case "backspace":
        if (value.length === 0) return
        onChange(value.slice(0, -1))
        return
      case "submit":
        onSubmit()
        return
    }
  }

  const renderKey = (cell: KeyCell, rowIdx: number, colIdx: number) => {
    // First alphabetical "A" claims focus on mount unless the ⏎ key
    // is explicitly requested (empty-state focus return).
    const isFirstAlpha = rowIdx === 1 && colIdx === 0 && cell.label === "A"
    const isSubmitKey = cell.action.kind === "submit"
    const preferred =
      submitKeyPreferredFocus === true ? isSubmitKey : isFirstAlpha

    return (
      <FocusableCard
        key={`${rowIdx}-${colIdx}-${cell.label}`}
        onPress={() => dispatch(cell.action)}
        hasTVPreferredFocus={preferred}
        accessibilityLabel={cell.accessibilityLabel ?? cell.label}
        style={cell.wide === true ? styles.keyWide : styles.key}
      >
        <View style={styles.keyInner}>
          <Text style={styles.keyLabel}>{cell.label}</Text>
        </View>
      </FocusableCard>
    )
  }

  return (
    <TVFocusGuideView
      style={styles.keyboard}
      trapFocusLeft
      trapFocusDown={false}
    >
      {/* Frequency quick-pick row */}
      <View style={styles.row}>
        {FREQUENCY_ROW.map((cell, col) => renderKey(cell, 0, col))}
      </View>
      {/* Visual separator — background-color only, no border per
          Crimson Gallery constraint. */}
      <View style={styles.separator} />
      {/* Alphabetical grid */}
      {ALPHA_ROWS.map((row, rowIdx) => (
        <View key={`alpha-${rowIdx}`} style={styles.row}>
          {row.map((cell, col) => renderKey(cell, rowIdx + 1, col))}
        </View>
      ))}
      {/* Numerals */}
      {NUMERIC_ROWS.map((row, rowIdx) => (
        <View key={`num-${rowIdx}`} style={styles.row}>
          {row.map((cell, col) => renderKey(cell, rowIdx + 5, col))}
        </View>
      ))}
      {/* Action row: space (wide) + backspace + submit */}
      <View style={styles.row}>
        {ACTION_ROW.map((cell, col) => renderKey(cell, 7, col))}
      </View>
    </TVFocusGuideView>
  )
}

const KEY_SIZE = scale(56)
const KEY_GAP = scale(8)

const styles = StyleSheet.create({
  keyboard: {
    flexDirection: "column",
    gap: KEY_GAP,
  },
  row: {
    flexDirection: "row",
    gap: KEY_GAP,
  },
  separator: {
    height: scale(2),
    backgroundColor: COLORS.surfaceContainerHigh,
    marginVertical: scale(4),
  },
  key: {
    width: KEY_SIZE,
    height: KEY_SIZE,
    backgroundColor: COLORS.surfaceContainer,
  },
  keyWide: {
    width: KEY_SIZE * 2 + KEY_GAP,
    height: KEY_SIZE,
    backgroundColor: COLORS.surfaceContainer,
  },
  keyInner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  keyLabel: {
    fontFamily: "System",
    fontSize: scale(22),
    fontWeight: "600",
    color: COLORS.text,
  },
})
