/**
 * Pure fade-race transition table for the auto-hiding video chrome, unit-testable without the RN runtime
 * (hook `useControlsVisibility` runs side effects; R19). Invariants (ce-code-review #7): `mounted` keeps
 * chrome mid-fade so taps reveal, `hideDone` unmounts only if still hidden, `reveal` always re-mounts.
 */
export type ControlsState = { visible: boolean; mounted: boolean }

export type ControlsEvent = "reveal" | "hideStart" | "hideDone"

export function nextControlsState(
  state: ControlsState,
  event: ControlsEvent,
): ControlsState {
  switch (event) {
    case "reveal":
      return { visible: true, mounted: true }
    case "hideStart":
      // Logically hidden immediately; stays mounted so the fade can play out.
      return { visible: false, mounted: true }
    case "hideDone":
      // Stale-completion guard: a reveal during the fade set visible=true, so
      // keep the chrome up; only a genuinely-still-hidden state unmounts.
      return state.visible
        ? { visible: true, mounted: true }
        : { visible: false, mounted: false }
  }
}

/** Read side of the published `visible` value, for `useSyncExternalStore`. */
export type ControlsVisibleReader = {
  get: () => boolean
  subscribe: (listener: () => void) => () => void
}

export type ControlsVisibleStore = ControlsVisibleReader & {
  set: (visible: boolean) => void
}

/** Publishes the table's `visible` value, which also drives the player glass
 *  (feat-699 KTD5). It changes at hide start, before React state does. */
export function createControlsVisibleStore(
  initial: boolean,
): ControlsVisibleStore {
  let visible = initial
  const listeners = new Set<() => void>()
  return {
    get: () => visible,
    set: (next) => {
      visible = next
      listeners.forEach((listener) => listener())
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
