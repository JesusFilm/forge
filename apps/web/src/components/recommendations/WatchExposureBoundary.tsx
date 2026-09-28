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
import { waitForRecommendationActivation } from "@/lib/recommendation-activation"
import type { SignedWatchSurfaceManifest } from "@/lib/watch-surface-manifest"
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

type Card = { path: string; position: number; issuedPosition?: number }
type Fact = Record<string, unknown>
const DELIVERY_ENDPOINT = watchPath("/api/recommendations/surface-delivery")
const MAX_BUFFERED_EVENTS = 256
const MAX_BUFFER_AGE_MS = 2_000
const ENDPOINT = watchPath("/api/recommendations/surface-exposure")
const WATCH_ITEM_PATH =
  /^\/watch\/[a-zA-Z0-9_-]+\.html(?:\/[a-zA-Z0-9_-]+\.html){0,2}$/
const MAX_BATCH_BYTES = 48 * 1024
const encoder = new TextEncoder()

/**
 * Instruments only public Watch video links within an explicit block. Cards
 * remain ordinary anchors and the telemetry request never delays navigation.
 */
type BoundaryProps = {
  config: Surface
  children: ReactNode
  rootRef?: RefObject<HTMLDivElement | null>
  manifest?: SignedWatchSurfaceManifest | null
}

export function WatchExposureBoundary(props: BoundaryProps) {
  // A new block projection/placement gets its own attempt, dwell and event window.
  return (
    <ExposureWindow
      key={JSON.stringify([props.config, props.manifest])}
      {...props}
    />
  )
}

function ExposureWindow({
  config,
  children,
  rootRef,
  manifest,
}: BoundaryProps) {
  const internalRoot = useRef<HTMLDivElement>(null)
  const root = rootRef ?? internalRoot
  const coverageRoot = useRef<Element | null>(null)
  const cards = useRef(
    new Map<HTMLAnchorElement, { key: string; card: Card }>(),
  )
  const rendered = useRef(new Set<string>())
  const pending = useRef<Array<Record<string, unknown>>>([])
  const flushTimer = useRef<number | null>(null)
  const [windowId, setWindowId] = useState(() => crypto.randomUUID())
  const { surface, block, presentation, placement } = config
  const descriptor =
    manifest &&
    manifest.manifest.surface === surface &&
    manifest.manifest.block === block &&
    manifest.manifest.presentation === presentation &&
    manifest.manifest.placement === placement &&
    manifest.manifest.policyVersion === "watch-exposure-v2"
      ? manifest
      : null
  const lifecycle = useRef({
    active: false,
    activated:
      typeof document !== "undefined" &&
      !(document as Document & { prerendering?: boolean }).prerendering,
    ready:
      !descriptor &&
      typeof document !== "undefined" &&
      document.readyState === "complete" &&
      !(document as Document & { prerendering?: boolean }).prerendering,
    attemptId: crypto.randomUUID(),
    receipt: null as null | {
      windowId: string
      items: Array<{ position: number; itemPath: string }>
    },
    waiting: !!descriptor,
    buffered: [] as Fact[],
    ageTimer: null as number | null,
  })

  const flush = useCallback(() => {
    if (flushTimer.current != null) {
      window.clearTimeout(flushTimer.current)
      flushTimer.current = null
    }
    if (!lifecycle.current.ready) return
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

  const enqueue = useCallback(
    (fact: Fact) => {
      // A page whose load never completes must not retain an unbounded legacy
      // fallback queue. Prefer selections; overflow remains unknown coverage.
      if (
        !lifecycle.current.ready &&
        pending.current.length >= MAX_BUFFERED_EVENTS
      ) {
        const discard = pending.current.findIndex(
          (event) => event.kind !== "selected",
        )
        if (discard < 0 && fact.kind !== "selected") return
        pending.current.splice(discard < 0 ? 0 : discard, 1)
        coverageRoot.current?.setAttribute(
          "data-watch-exposure-coverage",
          "buffer-overflow",
        )
      }
      pending.current.push(fact)
      if (pending.current.length >= 64) flush()
      else if (flushTimer.current == null)
        flushTimer.current = window.setTimeout(flush, 120)
    },
    [flush],
  )
  const settleBuffered = useCallback(() => {
    const state = lifecycle.current
    if (state.ageTimer != null) window.clearTimeout(state.ageTimer)
    state.ageTimer = null
    state.waiting = false
    for (const fact of state.buffered.splice(0)) {
      const position = fact.issuedPosition
      delete fact.issuedPosition
      const issued = state.receipt?.items.some(
        (item) => item.position === position && item.itemPath === fact.itemPath,
      )
      enqueue(
        issued
          ? {
              ...fact,
              windowId: state.receipt!.windowId,
              policyVersion: "watch-exposure-v2",
              position,
            }
          : fact,
      )
    }
  }, [enqueue])
  const send = useCallback(
    (
      card: Card,
      kind: "rendered" | "eligible" | "selected",
      visibilityCapability: ExposureVisibilityCapability | null = null,
    ) => {
      const state = lifecycle.current
      const fact: Fact = {
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
      }
      if (state.waiting && card.issuedPosition != null) {
        if (state.buffered.length >= MAX_BUFFERED_EVENTS) settleBuffered()
        else {
          state.buffered.push({ ...fact, issuedPosition: card.issuedPosition })
          if (state.ageTimer == null)
            state.ageTimer = window.setTimeout(
              settleBuffered,
              MAX_BUFFER_AGE_MS,
            )
          return
        }
      }
      const issued = state.receipt?.items.some(
        (item) =>
          item.position === card.issuedPosition && item.itemPath === card.path,
      )
      enqueue(
        issued
          ? {
              ...fact,
              windowId: state.receipt!.windowId,
              policyVersion: "watch-exposure-v2",
              position: card.issuedPosition,
            }
          : fact,
      )
    },
    [
      surface,
      block,
      presentation,
      placement,
      windowId,
      enqueue,
      settleBuffered,
    ],
  )

  useEffect(() => {
    const state = lifecycle.current
    const controller = new AbortController()
    const attemptId = state.attemptId
    state.active = true
    const afterLoad = () =>
      new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          window.removeEventListener("load", loaded)
          controller.signal.removeEventListener("abort", aborted)
        }
        const loaded = () => {
          cleanup()
          resolve()
        }
        const aborted = () => {
          cleanup()
          reject(new DOMException("Cancelled", "AbortError"))
        }
        if (controller.signal.aborted) return aborted()
        if (document.readyState === "complete") return resolve()
        window.addEventListener("load", loaded, { once: true })
        controller.signal.addEventListener("abort", aborted, { once: true })
      })
    void (async () => {
      await waitForRecommendationActivation(controller.signal)
      if (controller.signal.aborted) return
      state.activated = true
      await afterLoad()
      if (controller.signal.aborted) return
      state.ready = true
      flush()
      if (!descriptor) return
      try {
        const response = await recommendationFetchWithRetry(
          DELIVERY_ENDPOINT,
          {
            method: "POST",
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ descriptor, attemptId }),
          },
          700,
        )
        const receipt = await response.json()
        if (
          controller.signal.aborted ||
          !state.active ||
          state.attemptId !== attemptId
        )
          return
        if (
          receipt.disposition === "measured" &&
          (receipt.status === "accepted" || receipt.status === "replay") &&
          typeof receipt.windowId === "string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            receipt.windowId,
          ) &&
          Array.isArray(receipt.items) &&
          receipt.items.length === descriptor.manifest.items.length &&
          receipt.items.every(
            (item: { position: number; itemPath: string }, index: number) =>
              item?.position === descriptor.manifest.items[index].position &&
              item?.itemPath === descriptor.manifest.items[index].itemPath,
          )
        ) {
          state.receipt = receipt
        }
        settleBuffered()
      } catch {
        if (!controller.signal.aborted) settleBuffered()
      }
    })().catch(() => undefined)
    return () => {
      state.active = false
      controller.abort()
      // StrictMode's immediate effect restart retains one attempt and its facts.
      queueMicrotask(() => {
        if (state.active) return
        // Departure telemetry cannot contend with the departing player/page.
        state.ready = state.activated
        settleBuffered()
        flush()
      })
    }
  }, [descriptor, windowId, settleBuffered, flush])
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
    coverageRoot.current = element
    // External roots also declare ownership, so authored parents cannot count
    // cards belonging to a signed nested section a second time.
    element.setAttribute("data-watch-exposure-block", block)
    element.setAttribute("data-watch-exposure-presentation", presentation)
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
        const owner = anchor.closest("[data-watch-exposure-block]")
        if (owner && owner !== element && element.contains(owner)) continue
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
        const card: Card = { path, position }
        const occurrence = occurrences.get(path) ?? 0
        occurrences.set(path, occurrence + 1)
        const issued = descriptor?.manifest.items.find(
          (item) =>
            item.itemPath === path &&
            item.position === (presentation === "hero-card" ? 0 : position),
        )
        if (issued) card.issuedPosition = issued.position
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
  }, [attach, root, send, windowId, descriptor, presentation, block])

  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      settleBuffered()
      flush()
      lifecycle.current.receipt = null
      lifecycle.current.waiting = !!descriptor
      lifecycle.current.attemptId = crypto.randomUUID()
      rendered.current.clear()
      setWindowId(crypto.randomUUID())
    }
    window.addEventListener("pageshow", restore)
    const hide = () => {
      lifecycle.current.ready = lifecycle.current.activated
      settleBuffered()
      flush()
    }
    window.addEventListener("pagehide", hide)
    return () => {
      window.removeEventListener("pageshow", restore)
      window.removeEventListener("pagehide", hide)
    }
  }, [flush, settleBuffered, descriptor])

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
