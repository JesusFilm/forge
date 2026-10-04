import { useSyncExternalStore } from "react"

/** Whether the cinematic curtain is up. The announcement list requests it, and
 *  the root stage draws it: the list is a descendant, so no context reaches up. */
let paused = false
const listeners = new Set<() => void>()

function setPaused(next: boolean): void {
  if (paused === next) return
  paused = next
  listeners.forEach((listener) => listener())
}

export function requestPause(): void {
  setPaused(true)
}

/** The stage calls this when the resume animation finishes, not when the
 *  viewer taps, so the curtain stays mounted while it lifts. */
export function endPause(): void {
  setPaused(false)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): boolean {
  return paused
}

export function usePauseRequested(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
