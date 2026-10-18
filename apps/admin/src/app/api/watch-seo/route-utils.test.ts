import { describe, expect, it, vi } from "vitest"

const incrementFixedWindow = vi.fn()
vi.mock("@/auth/rate-limit", () => ({
  incrementFixedWindow,
  rateLimitAuthRoute: vi.fn(),
}))

const { admitWatchSeoSubject } = await import("./route-utils")

describe("Watch SEO subject admission", () => {
  it("uses distinct opaque keys for distinct verified subjects", async () => {
    incrementFixedWindow.mockResolvedValue({ allowed: true, source: "redis" })
    await admitWatchSeoSubject("subject-a", "watch-seo-read-model", {
      limit: 60,
      windowMs: 60_000,
    })
    await admitWatchSeoSubject("subject-b", "watch-seo-read-model", {
      limit: 60,
      windowMs: 60_000,
    })

    const firstKey = incrementFixedWindow.mock.calls[0]?.[0] as string
    const secondKey = incrementFixedWindow.mock.calls[1]?.[0] as string
    expect(firstKey).not.toBe(secondKey)
    expect(firstKey).not.toContain("subject-a")
    expect(secondKey).not.toContain("subject-b")
  })
})
