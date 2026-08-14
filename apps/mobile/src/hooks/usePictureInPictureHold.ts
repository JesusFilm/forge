/**
 * R24 at a render decision: while the operating system's picture-in-picture
 * window is showing, the app performs no video-view mount, unmount or handoff.
 *
 * Three decisions read it — which video the host owns a player for, whether the
 * mini player window holds the one surface, and whether the window drops that
 * surface at the end of playback. The hold covers WHICH VIEWS EXIST, never how
 * the window looks: `presentationFor` still suppresses the floating chrome,
 * because Android shrinks the whole activity into the picture-in-picture
 * window and a floating window drawn inside that one is a window in a window.
 */

import { useRef, useSyncExternalStore } from "react"

import { pictureInPictureHold } from "../lib/miniPlayer/pipHold"
import {
  isPictureInPictureActive,
  subscribeToPictureInPicture,
} from "../lib/miniPlayer/pipLatch"

export function usePictureInPictureHold<T>(next: T): T {
  const pipActive = useSyncExternalStore(
    subscribeToPictureInPicture,
    isPictureInPictureActive,
  )
  // Written during render, and idempotent in both branches, so a StrictMode
  // double render resolves to the same value it would have alone.
  const heldRef = useRef(next)
  const value = pictureInPictureHold(next, heldRef.current, pipActive)
  heldRef.current = value
  return value
}
