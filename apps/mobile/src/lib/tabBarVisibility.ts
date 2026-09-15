import { useSyncExternalStore } from "react"

/**
 * Whether the iOS native tab bar is hidden.
 *
 * NativeTabs has no per-screen `tabBarStyle`; its only bar-hide lever is the
 * navigator-level `hidden` prop. So the Library screen's selection flag has to
 * reach `app/(tabs)/_layout.ios.tsx`, and a context cannot carry it — the
 * layout renders the screen, so it is an ANCESTOR, not a descendant.
 *
 * Android never reads this: its bar still hides through `navigation.setOptions`.
 */
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
