import { useSyncExternalStore } from "react"

/** Whether the iOS native tab bar is hidden: NativeTabs' only hide lever is the
 *  navigator-level `hidden` prop, which a screen's context cannot reach. No
 *  screen hides the bar since the downloads list moved to a root route. */
let hidden = false
const listeners = new Set<() => void>()

export function setTabBarHidden(next: boolean): void {
  if (hidden === next) return
  hidden = next
  listeners.forEach((listener) => listener())
}

/** Restores the visible default. Every screen that hides the bar must call
 *  this on blur and on unmount, or a tab switch strands it hidden. */
export function resetTabBarHidden(): void {
  setTabBarHidden(false)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): boolean {
  return hidden
}

export function useTabBarHidden(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
