import { describe, expect, it, vi } from "vitest"

describe("recommendation consent bootstrap", () => {
  it("blocks an early recommendation waiter until the consent shell completes", async () => {
    vi.resetModules()
    const bootstrap = await import("./recommendation-consent-bootstrap")
    let settled = false

    const waiting = bootstrap
      .waitForRecommendationConsentBootstrap()
      .then(() => {
        settled = true
      })

    await Promise.resolve()
    expect(settled).toBe(false)

    bootstrap.startRecommendationConsentBootstrap()
    await Promise.resolve()
    expect(settled).toBe(false)

    bootstrap.completeRecommendationConsentBootstrap()
    await waiting
    expect(settled).toBe(true)
  })
})
