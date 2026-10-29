import { beforeEach, describe, expect, it, vi } from "vitest"

const statusMock = vi.fn()
const transitionMock = vi.fn()

vi.mock("@/services/recommendations/profile.service", () => ({
  createRecommendationProfileService: vi.fn(() => ({
    status: statusMock,
    transition: transitionMock,
  })),
}))
vi.mock("@/db/client", () => ({ prisma: {} }))

import { schema } from "@/graphql/schema"

const caller = {
  id: null,
  role: "CONSUMER_BEARER",
  fleet: false,
  rateLimitBucketKey: "test-web-consumer-key",
}

function mutation(name: string) {
  return schema.getMutationType()!.getFields()[name]!.resolve!
}

beforeEach(() => {
  vi.clearAllMocks()
  statusMock.mockResolvedValue({
    state: "session_only",
    choice: "session_only",
    privacyGeneration: null,
    expiresAt: null,
    erasureState: null,
    cookieDisposition: "keep",
    consentChoice: "undecided",
    consentContractVersion: "recommendation-consent-v1",
    consentExpiresAt: null,
    consentCookieDisposition: "keep",
    profileId: null,
    erasureGeneration: null,
  })
  transitionMock.mockResolvedValue({
    state: "session_only",
    choice: "session_only",
    privacyGeneration: null,
    expiresAt: null,
    erasureState: "pending",
    cookieDisposition: "clear",
    consentChoice: "undecided",
    consentContractVersion: "recommendation-consent-v1",
    consentExpiresAt: null,
    consentCookieDisposition: "clear",
    profileId: "private-profile-id",
    erasureGeneration: 1,
  })
})

describe("recommendation profile resolvers", () => {
  it("forwards session-only status without scheduling a pre-consent projection", async () => {
    const args = {
      contractVersion: "recommendation-profile-v1",
      sessionDigest: "a".repeat(64),
      profileDigest: null,
    }
    const result = await mutation("recommendationProfileStatus")(
      null,
      args,
      { user: caller },
      {} as never,
    )

    expect(statusMock).toHaveBeenCalledWith({
      ...args,
      caller,
      consentContractVersion: undefined,
      consentReceiptDigest: null,
    })
    expect(result).not.toHaveProperty("tokenDigest")
    expect(result).not.toHaveProperty("profileId")
    expect(result).not.toHaveProperty("erasureGeneration")
  })

  it("keeps a historical pending erasure private without restarting a learner", async () => {
    statusMock.mockResolvedValueOnce({
      state: "session_only",
      choice: "session_only",
      privacyGeneration: null,
      expiresAt: null,
      erasureState: "pending",
      cookieDisposition: "clear",
      consentChoice: "undecided",
      profileId: "private-profile-id",
      erasureGeneration: 3,
    })

    const result = await mutation("recommendationProfileStatus")(
      null,
      {
        contractVersion: "recommendation-profile-v1",
        sessionDigest: "a".repeat(64),
        profileDigest: "b".repeat(64),
      },
      { user: caller },
      {} as never,
    )

    expect(result).toMatchObject({ erasureState: "pending" })
    expect(result).not.toHaveProperty("profileId")
    expect(result).not.toHaveProperty("erasureGeneration")
  })

  it("does not schedule a projection for an Essential-only receipt", async () => {
    statusMock.mockResolvedValueOnce({
      state: "session_only",
      choice: "session_only",
      privacyGeneration: null,
      expiresAt: null,
      erasureState: null,
      cookieDisposition: "clear",
      consentChoice: "essential_only",
      consentContractVersion: "recommendation-consent-v1",
      consentExpiresAt: "2027-02-21T00:00:00.000Z",
      consentCookieDisposition: "keep",
      profileId: null,
      erasureGeneration: null,
    })

    await mutation("recommendationProfileStatus")(
      null,
      {
        contractVersion: "recommendation-profile-v1",
        sessionDigest: "a".repeat(64),
        profileDigest: null,
      },
      { user: caller },
      {} as never,
    )
  })

  it("keeps erasure scheduling keys out of the public receipt", async () => {
    const args = {
      contractVersion: "recommendation-profile-v1",
      action: "grant",
      sessionDigest: "a".repeat(64),
      existingProfileDigest: null,
      proposedProfileDigest: "b".repeat(64),
    }
    const result = await mutation("transitionRecommendationProfile")(
      null,
      args,
      { user: caller },
      {} as never,
    )

    expect(transitionMock).toHaveBeenCalledWith({
      ...args,
      caller,
      consentChoice: undefined,
      consentContractVersion: undefined,
      existingConsentReceiptDigest: null,
      proposedConsentReceiptDigest: null,
    })
    expect(result).not.toHaveProperty("tokenDigest")
    expect(result).not.toHaveProperty("profileId")
    expect(result).not.toHaveProperty("erasureGeneration")
  })
})
