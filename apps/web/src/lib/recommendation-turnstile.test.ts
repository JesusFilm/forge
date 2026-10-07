import { describe, expect, it, vi } from "vitest"
import {
  verifyWatchRecommendationTurnstile,
  WATCH_RECOMMENDATION_TURNSTILE_ACTION,
  WATCH_RECOMMENDATION_TURNSTILE_FIXTURE_HOSTNAME,
  WATCH_RECOMMENDATION_TURNSTILE_TEST_SECRET_KEY,
  WATCH_RECOMMENDATION_TURNSTILE_TEST_SITE_KEY,
} from "./recommendation-turnstile"

const config = {
  secret: "private-watch-secret",
  hostnames: ["www.jesusfilm.org"],
}

function siteverifyResponse(fields: Record<string, unknown>) {
  return vi.fn<typeof fetch>(async () =>
    Response.json({
      success: true,
      action: WATCH_RECOMMENDATION_TURNSTILE_ACTION,
      hostname: "www.jesusfilm.org",
      ...fields,
    }),
  )
}

describe("Watch Turnstile server verification", () => {
  it("fails closed without a dedicated secret or allowed hostname", async () => {
    const siteverify = siteverifyResponse({})
    expect(
      await verifyWatchRecommendationTurnstile(
        "token",
        { ...config, secret: undefined },
        siteverify,
      ),
    ).toEqual({ status: "unavailable" })
    expect(
      await verifyWatchRecommendationTurnstile(
        "token",
        { ...config, hostnames: [] },
        siteverify,
      ),
    ).toEqual({ status: "unavailable" })
    expect(siteverify).not.toHaveBeenCalled()
  })

  it("rejects missing or oversized tokens before calling Siteverify", async () => {
    const siteverify = siteverifyResponse({})
    expect(
      await verifyWatchRecommendationTurnstile(null, config, siteverify),
    ).toEqual({ status: "rejected" })
    expect(
      await verifyWatchRecommendationTurnstile(
        "x".repeat(2_049),
        config,
        siteverify,
      ),
    ).toEqual({ status: "rejected" })
    expect(siteverify).not.toHaveBeenCalled()
  })

  it("requires a successful token for the exact action and hostname", async () => {
    for (const fields of [
      { success: false },
      { action: "tv_feedback" },
      { hostname: "attacker.example" },
      { hostname: undefined },
    ]) {
      expect(
        await verifyWatchRecommendationTurnstile(
          "token",
          config,
          siteverifyResponse(fields),
        ),
      ).toEqual({ status: "rejected" })
    }
    const siteverify = siteverifyResponse({})
    expect(
      await verifyWatchRecommendationTurnstile("token", config, siteverify),
    ).toEqual({ status: "verified", hostname: "www.jesusfilm.org" })
    const [url, init] = siteverify.mock.calls[0]!
    expect(url).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    )
    expect(init?.method).toBe("POST")
    expect(new URLSearchParams(String(init?.body)).get("response")).toBe(
      "token",
    )
  })

  it("treats transport and response failures as unavailable", async () => {
    expect(
      await verifyWatchRecommendationTurnstile(
        "token",
        config,
        vi.fn<typeof fetch>(async () => {
          throw new Error("network failure")
        }),
      ),
    ).toEqual({ status: "unavailable" })
    expect(
      await verifyWatchRecommendationTurnstile(
        "token",
        config,
        vi.fn<typeof fetch>(async () => new Response(null, { status: 503 })),
      ),
    ).toEqual({ status: "unavailable" })
  })

  it("labels real official test-key Siteverify success as a local fixture only", async () => {
    const fixture = {
      secret: WATCH_RECOMMENDATION_TURNSTILE_TEST_SECRET_KEY,
      siteKey: WATCH_RECOMMENDATION_TURNSTILE_TEST_SITE_KEY,
      hostnames: [WATCH_RECOMMENDATION_TURNSTILE_FIXTURE_HOSTNAME],
      requestHostname: "localhost",
      allowLocalFixture: true,
    }
    const siteverify = siteverifyResponse({
      action: undefined,
      hostname: "example.com",
      metadata: { result_with_testing_key: true },
    })
    expect(
      await verifyWatchRecommendationTurnstile(
        "XXXX.DUMMY.TOKEN.XXXX",
        fixture,
        siteverify,
      ),
    ).toEqual({
      status: "fixture_verified",
      hostname: WATCH_RECOMMENDATION_TURNSTILE_FIXTURE_HOSTNAME,
    })
    expect(
      await verifyWatchRecommendationTurnstile(
        "XXXX.DUMMY.TOKEN.XXXX",
        { ...fixture, allowLocalFixture: false },
        siteverify,
      ),
    ).toEqual({ status: "unavailable" })
    expect(
      await verifyWatchRecommendationTurnstile(
        "XXXX.DUMMY.TOKEN.XXXX",
        { ...fixture, requestHostname: "www.jesusfilm.org" },
        siteverify,
      ),
    ).toEqual({ status: "unavailable" })
    vi.stubEnv("NODE_ENV", "production")
    try {
      expect(
        await verifyWatchRecommendationTurnstile(
          "XXXX.DUMMY.TOKEN.XXXX",
          fixture,
          siteverify,
        ),
      ).toEqual({ status: "unavailable" })
    } finally {
      vi.unstubAllEnvs()
    }
    expect(siteverify).toHaveBeenCalledOnce()
  })
})
