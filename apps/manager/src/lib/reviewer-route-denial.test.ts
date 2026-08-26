import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

let reviewerCookie = ""

beforeAll(async () => {
  vi.stubEnv("MANAGER_DATA_MODE", "mock")
  vi.stubEnv("MANAGER_BACKEND_MODE", "mock")
  vi.stubEnv("MANAGER_MOCK_SESSION_SECRET", "mock-session-secret")
  vi.stubEnv(
    "MANAGER_SESSION_SECRET",
    "manager-session-secret-change-me-000000",
  )
  vi.stubEnv("MUX_TOKEN_ID", "mux-token-id")
  vi.stubEnv("MUX_TOKEN_SECRET", "mux-token-secret")
  vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key")

  const { createManagerSessionCookie, MANAGER_SESSION_COOKIE } =
    await import("./manager-session-cookie")
  const token = await createManagerSessionCookie({
    id: "reviewer-1",
    subject: "auth-reviewer-1",
    email: "reviewer@forge.test",
    managerRole: "REVIEWER",
    scopes: ["openid", "manager:access"],
    reviewerLanguageGrants: [
      {
        id: "grant-es",
        languageId: "language-es",
        languageSlug: "spanish-latin-america",
        permittedRubricDimensions: ["MEANING_ACCURACY"],
        specialistCapabilities: { scripture: false, theology: false },
      },
    ],
  })
  reviewerCookie = `${MANAGER_SESSION_COOKIE}=${token}`
})

afterAll(() => {
  vi.unstubAllEnvs()
})

function reviewerRequest(path: string, init?: RequestInit) {
  return new Request(`http://example.test${path}`, {
    ...init,
    headers: {
      cookie: reviewerCookie,
      ...init?.headers,
    },
  })
}

describe("reviewer denial at existing route boundaries", () => {
  it("denies Jobs, Coverage, and Automations reads", async () => {
    const [{ GET: getJobs }, { GET: getCoverage }, { GET: getAutomations }] =
      await Promise.all([
        import("@/app/api/jobs/route"),
        import("@/app/api/coverage-snapshots/route"),
        import("@/app/api/automations/route"),
      ])

    const responses = await Promise.all([
      getJobs(reviewerRequest("/api/jobs")),
      getCoverage(reviewerRequest("/api/coverage-snapshots?latest=true")),
      getAutomations(reviewerRequest("/api/automations")),
    ])

    expect(responses.map((response) => response.status)).toEqual([
      401, 401, 401,
    ])
  })

  it("denies Smart Crop and Shorts operator mutations", async () => {
    const [{ POST: approveSmartCrop }, { POST: createShort }] =
      await Promise.all([
        import("@/app/api/smart-crop/jobs/[id]/approve/route"),
        import("@/app/api/shorts/jobs/route"),
      ])

    const [smartCropResponse, shortsResponse] = await Promise.all([
      approveSmartCrop(
        reviewerRequest("/api/smart-crop/jobs/job-1/approve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "approve" }),
        }),
        { params: Promise.resolve({ id: "job-1" }) },
      ),
      createShort(
        reviewerRequest("/api/shorts/jobs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ muxAssetId: "asset-1" }),
        }),
      ),
    ])

    expect(smartCropResponse.status).toBe(403)
    expect(shortsResponse.status).toBe(403)
  })

  it("denies an SEO decision before CSRF consumption", async () => {
    const { POST } = await import("@/app/api/seo/proposals/[id]/approve/route")
    const response = await POST(
      reviewerRequest("/api/seo/proposals/proposal-1/approve", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://example.test",
        },
        body: JSON.stringify({ version: 1, payloadDigest: "digest" }),
      }),
      { params: Promise.resolve({ id: "proposal-1" }) },
    )

    expect(response.status).toBe(401)
  })
})
