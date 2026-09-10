import { createHash } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { adminUserRecommendationsOperation } from "@forge/admin-graphql/operations"
import { resetRecommendationMutationAdmissionForTests } from "@/lib/recommendation-mutation-admission"
const { query } = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_CANONICAL_ORIGIN: "https://watch.example" },
}))
vi.mock("@/lib/admin-client", () => ({ default: { query } }))
const { POST } = await import("./route")
const body = { locale: "en", audioLanguageSlug: "english" }
const delivery = { result: "served", items: [] }
function request(value: unknown = body, headers: Record<string, string> = {}) {
  return new Request(
    "https://watch.example/watch/api/recommendations/for-you",
    {
      method: "POST",
      headers: {
        origin: "https://watch.example",
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(value),
    },
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  resetRecommendationMutationAdmissionForTests()
  query.mockResolvedValue({ data: { userRecommendations: delivery } })
})
describe("source-free Web adapter", () => {
  it("issues private no-store responses and requests six using a host-only session", async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toMatch(/private.*no-store/)
    expect(response.headers.get("set-cookie")).toContain("HttpOnly")
    expect(response.headers.get("set-cookie")).not.toContain("Domain=")
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        query: adminUserRecommendationsOperation,
        fetchPolicy: "no-cache",
        variables: expect.objectContaining({
          ...body,
          count: 6,
          sessionDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    )
  })
  it("forwards digests only and leaves a profile dormant without its receipt", async () => {
    const raw = "a".repeat(43)
    await POST(
      request(body, {
        cookie: `forge_recommendation_session=${raw}; forge_recommendation_profile=${"b".repeat(43)}`,
      }),
    )
    expect(query.mock.calls[0][0].variables).toMatchObject({
      sessionDigest: createHash("sha256").update(raw).digest("hex"),
      profileTokenDigest: null,
      consentReceiptDigest: null,
    })
    expect(JSON.stringify(query.mock.calls)).not.toContain(raw)
  })
  it("honors a pending withdrawal despite remaining profile cookies", async () => {
    await POST(
      request(body, {
        cookie: `forge_recommendation_session=${"a".repeat(43)}; forge_recommendation_profile=${"b".repeat(43)}; forge_recommendation_consent=${"c".repeat(43)}; forge_recommendation_withdrawal_pending=1`,
      }),
    )
    expect(query.mock.calls[0][0].variables).toMatchObject({
      profileTokenDigest: null,
      consentReceiptDigest: null,
    })
  })
  it.each([
    { ...body, viewerToken: "injected" },
    { ...body, sessionDigest: "a".repeat(64) },
    { ...body, count: 20 },
  ])("rejects client identity/count injection", async (input) => {
    expect((await POST(request(input))).status).toBe(400)
    expect(query).not.toHaveBeenCalled()
  })
  it("rejects cross-origin delivery", async () => {
    expect(
      (await POST(request(body, { origin: "https://other.example" }))).status,
    ).toBe(403)
    expect(query).not.toHaveBeenCalled()
  })
})
