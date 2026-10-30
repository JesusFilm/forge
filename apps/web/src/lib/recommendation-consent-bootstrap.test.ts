import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => vi.unstubAllGlobals())

describe("recommendation consent bootstrap", () => {
  it("allows recommendation delivery without any profile bootstrap", async () => {
    vi.resetModules()
    const bootstrap = await import("./recommendation-consent-bootstrap")
    bootstrap.startRecommendationConsentBootstrap()
    await expect(
      bootstrap.waitForRecommendationConsentBootstrap(),
    ).resolves.toBeUndefined()
  })

  it("serializes session-creating requests without the Web Locks API", async () => {
    vi.resetModules()
    vi.stubGlobal("navigator", { locks: undefined })
    const bootstrap = await import("./recommendation-consent-bootstrap")
    const order: string[] = []
    let releaseFirst!: () => void
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = bootstrap.withRecommendationConsentLock(async () => {
      order.push("first:start")
      await firstBlocked
      order.push("first:end")
    })
    const second = bootstrap.withRecommendationConsentLock(async () => {
      order.push("second")
    })

    await Promise.resolve()
    expect(order).toEqual(["first:start"])

    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(["first:start", "first:end", "second"])
  })
})
