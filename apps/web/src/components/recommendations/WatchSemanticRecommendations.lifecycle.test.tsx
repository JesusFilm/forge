/** @vitest-environment jsdom */

import React, {
  act,
  forwardRef,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    <span data-src={src} data-alt={alt} />
  ),
}))
vi.mock("next/link", () => {
  const MockLink = forwardRef<
    HTMLAnchorElement,
    AnchorHTMLAttributes<HTMLAnchorElement> & {
      href: string
      children: ReactNode
    }
  >(({ href, children, ...props }, ref) => (
    <a ref={ref} href={href} {...props}>
      {children}
    </a>
  ))
  MockLink.displayName = "MockLink"
  return { default: MockLink }
})
vi.mock("@/components/watch/MuxHoverPreview", () => ({
  MuxHoverPreview: () => null,
}))

import { WatchSemanticRecommendations } from "@/components/recommendations/WatchSemanticRecommendations"
import {
  completeRecommendationConsentBootstrap,
  startRecommendationConsentBootstrap,
} from "@/lib/recommendation-consent-bootstrap"
import { RECOMMENDATION_TAB_CORRELATION_KEY } from "@/lib/recommendation-contracts"
import {
  container,
  delivery,
  deliveryWithTwoItems,
  flush,
  jsonResponse,
  observerCallback,
  requestBodies,
  root,
  setupWatchRecommendationsTestHarness,
} from "./WatchSemanticRecommendations.test-helpers"

setupWatchRecommendationsTestHarness()

describe("WatchSemanticRecommendations lifecycle", () => {
  beforeEach(() => {
    startRecommendationConsentBootstrap()
    completeRecommendationConsentBootstrap()
  })

  it("hides a stale slate while a changed Watch seed loads", async () => {
    let resolveReplacement!: (response: Response) => void
    const replacement = new Promise<Response>((resolve) => {
      resolveReplacement = resolve
    })
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (!url.endsWith("/api/recommendations")) {
        return Promise.resolve(jsonResponse({ receipts: [] }))
      }
      const deliveryCalls = fetchMock.mock.calls.filter(([candidate]) =>
        String(candidate).endsWith("/api/recommendations"),
      ).length
      return deliveryCalls === 1
        ? Promise.resolve(jsonResponse({ delivery }))
        : replacement
    })
    vi.stubGlobal("fetch", fetchMock)

    act(() => {
      root.render(
        <WatchSemanticRecommendations
          seedMediaId="seed-1"
          locale="en"
          audioLanguageSlug="english"
        />,
      )
    })
    await flush()
    expect(container.textContent).toContain("Target video")

    act(() => {
      root.render(
        <WatchSemanticRecommendations
          seedMediaId="seed-2"
          locale="en"
          audioLanguageSlug="english"
        />,
      )
    })
    expect(container.querySelector('[data-state="loading"]')).not.toBeNull()
    expect(container.textContent).not.toContain("Target video")
    await flush()

    resolveReplacement(
      jsonResponse({
        delivery: {
          ...delivery,
          requestId: "request-2",
          items: [deliveryWithTwoItems.items[1]],
        },
      }),
    )
    await flush()
    expect(container.textContent).toContain("Second target video")
    expect(container.textContent).not.toContain("Target video")
  })

  it("leaves loading when delivery headers arrive but the JSON body exceeds the deadline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => new Promise<never>(() => undefined),
        } as unknown as Response),
      ),
    )

    act(() => {
      root.render(
        <WatchSemanticRecommendations
          seedMediaId="seed-1"
          locale="en"
          audioLanguageSlug="english"
        />,
      )
    })
    await flush()
    expect(container.querySelector('[data-state="loading"]')).not.toBeNull()

    await act(async () => vi.advanceTimersByTime(12_000))
    expect(container.querySelector('[data-state="loading"]')).toBeNull()
    expect(container.querySelector('[data-state="unavailable"]')).toBeNull()
    expect(container.innerHTML).toBe("")
  })

  it("makes pointer/keyboard activation single-flight, stores only the fresh claim nonce, and navigates once", async () => {
    let resolveSelection!: (response: Response) => void
    const selectionResponse = new Promise<Response>((resolve) => {
      resolveSelection = resolve
    })
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/api/recommendations")) {
        return Promise.resolve(jsonResponse({ delivery }))
      }
      if (url.endsWith("/select")) return selectionResponse
      return Promise.resolve(jsonResponse({ receipts: [] }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const navigate = vi.fn()

    act(() => {
      root.render(
        <WatchSemanticRecommendations
          seedMediaId="seed-1"
          locale="en"
          audioLanguageSlug="english"
          navigate={navigate}
        />,
      )
    })
    await flush()
    const card = container.querySelector("a")!
    act(() => {
      card.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      )
      card.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }),
      )
    })

    expect(card.getAttribute("aria-busy")).toBe("true")
    expect(container.textContent).toContain("Opening Target video")
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/select")),
    ).toHaveLength(1)

    resolveSelection(
      jsonResponse({
        claimNonce: "fresh_claim_nonce_1234567890",
        canonicalHref: "/watch/target.html",
        targetMediaId: "target-1",
      }),
    )
    await flush()

    expect(navigate).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith("/watch/target.html")
    expect(sessionStorage).toHaveLength(1)
    expect(sessionStorage.getItem(RECOMMENDATION_TAB_CORRELATION_KEY)).toBe(
      "fresh_claim_nonce_1234567890",
    )
    expect(JSON.stringify(requestBodies(fetchMock))).toContain(
      "capability-secret",
    )
    expect(container.innerHTML).not.toContain("capability-secret")
  })

  it("allows only one component-wide selection attempt across different cards", async () => {
    let resolveSelection!: (response: Response) => void
    const selectionResponse = new Promise<Response>((resolve) => {
      resolveSelection = resolve
    })
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/api/recommendations")) {
        return Promise.resolve(jsonResponse({ delivery: deliveryWithTwoItems }))
      }
      if (url.endsWith("/select")) return selectionResponse
      return Promise.resolve(jsonResponse({ receipts: [] }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const navigate = vi.fn()

    act(() => {
      root.render(
        <WatchSemanticRecommendations
          seedMediaId="seed-1"
          locale="en"
          audioLanguageSlug="english"
          navigate={navigate}
        />,
      )
    })
    await flush()
    const cards = container.querySelectorAll("a")
    expect(cards).toHaveLength(2)
    act(() => {
      cards[0]!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      )
      cards[1]!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      )
    })

    const selectionBodies = requestBodies(fetchMock).filter(
      (body) => body.eventId != null,
    )
    expect(selectionBodies).toHaveLength(1)
    expect(selectionBodies[0]?.itemId).toBe("item-1")

    resolveSelection(
      jsonResponse({
        claimNonce: "fresh_claim_nonce_1234567890",
        canonicalHref: "/watch/target.html",
        targetMediaId: "target-1",
      }),
    )
    await flush()
    expect(navigate).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith("/watch/target.html")
  })

  it("ignores a late selection response after the recommendation block unmounts", async () => {
    let resolveSelection!: (response: Response) => void
    const selectionResponse = new Promise<Response>((resolve) => {
      resolveSelection = resolve
    })
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/api/recommendations")) {
        return Promise.resolve(jsonResponse({ delivery }))
      }
      if (url.endsWith("/select")) return selectionResponse
      return Promise.resolve(jsonResponse({ receipts: [] }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const navigate = vi.fn()

    act(() => {
      root.render(
        <WatchSemanticRecommendations
          seedMediaId="seed-1"
          locale="en"
          audioLanguageSlug="english"
          navigate={navigate}
        />,
      )
    })
    await flush()
    act(() => {
      container
        .querySelector("a")!
        .dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        )
    })
    const correlationNonce = sessionStorage.getItem(
      RECOMMENDATION_TAB_CORRELATION_KEY,
    )
    expect(correlationNonce).not.toBeNull()

    act(() => root.render(<div>replacement</div>))
    resolveSelection(
      jsonResponse({
        claimNonce: "late_claim_nonce_1234567890",
        canonicalHref: "/watch/target.html",
        targetMediaId: "target-1",
      }),
    )
    await flush()

    expect(navigate).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(RECOMMENDATION_TAB_CORRELATION_KEY)).toBe(
      correlationNonce,
    )
  })

  it("fails open to the token-free trusted href on the short selection deadline without double navigation", async () => {
    let resolveSelectionBody!: (body: unknown) => void
    const selectionBody = new Promise<unknown>((resolve) => {
      resolveSelectionBody = resolve
    })
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith("/api/recommendations")) {
          return Promise.resolve(jsonResponse({ delivery }))
        }
        if (url.endsWith("/select")) {
          return Promise.resolve({
            ok: true,
            json: () => selectionBody,
          } as Response)
        }
        return Promise.resolve(jsonResponse({ receipts: [] }))
      }),
    )
    const navigate = vi.fn()

    act(() => {
      root.render(
        <WatchSemanticRecommendations
          seedMediaId="seed-1"
          locale="en"
          audioLanguageSlug="english"
          navigate={navigate}
        />,
      )
    })
    await flush()
    act(() => {
      container
        .querySelector("a")!
        .dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        )
    })
    await act(async () => vi.advanceTimersByTime(800))
    expect(navigate).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith("/watch/target.html")

    resolveSelectionBody({
      claimNonce: "late_claim_nonce_1234567890",
      canonicalHref: "/watch/target.html",
      targetMediaId: "target-1",
    })
    await flush()
    expect(navigate).toHaveBeenCalledOnce()
  })

  it("fails open to the trusted href when tab storage is unavailable", async () => {
    const storageGet = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new DOMException("Storage disabled", "SecurityError")
      })
    const storageSet = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("Storage disabled", "SecurityError")
      })
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/api/recommendations")) {
        return Promise.resolve(jsonResponse({ delivery }))
      }
      if (url.endsWith("/select")) {
        return Promise.resolve(
          jsonResponse({
            claimNonce: "fresh_claim_nonce_1234567890",
            canonicalHref: "/watch/target.html",
            targetMediaId: "target-1",
          }),
        )
      }
      return Promise.resolve(jsonResponse({ receipts: [] }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const navigate = vi.fn()

    act(() => {
      root.render(
        <WatchSemanticRecommendations
          seedMediaId="seed-1"
          locale="en"
          audioLanguageSlug="english"
          navigate={navigate}
        />,
      )
    })
    await flush()
    act(() => {
      container
        .querySelector("a")!
        .dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        )
    })
    await flush()

    expect(storageGet).toHaveBeenCalled()
    expect(storageSet).toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith("/watch/target.html")
  })

  it("cancels a pending impression when its card detaches", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/recommendations")) {
        return jsonResponse({ delivery })
      }
      return jsonResponse({ receipts: [] })
    })
    vi.stubGlobal("fetch", fetchMock)

    act(() => {
      root.render(
        <WatchSemanticRecommendations
          seedMediaId="seed-1"
          locale="en"
          audioLanguageSlug="english"
        />,
      )
    })
    await flush()
    observerCallback(
      [
        {
          target: container.querySelector("a")!,
          isIntersecting: true,
          intersectionRatio: 0.5,
        } as unknown as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver,
    )

    act(() => root.render(<div>replacement</div>))
    await act(async () => vi.advanceTimersByTime(1_000))
    expect(
      requestBodies(fetchMock).filter(
        (value) =>
          (value.events as Array<{ kind?: string }> | undefined)?.[0]?.kind ===
          "impression",
      ),
    ).toHaveLength(0)
  })
})
