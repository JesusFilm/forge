import { describe, expect, it, vi } from "vitest"

import {
  searchJesusfilmRag,
  type JesusfilmRagConfig,
} from "./jesusfilm-rag-client"

const testConfig: JesusfilmRagConfig = {
  baseUrl: "https://rag.internal",
  apiKey: "rag-key",
  timeoutMs: 5_000,
  userAgent: "forge-test-rag/1.0",
}

function jsonResponse(
  body: unknown,
  init: ResponseInit = {},
): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: {
        "content-type": "application/json",
        ...Object.fromEntries(new Headers(init.headers).entries()),
      },
    }),
  )
}

// Fixtures transcribed field-for-field from jesusfilm-rag
// contracts/openapi.v1.json (captured 2026-06-10), including `tags`, `chunkId`,
// `ord`, `sourceKey`, and a `title: null` case.
const rankedResultWithTitle = {
  chunkId: "chunk-001",
  score: 0.82,
  text: "Jesus invites everyone to follow him.",
  ord: 0,
  tags: ["gospel", "intro"],
  citation: {
    sourceKey: "jesus-film",
    sourceName: "The Jesus Film",
    title: "Who Is Jesus?",
    url: "https://example.org/who-is-jesus",
  },
}

const rankedResultNullTitle = {
  chunkId: "chunk-002",
  score: 0.71,
  text: "The Gospel of Luke records his life.",
  ord: 1,
  tags: [],
  citation: {
    sourceKey: "luke",
    sourceName: "Gospel of Luke",
    title: null,
    url: "https://example.org/luke",
  },
}

describe("jesusfilm-rag client", () => {
  it("returns parsed passages and issues the exact contract request", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      jsonResponse({ results: [rankedResultWithTitle, rankedResultNullTitle] }),
    )

    const result = await searchJesusfilmRag({
      query: "How do I become a Christian?",
      config: testConfig,
      fetchImpl,
    })

    expect(result).toEqual({
      ok: true,
      results: [
        {
          score: 0.82,
          text: "Jesus invites everyone to follow him.",
          citation: {
            sourceName: "The Jesus Film",
            title: "Who Is Jesus?",
            url: "https://example.org/who-is-jesus",
          },
        },
        {
          score: 0.71,
          text: "The Gospel of Luke records his life.",
          citation: {
            sourceName: "Gospel of Luke",
            title: null,
            url: "https://example.org/luke",
          },
        },
      ],
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://rag.internal/v1/search"),
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        headers: expect.objectContaining({
          authorization: "Bearer rag-key",
          "content-type": "application/json",
          "user-agent": "forge-test-rag/1.0",
        }),
        body: JSON.stringify({
          query: "How do I become a Christian?",
          policy: { topK: 5 },
        }),
      }),
    )
  })

  it("returns ok with an empty array for a 200 with no results", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => jsonResponse({ results: [] }))

    const result = await searchJesusfilmRag({
      query: "obscure question",
      config: testConfig,
      fetchImpl,
    })

    expect(result).toEqual({ ok: true, results: [] })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("short-circuits config_missing (base_url_missing) without fetching", async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    const result = await searchJesusfilmRag({
      query: "x",
      config: { ...testConfig, baseUrl: undefined },
      fetchImpl,
    })

    expect(result).toEqual({
      ok: false,
      reason: "config_missing",
      retryable: false,
      detail: "base_url_missing",
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("short-circuits config_missing (api_key_missing) without fetching", async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    const result = await searchJesusfilmRag({
      query: "x",
      config: { ...testConfig, apiKey: undefined },
      fetchImpl,
    })

    expect(result).toEqual({
      ok: false,
      reason: "config_missing",
      retryable: false,
      detail: "api_key_missing",
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("short-circuits config_missing when neither half is set", async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    const result = await searchJesusfilmRag({
      query: "x",
      config: { ...testConfig, baseUrl: undefined, apiKey: undefined },
      fetchImpl,
    })

    expect(result).toMatchObject({
      ok: false,
      reason: "config_missing",
      detail: "base_url_missing",
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("classifies 401 as non-retryable auth_failed", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      jsonResponse({ error: "unknown bearer" }, { status: 401 }),
    )

    const result = await searchJesusfilmRag({
      query: "x",
      config: testConfig,
      fetchImpl,
    })

    expect(result).toEqual({
      ok: false,
      reason: "auth_failed",
      retryable: false,
      status: 401,
      upstreamReason: "unknown bearer",
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("classifies 403 as non-retryable auth_failed", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      jsonResponse({ error: "forbidden" }, { status: 403 }),
    )

    const result = await searchJesusfilmRag({
      query: "x",
      config: testConfig,
      fetchImpl,
    })

    expect(result).toEqual({
      ok: false,
      reason: "auth_failed",
      retryable: false,
      status: 403,
      upstreamReason: "forbidden",
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("classifies 400 as non-retryable rejected", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      jsonResponse({ error: "query too long" }, { status: 400 }),
    )

    const result = await searchJesusfilmRag({
      query: "x",
      config: testConfig,
      fetchImpl,
    })

    expect(result).toEqual({
      ok: false,
      reason: "rejected",
      retryable: false,
      status: 400,
      upstreamReason: "query too long",
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("reads upstreamReason from the body `message` field when `error` is absent", async () => {
    // Exercises readUpstreamReason's `?? safeReason(record.message)` fallback.
    // Every other error-body fixture uses `{ error }`, so without this the
    // `message` branch is dead from a coverage standpoint and deletable.
    const fetchImpl = vi.fn<typeof fetch>(() =>
      jsonResponse({ message: "rate window exceeded" }, { status: 400 }),
    )

    const result = await searchJesusfilmRag({
      query: "x",
      config: testConfig,
      fetchImpl,
    })

    expect(result).toEqual({
      ok: false,
      reason: "rejected",
      retryable: false,
      status: 400,
      upstreamReason: "rate window exceeded",
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("classifies 500 as retryable network_error", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      jsonResponse({ error: "embedding provider down" }, { status: 500 }),
    )

    const result = await searchJesusfilmRag({
      query: "x",
      config: testConfig,
      fetchImpl,
    })

    expect(result).toEqual({
      ok: false,
      reason: "network_error",
      retryable: true,
      status: 500,
      upstreamReason: "embedding provider down",
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("classifies 429 as rate_limited", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      jsonResponse({ error: "slow down" }, { status: 429 }),
    )

    const result = await searchJesusfilmRag({
      query: "x",
      config: testConfig,
      fetchImpl,
    })

    expect(result).toMatchObject({
      ok: false,
      reason: "rate_limited",
      retryable: true,
      status: 429,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("maps a TimeoutError rejection to reason timeout (name-based, not message)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.reject(
        Object.assign(new Error("the operation was aborted"), {
          name: "TimeoutError",
        }),
      ),
    )

    const result = await searchJesusfilmRag({
      query: "x",
      config: testConfig,
      fetchImpl,
    })

    expect(result).toEqual({ ok: false, reason: "timeout", retryable: true })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("maps an AbortError rejection to reason timeout (name-based, not message)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.reject(
        Object.assign(new Error("aborted"), { name: "AbortError" }),
      ),
    )

    const result = await searchJesusfilmRag({
      query: "x",
      config: testConfig,
      fetchImpl,
    })

    expect(result).toEqual({ ok: false, reason: "timeout", retryable: true })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("maps a generic TypeError rejection to network_error", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.reject(new TypeError("network failure")),
    )

    const result = await searchJesusfilmRag({
      query: "x",
      config: testConfig,
      fetchImpl,
    })

    expect(result).toEqual({
      ok: false,
      reason: "network_error",
      retryable: true,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("maps invalid JSON to parse_error carrying no raw body text", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response("not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    )

    const result = await searchJesusfilmRag({
      query: "x",
      config: testConfig,
      fetchImpl,
    })

    expect(result).toEqual({
      ok: false,
      reason: "parse_error",
      retryable: false,
      status: 200,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("maps a 200 missing a required consumed field (citation.url) to parse_error", async () => {
    const SECRET_MARKER = "DO-NOT-LEAK-THIS-BODY"
    const fetchImpl = vi.fn<typeof fetch>(() =>
      jsonResponse({
        results: [
          {
            chunkId: "chunk-x",
            score: 0.5,
            text: SECRET_MARKER,
            ord: 0,
            tags: [],
            citation: {
              sourceKey: "k",
              sourceName: "Name",
              title: null,
              // url omitted — a required consumed field is missing.
            },
          },
        ],
      }),
    )

    const result = await searchJesusfilmRag({
      query: "x",
      config: testConfig,
      fetchImpl,
    })

    expect(result).toEqual({
      ok: false,
      reason: "parse_error",
      retryable: false,
      status: 200,
    })
    // Leak control: nothing from the body bled into the typed failure.
    expect(JSON.stringify(result)).not.toContain(SECRET_MARKER)
  })

  it("tolerates a contract-legal additive field on RankedResult and Citation", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      jsonResponse({
        results: [
          {
            ...rankedResultWithTitle,
            // Hypothetical additive v1 fields the tool doesn't consume.
            relevanceTier: "high",
            citation: {
              ...rankedResultWithTitle.citation,
              license: "CC-BY",
            },
          },
        ],
        // Hypothetical additive envelope field.
        latencyMs: 1200,
      }),
    )

    const result = await searchJesusfilmRag({
      query: "x",
      config: testConfig,
      fetchImpl,
    })

    expect(result).toEqual({
      ok: true,
      results: [
        {
          score: 0.82,
          text: "Jesus invites everyone to follow him.",
          citation: {
            sourceName: "The Jesus Film",
            title: "Who Is Jesus?",
            url: "https://example.org/who-is-jesus",
          },
        },
      ],
    })
  })

  it("rejects a non-finite score as parse_error (no Infinity leaks through)", async () => {
    // 1e999 is JSON-legal and parses to Infinity; the schema's .finite() rejects.
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          `{"results":[{"chunkId":"c","score":1e999,"text":"t","ord":0,"tags":[],"citation":{"sourceKey":"k","sourceName":"N","title":null,"url":"https://example.org/x"}}]}`,
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    )

    const result = await searchJesusfilmRag({
      query: "x",
      config: testConfig,
      fetchImpl,
    })

    expect(result).toEqual({
      ok: false,
      reason: "parse_error",
      retryable: false,
      status: 200,
    })
  })

  it("caps the returned results to RAG_TOP_K even when the server returns more", async () => {
    const overflowResults = Array.from({ length: 12 }, (_, index) => ({
      ...rankedResultWithTitle,
      chunkId: `chunk-${index}`,
    }))
    const fetchImpl = vi.fn<typeof fetch>(() =>
      jsonResponse({ results: overflowResults }),
    )

    const result = await searchJesusfilmRag({
      query: "x",
      config: testConfig,
      fetchImpl,
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.results).toHaveLength(5)
  })

  it("caps a >300-codepoint upstream error reason, codepoint-safe", async () => {
    // 310 surrogate-pair characters; the cap must not split the boundary pair.
    const longReason = "😀".repeat(310)
    const fetchImpl = vi.fn<typeof fetch>(() =>
      jsonResponse({ error: longReason }, { status: 400 }),
    )

    const result = await searchJesusfilmRag({
      query: "x",
      config: testConfig,
      fetchImpl,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.upstreamReason).toBeDefined()
      expect(Array.from(result.upstreamReason ?? "")).toHaveLength(300)
      expect(result.upstreamReason?.endsWith("...")).toBe(true)
      // Codepoint-safe: no lone surrogate at the truncation boundary.
      expect(result.upstreamReason).toContain("😀...")
    }
  })

  it("resolves v1/search against a base URL with a trailing slash", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => jsonResponse({ results: [] }))

    await searchJesusfilmRag({
      query: "x",
      config: { ...testConfig, baseUrl: "https://rag.internal/" },
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://rag.internal/v1/search"),
      expect.anything(),
    )
  })

  it("resolves v1/search against a base URL carrying a path prefix", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => jsonResponse({ results: [] }))

    await searchJesusfilmRag({
      query: "x",
      config: { ...testConfig, baseUrl: "https://gw.internal/rag/" },
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://gw.internal/rag/v1/search"),
      expect.anything(),
    )
  })
})
