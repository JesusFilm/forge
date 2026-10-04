import { useSyncExternalStore } from "react"

/**
 * The Daily Bible Pause curtain (KTD5). The entry points request it, the root
 * stage draws it, and the bridge inside the providers hands it over to the run
 * route. A module store, because the stage sits outside every provider.
 */
export type PausePhase =
  /** No curtain. */
  | "idle"
  /** The curtain closes and the logo draws. */
  | "closing"
  /** The logo pen finished, so the bridge may push the run. */
  | "drawn"
  /** The curtain lifts, onto the run or back to the previous screen. */
  | "lifting"

let phase: PausePhase = "idle"
let runOnTop = false
const listeners = new Set<() => void>()

function setPhase(next: PausePhase): void {
  if (phase === next) return
  phase = next
  listeners.forEach((listener) => listener())
}

/** R1: every entry point opens today's devotional through this call. A request
 *  while the curtain is up, or while the run is on top, does nothing. */
export function requestPause(): void {
  if (phase !== "idle" || runOnTop) return
  setPhase("closing")
}

/** The stage calls this from its own clock when the logo pen ends. */
export function reportLogoDrawn(): void {
  if (phase === "closing") setPhase("drawn")
}

/** A curtain tap lifts back to the previous screen. The bridge lifts onto the
 *  run after its push. Once the lift starts, neither can start another. */
export function liftPause(): void {
  if (phase === "closing" || phase === "drawn") setPhase("lifting")
}

/** The stage calls this when the lift ends, not when the lift starts, so the
 *  curtain stays mounted while it lifts. */
export function endPause(): void {
  setPhase("idle")
}

/** The bridge keeps this in step with the router. */
export function setPauseRunOnTop(onTop: boolean): void {
  runOnTop = onTop
}

export function getPausePhase(): PausePhase {
  return phase
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
