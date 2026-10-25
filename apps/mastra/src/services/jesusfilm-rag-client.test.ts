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
  // Default production ceiling (2 MiB). Every existing fixture is well under it,
  // so these tests double as under-cap regression guards that the byte-capped
  // read is transparent below the limit.
  maxResponseBytes: 2_097_152,
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

  it("maps an over-cap success body to parse_error (real over-cap, not a mocked branch)", async () => {
    // A structurally VALID JSON body that is larger than a deliberately tiny
    // cap. The byte counter trips before the body is parsed, so it rides the
    // existing parse_error path — exercised against a real Response stream.
    const big = JSON.stringify({
      results: Array.from({ length: 50 }, (_, index) => ({
        ...rankedResultWithTitle,
        chunkId: `chunk-${index}`,
      })),
    })
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(big, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    )

    const result = await searchJesusfilmRag({
      query: "x",
      config: { ...testConfig, maxResponseBytes: 64 },
      fetchImpl,
    })

    expect(result).toEqual({
      ok: false,
      reason: "parse_error",
      retryable: false,
      status: 200,
    })
    // Leak control: no body content bled into the typed failure.
    expect(JSON.stringify(result)).not.toContain("Jesus invites everyone")
  })

  it("aborts the stream on over-cap — proves reader.cancel() fires, not just the return value", async () => {
    // The load-bearing R2 test: assert the ABORT mechanism fired, not merely
    // that the result is parse_error. The body is an unbounded stream that would
    // emit far more than the cap if fully drained; a regression deleting
    // reader.cancel() (bare `return undefined` after the loop) would still
    // return parse_error but would NOT set this flag — reopening the OOM vector.
    let cancelled = false
    const oneKib = new Uint8Array(1024)
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(oneKib)
      },
      cancel() {
        cancelled = true
      },
    })
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(stream, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    )

    const result = await searchJesusfilmRag({
      query: "x",
      config: { ...testConfig, maxResponseBytes: 4_096 },
      fetchImpl,
    })

    expect(cancelled).toBe(true)
    expect(result).toEqual({
      ok: false,
      reason: "parse_error",
      retryable: false,
      status: 200,
    })
  })

  it("byte-bounds the error path too: over-cap error body yields no upstreamReason", async () => {
    // A multi-GB *error* body OOMs the shared process identically to a success
    // body, so readUpstreamReason is byte-bounded as well. An over-cap error
    // body returns undefined from the capped read → no reason extracted, but the
    // status-based classification (rejected, 400) is unchanged.
    const big = JSON.stringify({ error: "x".repeat(5_000) })
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(big, {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      ),
    )

    const result = await searchJesusfilmRag({
      query: "x",
      config: { ...testConfig, maxResponseBytes: 64 },
      fetchImpl,
    })

    expect(result).toEqual({
      ok: false,
      reason: "rejected",
      retryable: false,
      status: 400,
    })
    // The capped read returned undefined, so no reason was extracted.
    if (!result.ok) expect(result.upstreamReason).toBeUndefined()
  })

  it("treats a null-body response as parse_error without throwing", async () => {
    // `new Response(null).body === null`; the helper returns undefined for the
    // missing stream → the success site maps it to parse_error gracefully.
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(null, {
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
  })

  it("accepts a body exactly at the cap but rejects one byte over (boundary)", async () => {
    const body = JSON.stringify({ results: [] })
    const byteLength = new TextEncoder().encode(body).byteLength

    const atCap = await searchJesusfilmRag({
      query: "x",
      config: { ...testConfig, maxResponseBytes: byteLength },
      fetchImpl: vi.fn<typeof fetch>(() =>
        Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    })
    expect(atCap).toEqual({ ok: true, results: [] })

    const overCap = await searchJesusfilmRag({
      query: "x",
      config: { ...testConfig, maxResponseBytes: byteLength - 1 },
      fetchImpl: vi.fn<typeof fetch>(() =>
        Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    })
    expect(overCap).toEqual({
      ok: false,
      reason: "parse_error",
      retryable: false,
      status: 200,
    })
  })

  it("aborts the stream on an over-cap error body too — proves cancel() fires on the error path", async () => {
    // The error-path read (readUpstreamReason) must be byte-bounded by the SAME
    // abort mechanism as the success body, proven independently: if the error
    // read were ever split into a separate uncapped helper, this test fails even
    // though the success-path abort test would still pass.
    let cancelled = false
    const oneKib = new Uint8Array(1024)
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(oneKib)
      },
      cancel() {
        cancelled = true
      },
    })
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(stream, {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      ),
    )

    const result = await searchJesusfilmRag({
      query: "x",
      config: { ...testConfig, maxResponseBytes: 4_096 },
      fetchImpl,
    })

    expect(cancelled).toBe(true)
    expect(result).toEqual({
      ok: false,
      reason: "rejected",
      retryable: false,
      status: 400,
    })
    if (!result.ok) expect(result.upstreamReason).toBeUndefined()
  })

  it("reassembles a multi-chunk under-cap body correctly (offset loop)", async () => {
    // Exercises the merged.set(chunk, offset) reassembly across >1 chunk — the
    // single-chunk fixtures above never run the offset arithmetic. A real stream
    // emits the JSON in three separate chunks, all under the default cap.
    const payload = { results: [rankedResultWithTitle, rankedResultNullTitle] }
    const bytes = new TextEncoder().encode(JSON.stringify(payload))
    const third = Math.ceil(bytes.byteLength / 3)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, third))
        controller.enqueue(bytes.subarray(third, third * 2))
        controller.enqueue(bytes.subarray(third * 2))
        controller.close()
      },
    })
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(stream, {
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

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.results).toHaveLength(2)
      expect(result.results[0].citation.url).toBe(
        "https://example.org/who-is-jesus",
      )
    }
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
