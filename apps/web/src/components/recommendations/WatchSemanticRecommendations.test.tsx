/** @vitest-environment jsdom */

import React, {
  act,
  forwardRef,
  StrictMode,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react"
import { describe, expect, it, vi } from "vitest"

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
import {
  container,
  deferred,
  delivery,
  emptyDelivery,
  fallbackDelivery,
  flush,
  jsonResponse,
  observerCallback,
  requestBodies,
  resetRoot,
  root,
  setVisibilityState,
  setupWatchRecommendationsTestHarness,
  sixItemDelivery,
  unavailableDelivery,
} from "./WatchSemanticRecommendations.test-helpers"

setupWatchRecommendationsTestHarness()

describe("WatchSemanticRecommendations", () => {
  it("waits for first-visit consent initialization before delivery", async () => {
    startRecommendationConsentBootstrap()
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      jsonResponse({ delivery: sixItemDelivery }),
    )
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
    expect(fetchMock).not.toHaveBeenCalled()

    completeRecommendationConsentBootstrap()
    await flush()
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith("/api/recommendations"),
      ),
    ).toHaveLength(1)
    expect(container.textContent).toContain("Target video")
  })

  it("renders the compatible profile lane with a privacy-safe explanation", async () => {
    const profileDelivery = {
      ...delivery,
      personalization: {
        contractVersion: "anonymous-profile-personalization-v1",
        lane: "profile_challenger",
        effectiveManifestId: "multi-interest-profile-pilot-v1",
        profileState: "session",
        projectionVersion: "multi-interest-profile-projection-v1",
        projectionGeneration: 2,
        interestCount: 2,
        sessionIntentPresent: true,
        reason: null,
      },
      items: delivery.items.map((item) => ({
        ...item,
        candidateGenerator: "multi-interest-profile",
      })),
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/api/recommendations")
        ? jsonResponse({ delivery: profileDelivery })
        : jsonResponse({
            profile: { state: "session_only", privacyGeneration: null },
          }),
    )
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
    expect(container.textContent).toContain("Personalized for this visit.")
    expect(container.innerHTML).not.toMatch(/projection-2|profileToken|digest/)
  })

  it("renders six unique playable hybrid cards with thumbnails and consent-safe copy", async () => {
    const rawDelivery = {
      ...sixItemDelivery,
      rawProfileId: "must-not-enter-the-browser-view",
      watchHistory: ["private-history"],
      profileVector: [0.1, 0.2],
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/api/recommendations")
        ? jsonResponse({ delivery: rawDelivery })
        : jsonResponse({ receipts: [] }),
    )
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

    const cards = [...container.querySelectorAll("a[data-recommendation-key]")]
    expect(cards).toHaveLength(6)
    expect(new Set(cards.map((card) => card.getAttribute("href"))).size).toBe(6)
    expect(cards.map((card) => card.getAttribute("href"))).toEqual(
      Array.from({ length: 6 }, (_, index) => `/target-${index + 1}.html`),
    )
    expect(container.querySelectorAll("[data-src]")).toHaveLength(6)
    expect(container.textContent).toContain("2:05")
    expect(container.textContent).not.toContain("0:00")
    expect(container.textContent).not.toContain("90% match")
    expect(container.textContent).not.toContain("Fear/Power")
    expect(container.textContent).toContain(
      "Recommended from this video and interests you chose to remember.",
    )
    expect(container.innerHTML).not.toMatch(
      /must-not-enter|private-history|profileVector|rawProfileId/,
    )
  })

  it.each([
    [
      "semantic contextual",
      "semantic_control",
      "semantic_contextual",
      "Recommended from what you're watching now.",
    ],
    [
      "semantic fallback",
      "semantic_fallback",
      "semantic_fallback",
      "Recommended from what you're watching now while personalization is unavailable.",
    ],
  ])(
    "uses context-only viewer copy for %s delivery",
    async (_name, lane, executionMode, copy) => {
      const contextualDelivery = {
        ...delivery,
        requestedCount: 1,
        composedCount: 1,
        shortfallReason: null,
        personalization: {
          ...sixItemDelivery.personalization,
          lane,
          executionMode,
          profileState: null,
          projectionVersion: null,
          projectionGeneration: null,
          interestCount: 0,
          effectiveManifestId: "semantic-transcript-pgvector-v1",
        },
      }
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) =>
          String(input).endsWith("/api/recommendations")
            ? jsonResponse({ delivery: contextualDelivery })
            : jsonResponse({ receipts: [] }),
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

      expect(container.textContent).toContain(copy)
      expect(container.textContent).not.toMatch(
        /remembered interests|Personalized/,
      )
    },
  )

  it("replaces a personalized slate with contextual recommendations when the profile changes and cleans up its listener", async () => {
    const contextualReplacement = {
      ...sixItemDelivery,
      requestId: "request-2",
      personalization: {
        ...sixItemDelivery.personalization,
        lane: "semantic_control",
        executionMode: "semantic_contextual",
        effectiveManifestId: "semantic-transcript-pgvector-v1",
        profileState: null,
        projectionVersion: null,
        projectionGeneration: null,
        interestCount: 0,
        sessionIntentPresent: false,
      },
      items: sixItemDelivery.items.map((item) => ({
        ...item,
        candidateGenerator: "semantic",
        contributors: item.contributors.filter(
          (contributor) => contributor.generator === "semantic",
        ),
      })),
    }
    const replacement = deferred<Response>()
    let deliveryCalls = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (!url.endsWith("/api/recommendations")) {
        return jsonResponse({ receipts: [] })
      }
      deliveryCalls += 1
      return deliveryCalls === 1
        ? jsonResponse({ delivery: sixItemDelivery })
        : replacement.promise
    })
    const addEventListenerSpy = vi.spyOn(window, "addEventListener")
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener")
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

    expect(container.textContent).toContain(
      "Recommended from this video and interests you chose to remember.",
    )
    expect(
      container.querySelectorAll("a[data-recommendation-key]"),
    ).toHaveLength(6)

    act(() => {
      window.dispatchEvent(new Event("forge:recommendation-profile-changed"))
    })
    await flush()

    expect(deliveryCalls).toBe(2)
    expect(container.querySelector('[data-state="loading"]')).not.toBeNull()
    expect(container.querySelector("a[data-recommendation-key]")).toBeNull()

    replacement.resolve(jsonResponse({ delivery: contextualReplacement }))
    await flush()

    expect(
      container.querySelectorAll("a[data-recommendation-key]"),
    ).toHaveLength(6)
    expect(container.textContent).toContain(
      "Recommended from what you're watching now.",
    )
    expect(container.textContent).not.toContain(
      "interests you chose to remember",
    )

    const profileListener = addEventListenerSpy.mock.calls.find(
      ([event]) => event === "forge:recommendation-profile-changed",
    )?.[1]
    expect(profileListener).toBeTypeOf("function")
    act(() => root.unmount())
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "forge:recommendation-profile-changed",
      profileListener,
    )
    resetRoot()
  })

  it("keeps a pending card selection actionable when the profile changes", async () => {
    const pendingSelection = deferred<Response>()
    let selectionSignal: AbortSignal | null = null
    let deliveryCalls = 0
    const navigate = vi.fn()
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith("/select")) {
          selectionSignal = init?.signal as AbortSignal
          return pendingSelection.promise
        }
        if (url.endsWith("/api/recommendations")) {
          deliveryCalls += 1
          return jsonResponse({ delivery: sixItemDelivery })
        }
        return jsonResponse({ receipts: [] })
      },
    )
    vi.stubGlobal("fetch", fetchMock)

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
        .querySelector("a[data-recommendation-key]")
        ?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        )
    })
    expect((selectionSignal as AbortSignal | null)?.aborted).toBe(false)

    act(() => {
      window.dispatchEvent(new Event("forge:recommendation-profile-changed"))
    })
    await flush()

    expect(deliveryCalls).toBe(1)
    expect((selectionSignal as AbortSignal | null)?.aborted).toBe(false)

    pendingSelection.resolve(
      jsonResponse({
        claimNonce: "qualified-claim-nonce",
        canonicalHref: sixItemDelivery.items[0].canonicalHref,
        targetMediaId: sixItemDelivery.items[0].targetMediaId,
      }),
    )
    await flush()

    expect(navigate).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith(
      sixItemDelivery.items[0].canonicalHref,
    )
  })

  it("rejects inconsistent additive counts and duplicate playable destinations", async () => {
    const invalidDelivery = {
      ...sixItemDelivery,
      composedCount: 5,
      items: [
        ...sixItemDelivery.items.slice(0, 5),
        {
          ...sixItemDelivery.items[5],
          canonicalHref: sixItemDelivery.items[0].canonicalHref,
        },
      ],
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ delivery: invalidDelivery })),
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

    expect(container.querySelector('[data-state="unavailable"]')).toBeNull()
    expect(container.querySelector("a[data-recommendation-key]")).toBeNull()
  })

  it.each([
    [
      "semantic recommendation contract",
      { ...delivery, contractVersion: "semantic-recommendation-v2" },
    ],
    ["Watch surface", { ...delivery, surfaceVersion: "watch-below-player-v2" }],
    [
      "personalization contract",
      {
        ...delivery,
        personalization: {
          contractVersion: "anonymous-profile-personalization-v2",
          lane: "profile_challenger",
          effectiveManifestId: "multi-interest-profile-pilot-v1",
          profileState: "session",
          projectionVersion: "multi-interest-profile-projection-v1",
          projectionGeneration: 2,
          interestCount: 2,
          sessionIntentPresent: true,
          reason: null,
        },
      },
    ],
  ])(
    "rejects an unknown %s before rendering cards or sending lifecycle telemetry",
    async (_version, incompatibleDelivery) => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith("/api/recommendations")) {
          return jsonResponse({ delivery: incompatibleDelivery })
        }
        if (url.endsWith("/api/recommendations/profile")) {
          return jsonResponse({
            profile: { state: "session_only", privacyGeneration: null },
          })
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

      expect(container.querySelector('[data-state="unavailable"]')).toBeNull()
      expect(container.textContent).not.toContain("Target video")
      expect(container.querySelector("a")).toBeNull()
      expect(
        fetchMock.mock.calls.filter(([input]) => {
          const url = String(input)
          return url.endsWith("/evidence") || url.endsWith("/select")
        }),
      ).toHaveLength(0)
    },
  )

  it("loads after mount, keeps the capability out of DOM, and emits render/impression once per committed envelope", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/api/recommendations")) {
        return jsonResponse({ delivery })
      }
      return jsonResponse({
        receipts: [{ eventId: "event", status: "accepted" }],
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    act(() => {
      root.render(
        <StrictMode>
          <WatchSemanticRecommendations
            seedMediaId="seed-1"
            locale="en"
            audioLanguageSlug="english"
          />
        </StrictMode>,
      )
    })
    expect(container.querySelector('[data-state="loading"]')).not.toBeNull()
    await flush()

    expect(container.textContent).toContain("Target video")
    expect(
      container
        .querySelector('[data-alt^="Target video"]')
        ?.getAttribute("data-src"),
    ).toBe("https://image.mux.com/playback-1/thumbnail.jpg?time=0")
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith("/api/recommendations"),
      ),
    ).toHaveLength(1)
    expect(container.innerHTML).not.toContain("delivery-capability-secret")
    // Next Link adds the configured `/watch` basePath in the browser. The
    // component must not pass the already-prefixed Admin target to Link.
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/target.html",
    )
    await flush()
    expect(
      requestBodies(fetchMock).filter(
        (value) =>
          (value.events as Array<{ kind?: string }> | undefined)?.[0]?.kind ===
          "render",
      ),
    ).toHaveLength(1)

    const card = container.querySelector("a")!
    observerCallback(
      [
        {
          target: card,
          isIntersecting: true,
          intersectionRatio: 0.49,
        } as unknown as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver,
    )
    await act(async () => vi.advanceTimersByTime(1_000))
    expect(
      requestBodies(fetchMock).filter(
        (value) =>
          (value.events as Array<{ kind?: string }> | undefined)?.[0]?.kind ===
          "impression",
      ),
    ).toHaveLength(0)

    observerCallback(
      [
        {
          target: card,
          isIntersecting: true,
          intersectionRatio: 0.5,
        } as unknown as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver,
    )
    setVisibilityState("hidden")
    document.dispatchEvent(new Event("visibilitychange"))
    await act(async () => vi.advanceTimersByTime(1_000))
    expect(
      requestBodies(fetchMock).filter(
        (value) =>
          (value.events as Array<{ kind?: string }> | undefined)?.[0]?.kind ===
          "impression",
      ),
    ).toHaveLength(0)

    setVisibilityState("visible")
    document.dispatchEvent(new Event("visibilitychange"))
    await act(async () => vi.advanceTimersByTime(1_000))
    await flush()
    expect(
      requestBodies(fetchMock).filter(
        (value) =>
          (value.events as Array<{ kind?: string }> | undefined)?.[0]?.kind ===
          "impression",
      ),
    ).toHaveLength(1)
  })

  it.each([
    ["empty", emptyDelivery],
    ["unavailable", unavailableDelivery],
  ])(
    "renders nothing for a terminal %s delivery",
    async (_state, sentinelDelivery) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve(jsonResponse({ delivery: sentinelDelivery })),
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

      expect(container.innerHTML).toBe("")
    },
  )

  it.each(["cooldown", "in_flight"] as const)(
    "keeps %s admission transient and retries once after the admission window",
    async (reason) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            delivery: { ...unavailableDelivery, reason },
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ delivery }))
        .mockResolvedValue(jsonResponse({ receipts: [] }))
      vi.stubGlobal("fetch", fetchMock)
      const deliveryRequestCount = () =>
        fetchMock.mock.calls.filter(([input]) =>
          String(input).endsWith("/api/recommendations"),
        ).length

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
      expect(container.textContent).not.toContain(
        "Recommended videos are temporarily unavailable.",
      )
      expect(deliveryRequestCount()).toBe(1)

      await act(async () => vi.advanceTimersByTime(4_999))
      expect(deliveryRequestCount()).toBe(1)

      await act(async () => vi.advanceTimersByTime(1))
      await flush()

      expect(deliveryRequestCount()).toBe(2)
      expect(container.textContent).toContain("Target video")
      expect(container.querySelector('[data-state="unavailable"]')).toBeNull()
    },
  )

  it("retries one transient delivery failure before showing unavailable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: "temporarily_unavailable" }, 503),
      )
      .mockResolvedValueOnce(jsonResponse({ delivery }))
      .mockResolvedValue(jsonResponse({ receipts: [] }))
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

    expect(container.querySelector('[data-state="loading"]')).not.toBeNull()
    expect(container.querySelector('[data-state="unavailable"]')).toBeNull()

    await act(async () => vi.advanceTimersByTime(500))
    await flush()

    expect(container.textContent).toContain("Target video")
    expect(container.querySelector('[data-state="unavailable"]')).toBeNull()
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith("/api/recommendations"),
      ),
    ).toHaveLength(2)
  })

  it("keeps all retries inside one delivery deadline", async () => {
    const pending = deferred<Response>()
    const fetchMock = vi.fn().mockReturnValueOnce(pending.promise)
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

    await act(async () => vi.advanceTimersByTime(11_750))
    await act(async () => {
      pending.resolve(
        jsonResponse({
          delivery: {
            ...unavailableDelivery,
            reason: "delivery_unavailable",
          },
        }),
      )
      await pending.promise
    })
    await flush()

    expect(container.querySelector('[data-state="unavailable"]')).toBeNull()
    await act(async () => vi.advanceTimersByTime(1_000))
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith("/api/recommendations"),
      ),
    ).toHaveLength(1)
  })

  it("does not retry a permanent delivery rejection", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "invalid_request" }, 400))
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

    expect(container.querySelector('[data-state="unavailable"]')).toBeNull()
    await act(async () => vi.advanceTimersByTime(500))
    await flush()
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith("/api/recommendations"),
      ),
    ).toHaveLength(1)
  })

  it("does not retry a deployment-disabled delivery", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        delivery: { ...unavailableDelivery, reason: "environment_disabled" },
      }),
    )
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
    expect(container.querySelector('[data-state="unavailable"]')).toBeNull()

    await act(async () => vi.advanceTimersByTime(500))
    await flush()
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith("/api/recommendations"),
      ),
    ).toHaveLength(1)
  })

  it("does not retry a malformed successful delivery response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("not-json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
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
    expect(container.querySelector('[data-state="unavailable"]')).toBeNull()

    await act(async () => vi.advanceTimersByTime(500))
    await flush()
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith("/api/recommendations"),
      ),
    ).toHaveLength(1)
  })

  it("keeps a fallback slate actionable and announces that it is saved", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/recommendations")) {
        return jsonResponse({ delivery: fallbackDelivery })
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

    expect(container.querySelector('[data-state="fallback"]')).not.toBeNull()
    expect(container.textContent).toContain("Showing saved recommendations.")
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/target.html",
    )
  })

  it("renders the environment fallback without attribution calls or navigation delay", async () => {
    const contextualFallback = {
      ...fallbackDelivery,
      requestId: null,
      reason: "delivery_timeout",
      items: fallbackDelivery.items.map((item) => ({
        ...item,
        capability: "contextual-fallback-unattributed-v1",
      })),
    }
    const navigate = vi.fn()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/recommendations")) {
        return jsonResponse({ delivery: contextualFallback })
      }
      return jsonResponse({ error: "unexpected attribution" }, 500)
    })
    vi.stubGlobal("fetch", fetchMock)

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

    expect(container.textContent).toContain("Target video")
    expect(fetchMock).toHaveBeenCalledOnce()
    act(() => {
      container
        .querySelector("a[data-recommendation-key]")
        ?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        )
    })
    expect(navigate).toHaveBeenCalledWith("/watch/target.html")
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("keeps trusted links usable when lifecycle instrumentation is degraded", async () => {
    let evidenceAttempts = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/recommendations")) {
        return jsonResponse({ delivery })
      }
      if (String(input).endsWith("/api/recommendations/profile")) {
        return jsonResponse({
          profile: {
            state: "session_only",
            privacyGeneration: null,
          },
        })
      }
      evidenceAttempts += 1
      return jsonResponse({ error: "temporary" }, 503)
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
    expect(evidenceAttempts).toBe(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    await flush()

    expect(evidenceAttempts).toBe(2)
    expect(container.querySelector('[data-state="ready"]')).not.toBeNull()
    expect(container.textContent).toContain(
      "Recommendation activity could not be recorded. Links still work.",
    )
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/target.html",
    )
  })

  it("retries rejected render evidence with the same event id", async () => {
    let evidenceAttempts = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/api/recommendations")) {
        return jsonResponse({ delivery })
      }
      if (url.endsWith("/api/recommendations/profile")) {
        return jsonResponse({
          profile: {
            state: "session_only",
            privacyGeneration: null,
          },
        })
      }
      evidenceAttempts += 1
      return evidenceAttempts === 1
        ? jsonResponse({ error: "temporary" }, 503)
        : jsonResponse({ receipts: [] })
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
    expect(evidenceAttempts).toBe(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(evidenceAttempts).toBe(2)
    const evidenceBodies = requestBodies(fetchMock).filter(
      (body) => body.requestId === "request-1" && Array.isArray(body.events),
    )
    expect(evidenceBodies).toHaveLength(2)
    expect(evidenceBodies[1]).toEqual(evidenceBodies[0])
  })

  it("does not let stale evidence failure degrade a replacement slate", async () => {
    const oldEvidence = deferred<Response>()
    const replacementDelivery = {
      ...delivery,
      requestId: "request-2",
      items: delivery.items.map((item) => ({
        ...item,
        id: "item-2",
        capability: "replacement-capability-secret",
      })),
    }
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          seedMediaId?: string
          requestId?: string
        }
        if (url.endsWith("/api/recommendations")) {
          return jsonResponse({
            delivery:
              body.seedMediaId === "seed-2" ? replacementDelivery : delivery,
          })
        }
        if (body.requestId === "request-1") {
          return oldEvidence.promise
        }
        return jsonResponse({ receipts: [] })
      },
    )
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
    act(() => {
      root.render(
        <WatchSemanticRecommendations
          seedMediaId="seed-2"
          locale="en"
          audioLanguageSlug="english"
        />,
      )
    })
    await flush()
    expect(container.textContent).toContain("Target video")

    oldEvidence.reject(new Error("old request failed"))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    oldEvidence.reject(new Error("old request failed again"))
    await flush()

    expect(container.textContent).not.toContain(
      "Recommendation activity could not be recorded",
    )
  })
})
