"use client"

import { useCallback, useEffect, useRef } from "react"

const MINIMUM_INTERSECTION_RATIO = 0.5
const CONTINUOUS_DWELL_MS = 1_000

export type ExposureVisibilityCapability = "occlusion-aware" | "unknown"

/** One eligible impression per item and envelope, across node replacement. */
export function useEligibleRecommendationImpression({
  envelopeKey,
  onEligible,
  onCapability,
}: {
  envelopeKey: string
  onEligible: (itemId: string, capability: ExposureVisibilityCapability) => void
  onCapability?: (capability: ExposureVisibilityCapability) => void
}) {
  const nodes = useRef(new Map<Element, string>())
  const observer = useRef<IntersectionObserver | null>(null)
  const visible = useRef(new Set<string>())
  const emitted = useRef(new Set<string>())
  const timers = useRef(new Map<string, number>())
  const lastEnvelope = useRef(envelopeKey)
  const capability = useRef<ExposureVisibilityCapability>("unknown")

  const cancel = useCallback((itemId: string) => {
    const timer = timers.current.get(itemId)
    if (timer != null) window.clearTimeout(timer)
    timers.current.delete(itemId)
  }, [])

  const begin = useCallback(
    (itemId: string) => {
      if (
        document.visibilityState !== "visible" ||
        !visible.current.has(itemId) ||
        emitted.current.has(itemId) ||
        timers.current.has(itemId)
      )
        return
      timers.current.set(
        itemId,
        window.setTimeout(() => {
          timers.current.delete(itemId)
          if (
            document.visibilityState === "visible" &&
            visible.current.has(itemId) &&
            !emitted.current.has(itemId)
          ) {
            emitted.current.add(itemId)
            onEligible(itemId, capability.current)
          }
        }, CONTINUOUS_DWELL_MS),
      )
    },
    [onEligible],
  )

  useEffect(() => {
    const activeTimers = timers.current
    const activeVisible = visible.current
    if (lastEnvelope.current !== envelopeKey) {
      emitted.current.clear()
      lastEnvelope.current = envelopeKey
    }
    // V1 cannot detect overlays; its occlusion capability remains unknown.
    const supportsVisibility =
      typeof IntersectionObserverEntry !== "undefined" &&
      "isVisible" in IntersectionObserverEntry.prototype
    const callback: IntersectionObserverCallback = (entries) => {
      for (const entry of entries) {
        const itemId = nodes.current.get(entry.target)
        if (!itemId) continue
        const eligible =
          entry.isIntersecting &&
          entry.intersectionRatio >= MINIMUM_INTERSECTION_RATIO &&
          (capability.current === "unknown" ||
            (entry as IntersectionObserverEntry & { isVisible?: boolean })
              .isVisible === true)
        if (eligible) {
          visible.current.add(itemId)
          begin(itemId)
        } else {
          visible.current.delete(itemId)
          cancel(itemId)
        }
      }
    }
    let nextObserver: IntersectionObserver
    try {
      if (!supportsVisibility) throw new TypeError("visibility unavailable")
      nextObserver = new IntersectionObserver(callback, {
        threshold: [MINIMUM_INTERSECTION_RATIO],
        trackVisibility: true,
        delay: 100,
      } as IntersectionObserverInit)
      capability.current = "occlusion-aware"
    } catch {
      nextObserver = new IntersectionObserver(callback, {
        threshold: [MINIMUM_INTERSECTION_RATIO],
      })
      capability.current = "unknown"
    }
    onCapability?.(capability.current)
    observer.current = nextObserver
    for (const node of nodes.current.keys()) nextObserver.observe(node)
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        for (const itemId of timers.current.keys()) cancel(itemId)
      } else {
        for (const itemId of visible.current) begin(itemId)
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange)
      nextObserver.disconnect()
      observer.current = null
      for (const timer of activeTimers.values()) window.clearTimeout(timer)
      activeTimers.clear()
      activeVisible.clear()
    }
  }, [begin, cancel, envelopeKey, onCapability])

  return useCallback(
    (itemId: string, node: HTMLAnchorElement | null) => {
      for (const [existingNode, existingId] of nodes.current) {
        if (existingId !== itemId || existingNode === node) continue
        observer.current?.unobserve(existingNode)
        nodes.current.delete(existingNode)
        cancel(itemId)
        visible.current.delete(itemId)
      }
      if (node == null) {
        for (const [existingNode, existingId] of nodes.current) {
          if (existingId !== itemId) continue
          observer.current?.unobserve(existingNode)
          nodes.current.delete(existingNode)
        }
        cancel(itemId)
        visible.current.delete(itemId)
        return
      }
      nodes.current.set(node, itemId)
      observer.current?.observe(node)
    },
    [cancel],
  )
}
