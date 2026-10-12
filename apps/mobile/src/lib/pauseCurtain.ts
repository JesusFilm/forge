import { useSyncExternalStore } from "react"

// The Daily Bible Pause curtain (KTD5; the exit: v2 R17, R18, KTD5). The entry
// points and Share request it, the root stage draws it, and the bridge hands it
// over. A module store, because the stage sits outside every provider.
export type PausePhase =
  /** No curtain. */
  | "idle"
  /** The curtain closes and the logo draws. */
  | "closing"
  /** The logo is drawn and has held, so the bridge may change the route. */
  | "drawn"
  /** The curtain lifts onto the run, onto an exit's target, or back. */
  | "lifting"

/** An entry closes over the app and lifts onto the run. An exit closes over
 *  the run and lifts onto its target. */
export type PauseDirection = "entry" | "exit"

/** Where an exit lands: Home, or the search tab with a question to search. */
export type PauseExitTarget =
  | { kind: "home" }
  | { kind: "search"; question: string }

let phase: PausePhase = "idle"
let exitTarget: PauseExitTarget | null = null
let runOnTop = false
/** Entry requests while the run is on top. The run decides what they mean. */
let entryRequestsOnTop = 0
const listeners = new Set<() => void>()

function setPhase(next: PausePhase): void {
  if (phase === next) return
  phase = next
  listeners.forEach((listener) => listener())
}

/** R1: every entry point opens today's devotional through this call. A request
 *  while the curtain is up does nothing. While the run is on top, the request
 *  goes to the run, which goes back to today if it is pinned to an older day. */
export function requestPause(): void {
  if (phase !== "idle") return
  if (runOnTop) {
    entryRequestsOnTop += 1
    listeners.forEach((listener) => listener())
    return
  }
  setPhase("closing")
}

/** v2 R17, R18: Share leaves the run through the curtain. It does not use
 *  requestPause, which only counts a request while the run is on top. */
export function requestPauseExit(target: PauseExitTarget): void {
  if (phase !== "idle") return
  exitTarget = target
  setPhase("closing")
}

/** The stage calls this from its own clock when the drawn logo's hold ends. */
export function reportLogoDrawn(): void {
  if (phase === "closing") setPhase("drawn")
}

/** A tap on an entry's curtain lifts back to the previous screen. The bridge
 *  lifts onto the run or an exit's target. Once the lift starts, neither can
 *  start another. */
export function liftPause(): void {
  if (phase === "closing" || phase === "drawn") setPhase("lifting")
}

/** The stage calls this when the lift ends, not when the lift starts, so the
 *  curtain stays mounted while it lifts. The next request starts with no
 *  direction from this one. */
export function endPause(): void {
  exitTarget = null
  setPhase("idle")
}

/** The bridge keeps this in step with the router. */
export function setPauseRunOnTop(onTop: boolean): void {
  runOnTop = onTop
}

export function getPausePhase(): PausePhase {
  return phase
}

export function getPauseExitTarget(): PauseExitTarget | null {
  return exitTarget
}

export function getPauseDirection(): PauseDirection {
  return exitTarget == null ? "entry" : "exit"
}

export function subscribePause(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function usePausePhase(): PausePhase {
  return useSyncExternalStore(subscribePause, getPausePhase, getPausePhase)
}

export function usePauseDirection(): PauseDirection {
  return useSyncExternalStore(
    subscribePause,
    getPauseDirection,
    getPauseDirection,
  )
}

export function getEntryRequestsOnTop(): number {
  return entryRequestsOnTop
}

export function useEntryRequestsOnTop(): number {
  return useSyncExternalStore(
    subscribePause,
    getEntryRequestsOnTop,
    getEntryRequestsOnTop,
  )
}
