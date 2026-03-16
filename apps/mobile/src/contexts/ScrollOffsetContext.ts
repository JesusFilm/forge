import { createContext, useContext, useEffect, useRef } from "react"
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native"

type ScrollListener = (y: number) => void

interface ScrollHandle {
  addListener: (fn: ScrollListener) => () => void
  handleScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void
}

export const ScrollContext = createContext<ScrollHandle | null>(null)

/** Create a scroll handle — use in the component that owns the ScrollView. */
export function useScrollHandle(): ScrollHandle {
  const listeners = useRef(new Set<ScrollListener>())

  return useRef<ScrollHandle>({
    addListener(fn) {
      listeners.current.add(fn)
      return () => {
        listeners.current.delete(fn)
      }
    },
    handleScroll(e) {
      const y = e.nativeEvent.contentOffset.y
      for (const fn of listeners.current) fn(y)
    },
  }).current
}

/** Subscribe to scroll Y offset changes from the nearest ScrollContext. */
export function useScrollY(callback: (y: number) => void): void {
  const handle = useContext(ScrollContext)
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    if (!handle) return
    return handle.addListener((y) => callbackRef.current(y))
  }, [handle])
}
