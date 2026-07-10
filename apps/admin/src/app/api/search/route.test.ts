import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/auth/rate-limit", () => ({
  rateLimitAuthRoute: vi.fn(),
}))

vi.mock("@/auth/search-bearer", () => ({
  isAnyKnownBearer: vi.fn(),
}))

vi.mock("@/config/env", () => ({
  env: {} as { SEARCH_AUTH_REQUIRED?: "true" | "false" },
}))

// The route constructs a HybridSearchService with the shared `prisma`
// import; we mock the class so tests don't touch the DB.
const searchMock = vi.fn()
const makeTimings = () => ({
  pipelineMode: "hybrid" as const,
  totalMs: 1,
  embeddingMs: 1,
  retrievalsMs: 0,
  retrievalWaitMs: 0,
  fusionMs: 0,
  dilutionCapMs: 0,
  dedupeMs: 0,
  mappingMs: 0,
  hydrationMs: 0,
  retrievers: [],
  db: [],
})
const searchWithTraceMock = vi.fn(async (params) => {
  const response = await searchMock(params)
  return {
    response,
    trace: {
      searchMode: response.searchMode,
      resultCount: response.results.length,
      outcome: response.searchMode === "keyword-only" ? "degraded" : "success",
      traceClass:
        response.searchMode === "keyword-only"
          ? "query_embedding_failure"
          : "none",
      failedRetrievers: [],
      contributingRetrievers: [],
    },
    timings: makeTimings(),
  }
})
vi.mock("@/services/hybrid-search.service", async () => {
  const actual = await vi.importActual<
    typeof import("@/services/hybrid-search.service")
  >("@/services/hybrid-search.service")
  return {
    ...actual,
    HybridSearchService: vi.fn(() => ({
      search: searchMock,
      searchWithTrace: searchWithTraceMock,
    })),
  }
})

vi.mock("@/db/client", () => ({ prisma: {} }))

vi.mock("@/services/search-trace.service", () => ({
  recordSearchTraceSafely: vi.fn(async () => ({ ok: true, timedOut: false })),
}))

vi.mock("@/services/hybrid-search-debug-allowlist", () => ({
  isDebugAllowedForOrigin: vi.fn(),
}))

import { rateLimitAuthRoute } from "@/auth/rate-limit"
import { isAnyKnownBearer } from "@/auth/search-bearer"
import { env } from "@/config/env"
import { isDebugAllowedForOrigin } from "@/services/hybrid-search-debug-allowlist"
import { recordSearchTraceSafely } from "@/services/search-trace.service"
import { GET } from "./route"

const envMutable = env as { SEARCH_AUTH_REQUIRED?: "true" | "false" }

const allowRateLimit = () =>
  vi.mocked(rateLimitAuthRoute).mockResolvedValue({
    allowed: true,
    source: "local",
  })

const denyRateLimit = () =>
  vi.mocked(rateLimitAuthRoute).mockResolvedValue({
    allowed: false,
    source: "local",
  })

function req(path: string): Request {
  return new Request(`http://localhost${path}`, { method: "GET" })
}

function reqWithOrigin(path: string, origin: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "GET",
    headers: { origin },
  })
}

function reqWithAuth(path: string, authHeader: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "GET",
    headers: { authorization: authHeader },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  allowRateLimit()
  // Default: deny debug. Individual tests opt in.
  vi.mocked(isDebugAllowedForOrigin).mockReturnValue(false)
  // Default: dual-accept mode (SEARCH_AUTH_REQUIRED unset → "false" in
  // prod via the zod default). Individual tests opt in to required-auth.
  envMutable.SEARCH_AUTH_REQUIRED = "false"
  // Default: bearer absent / invalid → false. Tests opt into valid.
  vi.mocked(isAnyKnownBearer).mockResolvedValue({ valid: false })
  searchMock.mockResolvedValue({
    results: [],
    hasMore: false,
    query: "",
    searchMode: "hybrid",
  })
})

afterEach(() => {
  vi.clearAllMocks()
  envMutable.SEARCH_AUTH_REQUIRED = "false"
})

describe("GET /api/search", () => {
  it("returns 400 when `q` is missing", async () => {
    const res = await GET(req("/api/search?locale=en"))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: "q (search query) is required",
    })
  })

  it("returns 400 when `q` is whitespace-only", async () => {
    const res = await GET(req("/api/search?q=%20%20&locale=en"))
    expect(res.status).toBe(400)
  })

  it("returns 400 when `locale` is missing", async () => {
    const res = await GET(req("/api/search?q=jesus"))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "locale is required" })
  })

  it("returns 400 when `type` is not video/experience", async () => {
    const res = await GET(req("/api/search?q=jesus&locale=en&type=foo"))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: "type must be 'video' or 'experience'",
    })
  })

  it("passes contentTypes=[video] when type=video", async () => {
    await GET(req("/api/search?q=jesus&locale=en&type=video"))
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ contentTypes: ["video"] }),
    )
  })

  it("passes contentTypes=undefined when type omitted", async () => {
    await GET(req("/api/search?q=jesus&locale=en"))
    const call = searchMock.mock.calls[0][0]
    expect(call.contentTypes).toBeUndefined()
  })

  it("parses limit + offset as numbers", async () => {
    await GET(req("/api/search?q=jesus&locale=en&limit=10&offset=5"))
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 5 }),
    )
  })

  it("ignores non-numeric limit/offset", async () => {
    await GET(req("/api/search?q=jesus&locale=en&limit=abc&offset=xyz"))
    const call = searchMock.mock.calls[0][0]
    expect(call.limit).toBeUndefined()
    expect(call.offset).toBeUndefined()
  })

  it("returns 200 with service response on happy path", async () => {
    searchMock.mockResolvedValueOnce({
      results: [
        {
          type: "video",
          id: "vid-1",
          slug: "jesus",
          title: "Jesus",
          imageUrl: null,
          snippet: "scene",
          startSeconds: 0,
          playbackId: "mux-1",
          score: 1,
        },
      ],
      hasMore: false,
      query: "jesus",
      searchMode: "hybrid",
    })

    const res = await GET(req("/api/search?q=jesus&locale=en"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.results).toHaveLength(1)
    expect(body.searchMode).toBe("hybrid")
    expect(recordSearchTraceSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "jesus",
        locale: "en",
        routeSource: "rest",
        requestedMode: null,
        searchMode: "hybrid",
        resultCount: 1,
        outcome: "success",
        traceClass: "none",
        startedAt: expect.any(Date),
        completedAt: expect.any(Date),
      }),
    )
    expect(body).toEqual({
      results: [
        {
          type: "video",
          id: "vid-1",
          slug: "jesus",
          title: "Jesus",
          imageUrl: null,
          snippet: "scene",
          startSeconds: 0,
          playbackId: "mux-1",
          score: 1,
        },
      ],
      hasMore: false,
      query: "jesus",
      searchMode: "hybrid",
    })
  })

  it("returns 429 when rate limit exceeded", async () => {
    denyRateLimit()
    const res = await GET(req("/api/search?q=jesus&locale=en"))
    expect(res.status).toBe(429)
  })

  it("forwards mode='keyword-first' to the service", async () => {
    await GET(req("/api/search?q=jesus&locale=en&mode=keyword-first"))
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "keyword-first" }),
    )
  })

  it("forwards arbitrary mode values verbatim (service warn-and-falls-back)", async () => {
    await GET(req("/api/search?q=jesus&locale=en&mode=garbage"))
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "garbage" }),
    )
  })

  it("treats empty mode (?mode=) as undefined to avoid polluting the warn log", async () => {
    await GET(req("/api/search?q=jesus&locale=en&mode="))
    const call = searchMock.mock.calls[0][0]
    expect(call.mode).toBeUndefined()
  })

  it("treats omitted mode as undefined", async () => {
    await GET(req("/api/search?q=jesus&locale=en"))
    const call = searchMock.mock.calls[0][0]
    expect(call.mode).toBeUndefined()
  })

  it("debug=true with allowlisted origin → service called with debug:true", async () => {
    vi.mocked(isDebugAllowedForOrigin).mockReturnValue(true)
    await GET(
      reqWithOrigin(
        "/api/search?q=jesus&locale=en&debug=true",
        "http://localhost:3003",
      ),
    )
    expect(isDebugAllowedForOrigin).toHaveBeenCalledWith(
      "http://localhost:3003",
    )
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ debug: true }),
    )
  })

  it("debug=true with disallowed origin → service called with debug:false", async () => {
    vi.mocked(isDebugAllowedForOrigin).mockReturnValue(false)
    await GET(
      reqWithOrigin(
        "/api/search?q=jesus&locale=en&debug=true",
        "https://attacker.test",
      ),
    )
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ debug: false }),
    )
  })

  it("debug=true without Origin header → fails closed (debug:false)", async () => {
    // No Origin header at all.
    await GET(req("/api/search?q=jesus&locale=en&debug=true"))
    expect(isDebugAllowedForOrigin).toHaveBeenCalledWith(undefined)
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ debug: false }),
    )
  })

  it("debug omitted → service called with debug:false (no allowlist consultation needed)", async () => {
    await GET(req("/api/search?q=jesus&locale=en"))
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ debug: false }),
    )
  })

  it("debug=1 (truthy non-'true' value) is treated as opt-out", async () => {
    vi.mocked(isDebugAllowedForOrigin).mockReturnValue(true)
    await GET(
      reqWithOrigin(
        "/api/search?q=jesus&locale=en&debug=1",
        "http://localhost:3003",
      ),
    )
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ debug: false }),
    )
  })

  it("returns 503 when service throws", async () => {
    searchMock.mockRejectedValueOnce(new Error("boom"))
    const res = await GET(req("/api/search?q=jesus&locale=en"))
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({
      error: "Search is temporarily unavailable",
    })
    expect(recordSearchTraceSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "jesus",
        locale: "en",
        routeSource: "rest",
        searchMode: "failed",
        resultCount: 0,
        outcome: "failed",
        traceClass: "search_exception",
      }),
    )
  })

  it("keeps the search response unchanged when trace recording throws", async () => {
    vi.mocked(recordSearchTraceSafely).mockRejectedValueOnce(
      new Error("trace db down"),
    )
    searchMock.mockResolvedValueOnce({
      results: [],
      hasMore: false,
      query: "jesus",
      searchMode: "hybrid",
    })

    const res = await GET(req("/api/search?q=jesus&locale=en"))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      results: [],
      hasMore: false,
      query: "jesus",
      searchMode: "hybrid",
    })
  })

  it("does not trace invalid requests rejected before live search", async () => {
    const res = await GET(req("/api/search?locale=en"))
    expect(res.status).toBe(400)
    expect(recordSearchTraceSafely).not.toHaveBeenCalled()
  })

  describe("bearer auth gate (Plan 002)", () => {
    let logSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      // The search.request log uses console.error because on the
      // current Next.js 16 + Node 24 + Railway stack, ONLY
      // console.error surfaces from runtime route handlers.
      // console.warn (also stderr) is silenced in practice. See
      // route.ts for the empirical rationale.
      logSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    })

    afterEach(() => {
      logSpy.mockRestore()
    })

    // Parses the `[search] event=search.request key=value key=value`
    // log format. See route.ts for why we use key=value strings rather
    // than JSON.stringify (Railway logsV2 silences JSON-shaped log
    // lines on this stack).
    function parseSearchLogLines(): Array<Record<string, string>> {
      return logSpy.mock.calls
        .map((args) => args[0])
        .filter((arg): arg is string => typeof arg === "string")
        .filter((line) => line.includes("event=search.request"))
        .map((line) => {
          const obj: Record<string, string> = { event: "search.request" }
          for (const match of line.matchAll(/(\w+)=(\S+)/g)) {
            obj[match[1]] = match[2]
          }
          return obj
        })
    }

    describe("dual-accept mode (SEARCH_AUTH_REQUIRED=false)", () => {
      it("anonymous request → 200, log shows auth=anonymous path=rest", async () => {
        const res = await GET(req("/api/search?q=jesus&locale=en"))
        expect(res.status).toBe(200)
        const log = parseSearchLogLines()[0]
        expect(log).toMatchObject({
          event: "search.request",
          auth: "anonymous",
          path: "rest",
        })
      })

      it("valid bearer → 200, log shows auth=bearer path=rest", async () => {
        vi.mocked(isAnyKnownBearer).mockResolvedValue({
          valid: true,
          source: "consumer",
        })
        const res = await GET(
          reqWithAuth("/api/search?q=jesus&locale=en", "Bearer valid-key"),
        )
        expect(res.status).toBe(200)
        const log = parseSearchLogLines()[0]
        expect(log).toMatchObject({
          event: "search.request",
          auth: "bearer",
          path: "rest",
        })
      })

      it("invalid bearer → 200, log shows auth=invalid_bearer (distinct from anonymous)", async () => {
        vi.mocked(isAnyKnownBearer).mockResolvedValue({ valid: false })
        const res = await GET(
          reqWithAuth("/api/search?q=jesus&locale=en", "Bearer not-a-real-key"),
        )
        expect(res.status).toBe(200)
        const log = parseSearchLogLines()[0]
        // `invalid_bearer` tags requests that presented an Authorization
        // header that didn't match SEARCH_API_KEYS — operationally
        // distinct from `anonymous` (no header at all) during the
        // dual-accept window. This is the population that will 401
        // after the SEARCH_AUTH_REQUIRED flip.
        expect(log).toMatchObject({ auth: "invalid_bearer" })
      })

      it("invokes isValidSearchBearer with the Authorization header verbatim", async () => {
        vi.mocked(isAnyKnownBearer).mockResolvedValue({
          valid: true,
          source: "consumer",
        })
        await GET(
          reqWithAuth("/api/search?q=jesus&locale=en", "Bearer some-key-value"),
        )
        expect(isAnyKnownBearer).toHaveBeenCalledWith("Bearer some-key-value")
      })

      it("invokes isValidSearchBearer with null when no Authorization header", async () => {
        await GET(req("/api/search?q=jesus&locale=en"))
        expect(isAnyKnownBearer).toHaveBeenCalledWith(null)
      })

      it("emits exactly one search.request log line per request (no double-log regression)", async () => {
        vi.mocked(isAnyKnownBearer).mockResolvedValue({
          valid: true,
          source: "consumer",
        })
        await GET(
          reqWithAuth("/api/search?q=jesus&locale=en", "Bearer valid-key"),
        )
        expect(parseSearchLogLines()).toHaveLength(1)
      })

      it("logs source=consumer for WEB_ADMIN_API_KEYS bearer matches", async () => {
        vi.mocked(isAnyKnownBearer).mockResolvedValue({
          valid: true,
          source: "consumer",
        })
        await GET(
          reqWithAuth("/api/search?q=jesus&locale=en", "Bearer consumer-key"),
        )
        const log = parseSearchLogLines()[0]
        expect(log).toMatchObject({ auth: "bearer", source: "consumer" })
        expect(log).not.toHaveProperty("keyId")
      })

      it("logs source=workflow for WORKFLOW_API_KEYS bearer matches", async () => {
        vi.mocked(isAnyKnownBearer).mockResolvedValue({
          valid: true,
          source: "workflow",
        })
        await GET(
          reqWithAuth("/api/search?q=jesus&locale=en", "Bearer workflow-key"),
        )
        const log = parseSearchLogLines()[0]
        expect(log).toMatchObject({ auth: "bearer", source: "workflow" })
        expect(log).not.toHaveProperty("keyId")
      })

      it("logs source=partner + keyId for DB-backed partner key matches", async () => {
        // Operator-actionable signal: grep `keyId=PartnerKey01` to
        // see one partner's traffic over a time window. SC3 from the
        // brainstorm: "answer 'which partners called this week' from
        // logs alone."
        vi.mocked(isAnyKnownBearer).mockResolvedValue({
          valid: true,
          source: "partner",
          keyId: "PartnerKey01",
        })
        await GET(
          reqWithAuth(
            "/api/search?q=jesus&locale=en",
            "Bearer jfp_search_PartnerKey01_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
          ),
        )
        const log = parseSearchLogLines()[0]
        expect(log).toMatchObject({
          auth: "bearer",
          source: "partner",
          keyId: "PartnerKey01",
        })
      })

      it("omits keyId when bearer is valid but no keyId is surfaced (env-CSV matches)", async () => {
        // env-CSV branches don't carry a per-key identifier.
        // Asserting the field is absent (not `keyId=undefined`)
        // keeps the log line clean for greppers.
        vi.mocked(isAnyKnownBearer).mockResolvedValue({
          valid: true,
          source: "consumer",
        })
        await GET(
          reqWithAuth("/api/search?q=jesus&locale=en", "Bearer search-csv-key"),
        )
        const logSpyCalls = logSpy.mock.calls
          .map((args) => String(args[0] ?? ""))
          .filter((line) => line.includes("event=search.request"))
        expect(logSpyCalls[0]).not.toContain("keyId=")
        expect(logSpyCalls[0]).not.toContain("undefined")
      })

      it("omits source on invalid_bearer + anonymous (no match to attribute)", async () => {
        vi.mocked(isAnyKnownBearer).mockResolvedValue({ valid: false })
        await GET(reqWithAuth("/api/search?q=jesus&locale=en", "Bearer bogus"))
        const log = parseSearchLogLines()[0]
        expect(log).toMatchObject({ auth: "invalid_bearer" })
        expect(log).not.toHaveProperty("source")
        expect(log).not.toHaveProperty("keyId")
      })

      it("tags rate-limit source in the structured log (rl=local|redis) for Redis-degradation visibility", async () => {
        // Default mock returns source: "local". Verify the log
        // carries it so an operator grepping `rl=local` on a
        // high-traffic prod replica can detect Redis fallback
        // without changing the auth tagging.
        await GET(req("/api/search?q=jesus&locale=en"))
        const log = parseSearchLogLines()[0]
        expect(log).toMatchObject({ rl: "local" })
      })

      it("still emits the search.request log line when the service throws (5xx path)", async () => {
        // Locks in log-ordering: the auth/log line fires BEFORE the
        // try/catch around service.search, so a 503 still carries the
        // operator's request-tag signal. A future refactor that moves
        // the log emission below service.search would break this.
        searchMock.mockRejectedValueOnce(new Error("boom"))
        const res = await GET(req("/api/search?q=jesus&locale=en"))
        expect(res.status).toBe(503)
        const log = parseSearchLogLines()[0]
        expect(log).toMatchObject({
          event: "search.request",
          auth: "anonymous",
          path: "rest",
        })
      })

      it("with SEARCH_AUTH_REQUIRED left undefined (zod default), behaves as dual-accept", async () => {
        // Locks the production default. Removing this would allow a
        // silent flip of the default in env.ts to go undetected by
        // the suite (every other test sets the value explicitly).
        envMutable.SEARCH_AUTH_REQUIRED = undefined
        const res = await GET(req("/api/search?q=jesus&locale=en"))
        expect(res.status).toBe(200)
      })
    })

    describe("required-auth mode (SEARCH_AUTH_REQUIRED=true)", () => {
      beforeEach(() => {
        envMutable.SEARCH_AUTH_REQUIRED = "true"
      })

      it("anonymous request → 401 Authentication required", async () => {
        const res = await GET(req("/api/search?q=jesus&locale=en"))
        expect(res.status).toBe(401)
        // Use toMatchObject so future error-envelope additions (e.g.
        // a typed `code` field) don't fail this test for free.
        expect(await res.json()).toMatchObject({
          error: "Authentication required",
        })
      })

      it("anonymous 401 carries WWW-Authenticate: Bearer realm=search (no error code per RFC 6750)", async () => {
        const res = await GET(req("/api/search?q=jesus&locale=en"))
        expect(res.status).toBe(401)
        expect(res.headers.get("WWW-Authenticate")).toBe(
          'Bearer realm="search"',
        )
      })

      it("invalid bearer 401 carries WWW-Authenticate: Bearer error=invalid_token (RFC 6750 §3)", async () => {
        vi.mocked(isAnyKnownBearer).mockResolvedValue({ valid: false })
        const res = await GET(
          reqWithAuth("/api/search?q=jesus&locale=en", "Bearer not-a-real-key"),
        )
        expect(res.status).toBe(401)
        expect(res.headers.get("WWW-Authenticate")).toBe(
          'Bearer realm="search", error="invalid_token"',
        )
      })

      it("invalid bearer → 401", async () => {
        vi.mocked(isAnyKnownBearer).mockResolvedValue({ valid: false })
        const res = await GET(
          reqWithAuth("/api/search?q=jesus&locale=en", "Bearer not-a-real-key"),
        )
        expect(res.status).toBe(401)
      })

      it("valid bearer → 200 (existing pipeline unchanged)", async () => {
        vi.mocked(isAnyKnownBearer).mockResolvedValue({
          valid: true,
          source: "consumer",
        })
        const res = await GET(
          reqWithAuth("/api/search?q=jesus&locale=en", "Bearer valid-key"),
        )
        expect(res.status).toBe(200)
      })

      it("rate-limit fires BEFORE auth (every request drains the bucket, including invalid-bearer)", async () => {
        // Operational requirement: invalid-bearer requests still
        // count toward the per-IP rate-limit bucket, so an attacker
        // can't bypass throttling by spamming junk Authorization
        // headers. Rate-limit runs first; the auth gate sees only
        // requests that pass the rate-limit.
        const res = await GET(req("/api/search?q=jesus&locale=en"))
        expect(res.status).toBe(401)
        expect(rateLimitAuthRoute).toHaveBeenCalled()
      })

      it("429 takes precedence over 401 (rate-limited anonymous request returns 429, not 401)", async () => {
        denyRateLimit()
        const res = await GET(req("/api/search?q=jesus&locale=en"))
        expect(res.status).toBe(429)
      })

      it("401 fires BEFORE arg validation (anonymous + missing q still 401s, not 400)", async () => {
        // Mirrors the GraphQL-side ordering test. Without this, an
        // unauthenticated caller could enumerate the validator's
        // shape (which params are required, accepted enum values)
        // before getting locked out. Both surfaces must reject auth
        // first.
        const res = await GET(req("/api/search?locale=en"))
        expect(res.status).toBe(401)
      })

      it("rate-limit still fires for authed callers (429 takes precedence over 200)", async () => {
        vi.mocked(isAnyKnownBearer).mockResolvedValue({
          valid: true,
          source: "consumer",
        })
        denyRateLimit()
        const res = await GET(
          reqWithAuth("/api/search?q=jesus&locale=en", "Bearer valid-key"),
        )
        expect(res.status).toBe(429)
      })

      it("logs auth=anonymous even when 401'd (so operators see who was rejected)", async () => {
        await GET(req("/api/search?q=jesus&locale=en"))
        const log = parseSearchLogLines()[0]
        expect(log).toMatchObject({ auth: "anonymous", path: "rest" })
      })
    })

    describe("log discipline", () => {
      it("never logs the bearer header value", async () => {
        vi.mocked(isAnyKnownBearer).mockResolvedValue({
          valid: true,
          source: "consumer",
        })
        await GET(
          reqWithAuth(
            "/api/search?q=jesus&locale=en",
            "Bearer the-secret-key-value-aaa",
          ),
        )
        const allLogged = logSpy.mock.calls
          .map((args) => String(args[0] ?? ""))
          .join("\n")
        expect(allLogged).not.toContain("the-secret-key-value-aaa")
        expect(allLogged).not.toContain("Bearer the-secret")
      })
    })
  })
})
