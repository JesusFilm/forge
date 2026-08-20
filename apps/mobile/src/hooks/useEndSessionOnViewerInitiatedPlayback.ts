import { useEffect } from "react"

import { endSessionForViewerInitiatedPlayback } from "../lib/miniPlayer/pictureInPicture"

/**
 * R10/R12: a screen that starts its own decoder but originates no session
 * (R19) makes the floating window give its player back first.
 */
export function useEndSessionOnViewerInitiatedPlayback(
  isPlaying: boolean,
): void {
  useEffect(() => {
    if (isPlaying) endSessionForViewerInitiatedPlayback()
  }, [isPlaying])
}
