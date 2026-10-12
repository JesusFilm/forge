// Whether the run's close prompt shows (the owner, 2026-10-12). The close (×)
// in RunScreen and Android back in DailyPauseHost both open it, so the state
// lives here and not in one of them.
import { useSyncExternalStore } from "react"

import { getPauseDirection } from "../pauseCurtain"

let open = false
const listeners = new Set<() => void>()

function set(next: boolean) {
  if (open === next) return
  open = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** v2 KTD5: no prompt under an exit's curtain, where a close does nothing. */
export function openClosePrompt(): void {
  if (getPauseDirection() === "exit") return
  set(true)
}

export function dismissClosePrompt(): void {
  set(false)
}

/** The viewer's Cancel. Under an exit's curtain the prompt stays up (R22),
 *  so the run never shows unblurred while the curtain closes. */
export function cancelClosePrompt(): void {
  if (getPauseDirection() === "exit") return
  set(false)
}

export function isClosePromptOpen(): boolean {
  return open
}

export function useClosePromptOpen(): boolean {
  return useSyncExternalStore(subscribe, isClosePromptOpen)
}
