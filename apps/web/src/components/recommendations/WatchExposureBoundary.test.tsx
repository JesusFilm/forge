/** @vitest-environment jsdom */
import React, { act, createRef, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SignedWatchSurfaceManifest } from "@/lib/watch-surface-manifest"
import { RecommendationRuntimeError } from "@/lib/recommendation-errors"

const { fetchWithRetry } = vi.hoisted(() => ({
  fetchWithRetry:
    vi.fn<
      (
        url: string,
        init: RequestInit,
        deadline: number,
        options?: { attempts?: number },
      ) => Promise<Response>
    >(),
}))
vi.mock("@/lib/recommendation-browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/recommendation-browser")>()),
  recommendationFetchWithRetry: fetchWithRetry,
}))
import { WatchExposureBoundary } from "./WatchExposureBoundary"

let observerCallback: IntersectionObserverCallback
const observed = new Set<Element>()
class TestObserver implements IntersectionObserver {
  readonly root = null
  readonly rootMargin = "0px"
  readonly thresholds = [0.5]
  constructor(callback: IntersectionObserverCallback) {
    observerCallback = callback
  }
  observe(node: Element) {
    observed.add(node)
  }
  unobserve(node: Element) {
    observed.delete(node)
  }
  disconnect() {
    observed.clear()
  }
  takeRecords() {
    return []
  }
}
const config = {
  surface: "watch-search",
  block: "results",
  presentation: "result-list",
  placement: "search-results",
} as const

function bodies() {
  return fetchWithRetry.mock.calls.flatMap((call) => {
    if (call[0].endsWith("surface-delivery")) return []
    const init = call[1] as RequestInit
    return JSON.parse(String(init.body)) as Array<Record<string, unknown>>
  })
}

describe("WatchExposureBoundary", () => {
  let root: Root
  let container: HTMLDivElement
  let uuid = 0
  beforeEach(() => {
    vi.useFakeTimers()
    fetchWithRetry.mockReset()
    fetchWithRetry.mockImplementation(async (url, init) =>
      successfulResponse(url, init),
    )
    Object.defineProperty(document, "readyState", {
      configurable: true,
      value: "complete",
    })
    Object.defineProperty(document, "prerendering", {
      configurable: true,
      value: false,
    })
    observed.clear()
    vi.stubGlobal("IntersectionObserver", TestObserver)
    vi.stubGlobal("IntersectionObserverEntry", undefined)
    vi.stubGlobal("crypto", {
      randomUUID: () =>
        `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`,
    })
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    })
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  const manifest = {
    manifest: {
      ...config,
      policyVersion: "watch-exposure-v2" as const,
      items: [{ position: 0, itemPath: "/watch/first.html" }],
      sourceVersion: "a".repeat(64),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    signature: "test-signature",
  }
  const receipt = {
    disposition: "measured",
    status: "accepted",
    windowId: "10000000-0000-4000-8000-000000000001",
    items: manifest.manifest.items,
  }
  const successfulResponse = (
    url: string,
    init: RequestInit,
    delivery: unknown = receipt,
  ) => {
    if (url.endsWith("surface-delivery"))
      return new Response(JSON.stringify(delivery))
    const events = JSON.parse(String(init.body)) as Array<{ eventId: string }>
    return new Response(
      JSON.stringify({
        receipts: events.map(({ eventId }) => ({
          eventId,
          status: "accepted",
        })),
      }),
    )
  }
  const deliveryCalls = () =>
    fetchWithRetry.mock.calls.filter((call) =>
      call[0].endsWith("surface-delivery"),
    )
  const renderMeasured = (descriptor: SignedWatchSurfaceManifest = manifest) =>
    root.render(
      <WatchExposureBoundary config={config} manifest={descriptor}>
        <a href="/watch/first.html" onClick={(event) => event.preventDefault()}>
          first
        </a>
      </WatchExposureBoundary>,
    )
  const drain = async () => {
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  const externalRoot = () => createRef<HTMLDivElement>()
  const renderExternal = (
    actionsRef: ReturnType<typeof externalRoot>,
    measurementKey: string,
    descriptor: SignedWatchSurfaceManifest | null = manifest,
    path = "/watch/first.html",
  ) =>
    root.render(
      <WatchExposureBoundary
        config={config}
        rootRef={actionsRef}
        manifest={descriptor}
        measurementKey={measurementKey}
      >
        <div ref={actionsRef}>
          <a href={path} onClick={(event) => event.preventDefault()}>
            watch
          </a>
          <button type="button">queue control</button>
        </div>
      </WatchExposureBoundary>,
    )
  const intersect = (target: Element) =>
    observerCallback(
      [
        {
          target,
          isIntersecting: true,
          intersectionRatio: 0.5,
        } as unknown as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver,
    )

  it("keeps external DOM, focus and component state across descriptor changes", async () => {
    const actionsRef = externalRoot()
    function Controls({ path }: { path: string }) {
      const [count, setCount] = React.useState(0)
      return (
        <div ref={actionsRef}>
          <a href={path}>watch</a>
          <button type="button" onClick={() => setCount((value) => value + 1)}>
            {count}
          </button>
        </div>
      )
    }
    const render = (descriptor: SignedWatchSurfaceManifest, path: string) =>
      root.render(
        <WatchExposureBoundary
          config={config}
          manifest={descriptor}
          rootRef={actionsRef}
        >
          <Controls path={path} />
        </WatchExposureBoundary>,
      )
    act(() => render(manifest, "/watch/first.html"))
    await drain()
    const originalRoot = actionsRef.current
    const anchor = container.querySelector("a")!
    const button = container.querySelector("button")!
    act(() => button.click())
    button.focus()
    const replacement = {
      ...manifest,
      manifest: {
        ...manifest.manifest,
        items: [{ position: 0, itemPath: "/watch/second.html" }],
      },
    }
    act(() => render(replacement, "/watch/second.html"))
    await drain()
    expect(actionsRef.current).toBe(originalRoot)
    expect(container.querySelector("a")).toBe(anchor)
    expect(container.querySelector("button")).toBe(button)
    expect(document.activeElement).toBe(button)
    expect(button.textContent).toBe("1")
    expect(deliveryCalls()).toHaveLength(2)
  })

  it("starts fresh rendered and dwell measurement for different active IDs sharing one href", async () => {
    fetchWithRetry.mockImplementation(async (url, init) =>
      successfulResponse(url, init),
    )
    const actionsRef = externalRoot()
    act(() => renderExternal(actionsRef, "slide-a"))
    await drain()
    const anchor = container.querySelector("a")!
    act(() => intersect(anchor))
    act(() => vi.advanceTimersByTime(500))
    act(() => renderExternal(actionsRef, "slide-b"))
    await drain()
    expect(container.querySelector("a")).toBe(anchor)
    act(() => intersect(anchor))
    act(() => vi.advanceTimersByTime(620))
    expect(bodies().filter((event) => event.kind === "eligible")).toHaveLength(
      0,
    )
    act(() => vi.advanceTimersByTime(500))
    await drain()
    expect(bodies().filter((event) => event.kind === "rendered")).toHaveLength(
      2,
    )
    expect(bodies().filter((event) => event.kind === "eligible")).toHaveLength(
      1,
    )
    const attempts = deliveryCalls().map(
      (call) => JSON.parse(String(call[1].body)).attemptId,
    )
    expect(attempts).toHaveLength(2)
    expect(attempts[0]).not.toBe(attempts[1])
  })

  it("keeps the same measurement window and dwell across playback query changes", async () => {
    fetchWithRetry.mockImplementation(async (url, init) =>
      successfulResponse(url, init),
    )
    const actionsRef = externalRoot()
    act(() =>
      renderExternal(
        actionsRef,
        "slide-a",
        manifest,
        "/watch/first.html?autoplay=1&t=12",
      ),
    )
    await drain()
    const anchor = container.querySelector("a")!
    act(() => intersect(anchor))
    act(() => vi.advanceTimersByTime(500))
    act(() =>
      renderExternal(
        actionsRef,
        "slide-a",
        manifest,
        "/watch/first.html?autoplay=1&t=13",
      ),
    )
    await drain()
    act(() => vi.advanceTimersByTime(620))
    expect(deliveryCalls()).toHaveLength(1)
    expect(bodies().filter((event) => event.kind === "rendered")).toHaveLength(
      1,
    )
    expect(bodies().filter((event) => event.kind === "eligible")).toHaveLength(
      1,
    )
  })

  it("ignores stale receipts after a measurement-key-only switch", async () => {
    const deliveries: Array<(response: Response) => void> = []
    fetchWithRetry.mockImplementation((url, init) =>
      url.endsWith("surface-delivery")
        ? new Promise<Response>((resolve) => deliveries.push(resolve))
        : Promise.resolve(successfulResponse(url, init)),
    )
    const actionsRef = externalRoot()
    act(() => renderExternal(actionsRef, "slide-a"))
    await drain()
    act(() => renderExternal(actionsRef, "slide-b"))
    await drain()
    await act(async () => {
      deliveries[0](new Response(JSON.stringify(receipt)))
      await Promise.resolve()
    })
    act(() => container.querySelector("a")!.click())
    act(() => vi.advanceTimersByTime(2120))
    expect(bodies().filter((event) => event.kind === "selected")).toEqual([
      expect.objectContaining({
        itemPath: "/watch/first.html",
        policyVersion: "watch-exposure-v1",
      }),
    ])
  })

  it("reconciles a rapid href switch before selection without waiting for a frame", async () => {
    fetchWithRetry.mockImplementation(async (url, init) =>
      successfulResponse(url, init),
    )
    const actionsRef = externalRoot()
    act(() => renderExternal(actionsRef, "slide-a"))
    await drain()
    const anchor = container.querySelector("a")!
    act(() => {
      anchor.href = "/watch/second.html?autoplay=1"
      anchor.click()
    })
    expect(bodies().filter((event) => event.kind === "selected")).toEqual([
      expect.objectContaining({
        itemPath: "/watch/second.html",
        policyVersion: "watch-exposure-v1",
      }),
    ])
    expect(
      bodies().some(
        (event) =>
          event.kind === "rendered" && event.itemPath === "/watch/second.html",
      ),
    ).toBe(true)
    expect(bodies().filter((event) => event.kind === "eligible")).toHaveLength(
      0,
    )
  })

  it("does not issue an empty or unknown descriptor, then measures a valid active target", async () => {
    const actionsRef = externalRoot()
    const empty = { ...manifest, manifest: { ...manifest.manifest, items: [] } }
    act(() => renderExternal(actionsRef, "intro", empty, "#intro"))
    await drain()
    expect(deliveryCalls()).toHaveLength(0)
    expect(bodies()).toHaveLength(0)
    act(() =>
      renderExternal(actionsRef, "unknown", null, "/watch/unknown.html"),
    )
    await drain()
    act(() => vi.advanceTimersByTime(120))
    expect(deliveryCalls()).toHaveLength(0)
    expect(bodies()[0]).toMatchObject({
      kind: "rendered",
      itemPath: "/watch/unknown.html",
      policyVersion: "watch-exposure-v1",
    })
    fetchWithRetry.mockImplementation(async (url, init) =>
      successfulResponse(url, init),
    )
    act(() => renderExternal(actionsRef, "valid"))
    await drain()
    act(() => vi.advanceTimersByTime(120))
    expect(deliveryCalls()).toHaveLength(1)
    expect(
      bodies().some(
        (event) =>
          event.kind === "rendered" &&
          event.policyVersion === "watch-exposure-v2",
      ),
    ).toBe(true)
  })

  it("waits for activation and load before issuing, retaining early selection", async () => {
    Object.defineProperty(document, "prerendering", {
      configurable: true,
      value: true,
    })
    Object.defineProperty(document, "readyState", {
      configurable: true,
      value: "loading",
    })
    fetchWithRetry.mockImplementation(async (url, init) =>
      successfulResponse(url, init),
    )
    act(() => renderMeasured())
    act(() => container.querySelector("a")!.click())
    await drain()
    act(() => vi.advanceTimersByTime(120))
    expect(fetchWithRetry).not.toHaveBeenCalled()
    Object.defineProperty(document, "prerendering", {
      configurable: true,
      value: false,
    })
    document.dispatchEvent(new Event("prerenderingchange"))
    await drain()
    expect(fetchWithRetry).not.toHaveBeenCalled()
    window.dispatchEvent(new Event("load"))
    await drain()
    act(() => vi.advanceTimersByTime(120))
    expect(deliveryCalls()).toHaveLength(1)
    expect(bodies().map((event) => event.kind)).toEqual([
      "rendered",
      "selected",
    ])
    expect(
      bodies().every(
        (event) =>
          event.policyVersion === "watch-exposure-v2" &&
          event.windowId === receipt.windowId,
      ),
    ).toBe(true)
  })

  it("sends departure fallback for selections made before load without issuing delivery", async () => {
    Object.defineProperty(document, "readyState", {
      configurable: true,
      value: "loading",
    })
    act(() => renderMeasured())
    act(() => container.querySelector("a")!.click())
    await drain()
    expect(fetchWithRetry).not.toHaveBeenCalled()
    act(() => window.dispatchEvent(new PageTransitionEvent("pagehide")))
    expect(deliveryCalls()).toHaveLength(0)
    expect(bodies().map((event) => event.kind)).toEqual([
      "rendered",
      "selected",
    ])
    expect(
      bodies().every((event) => event.policyVersion === "watch-exposure-v1"),
    ).toBe(true)
    // Departure telemetry still uses the bounded exposure deadline.
    expect(fetchWithRetry.mock.calls.length).toBeGreaterThan(0)
    expect(fetchWithRetry.mock.calls.map((call) => call[2])).toEqual(
      fetchWithRetry.mock.calls.map(() => 3_000),
    )
  })

  it("bounds waiting age and never replays fallback facts when a late receipt arrives", async () => {
    let deliver!: (response: Response) => void
    fetchWithRetry.mockImplementation((url, init) =>
      url.endsWith("surface-delivery")
        ? new Promise<Response>((resolve) => {
            deliver = resolve
          })
        : Promise.resolve(successfulResponse(url, init)),
    )
    act(() => renderMeasured())
    act(() => container.querySelector("a")!.click())
    const originalTime = new Date().toISOString()
    await drain()
    act(() => vi.advanceTimersByTime(2120))
    expect(bodies()).toHaveLength(2)
    expect(
      bodies().every(
        (event) =>
          event.policyVersion === "watch-exposure-v1" &&
          event.occurredAt === originalTime,
      ),
    ).toBe(true)
    await act(async () => {
      deliver(new Response(JSON.stringify(receipt)))
      await Promise.resolve()
    })
    act(() => container.querySelector("a")!.click())
    expect(bodies()).toHaveLength(3)
    expect(bodies()[2].policyVersion).toBe("watch-exposure-v2")
  })

  it("retains early selections on issuer failure without inventing served or eligibility", async () => {
    fetchWithRetry.mockImplementation(async (url, init) => {
      if (url.endsWith("surface-delivery")) throw new Error("unavailable")
      return successfulResponse(url, init)
    })
    act(() => renderMeasured())
    act(() => container.querySelector("a")!.click())
    await drain()
    act(() => vi.advanceTimersByTime(120))
    expect(bodies().map((event) => event.kind)).toEqual([
      "rendered",
      "selected",
    ])
    expect(
      bodies().every((event) => event.policyVersion === "watch-exposure-v1"),
    ).toBe(true)
  })

  it("rejects mismatched descriptors and unbound receipt items", async () => {
    act(() =>
      renderMeasured({
        ...manifest,
        manifest: { ...manifest.manifest, placement: "other" },
      }),
    )
    await drain()
    act(() => vi.advanceTimersByTime(120))
    expect(deliveryCalls()).toHaveLength(0)
    expect(bodies()[0].policyVersion).toBe("watch-exposure-v1")
    fetchWithRetry.mockImplementation(async (url, init) =>
      successfulResponse(url, init, { ...receipt, items: [] }),
    )
    act(() => renderMeasured())
    await drain()
    act(() => vi.advanceTimersByTime(120))
    expect(
      bodies().every((event) => event.policyVersion === "watch-exposure-v1"),
    ).toBe(true)
  })

  it("ignores old receipts across descriptor changes and uses a fresh attempt", async () => {
    const deliveries: Array<(response: Response) => void> = []
    fetchWithRetry.mockImplementation((url, init) =>
      url.endsWith("surface-delivery")
        ? new Promise<Response>((resolve) => deliveries.push(resolve))
        : Promise.resolve(successfulResponse(url, init)),
    )
    act(() => renderMeasured())
    await drain()
    act(() => renderMeasured({ ...manifest, signature: "new-signature" }))
    await drain()
    expect(deliveryCalls()).toHaveLength(2)
    const attempts = deliveryCalls().map(
      (call) => JSON.parse(String(call[1].body)).attemptId,
    )
    expect(attempts[0]).not.toBe(attempts[1])
    await act(async () => {
      deliveries[0](new Response(JSON.stringify(receipt)))
      await Promise.resolve()
    })
    act(() => container.querySelector("a")!.click())
    act(() => vi.advanceTimersByTime(2120))
    expect(
      bodies().every((event) => event.policyVersion === "watch-exposure-v1"),
    ).toBe(true)
  })

  it("StrictMode issues once and retains the original rendered event", async () => {
    fetchWithRetry.mockImplementation(async (url, init) =>
      successfulResponse(url, init),
    )
    act(() =>
      root.render(
        <StrictMode>
          <WatchExposureBoundary config={config} manifest={manifest}>
            <a href="/watch/first.html">first</a>
          </WatchExposureBoundary>
        </StrictMode>,
      ),
    )
    await drain()
    act(() => vi.advanceTimersByTime(120))
    expect(deliveryCalls()).toHaveLength(1)
    expect(bodies().map((event) => event.kind)).toEqual(["rendered"])
  })

  it("flushes a bounded queue without losing early selections on unmount", async () => {
    fetchWithRetry.mockImplementation((url, init) =>
      url.endsWith("surface-delivery")
        ? new Promise<Response>(() => {})
        : Promise.resolve(successfulResponse(url, init)),
    )
    act(() => renderMeasured())
    await drain()
    act(() => {
      for (let i = 0; i < 260; i++) container.querySelector("a")!.click()
    })
    await drain()
    expect(bodies().filter((event) => event.kind === "selected")).toHaveLength(
      260,
    )
    expect(
      bodies().every((event) => event.policyVersion === "watch-exposure-v1"),
    ).toBe(true)
    // A separate window still waiting must release its early facts at unmount.
    act(() => renderMeasured({ ...manifest, signature: "unmount" }))
    await drain()
    act(() => container.querySelector("a")!.click())
    await act(async () => root.render(null))
    expect(bodies().filter((event) => event.kind === "selected")).toHaveLength(
      261,
    )
  })

  it("retains a failed exposure batch and retries its original event ID after backoff", async () => {
    const sent: Array<Array<{ eventId: string }>> = []
    fetchWithRetry.mockImplementation(async (url, init) => {
      if (url.endsWith("surface-delivery")) return new Response("{}")
      const batch = JSON.parse(String(init.body)) as Array<{ eventId: string }>
      sent.push(batch)
      if (sent.length === 1) throw new Error("upstream unavailable")
      return new Response(
        JSON.stringify({
          receipts: batch.map(({ eventId }) => ({ eventId, status: "replay" })),
        }),
      )
    })
    act(() =>
      root.render(
        <WatchExposureBoundary config={config}>
          <a href="/watch/first.html">first</a>
        </WatchExposureBoundary>,
      ),
    )
    await drain()
    await act(async () => vi.advanceTimersByTimeAsync(120))
    expect(sent).toHaveLength(1)
    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(sent).toHaveLength(1)
    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual(sent[0])
  })

  it.each(["missing", "partial", "mismatched"] as const)(
    "retries a %s HTTP 200 receipt with the same event ID",
    async (kind) => {
      const sent: Array<Array<{ eventId: string }>> = []
      fetchWithRetry.mockImplementation(async (_url, init) => {
        const batch = JSON.parse(String(init.body)) as Array<{
          eventId: string
        }>
        sent.push(batch)
        if (sent.length > 1)
          return new Response(
            JSON.stringify({
              receipts: batch.map(({ eventId }) => ({
                eventId,
                status: "replay",
              })),
            }),
          )
        if (kind === "missing") return new Response("{}")
        if (kind === "partial")
          return new Response(JSON.stringify({ receipts: [] }))
        return new Response(
          JSON.stringify({
            receipts: [
              {
                eventId: "00000000-0000-4000-8000-999999999999",
                status: "accepted",
              },
            ],
          }),
        )
      })
      act(() =>
        root.render(
          <WatchExposureBoundary config={config}>
            <a href="/watch/first.html">first</a>
          </WatchExposureBoundary>,
        ),
      )
      await drain()
      await act(async () => vi.advanceTimersByTimeAsync(2_000))
      expect(sent).toHaveLength(2)
      expect(sent[1]).toEqual(sent[0])
    },
  )

  it("marks a conflicting HTTP 200 receipt as a definitive coverage gap", async () => {
    fetchWithRetry.mockImplementation(async (_url, init) => {
      const batch = JSON.parse(String(init.body)) as Array<{ eventId: string }>
      return new Response(
        JSON.stringify({
          receipts: batch.map(({ eventId }) => ({
            eventId,
            status: "conflict",
          })),
        }),
      )
    })
    act(() =>
      root.render(
        <WatchExposureBoundary config={config}>
          <a href="/watch/first.html">first</a>
        </WatchExposureBoundary>,
      ),
    )
    await drain()
    await act(async () => vi.advanceTimersByTimeAsync(30_000))
    expect(fetchWithRetry).toHaveBeenCalledTimes(1)
    expect(
      container
        .querySelector("[data-watch-exposure-coverage]")
        ?.getAttribute("data-watch-exposure-coverage"),
    ).toBe("conflict")
  })

  it("retries when exposure headers arrive but the receipt body never completes", async () => {
    const sent: Array<Array<{ eventId: string }>> = []
    fetchWithRetry.mockImplementation(async (url, init) => {
      const batch = JSON.parse(String(init.body)) as Array<{ eventId: string }>
      sent.push(batch)
      if (sent.length === 1)
        return new Response(new ReadableStream({ start() {} }))
      return successfulResponse(url, init)
    })
    act(() =>
      root.render(
        <WatchExposureBoundary config={config}>
          <a href="/watch/first.html">first</a>
        </WatchExposureBoundary>,
      ),
    )
    await drain()
    await act(async () => vi.advanceTimersByTimeAsync(5_100))
    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual(sent[0])
  })

  it("bounds delivery header and body together to one 4.5-second attempt", async () => {
    fetchWithRetry.mockImplementation(async (url, init) =>
      url.endsWith("surface-delivery")
        ? new Response(new ReadableStream({ start() {} }))
        : successfulResponse(url, init),
    )
    act(() => renderMeasured())
    await drain()
    expect(deliveryCalls()).toHaveLength(1)
    expect(deliveryCalls()[0][2]).toBe(4_500)
    expect(deliveryCalls()[0][3]).toEqual({ attempts: 1 })
    const signal = (deliveryCalls()[0][1] as RequestInit).signal!
    await act(async () => vi.advanceTimersByTimeAsync(4_499))
    expect(signal.aborted).toBe(false)
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(signal.aborted).toBe(true)
    expect(deliveryCalls()).toHaveLength(1)
  })

  it("does not retry a definitive rejected exposure", async () => {
    fetchWithRetry.mockRejectedValue(
      new RecommendationRuntimeError("request_failed", 400),
    )
    act(() =>
      root.render(
        <WatchExposureBoundary config={config}>
          <a href="/watch/first.html">first</a>
        </WatchExposureBoundary>,
      ),
    )
    await drain()
    await act(async () => vi.advanceTimersByTimeAsync(30_000))
    expect(fetchWithRetry).toHaveBeenCalledTimes(1)
    expect(
      container
        .querySelector("[data-watch-exposure-coverage]")
        ?.getAttribute("data-watch-exposure-coverage"),
    ).toBe("delivery-rejected")
  })

  it("serializes exposure batches while an acknowledgement is pending", async () => {
    let acknowledge!: (response: Response) => void
    const sent: Array<Array<{ eventId: string }>> = []
    fetchWithRetry.mockImplementation((_url, init) => {
      const batch = JSON.parse(String(init.body)) as Array<{ eventId: string }>
      sent.push(batch)
      if (sent.length === 1)
        return new Promise<Response>((resolve) => {
          acknowledge = resolve
        })
      return Promise.resolve(
        new Response(
          JSON.stringify({
            receipts: batch.map(({ eventId }) => ({
              eventId,
              status: "accepted",
            })),
          }),
        ),
      )
    })
    act(() =>
      root.render(
        <WatchExposureBoundary config={config}>
          <a
            href="/watch/first.html"
            onClick={(event) => event.preventDefault()}
          >
            first
          </a>
        </WatchExposureBoundary>,
      ),
    )
    await drain()
    await act(async () => vi.advanceTimersByTimeAsync(120))
    act(() => container.querySelector("a")!.click())
    await act(async () => vi.advanceTimersByTimeAsync(120))
    expect(sent).toHaveLength(1)
    await act(async () =>
      acknowledge(
        new Response(
          JSON.stringify({
            receipts: sent[0].map(({ eventId }) => ({
              eventId,
              status: "accepted",
            })),
          }),
        ),
      ),
    )
    expect(sent).toHaveLength(2)
    expect(sent[1][0].eventId).not.toBe(sent[0][0].eventId)
  })

  it("maps repeated paths to distinct positions and unknown paths to v1", async () => {
    const items = [
      { position: 0, itemPath: "/watch/first.html" },
      { position: 1, itemPath: "/watch/first.html" },
    ]
    fetchWithRetry.mockImplementation(async (url, init) =>
      successfulResponse(url, init, { ...receipt, items }),
    )
    act(() =>
      root.render(
        <WatchExposureBoundary
          config={config}
          manifest={{ ...manifest, manifest: { ...manifest.manifest, items } }}
        >
          <a href="/watch/first.html">first</a>
          <a href="/watch/first.html">repeated</a>
          <a href="/watch/unknown.html">unknown</a>
        </WatchExposureBoundary>,
      ),
    )
    await drain()
    act(() => vi.advanceTimersByTime(120))
    const events = bodies()
    expect(
      events
        .filter((event) => event.policyVersion === "watch-exposure-v2")
        .map((event) => event.position),
    ).toEqual([0, 1])
    expect(
      events.find((event) => event.itemPath === "/watch/unknown.html")
        ?.policyVersion,
    ).toBe("watch-exposure-v1")
  })

  it("maps each ordinary path to its exact position in a union of candidate slates", async () => {
    const items = [
      { position: 0, itemPath: "/watch/first.html" },
      { position: 0, itemPath: "/watch/second.html" },
      { position: 1, itemPath: "/watch/second.html" },
    ]
    fetchWithRetry.mockImplementation(async (url, init) =>
      successfulResponse(url, init, { ...receipt, items }),
    )
    act(() =>
      root.render(
        <WatchExposureBoundary
          config={config}
          manifest={{ ...manifest, manifest: { ...manifest.manifest, items } }}
        >
          <a href="/watch/first.html">first</a>
          <a href="/watch/second.html">second</a>
        </WatchExposureBoundary>,
      ),
    )
    await drain()
    act(() => vi.advanceTimersByTime(120))
    expect(
      bodies().map((event) => [event.position, event.policyVersion]),
    ).toEqual([
      [0, "watch-exposure-v2"],
      [1, "watch-exposure-v2"],
    ])
  })

  it("keeps hero candidate positions when different links share position zero", async () => {
    const heroConfig = {
      surface: "watch-home",
      block: "hero",
      presentation: "hero-card",
      placement: "home-hero",
    } as const
    const items = [
      { position: 0, itemPath: "/watch/first.html" },
      { position: 0, itemPath: "/watch/second.html" },
    ]
    fetchWithRetry.mockImplementation(async (url, init) =>
      successfulResponse(url, init, { ...receipt, items }),
    )
    act(() =>
      root.render(
        <WatchExposureBoundary
          config={heroConfig}
          manifest={{
            ...manifest,
            manifest: { ...manifest.manifest, ...heroConfig, items },
          }}
        >
          <a href="/watch/second.html">active hero</a>
        </WatchExposureBoundary>,
      ),
    )
    await drain()
    act(() => vi.advanceTimersByTime(120))
    expect(bodies()[0]).toMatchObject({
      itemPath: "/watch/second.html",
      position: 0,
      policyVersion: "watch-exposure-v2",
    })
  })

  it("issues a separate window after BFCache restoration", async () => {
    fetchWithRetry.mockImplementation(async (url, init) =>
      successfulResponse(url, init),
    )
    act(() => renderMeasured())
    await drain()
    act(() => vi.advanceTimersByTime(120))
    act(() =>
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      ),
    )
    await drain()
    act(() => vi.advanceTimersByTime(120))
    expect(deliveryCalls()).toHaveLength(2)
    expect(
      new Set(
        deliveryCalls().map(
          (call) => JSON.parse(String(call[1].body)).attemptId,
        ),
      ).size,
    ).toBe(2)
    expect(bodies().filter((event) => event.kind === "rendered")).toHaveLength(
      2,
    )
  })

  it("skips nested owners, including external roots, without duplicating parent facts", async () => {
    const nestedRoot = createRef<HTMLDivElement>()
    act(() =>
      root.render(
        <WatchExposureBoundary config={{ ...config, placement: "parent" }}>
          <a href="/watch/parent.html">parent</a>
          <WatchExposureBoundary
            config={{ ...config, placement: "nested" }}
            rootRef={nestedRoot}
          >
            <div ref={nestedRoot}>
              <a href="/watch/nested.html">nested</a>
            </div>
          </WatchExposureBoundary>
        </WatchExposureBoundary>,
      ),
    )
    await drain()
    act(() => vi.advanceTimersByTime(120))
    expect(bodies()).toHaveLength(2)
    expect(
      bodies().filter((event) => event.itemPath === "/watch/nested.html"),
    ).toEqual([
      expect.objectContaining({ placement: "nested", kind: "rendered" }),
    ])
  })

  it("caps a never-loaded fallback queue and visibly marks the coverage gap", async () => {
    Object.defineProperty(document, "readyState", {
      configurable: true,
      value: "loading",
    })
    act(() => renderMeasured())
    await drain()
    act(() => {
      for (let i = 0; i < 260; i++) container.querySelector("a")!.click()
    })
    expect(fetchWithRetry).not.toHaveBeenCalled()
    expect(
      container
        .querySelector("[data-watch-exposure-coverage]")
        ?.getAttribute("data-watch-exposure-coverage"),
    ).toBe("buffer-overflow")
    act(() => window.dispatchEvent(new PageTransitionEvent("pagehide")))
    await drain()
    expect(bodies()).toHaveLength(256)
    expect(
      bodies().every(
        (event) =>
          event.kind === "selected" &&
          event.policyVersion === "watch-exposure-v1",
      ),
    ).toBe(true)
  })

  it("batches many rendered cards and retains an early selection anomaly", async () => {
    act(() => {
      root.render(
        <WatchExposureBoundary config={config}>
          {Array.from({ length: 70 }, (_, i) => (
            <a
              key={i}
              href={`/watch/video-${i}.html`}
              onClick={(event) => event.preventDefault()}
            >
              video {i}
            </a>
          ))}
        </WatchExposureBoundary>,
      )
    })
    act(() => vi.advanceTimersByTime(120))
    await drain()
    expect(fetchWithRetry).toHaveBeenCalledTimes(2)
    expect(bodies().filter((event) => event.kind === "rendered")).toHaveLength(
      70,
    )
    const first = container.querySelector("a")!
    act(() => first.click())
    await drain()
    expect(bodies().filter((event) => event.kind === "selected")).toHaveLength(
      1,
    )
    expect(bodies().filter((event) => event.kind === "eligible")).toHaveLength(
      0,
    )
    act(() =>
      observerCallback(
        [
          {
            target: first,
            isIntersecting: true,
            intersectionRatio: 0.5,
          } as unknown as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      ),
    )
    act(() => vi.advanceTimersByTime(1120))
    expect(bodies().filter((event) => event.kind === "eligible")).toHaveLength(
      1,
    )
  })

  it("instruments an existing actions element without adding a layout wrapper", () => {
    const actionsRef = createRef<HTMLDivElement>()
    act(() => {
      root.render(
        <WatchExposureBoundary rootRef={actionsRef} config={config}>
          <div ref={actionsRef} data-testid="actions">
            <a
              href="/watch/hero.html"
              onClick={(event) => event.preventDefault()}
            >
              watch
            </a>
            <button type="button">mute</button>
          </div>
        </WatchExposureBoundary>,
      )
    })
    const actions = container.querySelector('[data-testid="actions"]')!
    expect(container.firstElementChild).toBe(actions)
    expect(actions.children).toHaveLength(2)
    act(() => actions.querySelector("a")!.click())
    expect(bodies().map((event) => event.kind)).toContain("selected")
  })

  it("splits long valid paths below the server's 48 KiB body limit", async () => {
    const prefix = "a".repeat(155)
    act(() => {
      root.render(
        <WatchExposureBoundary config={config}>
          {Array.from({ length: 64 }, (_, i) => (
            <a
              key={i}
              href={`/watch/${prefix}.html/${prefix}.html/${String(i).padStart(3, "0")}${prefix}.html`}
            >
              video {i}
            </a>
          ))}
        </WatchExposureBoundary>,
      )
    })
    act(() => vi.advanceTimersByTime(120))
    await drain()
    expect(fetchWithRetry.mock.calls.length).toBeGreaterThan(1)
    expect(bodies()).toHaveLength(64)
    for (const call of fetchWithRetry.mock.calls) {
      expect(
        new TextEncoder().encode(String((call[1] as RequestInit).body))
          .byteLength,
      ).toBeLessThanOrEqual(48 * 1024)
    }
  })

  it("re-reads a responsive href change and does not fabricate an exposure", () => {
    act(() =>
      root.render(
        <WatchExposureBoundary config={config}>
          <a
            href="/watch/first.html"
            onClick={(event) => event.preventDefault()}
          >
            first
          </a>
        </WatchExposureBoundary>,
      ),
    )
    act(() => vi.advanceTimersByTime(120))
    const anchor = container.querySelector("a")!
    anchor.setAttribute("href", "/watch/second.html")
    act(() => {
      vi.advanceTimersByTime(16)
      vi.advanceTimersByTime(120)
    })
    expect(bodies().filter((event) => event.kind === "eligible")).toHaveLength(
      0,
    )
    expect(
      bodies()
        .filter((event) => event.kind === "rendered")
        .map((event) => event.itemPath),
    ).toContain("/watch/first.html")
  })

  it("resets dwell and records a new placement after card reorder", async () => {
    const renderCards = (order: string[]) => (
      <WatchExposureBoundary config={config}>
        {order.map((name) => (
          <a
            key={name}
            href={`/watch/${name}.html`}
            onClick={(event) => event.preventDefault()}
          >
            {name}
          </a>
        ))}
      </WatchExposureBoundary>
    )
    act(() => root.render(renderCards(["first", "second"])))
    act(() => vi.advanceTimersByTime(120))
    const first = container.querySelector("a")!
    act(() =>
      observerCallback(
        [
          {
            target: first,
            isIntersecting: true,
            intersectionRatio: 0.5,
          } as unknown as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      ),
    )
    act(() => vi.advanceTimersByTime(500))
    await act(async () => {
      root.render(renderCards(["second", "first"]))
      await Promise.resolve()
      vi.advanceTimersByTime(16)
    })
    act(() => vi.advanceTimersByTime(620))
    expect(
      bodies().filter(
        (event) =>
          event.kind === "eligible" && event.itemPath === "/watch/first.html",
      ),
    ).toHaveLength(0)
    expect(
      bodies().filter(
        (event) =>
          event.kind === "rendered" && event.itemPath === "/watch/first.html",
      ),
    ).toHaveLength(2)
  })
})
