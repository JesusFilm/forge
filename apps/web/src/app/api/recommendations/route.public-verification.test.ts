import { beforeEach, describe, expect, it, vi } from "vitest"

const { publicVisit, semantic, siteverify, observe, env } = vi.hoisted(() => ({
  publicVisit: vi.fn(),
  semantic: vi.fn(),
  siteverify: vi.fn(),
  observe: vi.fn(async () => true),
  env: {
    NEXT_PUBLIC_CANONICAL_ORIGIN: "https://watch.example",
    NEXT_PUBLIC_WATCH_RECOMMENDATION_TURNSTILE_SITE_KEY: "watch-site-key",
    WATCH_RECOMMENDATION_TESTER_SECRET:
      "browser-cookie-test-secret-0123456789abcdef",
    WATCH_RECOMMENDATION_HUMAN_PROOF_SECRET:
      "proof-test-secret-0123456789abcdef",
    WATCH_RECOMMENDATION_TURNSTILE_SECRET_KEY: "private-siteverify-secret",
    WATCH_RECOMMENDATION_TURNSTILE_HOSTNAMES: "watch.example",
  },
}))
vi.mock("@/env", () => ({ env }))
vi.mock("@/lib/recommendation-public-observation", () => ({
  watchPublicObservationHour: () => "2026100620",
  recordWatchPublicObservation: observe,
}))
vi.mock("@/lib/recommendation-turnstile", () => ({
  WATCH_RECOMMENDATION_TURNSTILE_ACTION: "watch_recommendations",
  WATCH_RECOMMENDATION_TURNSTILE_FIXTURE_HOSTNAME:
    "turnstile-test-fixture.local",
  WATCH_RECOMMENDATION_TURNSTILE_TEST_SITE_KEY: "1x00000000000000000000AA",
  WATCH_RECOMMENDATION_TURNSTILE_TEST_SECRET_KEY:
    "1x0000000000000000000000000000000AA",
  isWatchTurnstileTestCredential: (siteKey: string, secret: string) =>
    siteKey === "1x00000000000000000000AA" ||
    secret === "1x0000000000000000000000000000000AA",
  isLoopbackWatchHost: (hostname: string) => hostname === "localhost",
  verifyWatchRecommendationTurnstile: siteverify,
}))
vi.mock("@/lib/recommendation-mutation-admission", () => ({
  assertRecommendationMutationAdmission: vi.fn(async () => undefined),
}))
vi.mock("@/lib/recommendations", () => ({
  getPrecomputedWatchPublicVisitDelivery: publicVisit,
  getSemanticRecommendationDelivery: semantic,
  RecommendationPreviewAuthorizationError: class extends Error {},
}))

const { POST } = await import("./route")
const visitId = "22222222-2222-4222-8222-222222222222"
const source = {
  seedMediaId: "source-1",
  locale: "en",
  audioLanguageSlug: "english",
}
const incumbent = {
  contractVersion: "semantic-recommendation-v1",
  surfaceVersion: "watch-below-player-v1",
  strategyVersion: "semantic-transcript-pgvector-v1",
  classifierVersion: "legacy-position-v0",
  requestId: "incumbent-request",
  result: "empty",
  reason: null,
  expiresAt: null,
  requestedCount: 0,
  composedCount: 0,
  shortfallReason: null,
  personalization: null,
  items: [],
}
const required = {
  disposition: "ab",
  status: "excluded",
  visitId,
  experimentId: "experiment-1",
  generationId: "generation-1",
  arm: null,
  reason: "verification_required",
  qualification: null,
  measurementStatus: "not_applicable",
  delivery: null,
}

function request(cookie?: string, turnstileToken?: string) {
  return new Request("https://watch.example/watch/api/recommendations", {
    method: "POST",
    headers: {
      origin: "https://watch.example",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0",
      "x-forge-recommendation-visit-id": visitId,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({
      ...source,
      ...(turnstileToken ? { turnstileToken } : {}),
    }),
  })
}

function cookies(response: Awaited<ReturnType<typeof POST>>) {
  return [...response.cookies.getAll()]
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ")
}

beforeEach(() => {
  vi.clearAllMocks()
  semantic.mockResolvedValue(incumbent)
  siteverify.mockResolvedValue({
    status: "verified",
    hostname: "watch.example",
  })
  observe.mockResolvedValue(true)
  vi.spyOn(console, "info").mockImplementation(() => undefined)
})

describe("live Watch browser verification", () => {
  it("does not challenge when Admin control is inactive", async () => {
    publicVisit.mockResolvedValueOnce({
      ...required,
      disposition: "inactive",
      status: "not_applicable",
      reason: null,
    })
    const response = await POST(request())
    const body = await response.json()
    expect(body.verificationRequired).toBeUndefined()
    expect(siteverify).not.toHaveBeenCalled()
    expect(publicVisit.mock.calls[0]?.[0].humanVerificationReceipt).toBeNull()
  })

  it("challenges in a default-off prelaunch baseline without changing incumbent serving", async () => {
    publicVisit
      .mockResolvedValueOnce({ ...required, disposition: "baseline" })
      .mockResolvedValueOnce({
        ...required,
        disposition: "baseline",
        status: "eligible",
        arm: "control",
        reason: null,
        qualification: "turnstile_verified_browser",
        measurementStatus: "recorded",
        delivery: incumbent,
      })
    const first = await POST(request())
    const firstBody = await first.json()
    expect(firstBody.verificationRequired).toBe(true)
    expect(firstBody.delivery.strategyVersion).toBe(
      "semantic-transcript-pgvector-v1",
    )
    expect(
      first.cookies.get("forge_recommendation_experiment_browser"),
    ).toBeTruthy()
    expect(siteverify).not.toHaveBeenCalled()
    const second = await POST(request(cookies(first), "baseline-token"))
    const secondBody = await second.json()
    expect(secondBody.verificationRequired).toBeUndefined()
    expect(secondBody.delivery.strategyVersion).toBe(
      "semantic-transcript-pgvector-v1",
    )
    expect(publicVisit.mock.calls[1]?.[0].humanVerificationReceipt).toMatch(
      /^v1\./,
    )
  })

  it("challenges only after active signal, then binds signed proof and reuses one browser grant", async () => {
    publicVisit
      .mockResolvedValueOnce(required)
      .mockResolvedValueOnce({
        ...required,
        status: "eligible",
        arm: "challenger",
        reason: null,
        qualification: "turnstile_verified_browser",
        measurementStatus: "recorded",
        delivery: incumbent,
      })
      .mockResolvedValueOnce({
        ...required,
        status: "eligible",
        arm: "challenger",
        reason: null,
        qualification: "turnstile_verified_browser",
        measurementStatus: "recorded",
        delivery: incumbent,
      })
    const first = await POST(request())
    expect((await first.json()).verificationSiteKey).toBe("watch-site-key")
    expect(
      first.cookies.get("forge_recommendation_experiment_browser"),
    ).toBeTruthy()
    expect(siteverify).not.toHaveBeenCalled()

    const second = await POST(request(cookies(first), "fresh-token"))
    expect((await second.json()).verificationRequired).toBeUndefined()
    expect(siteverify).toHaveBeenCalledOnce()
    const proof = publicVisit.mock.calls[1]?.[0].humanVerificationReceipt
    expect(proof).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    const payload = JSON.parse(
      Buffer.from(proof.split(".")[1], "base64url").toString(),
    )
    expect(payload).toMatchObject({
      visitId,
      seedMediaId: source.seedMediaId,
      locale: source.locale,
      audioLanguageSlug: source.audioLanguageSlug,
      action: "watch_recommendations",
      hostname: "watch.example",
    })
    expect(
      second.cookies.get("forge_watch_recommendation_verified_browser"),
    ).toBeTruthy()

    const retry = await POST(request(cookies(second)))
    expect((await retry.json()).verificationRequired).toBeUndefined()
    expect(siteverify).toHaveBeenCalledOnce()
    expect(publicVisit.mock.calls[2]?.[0].humanVerificationReceipt).toBe(proof)
  })

  it("never sends human proof after a rejected Cloudflare validation", async () => {
    siteverify.mockResolvedValueOnce({ status: "rejected" })
    publicVisit.mockResolvedValueOnce(required)
    const response = await POST(request(undefined, "bad-token"))
    expect((await response.json()).verificationRequired).toBe(true)
    expect(publicVisit.mock.calls[0]?.[0].humanVerificationReceipt).toBeNull()
    expect(
      response.cookies.get("forge_watch_recommendation_verified_browser"),
    ).toBeUndefined()
  })

  it("keeps the incumbent when the Web attempt counter cannot commit", async () => {
    observe.mockResolvedValueOnce(false)
    publicVisit.mockResolvedValueOnce(required)
    const response = await POST(request(undefined, "fresh-token"))
    const body = await response.json()
    expect(body.verificationRequired).toBeUndefined()
    expect(body.delivery.strategyVersion).toBe(
      "semantic-transcript-pgvector-v1",
    )
    expect(siteverify).not.toHaveBeenCalled()
    expect(publicVisit.mock.calls[0]?.[0].humanVerificationReceipt).toBeNull()
  })

  it("rejects official test credentials in production even with fixture settings", async () => {
    const original = { ...env }
    Object.assign(env, {
      NEXT_PUBLIC_WATCH_RECOMMENDATION_TURNSTILE_SITE_KEY:
        "1x00000000000000000000AA",
      WATCH_RECOMMENDATION_TURNSTILE_SECRET_KEY:
        "1x0000000000000000000000000000000AA",
      WATCH_RECOMMENDATION_TURNSTILE_HOSTNAMES: "turnstile-test-fixture.local",
      WATCH_RECOMMENDATION_TURNSTILE_TEST_FIXTURE_ENABLED: "1",
    })
    vi.stubEnv("NODE_ENV", "production")
    try {
      publicVisit.mockResolvedValueOnce(required)
      const response = await POST(request(undefined, "XXXX.DUMMY.TOKEN.XXXX"))
      expect((await response.json()).verificationRequired).toBeUndefined()
      expect(siteverify).not.toHaveBeenCalled()
      expect(publicVisit.mock.calls[0]?.[0].humanVerificationReceipt).toBeNull()
    } finally {
      Object.assign(env, original)
      delete (env as Record<string, unknown>)
        .WATCH_RECOMMENDATION_TURNSTILE_TEST_FIXTURE_ENABLED
      vi.unstubAllEnvs()
    }
  })
})
