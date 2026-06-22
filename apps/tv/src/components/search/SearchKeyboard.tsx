import { useMemo, useState } from "react"
import { StyleSheet, View } from "react-native"

import { scale } from "../../lib/scale"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { KeyButton } from "./KeyButton"
import {
  applyKey,
  buildActionRow,
  buildLetterRows,
  GRID_KEY_DIMS,
  type KeyAction,
  KEY_GAP,
} from "./keyGrid"

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

  // trapFocusLeft keeps a leftmost-column press from escaping to offscreen
  // chrome. Right is intentionally NOT trapped: the results pane sits to the
  // right in the two-pane layout, so D-pad-right from the rightmost column
  // must reach the results grid. Down/up move between grid rows by geometry.
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
              // One-shot focus claim on entry: the first letter ("a"/"A").
              // Position-based so the case toggle doesn't move it. Only
              // consulted on first mount; later typing leaves focus on the
              // last-pressed key.
              hasTVPreferredFocus={rowIdx === 0 && colIdx === 0}
              onPress={() => dispatch(cell.action)}
              dims={GRID_KEY_DIMS}
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
            dims={GRID_KEY_DIMS}
          />
        ))}
      </View>
    </TVFocusGuideView>
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
})
