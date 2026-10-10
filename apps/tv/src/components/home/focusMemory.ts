// Screen-level memory of the last-focused D-pad element so Home can re-focus it
// after a stack pop (tvos#852: tvOS drops it, falling to the top-left default).
// Restores via requestTVFocus() — works across FlatList/tree boundaries.

import type { View as ViewType } from "react-native"

// react-native-tvos host nodes expose requestTVFocus() (NativeMethods), absent
// from the bundled View type — mirror HomeRail's local cast.
type FocusableNode = (ViewType & { requestTVFocus?: () => void }) | null

export type FocusMemory = {
  /** Remember the node that just gained focus. Nulls are ignored so a blur's
   *  null never wipes the last real target. */
  capture: (node: FocusableNode) => void
  /** Re-focus the remembered node. Returns false when nothing is remembered
   *  (first visit) so the caller can leave tvOS's default focus in place. */
  restore: () => boolean
}

export function createFocusMemory(): FocusMemory {
  let last: FocusableNode = null
  return {
    capture(node) {
      if (node != null) last = node
    },
    restore() {
      if (last == null) return false
      last.requestTVFocus?.()
      return true
    },
  }
}
