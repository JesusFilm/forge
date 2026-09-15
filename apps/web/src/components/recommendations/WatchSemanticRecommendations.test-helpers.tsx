import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, vi } from "vitest"

export const delivery = {
  contractVersion: "semantic-recommendation-v1",
  surfaceVersion: "watch-below-player-v1",
  strategyVersion: "semantic-transcript-pgvector-v1",
  classifierVersion: "legacy-position-v0",
  requestId: "request-1",
  result: "served",
  reason: null,
  expiresAt: "2026-08-19T03:10:00.000Z",
  items: [
    {
      id: "item-1",
      position: 0,
      targetMediaId: "target-1",
      canonicalHref: "/watch/target.html",
      candidateGenerator: "semantic",
      capability: "delivery-capability-secret",
      videoId: "target-1",
      videoSlug: "target",
      videoTitle: "Target video",
      imageUrl: "https://image.mux.com/playback-1/thumbnail.jpg?time=0",
      sceneIndex: 0,
      description: "Description",
      startSeconds: 0,
      endSeconds: null,
      durationSeconds: 125,
      similarity: 0.9,
      themes: ["Fear/Power"],
      demographics: [],
      spiritualContext: [],
      playbackId: "playback-1",
    },
  ],
}

export const deliveryWithTwoItems = {
  ...delivery,
  items: [
    ...delivery.items,
    {
      ...delivery.items[0],
      id: "item-2",
      position: 1,
      targetMediaId: "target-2",
      canonicalHref: "/watch/second-target.html",
      capability: "second-delivery-capability-secret",
      videoId: "target-2",
      videoSlug: "second-target",
      videoTitle: "Second target video",
      playbackId: "playback-2",
    },
  ],
}

export const sixItemDelivery = {
  ...delivery,
  requestedCount: 6,
  composedCount: 6,
  shortfallReason: null,
  personalization: {
    contractVersion: "anonymous-profile-personalization-v1",
    lane: "profile_challenger",
    executionMode: "hybrid_personalized",
    effectiveManifestId: "semantic-profile-hybrid-v1",
    profileState: "durable",
    projectionVersion: "multi-interest-profile-projection-v1",
    projectionGeneration: 3,
    interestCount: 2,
    sessionIntentPresent: false,
    reason: null,
  },
  items: Array.from({ length: 6 }, (_, position) => ({
    ...delivery.items[0],
    id: `item-${position + 1}`,
    position,
    targetMediaId: `target-${position + 1}`,
    canonicalHref: `/watch/target-${position + 1}.html`,
    capability: `delivery-capability-${position + 1}`,
    videoId: `target-${position + 1}`,
    videoSlug: `target-${position + 1}`,
    videoTitle: `Target video ${position + 1}`,
    imageUrl: `https://image.mux.com/playback-${position + 1}/thumbnail.jpg?time=0`,
    playbackId: `playback-${position + 1}`,
    contributors: [
      {
        generator: "semantic",
        generatorVersion: "semantic-transcript-candidate-v1",
        rank: position + 1,
      },
      ...(position === 0
        ? [
            {
              generator: "multi-interest-profile",
              generatorVersion: "multi-interest-profile-candidate-v1",
              rank: 1,
            },
          ]
        : []),
    ],
  })),
}

export const emptyDelivery = {
  ...delivery,
  requestId: null,
  result: "empty",
  reason: null,
  expiresAt: null,
  items: [],
}

export const unavailableDelivery = {
  ...delivery,
  requestId: null,
  result: "unavailable",
  reason: "disabled",
  expiresAt: null,
  items: [],
}

export const fallbackDelivery = {
  ...delivery,
  result: "fallback",
  reason: "cached_slate",
}

export let container: HTMLDivElement
export let root: Root
export let observerCallback: IntersectionObserverCallback
const observed = new Set<Element>()
let visibilityState: DocumentVisibilityState

class TestIntersectionObserver implements IntersectionObserver {
  readonly root = null
  readonly rootMargin = "0px"
  readonly thresholds = [0.5]
  constructor(callback: IntersectionObserverCallback) {
    observerCallback = callback
  }
  observe(element: Element) {
    observed.add(element)
  }
  unobserve(element: Element) {
    observed.delete(element)
  }
  disconnect() {
    observed.clear()
  }
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

export function acceptedEvidenceResponse(init: RequestInit | undefined) {
  const body = JSON.parse(String(init?.body ?? "{}")) as {
    events?: Array<{ eventId: string }>
  }
  return jsonResponse({
    receipts: (body.events ?? []).map((event) => ({
      eventId: event.eventId,
      status: "accepted",
    })),
  })
}

export function requestBodies(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.map(([, init]) =>
    JSON.parse(String((init as RequestInit | undefined)?.body ?? "{}")),
  ) as Array<Record<string, unknown>>
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

export async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

export function setVisibilityState(value: DocumentVisibilityState) {
  visibilityState = value
}

export function resetRoot() {
  root = createRoot(container)
}

export function setupWatchRecommendationsTestHarness() {
  beforeEach(() => {
    vi.useFakeTimers()
    sessionStorage.clear()
    observed.clear()
    visibilityState = "visible"
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilityState,
    })
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver)
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
}
