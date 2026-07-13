import { useEffect, useRef, useState } from "react"

import { useReduceMotion } from "../../hooks/useReduceMotion"
import { getMuxAnimatedPreviewUrl } from "../../lib/muxUrl"
import {
  computeHoverPreviewActive,
  createHoverPreviewDwell,
  type HoverPreviewDwell,
} from "./hoverPreviewDwell"

export type UseHoverPreviewArgs = {
  focused: boolean
  // Surface-level gate: !isSeriesShaped. The hook adds the id + reduce-motion checks.
  enabled: boolean
  playbackId: string | null | undefined
}

/**
 * Mux animated-preview URL for a focused, dwelled, eligible video card, else
 * null. Torn down on blur/unmount so only the focused card ever decodes.
 */
export function useHoverPreview({
  focused,
  enabled,
  playbackId,
}: UseHoverPreviewArgs): string | null {
  const reduceMotion = useReduceMotion()
  const active = computeHoverPreviewActive({
    focused,
    enabled,
    playbackId,
    reduceMotion,
  })

  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // Latest id for the deferred dwell callback, without re-creating the controller.
  const playbackIdRef = useRef(playbackId)
  playbackIdRef.current = playbackId

  const dwellRef = useRef<HoverPreviewDwell | null>(null)
  if (dwellRef.current == null) {
    dwellRef.current = createHoverPreviewDwell(
      () => setPreviewUrl(getMuxAnimatedPreviewUrl(playbackIdRef.current)),
      () => setPreviewUrl(null),
    )
  }

  useEffect(() => {
    dwellRef.current?.setActive(active)
  }, [active])

  // Unmount: clear a pending dwell without firing onLeave into a gone component.
  useEffect(() => () => dwellRef.current?.cancel(), [])

  return previewUrl
}
