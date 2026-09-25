import { useCallback, useState } from "react"
import type { NativeSyntheticEvent, TextLayoutEventData } from "react-native"

export type TextLayoutEvent = NativeSyntheticEvent<TextLayoutEventData>

/**
 * Collapse-and-expand state for the watch page's and the Explore clip's
 * descriptions. Pass a module-level `overflowsWhen`, so the handler is stable.
 */
export function useTextOverflow(
  overflowsWhen: (e: TextLayoutEvent) => boolean,
) {
  // Null until measured, so short text never flashes a toggle. Render the
  // toggle on `=== true`, and reset to null when the text changes, or a stale
  // `true` keeps a dead toggle up.
  const [overflows, setOverflows] = useState<boolean | null>(null)
  const [expanded, setExpanded] = useState(false)

  // Give this to a hidden copy WITHOUT numberOfLines: a capped copy reports
  // its cap whether the text was cut or not.
  const handleMeasureLayout = useCallback(
    (e: TextLayoutEvent) => {
      setOverflows(overflowsWhen(e))
    },
    [overflowsWhen],
  )

  return {
    overflows,
    setOverflows,
    expanded,
    setExpanded,
    handleMeasureLayout,
  }
}
