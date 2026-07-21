/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest"

const featureFlags = vi.hoisted(() => ({
  globalBetaTesterCtaEnabled: vi.fn<() => Promise<boolean>>(),
}))

vi.mock("@/lib/feature-flags", () => ({
  isWatchGlobalBetaTesterCtaEnabled: featureFlags.globalBetaTesterCtaEnabled,
}))

import { GET } from "./route"

describe("GET /watch/api/beta-tester-cta", () => {
  beforeEach(() => {
    featureFlags.globalBetaTesterCtaEnabled.mockReset()
    featureFlags.globalBetaTesterCtaEnabled.mockResolvedValue(false)
  })

  it.each([false, true])(
    "returns the current flag value %s without caching",
    async (enabled) => {
      featureFlags.globalBetaTesterCtaEnabled.mockResolvedValue(enabled)

      const response = await GET()

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ enabled })
      expect(response.headers.get("cache-control")).toContain("no-store")
    },
  )

  it("fails closed without caching when flag evaluation throws", async () => {
    featureFlags.globalBetaTesterCtaEnabled.mockRejectedValue(
      new Error("LaunchDarkly unavailable"),
    )

    const response = await GET()

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ enabled: false })
    expect(response.headers.get("cache-control")).toContain("no-store")
  })
})
