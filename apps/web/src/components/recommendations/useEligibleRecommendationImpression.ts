"use client"

import { useCallback, useEffect, useRef } from "react"

const MINIMUM_INTERSECTION_RATIO = 0.5
const CONTINUOUS_DWELL_MS = 1_000

export function useEligibleRecommendationImpression({
  envelopeKey,
  onEligible,
}: {
  envelopeKey: string
  onEligible: (itemId: string) => void
}) {
  const nodes = useRef(new Map<Element, string>())
  const observer = useRef<IntersectionObserver | null>(null)
  const ratios = useRef(new Map<string, number>())
  const timers = useRef(new Map<string, number>())

  const cancel = useCallback((itemId: string) => {
    const timer = timers.current.get(itemId)
    if (timer != null) window.clearTimeout(timer)
    timers.current.delete(itemId)
  }, [])

  const begin = useCallback(
    (itemId: string) => {
      if (
        document.visibilityState !== "visible" ||
        (ratios.current.get(itemId) ?? 0) < MINIMUM_INTERSECTION_RATIO ||
        timers.current.has(itemId)
      ) {
        return
      }
      timers.current.set(
        itemId,
        window.setTimeout(() => {
          timers.current.delete(itemId)
          if (
            document.visibilityState === "visible" &&
            (ratios.current.get(itemId) ?? 0) >= MINIMUM_INTERSECTION_RATIO
          ) {
            onEligible(itemId)
          }
        }, CONTINUOUS_DWELL_MS),
      )
    },
    [onEligible],
  )

  useEffect(() => {
    const activeTimers = timers.current
    const activeRatios = ratios.current
    const nextObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const itemId = nodes.current.get(entry.target)
          if (!itemId) continue
          const ratio = entry.isIntersecting ? entry.intersectionRatio : 0
          ratios.current.set(itemId, ratio)
          if (ratio >= MINIMUM_INTERSECTION_RATIO) begin(itemId)
          else cancel(itemId)
        }
      },
      { threshold: [MINIMUM_INTERSECTION_RATIO] },
    )
    observer.current = nextObserver
    for (const node of nodes.current.keys()) nextObserver.observe(node)

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        for (const itemId of timers.current.keys()) cancel(itemId)
        return
      }
      for (const itemId of ratios.current.keys()) begin(itemId)
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange)
      nextObserver.disconnect()
      observer.current = null
      for (const timer of activeTimers.values()) window.clearTimeout(timer)
      activeTimers.clear()
      activeRatios.clear()
    }
  }, [begin, cancel, envelopeKey])

  return useCallback(
    (itemId: string, node: HTMLAnchorElement | null) => {
      for (const [existingNode, existingId] of nodes.current) {
        if (existingId !== itemId || existingNode === node) continue
        observer.current?.unobserve(existingNode)
        nodes.current.delete(existingNode)
      }
      if (node == null) {
        cancel(itemId)
        ratios.current.delete(itemId)
        return
      }
      nodes.current.set(node, itemId)
      observer.current?.observe(node)
    },
    [cancel],
  )
}
