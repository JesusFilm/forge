/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  waitForRecommendationActivation,
  isDeferredRecommendationResponse,
} from "./recommendation-activation"
afterEach(() => {
  delete (document as Document & { prerendering?: boolean }).prerendering
})
describe("recommendation navigation activation", () => {
  it("waits through repeated inactive signals and activates once", async () => {
    Object.defineProperty(document, "prerendering", {
      configurable: true,
      writable: true,
      value: true,
    })
    const activated = vi.fn()
    const pending = waitForRecommendationActivation().then(activated)
    document.dispatchEvent(new Event("prerenderingchange"))
    await Promise.resolve()
    expect(activated).not.toHaveBeenCalled()
    Object.defineProperty(document, "prerendering", { value: false })
    document.dispatchEvent(new Event("prerenderingchange"))
    document.dispatchEvent(new Event("prerenderingchange"))
    await pending
    expect(activated).toHaveBeenCalledTimes(1)
  })
  it("cancels inactive navigation and StrictMode ordinary setup before issuing work", async () => {
    const controller = new AbortController()
    const pending = waitForRecommendationActivation(controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
  })
  it("distinguishes deferred reuse from legitimate contextual fallback", () => {
    expect(
      isDeferredRecommendationResponse({
        deliveryDisposition: "deferred",
        delivery: { requestId: null },
      }),
    ).toBe(true)
    expect(
      isDeferredRecommendationResponse({ delivery: { requestId: null } }),
    ).toBe(false)
    expect(
      isDeferredRecommendationResponse({ deliveryDisposition: "contextual" }),
    ).toBe(false)
  })
})
