import { useEffect } from "react"

import {
  getNonRouteSheetCounter,
  type NonRouteSheetId,
} from "../lib/miniPlayer/suppression"

/**
 * R11: a sheet that is component state rather than a route tells the floating
 * window it is open. The cleanup releases it, which also covers leaving the
 * screen with the sheet open.
 */
export function useNonRouteSheetSuppression(
  visible: boolean,
  id: NonRouteSheetId,
): void {
  useEffect(() => {
    if (!visible) return
    const counter = getNonRouteSheetCounter()
    counter.open(id)
    return () => counter.close(id)
  }, [visible, id])
}
