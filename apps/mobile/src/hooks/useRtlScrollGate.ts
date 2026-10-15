import { useCallback, useRef } from "react"

import { isLayoutRtl } from "../i18n/layoutRtl"

export type RtlScrollGate = {
  /** True while a scroll to an index must wait for the content width. */
  mustWait: () => boolean
  /** The list's `onContentSizeChange`; undefined in a left-to-right layout. */
  onContentSizeChange: ((width: number) => void) | undefined
}

// In a right-to-left layout a horizontal list counts an offset from its right
// edge by the last content width it measured. So a scroll waits until the list
// has measured `count` items, and runs again when that width changes.
export function useRtlScrollGate(
  count: number,
  scrollToCurrent: () => void,
): RtlScrollGate {
  const measuredRef = useRef<{ count: number; width: number } | null>(null)
  const mustWait = useCallback(
    () => isLayoutRtl() && measuredRef.current?.count !== count,
    [count],
  )
  const handleContentSizeChange = useCallback(
    (width: number) => {
      const widthChanged = measuredRef.current?.width !== width
      measuredRef.current = { count, width }
      if (widthChanged) scrollToCurrent()
    },
    [count, scrollToCurrent],
  )
  return {
    mustWait,
    onContentSizeChange: isLayoutRtl() ? handleContentSizeChange : undefined,
  }
}
