/**
 * Picture-in-picture wiring (U9), in ONE place for every video view that may
 * enter the operating system's window.
 *
 * A helper rather than four literals per call site, because three separate
 * requirements rest on the same four props arriving together: a view that
 * enters the OS window without feeding `setPipHold` is paused by the AppState
 * handler (the spike's finding 6, R13), is unmounted by the host mid-window
 * (R24), and takes the floating window's chrome with it (KTD16).
 *
 * React-native-free like its siblings here. It names no view type, so a call
 * site spreads it onto its own `VideoView`.
 */

import { getMiniPlayerStore } from "./store"

export type PictureInPictureViewProps = {
  allowsPictureInPicture: true
  startsPictureInPictureAutomatically: boolean
  onPictureInPictureStart: () => void
  onPictureInPictureStop: () => void
}

/**
 * `automatic` belongs to exactly ONE mounted view. expo-video elects a single
 * candidate across every view that carries it, warns when it finds more than
 * one, and re-parents only the elected view's player back out of the OS window.
 */
export function pictureInPictureViewProps(options: {
  automatic: boolean
}): PictureInPictureViewProps {
  return {
    allowsPictureInPicture: true,
    startsPictureInPictureAutomatically: options.automatic,
    onPictureInPictureStart: () => getMiniPlayerStore().setPipHold(true),
    onPictureInPictureStop: () => getMiniPlayerStore().setPipHold(false),
  }
}

/**
 * R10/R12: a viewer starting playback on an R19-excluded SDUI route brings up a
 * SECOND decoder beside the floating window, so the live session ends and the
 * window gives its own back. It creates no session in return — originating one
 * from these routes is exactly what R19 excludes.
 */
export function endSessionForViewerInitiatedPlayback(): void {
  getMiniPlayerStore().end("replaced")
}
