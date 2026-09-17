import {
  TRANSIENT_DELIVERY_REASONS,
  buildDeliveryVariables,
  classifyDelivery,
  fetchUserRecommendations,
  isSlateExpired,
  validateServedSlate,
  type DeliveryDeps,
  type RawUserRecommendationDelivery,
} from "../delivery"
import { RecommendationClientError } from "../errors"

const IDENTITY = { viewerToken: "v".repeat(43), sessionToken: "s".repeat(43) }

function item(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `item-${index}`,
    position: index,
    targetMediaId: `media-${index}`,
    canonicalHref: `https://www.jesusfilm.org/watch/video-${index}.html/english.html`,
    capability: `cap-${index}`,
    videoSlug: `video-${index}`,
    videoTitle: `Video ${index}`,
    imageUrl: `https://images.example.com/${index}.jpg`,
    description: "",
    durationSeconds: 120,
    generator: "curated",
    poolVersion: "2026-09-14.v1",
    poolKey: "start",
    ...overrides,
  }
}

function served(
  count = 6,
  overrides: Partial<RawUserRecommendationDelivery> = {},
): RawUserRecommendationDelivery {
  return {
    contractVersion: "user-recommendation-v1",
    surfaceVersion: "watch-for-you-v1",
    requestId: "req-1",
    result: "served",
    reason: null,
    expiresAt: "2026-09-16T01:00:00.000Z",
    requestedCount: count,
    profileCount: 0,
    curatedCount: count,
    cohort: "cold_start",
    poolVersion: "2026-09-14.v1",
    items: Array.from({ length: count }, (_, index) => item(index)),
    ...overrides,
  } as RawUserRecommendationDelivery
}

function unavailable(reason: string): RawUserRecommendationDelivery {
  return {
    ...served(0),
    requestId: null,
    result: "unavailable",
    reason,
    items: [],
  } as RawUserRecommendationDelivery
}

describe("buildDeliveryVariables", () => {
  it("sends viewer tokens and never a digest of any kind", () => {
    const variables = buildDeliveryVariables(IDENTITY, {
      locale: "en",
      audioLanguageSlug: "french",
      count: 6,
    })
    expect(variables).toEqual({
      viewerToken: IDENTITY.viewerToken,
      sessionToken: IDENTITY.sessionToken,
      locale: "en",
      audioLanguageSlug: "french",
      count: 6,
    })
    for (const forbidden of [
      "sessionDigest",
      "consentReceiptDigest",
      "profileTokenDigest",
    ]) {
      expect(variables).not.toHaveProperty(forbidden)
    }
  })
})

describe("validateServedSlate", () => {
  it("accepts a whole, distinct, in-order slate", () => {
    const slate = validateServedSlate(served(), 6)
    expect(slate?.requestId).toBe("req-1")
    expect(slate?.items.map((entry) => entry.position)).toEqual([
      0, 1, 2, 3, 4, 5,
    ])
    expect(slate?.items[0]).toMatchObject({
      targetMediaId: "media-0",
      videoSlug: "video-0",
      capability: "cap-0",
      imageUrl: "https://images.example.com/0.jpg",
      durationSeconds: 120,
    })
  })

  it.each([
    ["an undersized slate", served(5), 6],
    ["an oversized slate", served(7), 6],
    ["a missing request id", served(6, { requestId: null }), 6],
    [
      "a duplicate target media",
      served(6, {
        items: [
          item(0),
          item(1, { targetMediaId: "media-0" }),
          ...[2, 3, 4, 5].map((i) => item(i)),
        ],
      }),
      6,
    ],
    [
      "a position out of order",
      served(6, {
        items: [item(1), item(0), ...[2, 3, 4, 5].map((i) => item(i))],
      }),
      6,
    ],
    [
      "a missing capability",
      served(6, {
        items: [
          item(0, { capability: "" }),
          ...[1, 2, 3, 4, 5].map((i) => item(i)),
        ],
      }),
      6,
    ],
    [
      "a foreign contract version",
      served(6, { contractVersion: "user-recommendation-v2" }),
      6,
    ],
    [
      "a foreign surface version",
      served(6, { surfaceVersion: "watch-below-player-v1" }),
      6,
    ],
  ])("rejects %s", (_label, delivery, count) => {
    expect(validateServedSlate(delivery, count)).toBeNull()
  })

  it("drops an unusable image or duration to null instead of failing the slate", () => {
    const slate = validateServedSlate(
      served(1, {
        items: [
          item(0, { imageUrl: "javascript:alert(1)", durationSeconds: 0 }),
        ],
      }),
      1,
    )
    expect(slate?.items[0].imageUrl).toBeNull()
    expect(slate?.items[0].durationSeconds).toBeNull()
  })
})

describe("isSlateExpired", () => {
  it("treats the response's expiresAt as the authority, and no expiry as live", () => {
    const at = Date.parse("2026-09-16T01:00:00.000Z")
    expect(isSlateExpired({ expiresAt: "2026-09-16T01:00:00.000Z" }, at)).toBe(
      true,
    )
    expect(
      isSlateExpired({ expiresAt: "2026-09-16T01:00:00.000Z" }, at - 1),
    ).toBe(false)
    expect(isSlateExpired({ expiresAt: null }, at)).toBe(false)
    expect(isSlateExpired({ expiresAt: "soon" }, at)).toBe(false)
  })
})

describe("classifyDelivery", () => {
  it("maps environment_disabled to disabled", () => {
    expect(classifyDelivery(unavailable("environment_disabled"), 6)).toEqual({
      kind: "disabled",
    })
  })

  it.each([...TRANSIENT_DELIVERY_REASONS])(
    "marks %s as retryable",
    (reason) => {
      expect(classifyDelivery(unavailable(reason), 6)).toEqual({
        kind: "unavailable",
        reason,
        retryable: true,
      })
    },
  )

  it("does not retry coverage_unavailable: the context has no pool", () => {
    expect(classifyDelivery(unavailable("coverage_unavailable"), 6)).toEqual({
      kind: "unavailable",
      reason: "coverage_unavailable",
      retryable: false,
    })
  })

  it.each(["empty", "fallback"])(
    "carries Admin's own reason for a %s result instead of invalid_delivery",
    (result) => {
      expect(
        classifyDelivery({ ...unavailable("no_profile"), result } as never, 6),
      ).toEqual({ kind: "unavailable", reason: "no_profile", retryable: false })
      expect(
        classifyDelivery(
          { ...unavailable(""), result, reason: null } as never,
          6,
        ),
      ).toEqual({ kind: "unavailable", reason: result, retryable: false })
    },
  )

  it("reports invalid_delivery for a served slate that fails validation", () => {
    expect(classifyDelivery(served(5), 6)).toEqual({
      kind: "unavailable",
      reason: "invalid_delivery",
      retryable: false,
    })
  })

  it("returns the validated slate for a good answer", () => {
    const result = classifyDelivery(served(), 6)
    expect(result.kind).toBe("served")
  })
})

describe("fetchUserRecommendations", () => {
  function deps(overrides: Partial<DeliveryDeps> = {}) {
    const base: DeliveryDeps = {
      getIdentity: jest.fn(async () => ({
        kind: "ready" as const,
        identity: IDENTITY,
        personalization: true,
      })),
      query: jest.fn(async () => served()),
      invalidateIdentity: jest.fn(async () => undefined),
      touch: jest.fn(),
      report: jest.fn(),
    }
    return { ...base, ...overrides }
  }

  it("queries with the identity and returns the slate", async () => {
    const d = deps()
    const result = await fetchUserRecommendations(
      { locale: "en", audioLanguageSlug: "english" },
      d,
    )
    expect(result.kind).toBe("served")
    expect(d.query).toHaveBeenCalledWith({
      viewerToken: IDENTITY.viewerToken,
      sessionToken: IDENTITY.sessionToken,
      locale: "en",
      audioLanguageSlug: "english",
      count: 6,
    })
    expect(d.touch).toHaveBeenCalledTimes(1)
    expect(d.report).toHaveBeenCalledWith("served", "served", 1)
  })

  it.each([
    [{ kind: "disabled" as const }, { kind: "disabled" }],
    [{ kind: "unprovisioned" as const }, { kind: "unprovisioned" }],
    [
      { kind: "unavailable" as const, reason: "bootstrap_failed" as const },
      { kind: "unavailable", reason: "identity_unavailable", retryable: true },
    ],
  ])(
    "passes an identity gate through without querying",
    async (identity, expected) => {
      const d = deps({ getIdentity: jest.fn(async () => identity) })
      expect(
        await fetchUserRecommendations(
          { locale: "en", audioLanguageSlug: "english" },
          d,
        ),
      ).toEqual(expected)
      expect(d.query).not.toHaveBeenCalled()
    },
  )

  it("invalidates the handle on UNAUTHENTICATED and asks for a retry", async () => {
    const d = deps({
      query: jest.fn(async () => {
        throw new RecommendationClientError("UNAUTHENTICATED")
      }),
    })
    expect(
      await fetchUserRecommendations(
        { locale: "en", audioLanguageSlug: "english" },
        d,
      ),
    ).toEqual({
      kind: "unavailable",
      reason: "identity_rejected",
      retryable: true,
    })
    expect(d.invalidateIdentity).toHaveBeenCalledTimes(1)
    expect(d.touch).not.toHaveBeenCalled()
  })

  it("marks a timeout retryable and a bad request rejected", async () => {
    const timeout = deps({
      query: jest.fn(async () => {
        throw new RecommendationClientError("TIMEOUT")
      }),
    })
    expect(
      await fetchUserRecommendations(
        { locale: "en", audioLanguageSlug: "english" },
        timeout,
      ),
    ).toEqual({ kind: "unavailable", reason: "timeout", retryable: true })
    const rejected = deps({
      query: jest.fn(async () => {
        throw new RecommendationClientError("BAD_USER_INPUT")
      }),
    })
    expect(
      await fetchUserRecommendations(
        { locale: "en", audioLanguageSlug: "english" },
        rejected,
      ),
    ).toEqual({ kind: "unavailable", reason: "rejected", retryable: false })
  })

  it("refuses a count outside Admin's bound before any network", async () => {
    const d = deps()
    for (const count of [0, 21, 2.5, Number.NaN]) {
      await expect(
        fetchUserRecommendations(
          { locale: "en", audioLanguageSlug: "english", count },
          d,
        ),
      ).rejects.toBeInstanceOf(RangeError)
    }
    expect(d.getIdentity).not.toHaveBeenCalled()
  })
})
