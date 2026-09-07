import { useEffect, useRef, useState } from "react"
import { AppState } from "react-native"

import { useReduceMotion } from "../../hooks/useReduceMotion"
import {
  PREVIEW_HOLD_MS,
  PREVIEW_START_DELAY_MS,
  type PreviewCandidate,
  advancePreview,
  buildPreviewQueue,
} from "./previewCycle"

type Args = {
  results: readonly PreviewCandidate[]
  /** Indices currently on screen, from the list's viewability callback. */
  visibleIndices: readonly number[]
  /** False while loading, erroring, or off this tab. */
  enabled: boolean
  /** Changes per search; restarts the pass from the top. */
  passKey: string
}

/**
 * Index of the card holding the preview turn, or null. One pass: the turn walks
 * the visible eligible cards in grid order and then stops, so a search spends a
 * bounded number of Mux fetches rather than cycling.
 *
 * "One pass" means each card previews AT MOST ONCE per search, not "one
 * screenful". The pass therefore wakes for cards the viewer newly reveals — a
 * "Load More" page or a scroll — and always resumes past the last card shown,
 * so nothing replays. Only a new search (`passKey`) starts over from the top.
 *
 */
export function useSearchPreviewCycle({
  results,
  visibleIndices,
  enabled,
  passKey,
}: Args): number | null {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const reduceMotion = useReduceMotion()

  // Read at tick time so a scroll re-aims a live pass without restarting it.
  const resultsRef = useRef(results)
  const visibleRef = useRef(visibleIndices)
  resultsRef.current = results
  visibleRef.current = visibleIndices

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastShownRef = useRef<number | null>(null)
  const runningRef = useRef(false)
  const passKeyRef = useRef(passKey)

  // Held in a ref, not rebuilt per render: waking the pass must not tear down a
  // chain that is mid-turn.
  const stepRef = useRef<(current: number | null) => void>(() => {})
  stepRef.current = (current) => {
    const next = advancePreview(
      buildPreviewQueue(resultsRef.current, visibleRef.current),
      current,
    )
    setActiveIndex(next)
    if (next == null) {
      // Pass idle. lastShownRef survives, so a later wake resumes past it.
      runningRef.current = false
      return
    }
    lastShownRef.current = next
    timerRef.current = setTimeout(() => stepRef.current(next), PREVIEW_HOLD_MS)
  }

  const stop = () => {
    if (timerRef.current != null) clearTimeout(timerRef.current)
    timerRef.current = null
    runningRef.current = false
  }

  // Arms the chain from wherever the pass left off. No-op while one is running.
  const wake = () => {
    if (runningRef.current) return
    runningRef.current = true
    timerRef.current = setTimeout(
      () => stepRef.current(lastShownRef.current),
      PREVIEW_START_DELAY_MS,
    )
  }

  // Unmount is the ONLY teardown that must always run. Keeping it in its own
  // effect means no other effect's cleanup has to cancel a chain it did not
  // arm, so correctness no longer depends on effect declaration order.
  useEffect(() => stop, [])

  // One effect owns the whole lifecycle. A NEW SEARCH is the only full reset,
  // detected from a ref rather than a separate effect: `enabled` also flips on
  // a load-more error and its retry, and resetting there would replay the grid
  // from card 0 on the same search.
  //
  // This effect must NOT return `stop`. `visibleKey` is in its deps, so a
  // cleanup would cancel a live pass mid-turn on every scroll; `wake` already
  // no-ops while a chain is running, which is what keeps a live pass intact.
  const visibleKey = visibleIndices.join(",")
  useEffect(() => {
    if (passKeyRef.current !== passKey) {
      passKeyRef.current = passKey
      stop()
      lastShownRef.current = null
      setActiveIndex(null)
    }
    if (!enabled || reduceMotion) {
      stop()
      setActiveIndex(null)
      return
    }
    if (results.length === 0) return
    wake()
  }, [passKey, enabled, reduceMotion, results.length, visibleKey])

  // Backgrounding is not a blur: on Android the JS thread keeps running, so the
  // chain would keep spending Mux fetches for a screen nobody is looking at.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        if (enabled && !reduceMotion && resultsRef.current.length > 0) wake()
        return
      }
      stop()
      setActiveIndex(null)
    })
    return () => sub.remove()
  }, [enabled, reduceMotion])

  return activeIndex
}
