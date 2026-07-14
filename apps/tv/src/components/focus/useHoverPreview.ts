import { useEffect, useRef, useState } from "react"

import { useReduceMotion } from "../../hooks/useReduceMotion"
import {
  getMuxAnimatedPreviewUrl,
  type MuxAnimatedPreviewOpts,
} from "../../lib/muxUrl"
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
  // Mux preview transform overrides. Omit for the web-warm 448/8 default (instant,
  // cache-shared); the large experience-details card passes HD opts (cold ~5s).
  previewOpts?: MuxAnimatedPreviewOpts
}

/**
 * Mux animated-preview URL for a focused, dwelled, eligible video card, else
 * null. Torn down on blur/unmount so only the focused card ever decodes.
 */
export function useHoverPreview({
  focused,
  enabled,
  playbackId,
  previewOpts,
}: UseHoverPreviewArgs): string | null {
  const reduceMotion = useReduceMotion()
  const active = computeHoverPreviewActive({
    focused,
    enabled,
    playbackId,
    reduceMotion,
  })

  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // Latest id + opts for the deferred dwell callback, without re-creating the controller.
  const playbackIdRef = useRef(playbackId)
  playbackIdRef.current = playbackId
  const previewOptsRef = useRef(previewOpts)
  previewOptsRef.current = previewOpts

  const dwellRef = useRef<HoverPreviewDwell | null>(null)
  if (dwellRef.current == null) {
    dwellRef.current = createHoverPreviewDwell(
      () =>
        setPreviewUrl(
          getMuxAnimatedPreviewUrl(
            playbackIdRef.current,
            previewOptsRef.current,
          ),
        ),
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
