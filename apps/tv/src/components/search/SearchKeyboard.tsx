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
  /** Renders the mic key and receives its press — the availability decision
   *  (speech recognizer present) stays with the caller, keeping this pure. */
  onMicPress?: () => void
}

/**
 * Grid search keyboard: 6-col A–Z (ABC shift flips case) over a shift/space/
 * delete/search action row, in SEARCH_THEME. Easier to scan on a 10-foot screen
 * than the old strip. Cells dispatch in the showing case; writes go via onChange.
 */
export function SearchKeyboard({
  value,
  onChange,
  onSubmit,
  onMicPress,
}: Props) {
  // Lowercase default; persistent caps-lock-style toggle. Only future presses
  // are affected — already-typed characters in `value` stay as they were.
  const [isShifted, setIsShifted] = useState(false)

  const includeMicKey = onMicPress != null
  const letterRows = useMemo(() => buildLetterRows(isShifted), [isShifted])
  const actionRow = useMemo(
    () => buildActionRow(isShifted, includeMicKey),
    [isShifted, includeMicKey],
  )

  // Thin caller over applyKey (tested pure reducer): shift toggles case, submit
  // fires onSubmit, mic starts voice capture, value-mutating actions forward
  // their non-null next to onChange. Guarded no-ops (space/backspace on empty)
  // return null and fall through.
  const dispatch = (action: KeyAction) => {
    if (action.kind === "shift") {
      setIsShifted((prev) => !prev)
      return
    }
    if (action.kind === "submit") {
      onSubmit()
      return
    }
    if (action.kind === "mic") {
      onMicPress?.()
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
