import { useMemo, useState } from "react"
import { ScrollView, StyleSheet } from "react-native"
import type { View as ViewType } from "react-native"

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
  /**
   * Receives the FIRST key's native node so the stacked (Apple TV) layout wires
   * the results grid's top row back up to it as a D-pad `nextFocusUp` target —
   * a deterministic up-escape out of the grid. Unused in the two-pane layout.
   */
  onLandingNodeChange?: (node: ViewType | null) => void
}

/**
 * Single-line Apple TV search keyboard — 26 letters then shift · space · delete
 * · ⏎ in one auto-scrolling ScrollView row; shares the key model + reducer with
 * keyGrid. Focus trapped left/right but not down (drops into the results grid).
 */
export function SearchKeyboardLinear({
  value,
  onChange,
  onSubmit,
  onLandingNodeChange,
}: Props) {
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
            // Expose only the first key's node — the results grid's top row
            // targets it for D-pad-up, landing back on the same key the
            // keyboard claims on entry (symmetric up/down).
            nodeRef={index === 0 ? onLandingNodeChange : undefined}
          />
        ))}
      </ScrollView>
    </TVFocusGuideView>
  )
}

const styles = StyleSheet.create({
  // contentContainerStyle of the horizontal ScrollView. flexGrow:1 fills the
  // content width (keys fit one row at 1080p); space-between pins first/last
  // keys to the edges. On narrower devices it falls back to gap + scroll.
  row: {
    flexGrow: 1,
    flexDirection: "row",
    gap: scale(LINEAR_KEY_GAP),
    alignItems: "center",
    justifyContent: "space-between",
    // Slack so the 1.1x focus pop isn't clipped by the ScrollView frame
    // (space-between pins the end keys flush to the content edges).
    paddingVertical: scale(10),
    paddingHorizontal: scale(16),
  },
})
