"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react"
import { useEligibleRecommendationImpression } from "./useEligibleRecommendationImpression"
import type { ExposureVisibilityCapability } from "./useEligibleRecommendationImpression"
import { recommendationFetchWithRetry } from "@/lib/recommendation-browser"
import { watchPath } from "@/lib/watch-paths"

type Surface = {
  surface: "watch-home" | "watch-search" | "watch-video" | "watch-series"
  block:
    | "hero"
    | "collections"
    | "authored"
    | "results"
    | "editorial"
    | "chapters"
    | "episodes"
  presentation:
    | "hero-card"
    | "carousel"
    | "grid"
    | "result-list"
    | "authored-block"
    | "episode-grid"
  placement: string
}

type Card = { path: string; position: number }
const ENDPOINT = watchPath("/api/recommendations/surface-exposure")
const WATCH_ITEM_PATH =
  /^\/watch\/[a-zA-Z0-9_-]+\.html(?:\/[a-zA-Z0-9_-]+\.html){0,2}$/
const MAX_BATCH_BYTES = 48 * 1024
const encoder = new TextEncoder()

/**
 * Instruments only public Watch video links within an explicit block. Cards
 * remain ordinary anchors and the telemetry request never delays navigation.
 */
export function WatchExposureBoundary({
  config,
  children,
  rootRef,
}: {
  config: Surface
  children: ReactNode
  rootRef?: RefObject<HTMLDivElement | null>
}) {
  const internalRoot = useRef<HTMLDivElement>(null)
  const root = rootRef ?? internalRoot
  const cards = useRef(
    new Map<HTMLAnchorElement, { key: string; card: Card }>(),
  )
  const rendered = useRef(new Set<string>())
  const pending = useRef<Array<Record<string, unknown>>>([])
  const flushTimer = useRef<number | null>(null)
  const [windowId, setWindowId] = useState(() => crypto.randomUUID())
  const { surface, block, presentation, placement } = config

  const flush = useCallback(() => {
    if (flushTimer.current != null) {
      window.clearTimeout(flushTimer.current)
      flushTimer.current = null
    }
    while (pending.current.length > 0) {
      const batch: Array<Record<string, unknown>> = []
      while (batch.length < 64 && pending.current.length > 0) {
        const candidate = pending.current[0]
        if (
          batch.length > 0 &&
          encoder.encode(JSON.stringify([...batch, candidate])).byteLength >
            MAX_BATCH_BYTES
        )
          break
        batch.push(pending.current.shift()!)
      }
      const body = JSON.stringify(batch)
      void recommendationFetchWithRetry(
        ENDPOINT,
        {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          keepalive: true,
          headers: { "content-type": "application/json" },
          body,
        },
        700,
      ).catch(() => undefined)
    }
  }, [])

  const send = useCallback(
    (
      card: Card,
      kind: "rendered" | "eligible" | "selected",
      visibilityCapability: ExposureVisibilityCapability | null = null,
    ) => {
      pending.current.push({
        eventId: crypto.randomUUID(),
        windowId,
        surface,
        block,
        presentation,
        placement,
        policyVersion: "watch-exposure-v1",
        position: card.position,
        itemPath: card.path,
        kind,
        visibilityCapability,
        occurredAt: new Date().toISOString(),
      })
      if (pending.current.length >= 64) {
        flush()
      } else if (flushTimer.current == null) {
        flushTimer.current = window.setTimeout(flush, 120)
      }
    },
    [surface, block, presentation, placement, windowId, flush],
  )
  const onEligible = useCallback(
    (key: string, capability: ExposureVisibilityCapability) => {
      const card = [...cards.current.values()].find(
        (value) => value.key === key,
      )
      if (card) send(card.card, "eligible", capability)
    },
    [send],
  )
  const attach = useEligibleRecommendationImpression({
    envelopeKey: windowId,
    onEligible,
  })

  useEffect(() => {
    const element = root.current
    if (!element) return
    const attachedCards = cards.current
    let scheduled = 0
    const scan = () => {
      scheduled = 0
      const current = new Set<HTMLAnchorElement>()
      const occurrences = new Map<string, number>()
      let position = 0
      for (const anchor of element.querySelectorAll<HTMLAnchorElement>(
        "a[href]",
      )) {
        if (
          anchor.closest(
            '[data-block-type="HomepageRecommendations"],[data-block-type="SemanticRecommendations"]',
          )
        )
          continue
        let path: string
        try {
          const url = new URL(anchor.href)
          if (url.origin !== window.location.origin) continue
          path = url.pathname
        } catch {
          continue
        }
        if (!WATCH_ITEM_PATH.test(path)) continue
        if (position >= 100) break
        const card = { path, position }
        const occurrence = occurrences.get(path) ?? 0
        occurrences.set(path, occurrence + 1)
        const key = `${position}:${path}#${occurrence}`
        position += 1
        current.add(anchor)
        const previous = cards.current.get(anchor)
        if (previous?.key === key) {
          cards.current.set(anchor, { key, card })
          continue
        }
        if (previous) attach(previous.key, null)
        cards.current.set(anchor, { key, card })
        attach(key, anchor)
        if (!rendered.current.has(key)) {
          rendered.current.add(key)
          send(card, "rendered")
        }
      }
      for (const [anchor, value] of cards.current) {
        if (current.has(anchor)) continue
        attach(value.key, null)
        cards.current.delete(anchor)
      }
    }
    const scheduleScan = () => {
      if (scheduled) return
      scheduled = window.requestAnimationFrame(scan)
    }
    scan()
    const observer = new MutationObserver(scheduleScan)
    observer.observe(element, {
      childList: true,
      attributes: true,
      attributeFilter: ["href"],
      subtree: true,
    })
    window.addEventListener("resize", scheduleScan)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", scheduleScan)
      if (scheduled) window.cancelAnimationFrame(scheduled)
      for (const value of attachedCards.values()) attach(value.key, null)
      attachedCards.clear()
    }
  }, [attach, root, send, windowId])

  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      rendered.current.clear()
      setWindowId(crypto.randomUUID())
    }
    window.addEventListener("pageshow", restore)
    window.addEventListener("pagehide", flush)
    return () => {
      window.removeEventListener("pageshow", restore)
      window.removeEventListener("pagehide", flush)
      flush()
    }
  }, [flush])

  const selected = useCallback(
    (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest<HTMLAnchorElement>("a[href]")
      if (!anchor) return
      const item = cards.current.get(anchor)
      if (item) {
        send(item.card, "selected")
        flush()
      }
    },
    [send, flush],
  )
  useEffect(() => {
    const element = root.current
    if (!element) return
    element.addEventListener("click", selected)
    return () => element.removeEventListener("click", selected)
  }, [root, selected])
  if (rootRef) return <>{children}</>
  return (
    <div
      ref={internalRoot}
      className="contents"
      data-watch-exposure-block={block}
      data-watch-exposure-presentation={presentation}
    >
      {children}
    </div>
  )
}
