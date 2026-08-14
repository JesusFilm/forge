// The picture-in-picture hold state (KTD12). Module scope: the adapter's
// AppState handler reads it from a plain callback, not a render. Fed from the
// VIEW's onPictureInPictureStart/Stop, so every such surface shares one latch.

let active = false
const listeners = new Set<() => void>()

function notify() {
  for (const listener of [...listeners]) listener()
}

export function isPictureInPictureActive(): boolean {
  return active
}

/** R24: while this is set, no view mounts, unmounts or changes owner. */
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
