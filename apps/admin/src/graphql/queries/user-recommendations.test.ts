import { beforeEach, describe, expect, it, vi } from "vitest"

const { deliver, resolveIdentity } = vi.hoisted(() => ({
  deliver: vi.fn(),
  resolveIdentity: vi.fn(),
}))
vi.mock("@/services/recommendations/user-delivery.service", () => ({
  createUserRecommendationDeliveryService: () => ({ deliver }),
}))
vi.mock("@/services/recommendations/viewer-identity.service", () => ({
  resolveRecommendationIdentity: resolveIdentity,
}))
vi.mock("@/db/client", () => ({ prisma: {} }))

import { schema } from "@/graphql/schema"

const webCaller = {
  role: "CONSUMER_BEARER",
  id: null,
  fleet: false,
  rateLimitBucketKey: "web-key",
}
const args = {
  locale: "en",
  audioLanguageSlug: "english",
  viewerToken: "viewer-token",
  sessionToken: "session-token",
  sessionDigest: "a".repeat(64),
  consentReceiptDigest: "b".repeat(64),
  profileTokenDigest: "c".repeat(64),
}
const resolver = schema.getQueryType()!.getFields().userRecommendations!
  .resolve!

beforeEach(() => {
  vi.clearAllMocks()
  deliver.mockResolvedValue({ requestId: null, items: [] })
  resolveIdentity.mockResolvedValue({
    caller: webCaller,
    sessionDigest: "d".repeat(64),
    consentReceiptDigest: "e".repeat(64),
    profileTokenDigest: "f".repeat(64),
  })
})

describe("userRecommendations traffic boundary", () => {
  it.each([
    { trafficCategory: "declared_crawler" },
    { trafficCategory: "speculative_prefetch" },
    { trafficCategory: "speculative_prerender" },
    { eligibleHuman: false },
    { trafficCategory: "ordinary_browser", eligibleHuman: false },
  ])("bypasses identity and discards credentials for %j", async (traffic) => {
    await resolver(
      null,
      { ...args, ...traffic },
      { user: webCaller },
      {} as never,
    )
    expect(resolveIdentity).not.toHaveBeenCalled()
    expect(deliver).toHaveBeenCalledExactlyOnceWith({
      caller: webCaller,
      sessionDigest: "0".repeat(64),
      consentReceiptDigest: null,
      profileTokenDigest: null,
      locale: args.locale,
      audioLanguageSlug: args.audioLanguageSlug,
      count: 6,
      eligibleHuman: true,
      trafficCategory: undefined,
      ...traffic,
    })
  })

  it.each([null, { ...webCaller, fleet: true }])(
    "rejects untrusted classification before identity or delivery: %j",
    async (user) => {
      await expect(
        resolver(
          null,
          { ...args, trafficCategory: "declared_crawler" },
          { user },
          {} as never,
        ),
      ).rejects.toThrow("Web consumer authentication required")
      expect(resolveIdentity).not.toHaveBeenCalled()
      expect(deliver).not.toHaveBeenCalled()
    },
  )

  it.each([undefined, "ordinary_browser"])(
    "preserves verified identity for ordinary and older callers: %s",
    async (trafficCategory) => {
      const input = { ...args, trafficCategory }
      await resolver(null, input, { user: webCaller }, {} as never)
      expect(resolveIdentity).toHaveBeenCalledExactlyOnceWith(
        {},
        webCaller,
        input,
      )
      expect(deliver).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionDigest: "d".repeat(64),
          consentReceiptDigest: "e".repeat(64),
          profileTokenDigest: "f".repeat(64),
        }),
      )
    },
  )
})
