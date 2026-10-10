import { beforeEach, describe, expect, it, vi } from "vitest"
const { readSession, variation, config } = vi.hoisted(() => ({
  readSession: vi.fn(),
  variation: vi.fn(),
  config: { WATCH_FOR_YOU_ENABLED: "true" },
}))
vi.mock("@/env", () => ({ env: config }))
vi.mock("@/auth/web-session", () => ({
  WEB_AUTH_SESSION_COOKIE: "forge_web_session",
  readWebAuthSessionCookie: readSession,
}))
vi.mock("@/lib/feature-flags", () => ({
  isWatchHomepageRecommendationsEnabled: variation,
}))
import { homepageRecommendationsEnabled } from "./homepage-recommendations-flag"
import { GET } from "@/app/api/recommendations/for-you/availability/route"

beforeEach(() => {
  vi.clearAllMocks()
  config.WATCH_FOR_YOU_ENABLED = "true"
  readSession.mockResolvedValue(null)
  variation.mockResolvedValue(false)
})
describe("homepage recommendation targeting", () => {
  it("targets verified Watch account identity without sending profile capabilities or access tokens", async () => {
    readSession.mockResolvedValue({
      subject: "viewer",
      email: "viewer@example.test",
      accessToken: "access-secret",
    })
    variation.mockResolvedValue(true)
    const request = new Request(
      "https://watch.example/watch/api/recommendations/for-you",
      {
        method: "POST",
        body: "{}",
        headers: {
          cookie:
            "forge_web_session=encrypted; forge_recommendation_profile=profile-secret",
        },
      },
    )
    await request.json()
    expect(await homepageRecommendationsEnabled(request)).toBe(true)
    expect(readSession).toHaveBeenCalledWith("encrypted")
    expect(variation).toHaveBeenCalledWith({
      kind: "user",
      key: "viewer",
      email: "viewer@example.test",
      anonymous: false,
      custom: { surface: "watch-homepage-recommendations" },
    })
  })
  it("uses an anonymous context for missing or invalid auth and never accepts identity from query parameters", async () => {
    const response = await GET(
      new Request(
        "https://watch.example/availability?email=forged@example.test&key=admin",
      ),
    )
    expect(await response.json()).toEqual({ enabled: false })
    expect(response.headers.get("cache-control")).toMatch(/private.*no-store/)
    expect(variation).toHaveBeenCalledWith(
      expect.objectContaining({ key: "watch-anonymous", anonymous: true }),
    )
    expect(variation.mock.calls[0][0]).not.toHaveProperty("email")
  })
  it("preserves the environment kill switch before reading identity or LD", async () => {
    config.WATCH_FOR_YOU_ENABLED = "false"
    expect(
      await homepageRecommendationsEnabled(
        new Request("https://watch.example"),
      ),
    ).toBe(false)
    expect(readSession).not.toHaveBeenCalled()
    expect(variation).not.toHaveBeenCalled()
  })
  it("keeps the availability response private and disabled on evaluator failure", async () => {
    variation.mockRejectedValue(new Error("LD unavailable"))
    const response = await GET(
      new Request("https://watch.example/availability"),
    )
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ enabled: false })
    expect(response.headers.get("cache-control")).toMatch(/private.*no-store/)
  })
})
