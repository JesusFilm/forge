import { useMemo, useState } from "react"
import { ScrollView, StyleSheet } from "react-native"

import { scale } from "../../lib/scale"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { KeyButton } from "./KeyButton"
import {
  applyKey,
  buildLinearKeys,
  type KeyAction,
  LINEAR_KEY_DIMS,
  LINEAR_KEY_GAP,
} from "./keyGrid"

type Props = {
  value: string
  onChange: (next: string) => void
  onSubmit: () => void
}

/**
 * Single-line search keyboard for Apple TV — the 26 letters then
 * shift · space · delete · ⏎, laid out in one horizontal row inside a
 * ScrollView so tvOS auto-scrolls to the focused key (the native
 * "swipe along the line" feel) if the row exceeds the visible width.
 *
 * Shares the key model + reducer with the grid keyboard (keyGrid): shift
 * toggles the keyboard's case (component state, no value change), submit fires
 * onSubmit (bypassing the search debounce), and every value-mutating action
 * forwards applyKey's non-null result to onChange. The parent sanitizes at the
 * onChange write site.
 *
 * Focus: trapped left/right (single row — don't fall off the ends). Down is
 * intentionally NOT trapped so D-pad-down drops focus into the results grid
 * stacked below. Up needs no trap — QueryDisplay above is non-focusable
 * (View/Text/Animated.View only, verified), so D-pad-up is already a no-op.
 */
export function SearchKeyboardLinear({ value, onChange, onSubmit }: Props) {
  // Lowercase default; persistent caps-lock-style toggle. Only future presses
  // are affected — already-typed characters in `value` stay as they were.
  const [isShifted, setIsShifted] = useState(false)
  const keys = useMemo(() => buildLinearKeys(isShifted), [isShifted])

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

  return (
    <TVFocusGuideView trapFocusLeft trapFocusRight trapFocusDown={false}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {keys.map((cell, index) => (
          <KeyButton
            key={cell.id}
            cell={cell}
            // One-shot focus claim on entry: the first letter ("a"/"A").
            // Position-based so the case toggle doesn't move it.
            hasTVPreferredFocus={index === 0}
            onPress={() => dispatch(cell.action)}
            dims={LINEAR_KEY_DIMS}
          />
        ))}
      </ScrollView>
    </TVFocusGuideView>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: scale(LINEAR_KEY_GAP),
    alignItems: "center",
  },
})
