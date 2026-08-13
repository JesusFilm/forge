// The picture-in-picture hold state (KTD12). Module scope and readable WITHOUT
// React, because the AppState handler inside the player adapter consults it
// from a plain callback, not from a render.
//
// It is fed from the video view's onPictureInPictureStart / onPictureInPictureStop
// props rather than from player events: those are VIEW props, so every surface
// that can enter picture-in-picture feeds the same latch.
//
// While the latch is set, no view mounts, unmounts or changes owner (R24).

let active = false
const listeners = new Set<() => void>()

function notify() {
  for (const listener of [...listeners]) listener()
}

export function isPictureInPictureActive(): boolean {
  return active
}

export function setPictureInPictureActive(next: boolean) {
  if (active === next) return
  active = next
  notify()
}

export function subscribeToPictureInPicture(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Test teardown only: the latch outlives any one render. */
export function resetPictureInPictureLatch() {
  active = false
  listeners.clear()
}
