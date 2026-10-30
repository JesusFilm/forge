import { createHash } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { adminTransitionRecommendationProfileOperation } from "@forge/admin-graphql/operations"
import { resetRecommendationMutationAdmissionForTests } from "@/lib/recommendation-mutation-admission"

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

describe("retired profile compatibility endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetRecommendationMutationAdmissionForTests()
  })
  it.each(["status", "grant", "reset", "withdraw", "delete"])(
    "does not create a profile for %s",
    async (action) => {
      const response = await POST(request(action))
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        profile: {
          state: "session_only",
          consentChoice: "undecided",
          consentExpiresAt: null,
          cookieDisposition: "clear",
          consentCookieDisposition: "clear",
        },
      })
      expect(mutate).not.toHaveBeenCalled()
      expect(response.headers.get("set-cookie")).toContain(
        "forge_recommendation_profile=;",
      )
      expect(response.headers.get("set-cookie")).toContain("Max-Age=0")
      if (action === "reset" || action === "delete") {
        expect(response.headers.get("set-cookie")).toContain(
          "forge_recommendation_experiment_browser=;",
        )
        expect(response.headers.get("set-cookie")).toContain(
          "forge_recommendation_experiment_tester=;",
        )
      }
    },
  )
  it.each(["status", "grant"])(
    "retires old credentials before clearing a stale %s response",
    async (action) => {
      mutate.mockResolvedValue({
        data: { transitionRecommendationProfile: { erasureState: "pending" } },
      })
      const response = await POST(
        request(
          action,
          `forge_recommendation_session=${session}; forge_recommendation_profile=${profile}; forge_recommendation_consent=${consent}`,
        ),
      )
      expect(response.status).toBe(200)
      expect(mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: expect.objectContaining({
            action: "withdraw",
            existingProfileDigest: createHash("sha256")
              .update(profile)
              .digest("hex"),
            proposedProfileDigest: null,
          }),
        }),
      )
      expect(response.headers.get("set-cookie")).toContain(
        "forge_recommendation_profile=;",
      )
      expect(await response.json()).toMatchObject({
        profile: { erasureState: "pending" },
      })
    },
  )
  it("preserves credentials when retirement fails", async () => {
    mutate.mockRejectedValue(new Error("upstream unavailable"))
    const response = await POST(
      request("status", `forge_recommendation_profile=${profile}`),
    )
    expect(response.status).toBeGreaterThanOrEqual(500)
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(mutate).toHaveBeenCalled()
  })
  it("retires an old profile after its shorter-lived session cookie expired", async () => {
    mutate.mockResolvedValue({
      data: { transitionRecommendationProfile: { erasureState: "pending" } },
    })
    const response = await POST(
      request("status", `forge_recommendation_profile=${profile}`),
    )
    expect(response.status).toBe(200)
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({
          action: "withdraw",
          sessionDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          existingProfileDigest: createHash("sha256")
            .update(profile)
            .digest("hex"),
        }),
      }),
    )
  })
  it("forwards withdrawal only to erase existing state and never proposes new credentials", async () => {
    mutate.mockResolvedValue({
      data: { transitionRecommendationProfile: { erasureState: "pending" } },
    })
    const response = await POST(
      request(
        "delete",
        `forge_recommendation_session=${session}; forge_recommendation_profile=${profile}`,
      ),
    )
    expect(response.status).toBe(200)
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        mutation: adminTransitionRecommendationProfileOperation,
        variables: expect.objectContaining({
          action: "withdraw",
          existingProfileDigest: createHash("sha256")
            .update(profile)
            .digest("hex"),
          proposedProfileDigest: null,
          proposedConsentReceiptDigest: null,
        }),
      }),
    )
    expect(await response.json()).toMatchObject({
      profile: { erasureState: "pending" },
    })
  })
  it("retains origin checks and refuses client-supplied identities", async () => {
    const csrf = request("grant")
    csrf.headers.set("origin", "https://evil.example")
    expect((await POST(csrf)).status).toBe(403)
    expect((await POST(request("merge"))).status).toBe(400)
    expect(
      (await POST(request("grant", undefined, { profileDigest: "fabricated" })))
        .status,
    ).toBe(400)
    expect(mutate).not.toHaveBeenCalled()
  })
})
