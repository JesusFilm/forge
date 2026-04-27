import { useMemo, useState } from "react"
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
   * the default first-letter key. U6 uses this to return focus here
   * after empty-results state so the user can edit-and-resubmit in
   * one press (see plan R24 + doc-review P1 resolution).
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
  | { kind: "shift" }

type KeyCell = {
  label: string
  action: KeyAction
  /** Accessibility label overrides the visible glyph when the glyph is symbolic. */
  accessibilityLabel?: string
  /** Wider than a normal key (space key). */
  wide?: boolean
}

/**
 * Build the four key sections fresh whenever the case toggle flips.
 * Letter cells render in the active case (uppercase when `isShifted`,
 * lowercase otherwise) and dispatch the same character so the query
 * preserves whatever case the user typed. Punctuation and digits are
 * case-insensitive and pass through unchanged.
 *
 * Defaulting to lowercase rather than uppercase because search queries
 * are case-insensitive on the backend and lowercase reads as less
 * shouty in the QueryDisplay above the keyboard.
 */
function buildKeyboardSections(isShifted: boolean): {
  frequency: KeyCell[]
  alpha: KeyCell[][]
  numeric: KeyCell[][]
  action: KeyCell[]
} {
  const cased = (c: string) => (isShifted ? c.toUpperCase() : c)

  const frequency: KeyCell[] = ["e", "t", "a", "o", "i", "n", "s"].map((c) => {
    const display = cased(c)
    return { label: display, action: { kind: "char", char: display } }
  })

  const alpha: KeyCell[][] = [
    ["a", "b", "c", "d", "e", "f", "g"],
    ["h", "i", "j", "k", "l", "m", "n"],
    ["o", "p", "q", "r", "s", "t", "u"],
    ["v", "w", "x", "y", "z", "'", "."],
  ].map((row) =>
    row.map((c) => {
      const isLetter = /^[a-z]$/.test(c)
      const display = isLetter ? cased(c) : c
      return { label: display, action: { kind: "char", char: display } }
    }),
  )

  const numeric: KeyCell[][] = [
    ["0", "1", "2", "3", "4", "5", "6"],
    ["7", "8", "9"],
  ].map((row) =>
    row.map((n) => ({ label: n, action: { kind: "char", char: n } })),
  )

  // Shift key shows the case it would switch TO when pressed
  // (matches the iOS / tvOS convention). Persistent toggle, not
  // momentary — easier on D-pad than transient shift.
  const action: KeyCell[] = [
    {
      label: isShifted ? "abc" : "ABC",
      action: { kind: "shift" },
      accessibilityLabel: isShifted
        ? "Switch to lowercase"
        : "Switch to uppercase",
    },
    {
      label: "␣",
      action: { kind: "space" },
      accessibilityLabel: "Space",
      wide: true,
    },
    { label: "⌫", action: { kind: "backspace" }, accessibilityLabel: "Delete" },
    { label: "⏎", action: { kind: "submit" }, accessibilityLabel: "Search" },
  ]

  return { frequency, alpha, numeric, action }
}

export function SearchKeyboard({
  value,
  onChange,
  onSubmit,
  submitKeyPreferredFocus,
}: Props) {
  const [isShifted, setIsShifted] = useState(false)

  const sections = useMemo(() => buildKeyboardSections(isShifted), [isShifted])

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
      case "shift":
        // Persistent caps-lock-style toggle. The keyboard re-renders
        // with letters in the new case; only future presses are
        // affected — already-typed characters in `value` stay as-is
        // (matches every desktop / mobile keyboard's shift semantics).
        setIsShifted((prev) => !prev)
        return
    }
  }

  const renderKey = (cell: KeyCell, rowIdx: number, colIdx: number) => {
    // First alphabetical row, leftmost cell — claims focus on mount
    // unless the empty-state focus return wants the ⏎ key. Position-
    // based, not label-based, so the case toggle doesn't shift which
    // cell is the initial focus target.
    const isFirstAlpha = rowIdx === 1 && colIdx === 0
    const isSubmitKey = cell.action.kind === "submit"
    const preferred =
      submitKeyPreferredFocus === true ? isSubmitKey : isFirstAlpha

    return (
      <FocusableCard
        // Stable position-based key — does NOT include the label. The
        // shift toggle changes labels in place; using the label as the
        // React key would unmount + remount every cell on each toggle
        // and lose focus state.
        key={`r${rowIdx}-c${colIdx}`}
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
        {sections.frequency.map((cell, col) => renderKey(cell, 0, col))}
      </View>
      {/* Visual separator — background-color only, no border per
          Crimson Gallery constraint. */}
      <View style={styles.separator} />
      {/* Alphabetical grid */}
      {sections.alpha.map((row, rowIdx) => (
        <View key={`alpha-${rowIdx}`} style={styles.row}>
          {row.map((cell, col) => renderKey(cell, rowIdx + 1, col))}
        </View>
      ))}
      {/* Numerals */}
      {sections.numeric.map((row, rowIdx) => (
        <View key={`num-${rowIdx}`} style={styles.row}>
          {row.map((cell, col) => renderKey(cell, rowIdx + 5, col))}
        </View>
      ))}
      {/* Action row: shift toggle + space (wide) + backspace + submit */}
      <View style={styles.row}>
        {sections.action.map((cell, col) => renderKey(cell, 7, col))}
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
