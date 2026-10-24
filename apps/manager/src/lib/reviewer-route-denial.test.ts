import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

let reviewerCookie = ""
let operatorCookie = ""

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

  const operatorToken = await createManagerSessionCookie({
    id: "operator-1",
    subject: "auth-operator-1",
    email: "operator@forge.test",
    managerRole: "OPERATOR",
    scopes: ["openid", "manager:access"],
  })
  operatorCookie = `${MANAGER_SESSION_COOKIE}=${operatorToken}`
})

afterAll(() => {
  vi.unstubAllEnvs()
})

function operatorRequest(path: string, init?: RequestInit) {
  return new Request(`http://example.test${path}`, {
    ...init,
    headers: {
      cookie: operatorCookie,
      ...init?.headers,
    },
  })
}

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
    // `/api/shorts/jobs` was replaced by the single `/api/shorts/command`
    // Studio RPC entry point in #2246/#2248. That route's authenticator runs
    // its same-origin check BEFORE the role check, so this request must carry
    // a matching `origin` — otherwise the 403 proves same-origin rejection
    // and says nothing about reviewer isolation.
    const [{ POST: approveSmartCrop }, { POST: runShortsCommand }] =
      await Promise.all([
        import("@/app/api/smart-crop/jobs/[id]/approve/route"),
        import("@/app/api/shorts/command/route"),
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
      runShortsCommand(
        reviewerRequest("/api/shorts/command", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://example.test",
          },
          body: JSON.stringify({ action: "shorts.create", input: {} }),
        }),
      ),
    ])

    expect(smartCropResponse.status).toBe(403)
    // A REVIEWER session is not an OPERATOR session, so the interactive
    // authenticator sees no session at all and answers 401 (no bearer).
    expect(shortsResponse.status).toBe(401)
    await expect(shortsResponse.json()).resolves.toEqual({
      error: "Interactive Manager session required",
    })
  })

  // Anti-vacuous control for every denial above. Those assertions are all
  // equally satisfied by a cookie that simply fails to parse, so without a
  // case proving the fixture mints a session the guard actually reads, a
  // broken cookie helper would leave this whole file green while proving
  // nothing about the REVIEWER role.
  it("admits an OPERATOR session at the same Shorts route", async () => {
    const { POST: runShortsCommand } =
      await import("@/app/api/shorts/command/route")
    const response = await runShortsCommand(
      operatorRequest("/api/shorts/command", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://example.test",
        },
        body: JSON.stringify({ action: "shorts.create", input: {} }),
      }),
    )

    // Exactly 400: the operator IS admitted and the request then fails the
    // Studio RPC schema. A loose `not.toBe(401)` would also accept the guard's
    // pre-auth 403 and the 413 body cap, neither of which proves admission.
    expect(response.status).toBe(400)
  })

  // Mechanism-level cover for all 13 Studio routes at once. The source scan in
  // reviewer-boundary.test.ts pins that `authenticateStudioRequest` delegates
  // to the operator-only authenticator, but a reviewer-admitting early return
  // inserted ABOVE that delegation keeps both string assertions green. Only
  // calling the guard can catch that, and only one Studio route has a
  // behavioural denial case of its own.
  it("denies a REVIEWER at the shared Studio guard itself", async () => {
    const [{ authenticateStudioRequest }, { NextResponse }] = await Promise.all(
      [import("./studio-request"), import("next/server")],
    )

    const result = await authenticateStudioRequest(
      reviewerRequest("/api/shorts/command", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://example.test",
        },
        body: JSON.stringify({ action: "shorts.create", input: {} }),
      }),
    )

    expect(result).toBeInstanceOf(NextResponse)
    expect((result as InstanceType<typeof NextResponse>).status).toBe(401)
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
