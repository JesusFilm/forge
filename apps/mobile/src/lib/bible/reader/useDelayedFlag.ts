import { useEffect, useState } from "react"

// True once `active` has held for `delayMs`, false as soon as it ends. So a
// fast load (most bundled chapters) never flashes the loading indicator.
export function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false)

  useEffect(() => {
    if (!active) {
      setElapsed(false)
      return
    }
    const timer = setTimeout(() => setElapsed(true), delayMs)
    return () => clearTimeout(timer)
  }, [active, delayMs])

  return active && elapsed
}
