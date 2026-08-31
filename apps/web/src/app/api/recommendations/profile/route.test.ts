import { createHash } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  adminRecommendationProfileStatusOperation,
  adminTransitionRecommendationProfileOperation,
} from "@forge/admin-graphql/operations"
import {
  RECOMMENDATION_MUTATION_CLIENT_LIMIT,
  resetRecommendationMutationAdmissionForTests,
} from "@/lib/recommendation-mutation-admission"

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }))

vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_CANONICAL_ORIGIN: "https://watch.example" },
}))
vi.mock("@/lib/admin-client", () => ({ default: { mutate } }))

const { POST } = await import("./route")

const session = "s".repeat(43)
const profile = "p".repeat(43)
const consent = "c".repeat(43)

function request(
  action: string,
  cookie = `forge_recommendation_session=${session}`,
  extra = {},
) {
  return new Request(
    "https://watch.example/watch/api/recommendations/profile",
    {
      method: "POST",
      headers: {
        origin: "https://watch.example",
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        contractVersion: "recommendation-profile-v1",
        action,
        ...extra,
      }),
    },
  )
}

const sessionOnly = {
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
}

describe("POST /watch/api/recommendations/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetRecommendationMutationAdmissionForTests()
    mutate.mockResolvedValue({
      data: { recommendationProfileStatus: sessionOnly },
    })
  })

  it("reports session-only by default without issuing a durable identity", async () => {
    const response = await POST(request("status"))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ profile: sessionOnly })
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        mutation: adminRecommendationProfileStatusOperation,
        variables: {
          contractVersion: "recommendation-profile-v1",
          consentContractVersion: "recommendation-consent-v1",
          sessionDigest: createHash("sha256").update(session).digest("hex"),
          consentReceiptDigest: null,
          profileDigest: null,
        },
      }),
    )
  })

  it("accepts and strips the exact GraphQL receipt typename", async () => {
    mutate.mockResolvedValueOnce({
      data: {
        recommendationProfileStatus: {
          __typename: "RecommendationProfileReceipt",
          ...sessionOnly,
        },
      },
    })

    const response = await POST(request("status"))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ profile: sessionOnly })
  })

  it("rejects an unexpected GraphQL receipt typename", async () => {
    mutate.mockResolvedValueOnce({
      data: {
        recommendationProfileStatus: {
          __typename: "UnexpectedProfileReceipt",
          ...sessionOnly,
        },
      },
    })

    const response = await POST(request("status"))

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: "invalid_admin_response" })
  })

  it("issues a protected durable cookie only after explicit grant", async () => {
    mutate.mockResolvedValueOnce({
      data: {
        transitionRecommendationProfile: {
          ...sessionOnly,
          state: "active",
          choice: "durable_allowed",
          privacyGeneration: 1,
          expiresAt: "2027-02-21T00:00:00.000Z",
          erasureState: "not_required",
          cookieDisposition: "set",
          consentChoice: "personalization",
          consentExpiresAt: "2027-02-21T00:00:00.000Z",
          consentCookieDisposition: "set",
        },
      },
    })

    const response = await POST(request("grant"))
    expect(response.status).toBe(200)
    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain("forge_recommendation_profile=")
    expect(setCookie).toContain("forge_recommendation_consent=")
    expect(setCookie).toContain("HttpOnly")
    expect(setCookie.toLowerCase()).toContain("samesite=lax")
    const variables = mutate.mock.calls[0]?.[0]?.variables
    expect(mutate.mock.calls[0]?.[0]?.mutation).toBe(
      adminTransitionRecommendationProfileOperation,
    )
    expect(variables.existingProfileDigest).toBeNull()
    expect(variables.proposedProfileDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(variables.consentContractVersion).toBe("recommendation-consent-v1")
    expect(variables.consentChoice).toBe("personalization")
    expect(variables.existingConsentReceiptDigest).toBeNull()
    expect(variables.proposedConsentReceiptDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(setCookie).not.toContain(variables.proposedProfileDigest)
  })

  it("persists Essential only in a separate protected receipt without creating a profile", async () => {
    mutate.mockResolvedValueOnce({
      data: {
        transitionRecommendationProfile: {
          ...sessionOnly,
          consentChoice: "essential_only",
          consentExpiresAt: "2027-02-21T00:00:00.000Z",
          consentCookieDisposition: "set",
          cookieDisposition: "clear",
        },
      },
    })

    const response = await POST(request("withdraw"))
    expect(response.status).toBe(200)
    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain("forge_recommendation_consent=")
    expect(setCookie).toContain("HttpOnly")
    expect(setCookie).toContain("Secure")
    expect(setCookie).toContain("forge_recommendation_profile=;")
    const variables = mutate.mock.calls[0]?.[0]?.variables
    expect(variables).toMatchObject({
      consentContractVersion: "recommendation-consent-v1",
      consentChoice: "essential_only",
      existingConsentReceiptDigest: null,
      existingProfileDigest: null,
      proposedProfileDigest: null,
    })
    expect(variables.proposedConsentReceiptDigest).toMatch(/^[a-f0-9]{64}$/)
  })

  it("fails ambiguous consent cookies closed and never forwards their value", async () => {
    const response = await POST(
      request(
        "status",
        `forge_recommendation_session=${session}; forge_recommendation_consent=${consent}; forge_recommendation_consent=${consent}; forge_recommendation_profile=${profile}`,
      ),
    )
    expect(response.status).toBe(200)
    const variables = mutate.mock.calls[0]?.[0]?.variables
    expect(variables.consentReceiptDigest).toBeNull()
    expect(response.headers.get("set-cookie")).toContain(
      "forge_recommendation_consent=;",
    )
    expect(JSON.stringify(variables)).not.toContain(consent)
  })

  it("recovers a lost profile cookie by clearing stale consent and requiring a fresh choice", async () => {
    mutate.mockResolvedValueOnce({
      data: {
        recommendationProfileStatus: {
          ...sessionOnly,
          cookieDisposition: "clear",
          consentCookieDisposition: "clear",
        },
      },
    })

    const response = await POST(
      request(
        "status",
        `forge_recommendation_session=${session}; forge_recommendation_consent=${consent}`,
      ),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      profile: {
        ...sessionOnly,
        cookieDisposition: "clear",
        consentCookieDisposition: "clear",
      },
    })
    expect(mutate.mock.calls[0]?.[0]?.variables).toMatchObject({
      consentReceiptDigest: createHash("sha256").update(consent).digest("hex"),
      profileDigest: null,
    })
    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain("forge_recommendation_profile=;")
    expect(setCookie).toContain("forge_recommendation_consent=;")
  })

  it("clears malformed or substituted profile cookies without adopting them", async () => {
    mutate.mockResolvedValueOnce({
      data: {
        recommendationProfileStatus: {
          ...sessionOnly,
          cookieDisposition: "clear",
        },
      },
    })
    const response = await POST(
      request(
        "status",
        `forge_recommendation_session=${session}; forge_recommendation_profile=attacker`,
      ),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0")
    expect(mutate.mock.calls[0]?.[0]?.variables.profileDigest).toBeNull()
  })

  it("forwards only the digest of one valid profile cookie", async () => {
    await POST(
      request(
        "status",
        `forge_recommendation_session=${session}; forge_recommendation_profile=${profile}`,
      ),
    )
    const variables = mutate.mock.calls[0]?.[0]?.variables
    expect(variables.profileDigest).toBe(
      createHash("sha256").update(profile).digest("hex"),
    )
    expect(JSON.stringify(variables)).not.toContain(profile)
  })

  it("keeps withdraw available after the status namespace is exhausted", async () => {
    const statusRequest = () => {
      const value = request("status")
      value.headers.set("cf-connecting-ip", "203.0.113.77")
      return value
    }

    for (
      let attempt = 0;
      attempt < RECOMMENDATION_MUTATION_CLIENT_LIMIT;
      attempt += 1
    ) {
      expect((await POST(statusRequest())).status).toBe(200)
    }
    expect((await POST(statusRequest())).status).toBe(429)

    mutate.mockResolvedValueOnce({
      data: {
        transitionRecommendationProfile: {
          ...sessionOnly,
          cookieDisposition: "clear",
        },
      },
    })
    const withdrawRequest = request("withdraw")
    withdrawRequest.headers.set("cf-connecting-ip", "203.0.113.77")
    expect((await POST(withdrawRequest)).status).toBe(200)
  })

  it("rejects CSRF, unknown actions, and client-supplied identity fields", async () => {
    const csrfRequest = request("grant")
    csrfRequest.headers.set("origin", "https://evil.example")
    expect((await POST(csrfRequest)).status).toBe(403)
    expect((await POST(request("merge"))).status).toBe(400)
    expect(
      (await POST(request("grant", undefined, { profileDigest: "fabricated" })))
        .status,
    ).toBe(400)
    expect(mutate).not.toHaveBeenCalled()
  })
})
