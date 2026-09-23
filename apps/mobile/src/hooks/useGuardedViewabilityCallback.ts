/**
 * One guarded viewability callback for a list's whole life (feat-517 KTD4).
 * React Native's lists capture `onViewableItemsChanged` and `viewabilityConfig`
 * when they are constructed and ignore every later pair, so a fresh identity
 * per render is handed over and dropped. `guardViewabilityCallback` keeps a
 * throw inside the reporting path out of the caller.
 */
import { useRef } from "react"

import { guardViewabilityCallback } from "../lib/recommendations/impressionDwell"

/**
 * `report` is captured on the first render, so it must reach the current props
 * and state through refs rather than closing over them.
 */
export function useGuardedViewabilityCallback<T>(
  surface: string,
  report: (info: T) => void,
): (info: T) => void {
  const callbackRef = useRef<((info: T) => void) | null>(null)
  callbackRef.current ??= guardViewabilityCallback(surface, report)
  return callbackRef.current
}
