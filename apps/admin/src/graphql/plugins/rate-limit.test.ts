import { describe, expect, it, vi } from "vitest"
import type { ContextShape } from "@/graphql/builder"
import type { Principal } from "@/auth/principal"

// Mock the redis surface so we can import rate-limit.ts without
// touching real env / network during import-time `createRateLimitStore`.
vi.mock("@/infra/redis", () => ({
  getRedisClient: () => null,
  hasRedisConfig: () => false,
}))

// Stub env to NODE_ENV !== production so the in-memory fallback applies.
vi.mock("@/config/env", () => ({
  env: { NODE_ENV: "test" } as { NODE_ENV?: string },
}))

const { identifyForRateLimit, rateLimitConfigByField } =
  await import("@/graphql/plugins/rate-limit")

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/graphql", { headers })
}

function makeCtx(opts: {
  user: Principal | null
  request?: Request
}): ContextShape {
  // Cast partial shape — identifyForRateLimit only reads `user` and
  // `request`; the rest of ContextShape is irrelevant to this test.
  return {
    user: opts.user,
    request: opts.request ?? makeRequest(),
    prisma: {} as ContextShape["prisma"],
    loaders: {} as ContextShape["loaders"],
    services: {} as ContextShape["services"],
  }
}

describe("identifyForRateLimit", () => {
  // ---------------------------------------------------------------------------
  // Anonymous → public:<ip>
  // ---------------------------------------------------------------------------

  it("buckets anonymous users by IP (cf-connecting-ip)", () => {
    expect(
      identifyForRateLimit(
        makeCtx({
          user: null,
          request: makeRequest({ "cf-connecting-ip": "1.2.3.4" }),
        }),
      ),
    ).toBe("public:1.2.3.4")
  })

  it("buckets anonymous users by x-forwarded-for first hop when CF header is absent", () => {
    expect(
      identifyForRateLimit(
        makeCtx({
          user: null,
          request: makeRequest({ "x-forwarded-for": "5.6.7.8, 9.9.9.9" }),
        }),
      ),
    ).toBe("public:5.6.7.8")
  })

  it("uses `unknown` IP fallback when no source headers are present", () => {
    expect(
      identifyForRateLimit(makeCtx({ user: null, request: makeRequest() })),
    ).toBe("public:unknown")
  })

  // ---------------------------------------------------------------------------
  // CONSUMER_BEARER → consumer:<bucketKey>
  // ---------------------------------------------------------------------------

  it("buckets CONSUMER_BEARER principals by the bearer's rateLimitBucketKey", () => {
    expect(
      identifyForRateLimit(
        makeCtx({
          user: {
            id: null,
            role: "CONSUMER_BEARER",
            rateLimitBucketKey: "web-key-aaa",
          },
          request: makeRequest({ "cf-connecting-ip": "1.2.3.4" }),
        }),
      ),
    ).toBe("consumer:web-key-aaa")
  })

  it("CONSUMER_BEARER bucket survives across requests from different IPs (per-key, not per-IP)", () => {
    // CGNAT / mobile-carrier NAT scenario: two requests from
    // different upstream IPs both forward the same bearer. They land
    // in ONE bucket — the rate-limit isolation property of the new
    // identity class.
    const k = "shared-bucket-key"
    expect(
      identifyForRateLimit(
        makeCtx({
          user: { id: null, role: "CONSUMER_BEARER", rateLimitBucketKey: k },
          request: makeRequest({ "cf-connecting-ip": "1.1.1.1" }),
        }),
      ),
    ).toBe(`consumer:${k}`)
    expect(
      identifyForRateLimit(
        makeCtx({
          user: { id: null, role: "CONSUMER_BEARER", rateLimitBucketKey: k },
          request: makeRequest({ "cf-connecting-ip": "2.2.2.2" }),
        }),
      ),
    ).toBe(`consumer:${k}`)
  })

  it("two different bearer keys mint two different buckets (per-key isolation)", () => {
    const a = identifyForRateLimit(
      makeCtx({
        user: {
          id: null,
          role: "CONSUMER_BEARER",
          rateLimitBucketKey: "key-aaa",
        },
      }),
    )
    const b = identifyForRateLimit(
      makeCtx({
        user: {
          id: null,
          role: "CONSUMER_BEARER",
          rateLimitBucketKey: "key-bbb",
        },
      }),
    )
    expect(a).not.toBe(b)
    expect(a).toBe("consumer:key-aaa")
    expect(b).toBe("consumer:key-bbb")
  })

  // ---------------------------------------------------------------------------
  // Fleet consumer bearer → consumer:<key>:<ip> (per client IP)
  // ---------------------------------------------------------------------------

  it("buckets a fleet consumer bearer per client IP (two IPs → two buckets)", () => {
    // AE1 fleet half — the whole point: installs sharing one baked-in fleet
    // key must NOT collapse into a single bucket.
    const k = "fleet-key"
    const a = identifyForRateLimit(
      makeCtx({
        user: {
          id: null,
          role: "CONSUMER_BEARER",
          rateLimitBucketKey: k,
          fleet: true,
        },
        request: makeRequest({ "cf-connecting-ip": "1.1.1.1" }),
      }),
    )
    const b = identifyForRateLimit(
      makeCtx({
        user: {
          id: null,
          role: "CONSUMER_BEARER",
          rateLimitBucketKey: k,
          fleet: true,
        },
        request: makeRequest({ "cf-connecting-ip": "2.2.2.2" }),
      }),
    )
    expect(a).toBe("consumer:fleet-key:1.1.1.1")
    expect(b).toBe("consumer:fleet-key:2.2.2.2")
    expect(a).not.toBe(b)
  })

  it("keeps a non-fleet consumer bearer per-key even with a client IP present (R2)", () => {
    // Web SSR stays flat consumer:<key>, preserving the :91 CGNAT-isolation
    // contract — the fleet dimension is opt-in via the fleet flag.
    expect(
      identifyForRateLimit(
        makeCtx({
          user: {
            id: null,
            role: "CONSUMER_BEARER",
            rateLimitBucketKey: "web-key",
            fleet: false,
          },
          request: makeRequest({ "cf-connecting-ip": "9.9.9.9" }),
        }),
      ),
    ).toBe("consumer:web-key")
  })

  it("buckets a fleet key with no trusted IP as consumer:<key>:unknown (R7)", () => {
    // AE3: absent cf-connecting-ip stays inside the fleet namespace, never
    // the anonymous public:unknown bucket.
    expect(
      identifyForRateLimit(
        makeCtx({
          user: {
            id: null,
            role: "CONSUMER_BEARER",
            rateLimitBucketKey: "fleet-key",
            fleet: true,
          },
          request: makeRequest(),
        }),
      ),
    ).toBe("consumer:fleet-key:unknown")
  })

  it("ignores a spoofed x-forwarded-for for the fleet bucket (R8)", () => {
    // AE4: a spoofed xff with no cf-connecting-ip must NOT create a distinct
    // consumer:<key>:<spoofed> bucket — it falls to :unknown, so rotating xff
    // cannot mint fresh buckets.
    expect(
      identifyForRateLimit(
        makeCtx({
          user: {
            id: null,
            role: "CONSUMER_BEARER",
            rateLimitBucketKey: "fleet-key",
            fleet: true,
          },
          request: makeRequest({ "x-forwarded-for": "6.6.6.6, 7.7.7.7" }),
        }),
      ),
    ).toBe("consumer:fleet-key:unknown")
  })

  it("prefers a client viewer_id over IP for the fleet bucket (v: namespace)", () => {
    // CGNAT-immune: a valid x-viewer-id keys per-install, ignoring the shared
    // carrier egress IP.
    expect(
      identifyForRateLimit(
        makeCtx({
          user: {
            id: null,
            role: "CONSUMER_BEARER",
            rateLimitBucketKey: "fleet-key",
            fleet: true,
          },
          request: makeRequest({
            "cf-connecting-ip": "1.1.1.1",
            "x-viewer-id": "device-abc",
          }),
        }),
      ),
    ).toBe("consumer:fleet-key:v:device-abc")
  })

  it("splits two devices sharing one IP into separate viewer buckets (CGNAT)", () => {
    const shared = "203.0.113.9"
    const mk = (viewer: string) =>
      identifyForRateLimit(
        makeCtx({
          user: {
            id: null,
            role: "CONSUMER_BEARER",
            rateLimitBucketKey: "fleet-key",
            fleet: true,
          },
          request: makeRequest({
            "cf-connecting-ip": shared,
            "x-viewer-id": viewer,
          }),
        }),
      )
    const one = mk("device-one")
    const two = mk("device-two")
    expect(one).toBe("consumer:fleet-key:v:device-one")
    expect(two).toBe("consumer:fleet-key:v:device-two")
    expect(one).not.toBe(two)
  })

  it("falls back to the IP bucket when the viewer_id is malformed", () => {
    // Bad charset / over-length / empty → treated as absent, so junk can't dodge
    // the IP fallback. `:` is rejected so it can't cross the bucket namespace.
    for (const bad of ["has space", "colon:here", "a".repeat(65), ""]) {
      expect(
        identifyForRateLimit(
          makeCtx({
            user: {
              id: null,
              role: "CONSUMER_BEARER",
              rateLimitBucketKey: "fleet-key",
              fleet: true,
            },
            request: makeRequest({
              "cf-connecting-ip": "1.2.3.4",
              "x-viewer-id": bad,
            }),
          }),
        ),
      ).toBe("consumer:fleet-key:1.2.3.4")
    }
  })

  it("keeps a viewer_id shaped like an IP distinct from the IP bucket (R2)", () => {
    // A spoofed viewer_id "1.2.3.4" must NOT collide with the real IP bucket
    // consumer:<key>:1.2.3.4 — the v: prefix separates the namespaces.
    expect(
      identifyForRateLimit(
        makeCtx({
          user: {
            id: null,
            role: "CONSUMER_BEARER",
            rateLimitBucketKey: "fleet-key",
            fleet: true,
          },
          request: makeRequest({ "x-viewer-id": "1.2.3.4" }),
        }),
      ),
    ).toBe("consumer:fleet-key:v:1.2.3.4")
  })

  it("ignores x-viewer-id for a non-fleet consumer bearer (R6)", () => {
    // Web SSR (fleet:false) stays flat consumer:<key> — viewer_id only applies
    // to the fleet dimension.
    expect(
      identifyForRateLimit(
        makeCtx({
          user: {
            id: null,
            role: "CONSUMER_BEARER",
            rateLimitBucketKey: "web-key",
            fleet: false,
          },
          request: makeRequest({ "x-viewer-id": "device-abc" }),
        }),
      ),
    ).toBe("consumer:web-key")
  })

  it("falls back to public:<ip> when CONSUMER_BEARER lacks a bucket key (defensive)", () => {
    // Should not happen in practice — `createContext` mints the
    // principal via `CONSUMER_BEARER_PRINCIPAL({ rateLimitBucketKey })`
    // — but if a future code path constructs the role without the
    // bucket field, fall back to IP bucketing rather than crashing or
    // collapsing all keyless bearers into one bucket.
    expect(
      identifyForRateLimit(
        makeCtx({
          user: { id: null, role: "CONSUMER_BEARER" } as Principal,
          request: makeRequest({ "cf-connecting-ip": "1.2.3.4" }),
        }),
      ),
    ).toBe("public:1.2.3.4")
  })

  it("buckets VIDEO_MAPPER principals by service class", () => {
    expect(
      identifyForRateLimit(
        makeCtx({
          user: { id: null, role: "VIDEO_MAPPER" },
          request: makeRequest({ "cf-connecting-ip": "1.2.3.4" }),
        }),
      ),
    ).toBe("service:video-mapper")
  })

  // ---------------------------------------------------------------------------
  // Authenticated principals → user.id
  // ---------------------------------------------------------------------------

  it("buckets authenticated users by user.id, ignoring any bearer header", () => {
    expect(
      identifyForRateLimit(
        makeCtx({
          user: { id: "alice", role: "EDITOR" },
          request: makeRequest({ authorization: "Bearer leaked" }),
        }),
      ),
    ).toBe("alice")
  })

  // ---------------------------------------------------------------------------
  // Log scrubbing — the identifyFn must never leak the bearer key
  // into console output via this module.
  // ---------------------------------------------------------------------------

  it("does NOT log the bearer key or Authorization header", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {})
    try {
      // Walk every branch — anonymous IP, CONSUMER_BEARER, VIDEO_MAPPER,
      // authenticated.
      identifyForRateLimit(
        makeCtx({
          user: null,
          request: makeRequest({
            "cf-connecting-ip": "1.2.3.4",
            authorization: "Bearer raw-header-secret",
          }),
        }),
      )
      identifyForRateLimit(
        makeCtx({
          user: {
            id: null,
            role: "CONSUMER_BEARER",
            rateLimitBucketKey: "bearer-bucket-secret",
          },
          request: makeRequest({
            authorization: "Bearer raw-header-secret",
          }),
        }),
      )
      identifyForRateLimit(
        makeCtx({
          user: { id: null, role: "VIDEO_MAPPER" },
          request: makeRequest({
            authorization: "Bearer mapper-secret",
          }),
        }),
      )
      identifyForRateLimit(
        makeCtx({
          user: { id: "alice", role: "EDITOR" },
          request: makeRequest({ authorization: "Bearer raw-header-secret" }),
        }),
      )

      const combined = JSON.stringify([
        ...logSpy.mock.calls,
        ...warnSpy.mock.calls,
        ...errorSpy.mock.calls,
        ...infoSpy.mock.calls,
        ...debugSpy.mock.calls,
      ])
      // Authorization header value never leaks…
      expect(combined).not.toContain("raw-header-secret")
      expect(combined).not.toContain("Bearer ")
      // …and the bucket key (which IS used internally as the
      // identifyFn return value) is not LOGGED — the identifyFn
      // returns it to the rate-limit store, not to console.
      expect(combined).not.toContain("bearer-bucket-secret")
    } finally {
      logSpy.mockRestore()
      warnSpy.mockRestore()
      errorSpy.mockRestore()
      infoSpy.mockRestore()
      debugSpy.mockRestore()
    }
  })
})

describe("rateLimitConfigByField", () => {
  it("gives the watch route snapshot query a higher budget without broadening the generic query rule", () => {
    expect(rateLimitConfigByField).toContainEqual({
      type: "Query",
      field: "watchVideoRouteSnapshotBySlug",
      max: 300,
      window: "1m",
    })
    expect(rateLimitConfigByField).toContainEqual({
      type: "Query",
      field: "!(watchVideoRouteSnapshotBySlug)",
      max: 60,
      window: "1m",
    })
  })
})
