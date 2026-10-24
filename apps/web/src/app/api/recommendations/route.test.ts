import { createHash } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  adminSemanticRecommendationDeliveryOperation,
  adminSemanticRecommendationDeliveryQuery,
} from "@forge/admin-graphql/operations"
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

const contextualRecommendation = {
  videoId: "target-1",
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
}

const muxThumbnail =
  "https://image.mux.com/playback-1/thumbnail.jpg?width=448&height=252&fit_mode=smartcrop&time=2"

const deliveryLogs = () =>
  vi
    .mocked(console.info)
    .mock.calls.map(([message]) =>
      typeof message === "string"
        ? message.replace(
            /trafficCategory=\S+ trafficClassifierVersion=\S+ trustedEdgeSource=\S+ persistenceDisposition=\S+ attempted=\S+ avoidedPersistence=\S+ committed=\S+ /,
            "",
          )
        : message,
    )
    .filter(
      (message) =>
        typeof message === "string" &&
        message.startsWith("event=recommendation.delivery "),
    )
afterEach(() => vi.restoreAllMocks())

describe("POST /watch/api/recommendations", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "info").mockImplementation(() => undefined)
    resetRecommendationMutationAdmissionForTests()
    query.mockResolvedValue({
      data: { semanticRecommendationDelivery: delivery },
    })
  })

  it.each(["origins-of-christmas--episode-1", "soccer_event_collection"])(
    "accepts the canonical content slug %s",
    async (seedMediaSlug) => {
      const response = await POST(
        request(
          JSON.stringify({
            seedMediaId: "seed-1",
            seedMediaSlug,
            locale: "en",
            audioLanguageSlug: "english",
          }),
        ),
      )
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        delivery: { result: "served", requestId: "request-1" },
      })
      expect(query).toHaveBeenCalledTimes(1)
    },
  )

  it.each(["", "a/b", "a%2fb", "a?query", "a".repeat(192)])(
    "rejects invalid or oversized seed slug %s before Admin access",
    async (seedMediaSlug) => {
      const response = await POST(
        request(
          JSON.stringify({
            seedMediaId: "seed-1",
            seedMediaSlug,
            locale: "en",
            audioLanguageSlug: "english",
          }),
        ),
      )
      expect(response.status).toBe(400)
      expect(query).not.toHaveBeenCalled()
    },
  )

  it.each([undefined, "unknown-parser", "cowatch-mmr-v1"])(
    "forwards only the explicitly supported browser delivery contract %s",
    async (capability) => {
      query.mockResolvedValueOnce({
        data: { semanticRecommendationDelivery: delivery },
      })
      const response = await POST(
        request(
          JSON.stringify({
            seedMediaId: "seed-1",
            locale: "en",
            audioLanguageSlug: "english",
          }),
          {
            "x-forge-recommendation-client": "viewing-mode-v1",
            ...(capability
              ? { "x-forge-recommendation-delivery-contract": capability }
              : {}),
          },
        ),
      )
      expect(response.status).toBe(200)
      expect(query.mock.calls[0]?.[0]?.variables.clientDeliveryContract).toBe(
        capability === "cowatch-mmr-v1" ? capability : null,
      )
    },
  )
  it.each([undefined, "older-client", "viewing-mode-v1"])(
    "preserves mode-ranked cards for client version %s",
    async (clientVersion) => {
      const personalization = {
        contractVersion: "anonymous-profile-personalization-v1",
        lane: "profile_challenger",
        executionMode: "viewing_mode_personalized",
        effectiveManifestId: "semantic-transcript-pgvector-v1",
        profileState: "durable",
        projectionVersion: null,
        projectionGeneration: null,
        interestCount: 0,
        sessionIntentPresent: false,
        reason: "viewing_mode_preference",
      }
      query.mockResolvedValueOnce({
        data: {
          semanticRecommendationDelivery: { ...delivery, personalization },
        },
      })
      const response = await POST(
        request(
          JSON.stringify({
            seedMediaId: "seed-1",
            locale: "en",
            audioLanguageSlug: "english",
          }),
          clientVersion
            ? { "x-forge-recommendation-client": clientVersion }
            : {},
        ),
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.delivery.personalization).toEqual(
        clientVersion === "viewing-mode-v1" ? personalization : null,
      )
      expect(body.delivery.requestId).toBe(delivery.requestId)
      expect(body.delivery.items).toEqual([
        { ...delivery.items[0], imageUrl: muxThumbnail },
      ])
      expect(body.delivery.result).toBe("served")
    },
  )

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
    expect(deliveryLogs()).toEqual([
      "event=recommendation.delivery endpoint=seeded httpStatus=200 result=served reason=none itemCount=1 upstreamResult=served",
    ])
    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain("forge_recommendation_session=")
    expect(setCookie).toContain("HttpOnly")
    expect(setCookie.toLowerCase()).toContain("samesite=lax")
    expect(setCookie).toContain("Max-Age=86400")
    expect(setCookie).toContain("Path=/")
    expect(setCookie).not.toContain("Domain=")
    await expect(response.json()).resolves.toEqual({
      deliveryDisposition: "measured",
      delivery: {
        ...delivery,
        items: [{ ...delivery.items[0], imageUrl: muxThumbnail }],
      },
    })

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
    expect(adminSemanticRecommendationDeliveryQuery).not.toContain(
      "privatePreviewFallback",
    )
    expect(variables).toMatchObject({
      seedMediaId: "seed-1",
      locale: "en",
      audioLanguageSlug: "english",
      eligibleHuman: true,
    })
    expect(variables.sessionDigest).toMatch(/^[a-f0-9]{64}$/)
  })

  it("reports legacy browser requests missing a stable navigation visit ID", async () => {
    const response = await POST(
      request(
        JSON.stringify({
          seedMediaId: "seed-1",
          locale: "en",
          audioLanguageSlug: "english",
        }),
        { "user-agent": "Mozilla/5.0" },
      ),
    )
    expect(response.status).toBe(200)
    expect(query).toHaveBeenCalledOnce()
    expect(deliveryLogs()).toEqual([
      "event=recommendation.delivery endpoint=seeded experimentAdmission=missing_visit_id httpStatus=200 result=served reason=none itemCount=1 upstreamResult=served",
    ])
  })

  it("reports missing signed browser configuration without enrolling a visit", async () => {
    const response = await POST(
      request(
        JSON.stringify({
          seedMediaId: "seed-1",
          locale: "en",
          audioLanguageSlug: "english",
        }),
        {
          "user-agent": "Mozilla/5.0",
          "x-forge-recommendation-visit-id":
            "22222222-2222-4222-8222-222222222222",
        },
      ),
    )
    expect(response.status).toBe(200)
    expect(query).toHaveBeenCalledOnce()
    expect(deliveryLogs()).toEqual([
      "event=recommendation.delivery endpoint=seeded experimentAdmission=browser_identity_unavailable httpStatus=200 result=served reason=none itemCount=1 upstreamResult=served",
    ])
  })

  it("preserves an editorial thumbnail on a served delivery", async () => {
    const imageUrl = "https://images.example/editorial.jpg"
    query.mockResolvedValueOnce({
      data: {
        semanticRecommendationDelivery: {
          ...delivery,
          items: [{ ...delivery.items[0], imageUrl }],
        },
      },
    })

    const response = await POST(
      request(
        JSON.stringify({
          seedMediaId: "seed-editorial",
          locale: "en",
          audioLanguageSlug: "english",
        }),
      ),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      delivery: { items: [{ imageUrl }] },
    })
  })

  it.each([
    ["crawler user agent", { "user-agent": "Googlebot/2.1" }],
    ["browser prefetch", { purpose: "prefetch" }],
    ["browser prerender", { "sec-purpose": "prefetch;prerender" }],
  ])(
    "isolates %s without issuing cookies or using profile credentials",
    async (_name, headers) => {
      const response = await POST(
        request(
          JSON.stringify({
            seedMediaId: "seed-1",
            locale: "en",
            audioLanguageSlug: "english",
          }),
          {
            ...headers,
            cookie: `forge_recommendation_session=${"a".repeat(43)}; forge_recommendation_profile=${"b".repeat(43)}`,
          },
        ),
      )
      expect(response.headers.get("set-cookie")).toBeNull()
      expect(response.headers.get("cache-control")).toContain("no-store")
      const responseBody = await response.json()
      expect(responseBody.delivery.requestId).toBeNull()
      expect(responseBody.delivery.expiresAt).toBeNull()
      expect(responseBody.delivery.personalization).toBeNull()
      if (responseBody.deliveryDisposition === "deferred")
        expect(responseBody.delivery.items).toEqual([])
      else
        expect(responseBody.delivery.items[0].capability).toBe(
          "contextual-fallback-unattributed-v1",
        )
      expect(query.mock.calls[0]?.[0]?.variables).toMatchObject({
        eligibleHuman: false,
        sessionDigest: "0".repeat(64),
        profileTokenDigest: null,
        consentReceiptDigest: null,
      })
      expect(query.mock.calls[0]?.[0]?.variables.trafficCategory).toMatch(
        /^(declared_crawler|speculative_prefetch|speculative_prerender)$/,
      )
    },
  )

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

  it("recovers consent and profile digests from the one cookie production preserves", async () => {
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
          cookie: `forge_recommendation_session=${session}; forge_recommendation_consent=v1.${consent}.${profile}`,
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
  })

  it.each([
    {
      locale: "en",
      audioLanguageSlug: "english",
      result: "unavailable",
      reason: "delivery_timeout",
    },
    {
      locale: "en",
      audioLanguageSlug: "english",
      result: "empty",
      reason: "seed_embedding_unavailable",
    },
    {
      locale: "zh-Hans",
      audioLanguageSlug: "mandarin-china",
      result: "empty",
      reason: "no_candidates",
    },
    {
      locale: "zh-Hant",
      audioLanguageSlug: "mandarin-china",
      result: "empty",
      reason: "no_candidates",
    },
    {
      locale: "en",
      audioLanguageSlug: "gbii",
      result: "empty",
      reason: "no_candidates",
    },
    {
      locale: "en",
      audioLanguageSlug: "kwanyama",
      result: "unavailable",
      reason: "environment_disabled",
    },
  ])(
    "preserves the Admin $result receipt for $locale/$audioLanguageSlug without unverified recovery",
    async ({ locale, audioLanguageSlug, result, reason }) => {
      const receipt = {
        ...delivery,
        requestId: result === "empty" ? "empty-request" : null,
        result,
        reason,
        expiresAt: null,
        requestedCount: 6,
        composedCount: 0,
        shortfallReason: "insufficient_candidates",
        personalization: null,
        items: [],
      }
      // Legacy APIs cannot attest exact playback and presentation identity.
      query
        .mockResolvedValue({
          data: { sceneRecommendations: [contextualRecommendation] },
        })
        .mockResolvedValueOnce({
          data: { semanticRecommendationDelivery: receipt },
        })
      const response = await POST(
        request(
          JSON.stringify({
            seedMediaId: "seed-1",
            seedMediaSlug: "seed-video",
            locale,
            audioLanguageSlug,
          }),
        ),
      )
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({
        delivery: receipt,
        deliveryDisposition: "measured",
      })
      expect(response.headers.get("cache-control")).toContain("no-store")
      expect(response.headers.get("set-cookie")).toContain("HttpOnly")
      expect(query).toHaveBeenCalledOnce()
      expect(query.mock.calls[0]?.[0]?.query).toBe(
        adminSemanticRecommendationDeliveryOperation,
      )
      expect(query.mock.calls[0]?.[0]?.variables).not.toHaveProperty(
        "seedMediaSlug",
      )
      expect(deliveryLogs()).toEqual([
        `event=recommendation.delivery endpoint=seeded httpStatus=200 result=${result} reason=${reason} itemCount=0 upstreamResult=${result}`,
      ])
    },
  )

  it("returns an unavailable receipt for a GraphQL error without legacy recovery", async () => {
    query
      .mockResolvedValue({
        data: { sceneRecommendations: [contextualRecommendation] },
      })
      .mockResolvedValueOnce({
        data: null,
        error: new Error("GraphQL resolver server-secret"),
      })
    const response = await POST(
      request(
        JSON.stringify({
          seedMediaId: "seed-1",
          seedMediaSlug: "seed-video",
          locale: "zh-Hant",
          audioLanguageSlug: "mandarin-china",
        }),
      ),
    )
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).not.toContain("server-secret")
    expect(JSON.parse(body)).toMatchObject({
      delivery: {
        result: "unavailable",
        reason: "delivery_unavailable",
        items: [],
      },
    })
    expect(query).toHaveBeenCalledOnce()
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

  it("contains Admin delivery failures without exposing credentials or capabilities", async () => {
    query.mockRejectedValueOnce(
      new Error("Bearer server-secret delivery-capability-secret"),
    )

    const response = await POST(
      request(
        JSON.stringify({
          seedMediaId: "admin-failure-seed",
          locale: "en",
          audioLanguageSlug: "english",
        }),
      ),
    )
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(query).toHaveBeenCalledOnce()
    expect(text).not.toMatch(/Bearer|server-secret|delivery-capability-secret/)
    expect(JSON.parse(text)).toMatchObject({
      delivery: {
        result: "unavailable",
        reason: "delivery_unavailable",
        items: [],
      },
    })
  })

  it("returns an unavailable envelope when the Admin transport times out", async () => {
    query.mockRejectedValueOnce(
      new DOMException("server-secret", "TimeoutError"),
    )

    const response = await POST(
      request(
        JSON.stringify({
          seedMediaId: "all-delivery-failure-seed",
          locale: "en",
          audioLanguageSlug: "english",
        }),
      ),
    )

    expect(response.status).toBe(200)
    const text = await response.text()
    expect(query).toHaveBeenCalledOnce()
    expect(text).not.toContain("server-secret")
    expect(JSON.parse(text)).toMatchObject({
      delivery: {
        result: "unavailable",
        reason: "delivery_unavailable",
        requestedCount: null,
        composedCount: null,
        shortfallReason: null,
        items: [],
        personalization: null,
      },
    })
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

    expect(deliveryLogs()).toEqual([
      "event=recommendation.delivery endpoint=seeded httpStatus=502 result=failed reason=invalid_admin_response itemCount=0 upstreamResult=not_observed",
    ])
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      error: "invalid_admin_response",
    })
  })
  it("preserves a successful delivery when operational logging throws", async () => {
    vi.mocked(console.info).mockImplementation(() => {
      throw new Error("log unavailable")
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
    expect(response.status).toBe(200)
    expect(response.headers.get("set-cookie")).toContain("HttpOnly")
    await expect(response.json()).resolves.toMatchObject({
      delivery: { result: "served", requestId: "request-1" },
    })
  })
})
