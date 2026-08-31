import { createHash } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { adminSemanticRecommendationDeliveryOperation } from "@forge/admin-graphql/operations"
import {
  RECOMMENDATION_MUTATION_CLIENT_LIMIT,
  resetRecommendationMutationAdmissionForTests,
} from "@/lib/recommendation-mutation-admission"

const { query } = vi.hoisted(() => ({ query: vi.fn() }))

vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_CANONICAL_ORIGIN: "https://watch.example",
  },
}))
vi.mock("@/lib/admin-client", () => ({ default: { query } }))

const { POST, dynamic, revalidate } = await import("./route")

function request(body: string, headers: HeadersInit = {}) {
  return new Request("https://watch.example/watch/api/recommendations", {
    method: "POST",
    headers: {
      origin: "https://watch.example",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      ...headers,
    },
    body,
  })
}

const delivery = {
  contractVersion: "semantic-recommendation-v1",
  surfaceVersion: "watch-below-player-v1",
  strategyVersion: "semantic-transcript-pgvector-v1",
  classifierVersion: "legacy-position-v0",
  requestId: "request-1",
  result: "served",
  reason: null,
  expiresAt: "2026-08-19T03:10:00.000Z",
  items: [
    {
      id: "item-1",
      position: 0,
      targetMediaId: "target-1",
      canonicalHref: "/watch/target.html",
      candidateGenerator: "semantic",
      capability: "delivery-capability-secret",
      videoSlug: "target",
      videoTitle: "Target",
      imageUrl: null,
      sceneIndex: 0,
      description: "Description",
      startSeconds: 0,
      endSeconds: null,
      similarity: 0.9,
      themes: [],
      demographics: [],
      spiritualContext: [],
      playbackId: "playback-1",
    },
  ],
}

describe("POST /watch/api/recommendations", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetRecommendationMutationAdmissionForTests()
    query.mockResolvedValue({
      data: { semanticRecommendationDelivery: delivery },
    })
  })

  it("is dynamic and returns a private no-store delivery with a host-only session cookie", async () => {
    expect(dynamic).toBe("force-dynamic")
    expect(revalidate).toBe(0)

    const response = await POST(
      request(
        JSON.stringify({
          seedMediaId: "seed-1",
          locale: "en",
          audioLanguageSlug: "english",
        }),
      ),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toContain("private")
    expect(response.headers.get("cache-control")).toContain("no-store")
    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain("forge_recommendation_session=")
    expect(setCookie).toContain("HttpOnly")
    expect(setCookie.toLowerCase()).toContain("samesite=lax")
    expect(setCookie).toContain("Max-Age=86400")
    expect(setCookie).toContain("Path=/")
    expect(setCookie).not.toContain("Domain=")
    await expect(response.json()).resolves.toEqual({ delivery })

    const variables = query.mock.calls[0]?.[0]?.variables as Record<
      string,
      string
    >
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        query: adminSemanticRecommendationDeliveryOperation,
        fetchPolicy: "no-cache",
      }),
    )
    expect(variables).toMatchObject({
      seedMediaId: "seed-1",
      locale: "en",
      audioLanguageSlug: "english",
      eligibleHuman: true,
    })
    expect(variables.sessionDigest).toMatch(/^[a-f0-9]{64}$/)
  })

  it.each([
    ["crawler user agent", { "user-agent": "Googlebot/2.1" }],
    ["browser prefetch", { purpose: "prefetch" }],
    ["browser prerender", { "sec-purpose": "prefetch;prerender" }],
  ])("excludes %s from human experiment assignment", async (_name, headers) => {
    await POST(
      request(
        JSON.stringify({
          seedMediaId: "seed-1",
          locale: "en",
          audioLanguageSlug: "english",
        }),
        headers,
      ),
    )

    expect(query.mock.calls[0]?.[0]?.variables).toMatchObject({
      eligibleHuman: false,
    })
  })

  it("forwards only the digest of an existing session cookie", async () => {
    const session = "a".repeat(43)
    const response = await POST(
      request(
        JSON.stringify({
          seedMediaId: "seed-1",
          locale: "en",
          audioLanguageSlug: "english",
        }),
        { cookie: `forge_recommendation_session=${session}` },
      ),
    )

    expect(response.status).toBe(200)
    const variables = query.mock.calls[0]?.[0]?.variables
    expect(variables.sessionDigest).toBe(
      createHash("sha256").update(session).digest("hex"),
    )
    expect(JSON.stringify(variables)).not.toContain(session)
    expect(response.headers.get("set-cookie")).toBeNull()
  })

  it("keeps a legacy profile dormant until a fresh consent receipt is present", async () => {
    const session = "a".repeat(43)
    const profile = "b".repeat(43)
    await POST(
      request(
        JSON.stringify({
          seedMediaId: "seed-1",
          locale: "en",
          audioLanguageSlug: "english",
        }),
        {
          cookie: `forge_recommendation_session=${session}; forge_recommendation_profile=${profile}`,
        },
      ),
    )

    const variables = query.mock.calls[0]?.[0]?.variables
    expect(variables.consentReceiptDigest).toBeNull()
    expect(variables.profileTokenDigest).toBeNull()
  })

  it("forwards only the digests of one valid consent receipt and profile cookie", async () => {
    const session = "a".repeat(43)
    const profile = "b".repeat(43)
    const consent = "c".repeat(43)
    await POST(
      request(
        JSON.stringify({
          seedMediaId: "seed-1",
          locale: "en",
          audioLanguageSlug: "english",
        }),
        {
          cookie: `forge_recommendation_session=${session}; forge_recommendation_consent=${consent}; forge_recommendation_profile=${profile}`,
        },
      ),
    )

    const variables = query.mock.calls[0]?.[0]?.variables
    expect(variables.profileTokenDigest).toBe(
      createHash("sha256").update(profile).digest("hex"),
    )
    expect(variables.consentReceiptDigest).toBe(
      createHash("sha256").update(consent).digest("hex"),
    )
    expect(JSON.stringify(variables)).not.toContain(profile)
    expect(JSON.stringify(variables)).not.toContain(consent)
  })

  it("keeps delivery contextual while a client-visible withdrawal is pending", async () => {
    const session = "a".repeat(43)
    const profile = "b".repeat(43)
    const consent = "c".repeat(43)
    await POST(
      request(
        JSON.stringify({
          seedMediaId: "seed-1",
          locale: "en",
          audioLanguageSlug: "english",
        }),
        {
          cookie: `forge_recommendation_session=${session}; forge_recommendation_consent=${consent}; forge_recommendation_profile=${profile}; forge_recommendation_withdrawal_pending=1`,
        },
      ),
    )

    const variables = query.mock.calls[0]?.[0]?.variables
    expect(variables.sessionDigest).toBe(
      createHash("sha256").update(session).digest("hex"),
    )
    expect(variables.consentReceiptDigest).toBeNull()
    expect(variables.profileTokenDigest).toBeNull()
    expect(JSON.stringify(variables)).not.toContain(profile)
    expect(JSON.stringify(variables)).not.toContain(consent)
  })

  it("rejects hostile origin and duplicate raw keys before Admin", async () => {
    const hostile = await POST(
      request("{}", { origin: "https://attacker.example" }),
    )
    expect(hostile.status).toBe(403)

    const duplicate = await POST(
      request(
        '{"seedMediaId":"one","seedMediaId":"two","locale":"en","audioLanguageSlug":"english"}',
      ),
    )
    expect(duplicate.status).toBe(400)
    expect(query).not.toHaveBeenCalled()
  })

  it("limits one anonymous client before fresh sessions consume the shared Admin ceiling", async () => {
    for (
      let attempt = 0;
      attempt < RECOMMENDATION_MUTATION_CLIENT_LIMIT;
      attempt += 1
    ) {
      const response = await POST(
        request(
          JSON.stringify({
            seedMediaId: `seed-${attempt}`,
            locale: "en",
            audioLanguageSlug: "english",
          }),
          { "cf-connecting-ip": "203.0.113.8" },
        ),
      )
      expect(response.status).toBe(200)
    }

    const limited = await POST(
      request(
        JSON.stringify({
          seedMediaId: "seed-limited",
          locale: "en",
          audioLanguageSlug: "english",
        }),
        { "cf-connecting-ip": "203.0.113.8" },
      ),
    )

    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toEqual({ error: "rate_limited" })
    expect(query).toHaveBeenCalledTimes(RECOMMENDATION_MUTATION_CLIENT_LIMIT)
  })

  it("sanitizes Admin failures without exposing credentials or capabilities", async () => {
    query.mockRejectedValueOnce(
      new Error("Bearer server-secret delivery-capability-secret"),
    )

    const response = await POST(
      request(
        JSON.stringify({
          seedMediaId: "seed-1",
          locale: "en",
          audioLanguageSlug: "english",
        }),
      ),
    )
    expect(response.status).toBe(503)
    const text = await response.text()
    expect(text).not.toMatch(/Bearer|server-secret|delivery-capability-secret/)
  })

  it("rejects a serialized delivery response over 64 KiB", async () => {
    query.mockResolvedValueOnce({
      data: {
        semanticRecommendationDelivery: {
          ...delivery,
          items: [
            {
              ...delivery.items[0],
              description: "x".repeat(64 * 1024),
            },
          ],
        },
      },
    })

    const response = await POST(
      request(
        JSON.stringify({
          seedMediaId: "seed-1",
          locale: "en",
          audioLanguageSlug: "english",
        }),
      ),
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      error: "invalid_admin_response",
    })
  })
})
