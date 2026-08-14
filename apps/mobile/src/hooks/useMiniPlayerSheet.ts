import { useEffect } from "react"

import { getMiniPlayerSheets } from "../lib/miniPlayer"
import type { SheetCounter } from "../lib/miniPlayer/suppression"

/**
 * R11 for the two sheets that own no route, so `presentationFor` cannot see
 * them. The release rides the effect's cleanup rather than a close handler: a
 * component unmounted while its sheet is open would otherwise strand the count
 * and hide every later window until the app relaunches.
 */
export function useMiniPlayerSheet(
  open: boolean,
  sheets: SheetCounter = getMiniPlayerSheets(),
): void {
  useEffect(() => {
    if (!open) return
    sheets.openSheet()
    // The host resets the counter on session end, which zeroes THIS sheet's
    // claim while the sheet is still on screen. The counter cannot tell a live
    // claim from a stranded one, so the claimant re-asserts instead.
    let generation = sheets.getResetGeneration()
    const unsubscribe = sheets.subscribe(() => {
      const current = sheets.getResetGeneration()
      if (current === generation) return
      generation = current
      sheets.openSheet()
    })
    return () => {
      unsubscribe()
      sheets.closeSheet()
    }
  }, [open, sheets])
}
