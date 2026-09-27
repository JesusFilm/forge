import { useCallback, useState } from "react"
import type { NativeSyntheticEvent, TextLayoutEventData } from "react-native"

export type TextLayoutEvent = NativeSyntheticEvent<TextLayoutEventData>

/**
 * Collapse-and-expand state for the watch page's and the Explore clip's
 * descriptions. Pass a module-level `overflowsWhen`, so the handler is stable.
 */
export function useTextOverflow(
  text: string | null,
  overflowsWhen: (e: TextLayoutEvent) => boolean,
) {
  // Each result names the text it belongs to, so new text starts unmeasured
  // and collapsed with no reset effect. On a Galaxy S20 the layout event came
  // before that effect ran, and the reset erased the overflow: no "more".
  const [measured, setMeasured] = useState<{
    text: string | null
    overflows: boolean
  } | null>(null)
  const [openFor, setOpenFor] = useState<{ text: string | null } | null>(null)

  // Null until measured, so short text never flashes a toggle. Render the
  // toggle on `=== true`.
  const overflows =
    measured != null && measured.text === text ? measured.overflows : null
  const expanded = openFor != null && openFor.text === text

  const setExpanded = useCallback(
    (next: boolean | ((open: boolean) => boolean)) => {
      setOpenFor((open) => {
        const value =
          typeof next === "function"
            ? next(open != null && open.text === text)
            : next
        return value ? { text } : null
      })
    },
    [text],
  )

  // Give this to a hidden copy WITHOUT numberOfLines: a capped copy reports
  // its cap whether the text was cut or not.
  const handleMeasureLayout = useCallback(
    (e: TextLayoutEvent) => {
      setMeasured({ text, overflows: overflowsWhen(e) })
    },
    [text, overflowsWhen],
  )

  return {
    overflows,
    expanded,
    setExpanded,
    handleMeasureLayout,
  }
}
