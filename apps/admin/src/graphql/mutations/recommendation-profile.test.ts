import { beforeEach, describe, expect, it, vi } from "vitest"

const statusMock = vi.fn()
const transitionMock = vi.fn()
const completeErasureMock = vi.fn()
const dispatchProjectionMock = vi.hoisted(() => vi.fn())

vi.mock("@/services/recommendations/profile.service", () => ({
  createRecommendationProfileService: vi.fn(() => ({
    status: statusMock,
    transition: transitionMock,
    completeErasure: completeErasureMock,
  })),
}))
vi.mock("@/db/client", () => ({ prisma: {} }))
vi.mock("@/services/recommendations/profiles/job", () => ({
  dispatchRecommendationProfileProjection: dispatchProjectionMock,
}))

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
    state: "active",
    choice: "durable_allowed",
    privacyGeneration: 1,
    expiresAt: "2027-02-21T00:00:00.000Z",
    erasureState: "not_required",
    cookieDisposition: "set",
    consentChoice: "personalization",
    consentContractVersion: "recommendation-consent-v1",
    consentExpiresAt: "2027-02-21T00:00:00.000Z",
    consentCookieDisposition: "set",
    profileId: "private-profile-id",
    erasureGeneration: null,
  })
  dispatchProjectionMock.mockResolvedValue({ queued: true })
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
    await Promise.resolve()
    expect(dispatchProjectionMock).not.toHaveBeenCalled()
  })

  it("schedules status projection only for an active personalized receipt", async () => {
    statusMock.mockResolvedValueOnce({
      state: "active",
      choice: "durable_allowed",
      privacyGeneration: 3,
      expiresAt: "2027-02-21T00:00:00.000Z",
      erasureState: "not_required",
      cookieDisposition: "keep",
      consentChoice: "personalization",
      profileId: "private-profile-id",
      erasureGeneration: null,
    })

    await mutation("recommendationProfileStatus")(
      null,
      {
        contractVersion: "recommendation-profile-v1",
        sessionDigest: "a".repeat(64),
        profileDigest: "b".repeat(64),
      },
      { user: caller },
      {} as never,
    )

    await vi.waitFor(() => {
      expect(dispatchProjectionMock).toHaveBeenCalledWith({
        sessionDigest: "a".repeat(64),
        profileId: "private-profile-id",
        privacyGeneration: 3,
      })
    })
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

    await Promise.resolve()
    expect(dispatchProjectionMock).not.toHaveBeenCalled()
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
    await vi.waitFor(() => {
      expect(dispatchProjectionMock).toHaveBeenCalledWith({
        sessionDigest: "a".repeat(64),
        profileId: "private-profile-id",
        privacyGeneration: 1,
      })
    })
  })
})
