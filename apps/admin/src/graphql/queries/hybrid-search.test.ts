/**
 * Execution tests for the public `search` GraphQL query resolver.
 *
 * Invokes the resolver function directly via `schema.getFields()` to
 * dodge vitest's transitive-graphql double-instance issue (same
 * pattern used by `scene-recommendations.test.ts`). Mocks
 * HybridSearchService so we verify resolver wiring + arg validation
 * + mode plumbing without touching the DB or the embedding provider.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const searchMock = vi.fn()
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

vi.mock("@/services/hybrid-search-debug-allowlist", () => ({
  isDebugAllowedForOrigin: vi.fn(),
}))

vi.mock("@/auth/search-bearer", () => ({
  isAnyKnownBearer: vi.fn(),
}))

vi.mock("@/services/search-trace.service", () => ({
  recordSearchTraceSafely: vi.fn(async () => ({ ok: true, timedOut: false })),
}))

vi.mock("@/config/env", () => ({
  env: {} as { SEARCH_AUTH_REQUIRED?: "true" | "false" },
}))

import { schema } from "@/graphql/schema"
import { isDebugAllowedForOrigin } from "@/services/hybrid-search-debug-allowlist"
import { isAnyKnownBearer } from "@/auth/search-bearer"
import { env } from "@/config/env"
import { recordSearchTraceSafely } from "@/services/search-trace.service"

const envMutable = env as { SEARCH_AUTH_REQUIRED?: "true" | "false" }

type ResolverArgs = {
  q: string
  locale: string
  type?: "video" | "experience"
  limit?: number
  offset?: number
  mode?: string | null
  debug?: boolean | null
}

type ResolverCtx = {
  request?: { headers?: Headers | { get(name: string): string | null } }
}

function ctxWithOrigin(origin: string | undefined): ResolverCtx {
  if (origin == null) return { request: { headers: new Headers() } }
  return { request: { headers: new Headers({ origin }) } }
}

function ctxWithAuth(authHeader: string): ResolverCtx {
  return { request: { headers: new Headers({ authorization: authHeader }) } }
}

type FieldWithResolve = {
  resolve: (
    root: unknown,
    args: ResolverArgs,
    ctx: ResolverCtx,
    info: unknown,
  ) => unknown
}

function getResolver(): FieldWithResolve["resolve"] {
  const fields = schema.getQueryType()!.getFields()
  const field = fields.search as unknown as FieldWithResolve
  return field.resolve
}

async function invoke(
  args: ResolverArgs,
  ctx: ResolverCtx = ctxWithOrigin(undefined),
) {
  const resolve = getResolver()
  return resolve(null, args, ctx, {})
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isDebugAllowedForOrigin).mockReturnValue(false)
  // Default: dual-accept (SEARCH_AUTH_REQUIRED=false), bearer absent.
  // Individual tests opt into required-auth and/or valid bearer.
  envMutable.SEARCH_AUTH_REQUIRED = "false"
  vi.mocked(isAnyKnownBearer).mockResolvedValue({ valid: false })
  searchMock.mockResolvedValue({
    results: [],
    hasMore: false,
    query: "",
    searchMode: "hybrid",
  })
})

afterEach(() => {
  envMutable.SEARCH_AUTH_REQUIRED = "false"
})

describe("Query.search resolver", () => {
  it("rejects empty / whitespace-only q", async () => {
    await expect(invoke({ q: "   ", locale: "en" })).rejects.toThrow(/q/)
    expect(searchMock).not.toHaveBeenCalled()
    expect(recordSearchTraceSafely).not.toHaveBeenCalled()
  })

  it("rejects empty locale", async () => {
    await expect(invoke({ q: "jesus", locale: "" })).rejects.toThrow(/locale/)
  })

  it("rejects unknown content type", async () => {
    // Pothos enum normally rejects this at parse time; the resolver also
    // guards in case a caller passes a raw string through a custom client.
    await expect(
      invoke({
        q: "jesus",
        locale: "en",
        type: "foo" as unknown as "video",
      }),
    ).rejects.toThrow(/type/)
  })

  it("forwards canonical mode='keyword-first' to the service", async () => {
    await invoke({ q: "jesus", locale: "en", mode: "keyword-first" })
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "keyword-first" }),
    )
  })

  it("forwards mode='hybrid' explicitly", async () => {
    await invoke({ q: "jesus", locale: "en", mode: "hybrid" })
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "hybrid" }),
    )
  })

  it("forwards arbitrary mode values verbatim (service warn-and-falls-back)", async () => {
    await invoke({ q: "jesus", locale: "en", mode: "garbage" })
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "garbage" }),
    )
  })

  it("treats empty mode (mode: '') as undefined", async () => {
    await invoke({ q: "jesus", locale: "en", mode: "" })
    const call = searchMock.mock.calls[0]![0]
    expect(call.mode).toBeUndefined()
  })

  it("treats null mode as undefined", async () => {
    await invoke({ q: "jesus", locale: "en", mode: null })
    const call = searchMock.mock.calls[0]![0]
    expect(call.mode).toBeUndefined()
  })

  it("treats missing mode as undefined", async () => {
    await invoke({ q: "jesus", locale: "en" })
    const call = searchMock.mock.calls[0]![0]
    expect(call.mode).toBeUndefined()
  })

  it("forwards trimmed q + locale + limit + offset to the service", async () => {
    await invoke({
      q: "  jesus  ",
      locale: "es",
      limit: 5,
      offset: 10,
    })
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "jesus",
        locale: "es",
        limit: 5,
        offset: 10,
      }),
    )
  })

  it("returns the public response unchanged while recording a GraphQL trace", async () => {
    searchMock.mockResolvedValueOnce({
      results: [
        {
          type: "experience",
          id: "exp-1",
          slug: "easter",
          title: "Easter",
          imageUrl: null,
          snippet: "",
          startSeconds: null,
          playbackId: null,
          score: 1,
          label: null,
          durationSeconds: null,
          childCount: null,
        },
      ],
      hasMore: false,
      query: "easter",
      searchMode: "hybrid",
    })

    await expect(invoke({ q: "  easter  ", locale: "en" })).resolves.toEqual({
      results: [
        {
          type: "experience",
          id: "exp-1",
          slug: "easter",
          title: "Easter",
          imageUrl: null,
          snippet: "",
          startSeconds: null,
          playbackId: null,
          score: 1,
          label: null,
          durationSeconds: null,
          childCount: null,
        },
      ],
      hasMore: false,
      query: "easter",
      searchMode: "hybrid",
    })
    expect(recordSearchTraceSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "easter",
        locale: "en",
        routeSource: "graphql",
        requestedMode: null,
        searchMode: "hybrid",
        resultCount: 1,
        outcome: "success",
        traceClass: "none",
        startedAt: expect.any(Date),
        completedAt: expect.any(Date),
      }),
    )
  })

  it("keeps the GraphQL result unchanged when trace recording throws", async () => {
    vi.mocked(recordSearchTraceSafely).mockRejectedValueOnce(
      new Error("trace write failed"),
    )
    searchMock.mockResolvedValueOnce({
      results: [],
      hasMore: false,
      query: "jesus",
      searchMode: "hybrid",
    })

    await expect(invoke({ q: "jesus", locale: "en" })).resolves.toEqual({
      results: [],
      hasMore: false,
      query: "jesus",
      searchMode: "hybrid",
    })
  })
})

describe("Query.search debug arg + origin gating", () => {
  it("debug=true with allowlisted origin → service called with debug:true", async () => {
    vi.mocked(isDebugAllowedForOrigin).mockReturnValue(true)
    await invoke(
      { q: "jesus", locale: "en", debug: true },
      ctxWithOrigin("http://localhost:3003"),
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
    await invoke(
      { q: "jesus", locale: "en", debug: true },
      ctxWithOrigin("https://attacker.test"),
    )
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ debug: false }),
    )
  })

  it("debug=true without Origin header → fails closed (debug:false)", async () => {
    await invoke(
      { q: "jesus", locale: "en", debug: true },
      ctxWithOrigin(undefined),
    )
    expect(isDebugAllowedForOrigin).toHaveBeenCalledWith(undefined)
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ debug: false }),
    )
  })

  it("debug omitted → service called with debug:false", async () => {
    await invoke({ q: "jesus", locale: "en" })
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ debug: false }),
    )
  })
})

describe("schema description on Query.search.mode arg", () => {
  it("disambiguates from the searchMode response field", () => {
    const field = schema.getQueryType()!.getFields().search!
    const modeArg = field.args.find((a) => a.name === "mode")
    expect(modeArg).toBeDefined()
    const description = modeArg!.description ?? ""
    expect(description).toMatch(/searchMode/)
    expect(description.toLowerCase()).toMatch(/orthogonal/)
  })
})

describe("Query.search bearer auth gate (Plan 002)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // The search.request log uses console.error because on the
    // current Next.js 16 + Node 24 + Railway stack, ONLY
    // console.error surfaces from runtime route handlers.
    // console.warn (also stderr) is silenced in practice. See
    // hybrid-search.ts for the empirical rationale.
    logSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  // Parses the `[search] event=search.request key=value key=value` log
  // format. See hybrid-search.ts for why we use key=value strings
  // rather than JSON.stringify (Railway logsV2 silences JSON-shaped
  // log lines on this stack).
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

  describe("dual-accept (SEARCH_AUTH_REQUIRED=false)", () => {
    it("anonymous resolves; log shows auth=anonymous path=graphql", async () => {
      const result = await invoke({ q: "jesus", locale: "en" })
      expect(result).toBeDefined()
      const log = parseSearchLogLines()[0]
      expect(log).toMatchObject({
        event: "search.request",
        auth: "anonymous",
        path: "graphql",
      })
    })

    it("valid bearer resolves; log shows auth=bearer path=graphql", async () => {
      vi.mocked(isAnyKnownBearer).mockResolvedValue({
        valid: true,
        source: "consumer",
      })
      const result = await invoke(
        { q: "jesus", locale: "en" },
        ctxWithAuth("Bearer valid-key"),
      )
      expect(result).toBeDefined()
      const log = parseSearchLogLines()[0]
      expect(log).toMatchObject({
        event: "search.request",
        auth: "bearer",
        path: "graphql",
      })
    })

    it("invalid bearer resolves; log shows auth=invalid_bearer (distinct from anonymous)", async () => {
      vi.mocked(isAnyKnownBearer).mockResolvedValue({ valid: false })
      const result = await invoke(
        { q: "jesus", locale: "en" },
        ctxWithAuth("Bearer not-a-real-key"),
      )
      expect(result).toBeDefined()
      const log = parseSearchLogLines()[0]
      // `invalid_bearer` tags requests that presented an Authorization
      // header that didn't match SEARCH_API_KEYS — operationally
      // distinct from `anonymous` (no header at all).
      expect(log).toMatchObject({ auth: "invalid_bearer" })
    })

    it("forwards the Authorization header value verbatim to isValidSearchBearer", async () => {
      vi.mocked(isAnyKnownBearer).mockResolvedValue({
        valid: true,
        source: "consumer",
      })
      await invoke(
        { q: "jesus", locale: "en" },
        ctxWithAuth("Bearer some-key-value"),
      )
      expect(isAnyKnownBearer).toHaveBeenCalledWith("Bearer some-key-value")
    })

    it("forwards null when no Authorization header present", async () => {
      await invoke({ q: "jesus", locale: "en" })
      expect(isAnyKnownBearer).toHaveBeenCalledWith(null)
    })

    it("logs source=partner + keyId for DB-backed partner key matches", async () => {
      vi.mocked(isAnyKnownBearer).mockResolvedValue({
        valid: true,
        source: "partner",
        keyId: "PartnerKey01",
      })
      await invoke(
        { q: "jesus", locale: "en" },
        ctxWithAuth(
          "Bearer jfp_search_PartnerKey01_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        ),
      )
      const log = parseSearchLogLines()[0]
      expect(log).toMatchObject({
        auth: "bearer",
        source: "partner",
        keyId: "PartnerKey01",
        path: "graphql",
      })
    })

    it("logs source=<branch> for each env-CSV match without leaking keyId", async () => {
      for (const source of ["consumer", "workflow"] as const) {
        vi.mocked(isAnyKnownBearer).mockResolvedValueOnce({
          valid: true,
          source,
        })
        await invoke(
          { q: "jesus", locale: "en" },
          ctxWithAuth(`Bearer ${source}-key`),
        )
      }
      const lines = parseSearchLogLines()
      expect(lines).toHaveLength(2)
      expect(lines[0]).toMatchObject({ source: "consumer" })
      expect(lines[1]).toMatchObject({ source: "workflow" })
      for (const line of lines) {
        expect(line).not.toHaveProperty("keyId")
      }
    })

    it("emits exactly one search.request log line per resolver invocation", async () => {
      vi.mocked(isAnyKnownBearer).mockResolvedValue({
        valid: true,
        source: "consumer",
      })
      await invoke(
        { q: "jesus", locale: "en" },
        ctxWithAuth("Bearer valid-key"),
      )
      expect(parseSearchLogLines()).toHaveLength(1)
    })

    it("with SEARCH_AUTH_REQUIRED left undefined (zod default), behaves as dual-accept", async () => {
      envMutable.SEARCH_AUTH_REQUIRED = undefined
      const result = await invoke({ q: "jesus", locale: "en" })
      expect(result).toBeDefined()
    })
  })

  describe("required-auth (SEARCH_AUTH_REQUIRED=true)", () => {
    beforeEach(() => {
      envMutable.SEARCH_AUTH_REQUIRED = "true"
    })

    it("anonymous request throws Authentication required", async () => {
      await expect(invoke({ q: "jesus", locale: "en" })).rejects.toThrow(
        /Authentication required/,
      )
      expect(searchMock).not.toHaveBeenCalled()
    })

    it("invalid bearer throws Authentication required", async () => {
      vi.mocked(isAnyKnownBearer).mockResolvedValue({ valid: false })
      await expect(
        invoke(
          { q: "jesus", locale: "en" },
          ctxWithAuth("Bearer not-a-real-key"),
        ),
      ).rejects.toThrow(/Authentication required/)
    })

    it("valid bearer resolves normally", async () => {
      vi.mocked(isAnyKnownBearer).mockResolvedValue({
        valid: true,
        source: "consumer",
      })
      const result = await invoke(
        { q: "jesus", locale: "en" },
        ctxWithAuth("Bearer valid-key"),
      )
      expect(result).toBeDefined()
      expect(searchMock).toHaveBeenCalled()
    })

    it("auth throw fires BEFORE arg validation (anonymous + bad args still 401s)", async () => {
      // An anonymous caller with whitespace-only `q` should get the
      // auth error, not the validation error. Otherwise we'd be
      // leaking information about which inputs the endpoint cares
      // about to unauthenticated callers.
      await expect(invoke({ q: "   ", locale: "en" })).rejects.toThrow(
        /Authentication required/,
      )
    })

    it("logs auth=anonymous even when throw-rejected (operator visibility)", async () => {
      await expect(invoke({ q: "jesus", locale: "en" })).rejects.toThrow()
      const log = parseSearchLogLines()[0]
      expect(log).toMatchObject({ auth: "anonymous", path: "graphql" })
    })

    it("throws a typed GraphQLError with extensions.code='UNAUTHENTICATED' (survives Yoga maskedErrors)", async () => {
      // Yoga's default maskedErrors rewrites raw `new Error(...)` to
      // a generic "Unexpected error." message in production. A typed
      // GraphQLError with extensions.code is preserved through
      // masking, so clients can branch on extensions.code stably
      // instead of regex-matching error.message.
      try {
        await invoke({ q: "jesus", locale: "en" })
        throw new Error("expected resolver to throw")
      } catch (err) {
        // Use a structural assertion (rather than instanceof) to
        // stay compatible across the GraphQLError import shape from
        // `graphql` — vitest's interop occasionally produces two
        // distinct constructor identities. The contract that
        // matters is `extensions.code === "UNAUTHENTICATED"`.
        const e = err as {
          message?: string
          extensions?: Record<string, unknown>
        }
        expect(e.message).toBe("Authentication required")
        expect(e.extensions).toMatchObject({
          code: "UNAUTHENTICATED",
          http: { status: 401 },
        })
      }
    })
  })

  describe("dual-accept observability locks (mirror REST)", () => {
    it("still emits the search.request log line when the service throws (5xx-equivalent path)", async () => {
      // Locks log-ordering: the log/auth check fires BEFORE
      // service.search, so a thrown service stays observable in the
      // structured-log feed. A future refactor moving the log
      // emission below service.search would break this without
      // affecting any other GraphQL test.
      searchMock.mockRejectedValueOnce(new Error("boom"))
      await expect(invoke({ q: "jesus", locale: "en" })).rejects.toThrow(/boom/)
      expect(recordSearchTraceSafely).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "jesus",
          locale: "en",
          routeSource: "graphql",
          searchMode: "failed",
          resultCount: 0,
          outcome: "failed",
          traceClass: "search_exception",
        }),
      )
      const log = parseSearchLogLines()[0]
      expect(log).toMatchObject({
        event: "search.request",
        auth: "anonymous",
        path: "graphql",
      })
    })
  })

  describe("log discipline", () => {
    it("never logs the bearer header value", async () => {
      vi.mocked(isAnyKnownBearer).mockResolvedValue({
        valid: true,
        source: "consumer",
      })
      await invoke(
        { q: "jesus", locale: "en" },
        ctxWithAuth("Bearer the-secret-key-value-aaa"),
      )
      const allLogged = logSpy.mock.calls
        .map((args) => String(args[0] ?? ""))
        .join("\n")
      expect(allLogged).not.toContain("the-secret-key-value-aaa")
      expect(allLogged).not.toContain("Bearer the-secret")
    })
  })
})
