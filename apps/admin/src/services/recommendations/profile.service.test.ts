import { describe, expect, it } from "vitest"
import { RecommendationProfileService } from "./profile.service"

const webCaller = {
  id: "forge-web",
  role: "CONSUMER_BEARER" as const,
  rateLimitBucketKey: "forge-web",
}
const digest = "a".repeat(64)
const service = new RecommendationProfileService()

describe("retired recommendation profile contract", () => {
  it("returns a session-only receipt for a valid legacy status", async () => {
    const receipt = await service.status({
      caller: webCaller,
      contractVersion: "recommendation-profile-v1",
      sessionDigest: digest,
      profileDigest: digest,
      consentReceiptDigest: digest,
    })
    expect(receipt).toMatchObject({
      state: "session_only",
      choice: "session_only",
      profileId: null,
      cookieDisposition: "clear",
      consentCookieDisposition: "clear",
    })
  })

  it.each(["grant", "reset", "withdraw", "delete"] as const)(
    "does not create behavioral state for %s",
    async (action) => {
      const receipt = await service.transition({
        caller: webCaller,
        contractVersion: "recommendation-profile-v1",
        action,
        sessionDigest: digest,
        existingProfileDigest: digest,
        proposedProfileDigest: digest,
      })
      expect(receipt.state).toBe("session_only")
      expect(receipt.profileId).toBeNull()
      expect(receipt.cookieDisposition).toBe("clear")
    },
  )

  it("rejects malformed input and unauthenticated callers", async () => {
    await expect(
      service.status({
        caller: webCaller,
        contractVersion: "recommendation-profile-v1",
        sessionDigest: "invalid",
        profileDigest: null,
      }),
    ).rejects.toThrow()
    await expect(
      service.status({
        caller: null,
        contractVersion: "recommendation-profile-v1",
        sessionDigest: digest,
        profileDigest: null,
      }),
    ).rejects.toThrow()
  })
})
