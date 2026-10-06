import { describe, expect, it } from "vitest"
import {
  verifyWatchRecommendationTurnstile,
  WATCH_RECOMMENDATION_TURNSTILE_FIXTURE_HOSTNAME,
  WATCH_RECOMMENDATION_TURNSTILE_TEST_SECRET_KEY,
  WATCH_RECOMMENDATION_TURNSTILE_TEST_SITE_KEY,
} from "./recommendation-turnstile"

// Opt-in integration proof against Cloudflare's published dummy credentials.
// It never yields a live qualification and requires an explicit local run.
describe.skipIf(process.env.RECOMMENDATION_TURNSTILE_NETWORK_TEST !== "1")(
  "official Turnstile local fixture",
  () => {
    it("validates a real Siteverify response and labels it non-authoritative", async () => {
      expect(
        await verifyWatchRecommendationTurnstile("XXXX.DUMMY.TOKEN.XXXX", {
          secret: WATCH_RECOMMENDATION_TURNSTILE_TEST_SECRET_KEY,
          siteKey: WATCH_RECOMMENDATION_TURNSTILE_TEST_SITE_KEY,
          hostnames: [WATCH_RECOMMENDATION_TURNSTILE_FIXTURE_HOSTNAME],
          requestHostname: "localhost",
          allowLocalFixture: true,
        }),
      ).toEqual({
        status: "fixture_verified",
        hostname: WATCH_RECOMMENDATION_TURNSTILE_FIXTURE_HOSTNAME,
      })
    })
  },
)
