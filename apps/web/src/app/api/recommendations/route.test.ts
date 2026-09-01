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
    await expect(response.json()).resolves.toEqual({
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
    expect(variables).toMatchObject({
      seedMediaId: "seed-1",
      locale: "en",
      audioLanguageSlug: "english",
      eligibleHuman: true,
    })
    expect(variables.sessionDigest).toMatch(/^[a-f0-9]{64}$/)
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

  it("serves non-attributed contextual cards when semantic delivery is unavailable", async () => {
    query
      .mockResolvedValueOnce({
        data: {
          semanticRecommendationDelivery: {
            ...delivery,
            requestId: null,
            result: "unavailable",
            reason: "delivery_timeout",
            expiresAt: null,
            items: [],
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          sceneRecommendations: [contextualRecommendation],
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

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      delivery: {
        result: "fallback",
        reason: "delivery_timeout",
        items: [
          {
            targetMediaId: "target-1",
            canonicalHref: "/watch/target.html",
            videoTitle: "Target",
            imageUrl: muxThumbnail,
          },
        ],
      },
    })
    expect(query.mock.calls[1]?.[0]?.variables).toEqual({
      videoId: "seed-1",
      locale: "en",
      limit: 6,
    })
  })

  it("serves contextual cards when the semantic seed has no embedding", async () => {
    query
      .mockResolvedValueOnce({
        data: {
          semanticRecommendationDelivery: {
            ...delivery,
            result: "empty",
            reason: "seed_embedding_unavailable",
            items: [],
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          sceneRecommendations: [contextualRecommendation],
        },
      })

    const response = await POST(
      request(
        JSON.stringify({
          seedMediaId: "seed-without-embedding",
          locale: "en",
          audioLanguageSlug: "english",
        }),
      ),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      delivery: {
        result: "fallback",
        reason: "seed_embedding_unavailable",
        items: [{ targetMediaId: "target-1" }],
      },
    })
  })

  it("preserves the semantic unavailable receipt when contextual recovery also fails", async () => {
    query
      .mockResolvedValueOnce({
        data: {
          semanticRecommendationDelivery: {
            ...delivery,
            requestId: null,
            result: "unavailable",
            reason: "environment_disabled",
            expiresAt: null,
            items: [],
          },
        },
      })
      .mockRejectedValueOnce(new Error("contextual retrieval unavailable"))

    const response = await POST(
      request(
        JSON.stringify({
          seedMediaId: "uncached-seed",
          locale: "en",
          audioLanguageSlug: "english",
        }),
      ),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      delivery: {
        result: "unavailable",
        reason: "environment_disabled",
        items: [],
      },
    })
  })

  it("falls back to playable collection siblings when LUMO has no scene candidates", async () => {
    query
      .mockResolvedValueOnce({
        data: {
          semanticRecommendationDelivery: {
            ...delivery,
            requestId: null,
            result: "unavailable",
            reason: "environment_disabled",
            expiresAt: null,
            items: [],
          },
        },
      })
      .mockResolvedValueOnce({ data: { sceneRecommendations: [] } })
      .mockResolvedValueOnce({
        data: {
          watchVideoRouteSnapshotBySlug: {
            documentId: "lumo-current",
            slug: "lumo-matthew-5-1-48",
            children: [],
            parents: [
              {
                parent: {
                  slug: "lumo-the-gospel-of-matthew",
                  children: [
                    {
                      order: 3,
                      child: {
                        documentId: "lumo-current",
                        slug: "lumo-matthew-5-1-48",
                        muxPlaybackId: "current-playback",
                        durationSeconds: 2_400,
                        images: [],
                        exactLocales: [{ title: "Current" }],
                        broadLocales: [],
                        englishLocales: [],
                      },
                    },
                    {
                      order: 4,
                      child: {
                        documentId: "lumo-next",
                        slug: "lumo-matthew-6-1-7-23",
                        muxPlaybackId: "lumo-next-playback",
                        durationSeconds: 2_500,
                        images: [{ url: "https://images.example/raw.jpg" }],
                        exactLocales: [{ title: "LUMO - Matthew 6:1-7:23" }],
                        broadLocales: [],
                        englishLocales: [],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      })

    const response = await POST(
      request(
        JSON.stringify({
          seedMediaId: "lumo-current",
          seedMediaSlug: "lumo-matthew-5-1-48",
          locale: "en",
          audioLanguageSlug: "english",
        }),
      ),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      delivery: {
        result: "fallback",
        reason: "environment_disabled",
        strategyVersion: "collection-siblings-contextual-v1",
        items: [
          {
            targetMediaId: "lumo-next",
            canonicalHref:
              "/watch/lumo-the-gospel-of-matthew.html/lumo-matthew-6-1-7-23.html",
            videoTitle: "LUMO - Matthew 6:1-7:23",
            imageUrl:
              "https://image.mux.com/lumo-next-playback/thumbnail.jpg?width=448&height=252&fit_mode=smartcrop&time=2",
          },
        ],
      },
    })
    expect(query.mock.calls[0]?.[0]?.variables).not.toHaveProperty(
      "seedMediaSlug",
    )
    expect(query.mock.calls[2]?.[0]?.variables).toEqual({
      videoSlug: "lumo-matthew-5-1-48",
      locale: "en",
      languageSlug: "english",
    })
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

  it("recovers Admin delivery failures without exposing credentials or capabilities", async () => {
    query
      .mockRejectedValueOnce(
        new Error("Bearer server-secret delivery-capability-secret"),
      )
      .mockResolvedValueOnce({
        data: {
          sceneRecommendations: [contextualRecommendation],
        },
      })

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
    expect(text).not.toMatch(/Bearer|server-secret|delivery-capability-secret/)
    expect(JSON.parse(text)).toMatchObject({
      delivery: {
        result: "fallback",
        reason: "delivery_unavailable",
        items: [{ targetMediaId: "target-1" }],
      },
    })
  })

  it("returns an unavailable envelope when semantic and contextual delivery both fail", async () => {
    query
      .mockRejectedValueOnce(new Error("semantic server-secret"))
      .mockRejectedValueOnce(new Error("contextual server-secret"))

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

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      error: "invalid_admin_response",
    })
  })
})
