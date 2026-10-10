import { describe, expect, it, vi } from "vitest"

import {
  fetchVideoImageViaAdmin,
  lookupBibleVerseViaAdmin,
  searchVideosViaAdmin,
  type AdminAgentToolsConfig,
} from "./admin-agent-tools-client"

const CONFIG: AdminAgentToolsConfig = {
  baseUrl: "https://admin.example",
  apiKey: "svc-key",
  timeoutMs: 10_000,
  userAgent: "forge-mastra-agent-tools/1.0",
  maxResponseBytes: 2_097_152,
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const VIDEOS_BODY = {
  videos: [
    {
      videoId: "v1",
      title: "Easter",
      snippet: "Easter video.",
      slug: "easter",
      imageUrl: null,
    },
  ],
}

describe("searchVideosViaAdmin", () => {
  it("short-circuits to config_missing (base_url_missing) when the base URL is unset", async () => {
    const fetchImpl = vi.fn()
    const result = await searchVideosViaAdmin(
      { q: "x", locale: "en" },
      { config: { ...CONFIG, baseUrl: undefined }, fetchImpl },
    )
    expect(result).toEqual({
      ok: false,
      reason: "config_missing",
      retryable: false,
      detail: "base_url_missing",
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("short-circuits to config_missing (api_key_missing) when the key is unset", async () => {
    const result = await searchVideosViaAdmin(
      { q: "x", locale: "en" },
      { config: { ...CONFIG, apiKey: undefined }, fetchImpl: vi.fn() },
    )
    expect(result).toMatchObject({
      ok: false,
      reason: "config_missing",
      detail: "api_key_missing",
    })
  })

  it("returns ssrf_blocked (no fetch) when the base host is not in the allowlist", async () => {
    const fetchImpl = vi.fn()
    const result = await searchVideosViaAdmin(
      { q: "easter", locale: "en" },
      { config: { ...CONFIG, allowedHosts: "trusted.example" }, fetchImpl },
    )
    expect(result).toMatchObject({ ok: false, reason: "ssrf_blocked" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("proceeds when the base host IS in the allowlist", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, VIDEOS_BODY))
    const result = await searchVideosViaAdmin(
      { q: "easter", locale: "en" },
      { config: { ...CONFIG, allowedHosts: "admin.example" }, fetchImpl },
    )
    expect(result).toMatchObject({ ok: true })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("posts to the search-videos endpoint with a Bearer and returns the parsed data", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, VIDEOS_BODY))
    const result = await searchVideosViaAdmin(
      { q: "easter", locale: "en", limit: 5 },
      { config: CONFIG, fetchImpl },
    )
    expect(result).toEqual({ ok: true, data: VIDEOS_BODY })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(String(url)).toBe(
      "https://admin.example/api/internal/agent-tools/search-videos",
    )
    expect((init as RequestInit).redirect).toBe("error")
    expect(
      (init as RequestInit).headers as Record<string, string>,
    ).toMatchObject({ authorization: "Bearer svc-key" })
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      q: "easter",
      locale: "en",
      limit: 5,
    })
  })

  it("maps 401/403 to auth_failed", async () => {
    for (const status of [401, 403]) {
      const result = await searchVideosViaAdmin(
        { q: "x", locale: "en" },
        {
          config: CONFIG,
          fetchImpl: vi.fn().mockResolvedValue(jsonResponse(status, {})),
        },
      )
      expect(result).toMatchObject({
        ok: false,
        reason: "auth_failed",
        retryable: false,
      })
    }
  })

  it("maps 429 to rate_limited (retryable)", async () => {
    const result = await searchVideosViaAdmin(
      { q: "x", locale: "en" },
      {
        config: CONFIG,
        fetchImpl: vi.fn().mockResolvedValue(jsonResponse(429, {})),
      },
    )
    expect(result).toMatchObject({
      ok: false,
      reason: "rate_limited",
      retryable: true,
    })
  })

  it("maps 5xx to network_error (retryable) and 4xx to rejected (not retryable)", async () => {
    const five = await searchVideosViaAdmin(
      { q: "x", locale: "en" },
      {
        config: CONFIG,
        fetchImpl: vi.fn().mockResolvedValue(jsonResponse(503, {})),
      },
    )
    expect(five).toMatchObject({
      ok: false,
      reason: "network_error",
      retryable: true,
    })
    const four = await searchVideosViaAdmin(
      { q: "x", locale: "en" },
      {
        config: CONFIG,
        fetchImpl: vi.fn().mockResolvedValue(jsonResponse(400, {})),
      },
    )
    expect(four).toMatchObject({
      ok: false,
      reason: "rejected",
      retryable: false,
    })
  })

  it("classifies a TimeoutError as timeout (retryable) and a generic throw as network_error", async () => {
    const timeout = await searchVideosViaAdmin(
      { q: "x", locale: "en" },
      {
        config: CONFIG,
        fetchImpl: vi
          .fn()
          .mockRejectedValue(
            Object.assign(new Error("timed out"), { name: "TimeoutError" }),
          ),
      },
    )
    expect(timeout).toMatchObject({
      ok: false,
      reason: "timeout",
      retryable: true,
    })
    const network = await searchVideosViaAdmin(
      { q: "x", locale: "en" },
      {
        config: CONFIG,
        fetchImpl: vi.fn().mockRejectedValue(new Error("ECONNRESET")),
      },
    )
    expect(network).toMatchObject({
      ok: false,
      reason: "network_error",
      retryable: true,
    })
  })

  it("returns parse_error when a 200 body has the wrong shape", async () => {
    const result = await searchVideosViaAdmin(
      { q: "x", locale: "en" },
      {
        config: CONFIG,
        fetchImpl: vi.fn().mockResolvedValue(jsonResponse(200, { wat: true })),
      },
    )
    expect(result).toMatchObject({ ok: false, reason: "parse_error" })
  })
})

// ===========================================================================
// feat-327: widened row schema (plan P5) + byte-capped read
// ===========================================================================

describe("searchVideosViaAdmin — widened row schema (feat-327, plan P5)", () => {
  it("parses the full post-feat-326 row, carrying playback fields and availability through", async () => {
    const body = {
      videos: [
        {
          videoId: "v1",
          title: "Jesus calms the storm",
          snippet: "He rebukes the wind.",
          slug: "jesus-calms-the-storm",
          imageUrl: null,
          playbackId: "abc123DEF456",
          durationSeconds: 372,
          languageSlug: "english",
          availability: { kind: "target_audio", languageSlug: "english" },
        },
      ],
    }
    const result = await searchVideosViaAdmin(
      { q: "storm", locale: "en" },
      {
        config: CONFIG,
        fetchImpl: vi.fn().mockResolvedValue(jsonResponse(200, body)),
      },
    )
    // toStrictEqual: the parse must neither drop nor synthesize a field.
    expect(result).toStrictEqual({ ok: true, data: body })
  })

  it("tolerates a PRE-widening admin response (no playback fields, no availability)", async () => {
    // Plan P5: the deploy order is mastra-then-admin-flip, so an admin that
    // predates #1789/feat-326 must still validate rather than collapsing the
    // whole tool to parse_error.
    const result = await searchVideosViaAdmin(
      { q: "x", locale: "en" },
      {
        config: CONFIG,
        fetchImpl: vi.fn().mockResolvedValue(jsonResponse(200, VIDEOS_BODY)),
      },
    )
    expect(result).toStrictEqual({ ok: true, data: VIDEOS_BODY })
  })

  it("parses an UNKNOWN availability kind rather than failing the parse (tolerant string, not a closed enum)", async () => {
    // The discriminating case for P5: a closed enum here would turn a future
    // admin vocabulary change into an empty tool result for EVERY row, instead
    // of fail-closing only the unknown ones at the seeker tool's filter.
    const body = {
      videos: [
        {
          videoId: "v9",
          title: "Future",
          snippet: "...",
          slug: "future",
          imageUrl: null,
          playbackId: "playback9abc",
          durationSeconds: null,
          languageSlug: null,
          availability: { kind: "some_future_kind", languageSlug: null },
        },
      ],
    }
    const result = await searchVideosViaAdmin(
      { q: "x", locale: "en" },
      {
        config: CONFIG,
        fetchImpl: vi.fn().mockResolvedValue(jsonResponse(200, body)),
      },
    )
    expect(result).toStrictEqual({ ok: true, data: body })
  })
})

describe("byte-capped response read (feat-327)", () => {
  /**
   * A FINITE body: every chunk is enqueued and the stream closes immediately.
   * Used for the under-cap cases, where `cancel()` must NOT fire.
   */
  function streamingResponse(chunks: Uint8Array[]): {
    response: Response
    cancelled: () => boolean
  } {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
      cancel() {
        cancelled = true
      },
    })
    return {
      response: new Response(stream, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      cancelled: () => cancelled,
    }
  }

  /**
   * An ENDLESS body — the misbehaving upstream this guard exists for: it keeps
   * producing and never closes, so only an abort stops it. Tests the MECHANISM:
   * `cancel()` flips the flag, and an implementation that merely stopped
   * reading (leaving the socket filling the heap) would leave it false.
   *
   * The 1,000-chunk trip wire keeps a broken guard from hanging the suite: it
   * errors the stream instead, which lands on the graceful path with
   * `cancelled` still false — a failure, not a timeout.
   *
   * NOTE for future edits: a finite stream that has already CLOSED cannot show
   * this. Per the streams spec, `reader.cancel()` on a closed stream returns
   * without invoking the source's cancel algorithm, so the eager fixture above
   * would report `cancelled === false` no matter how correct the guard is.
   */
  function endlessResponse(chunkBytes: number): {
    response: Response
    cancelled: () => boolean
    chunksServed: () => number
  } {
    let cancelled = false
    let served = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        served += 1
        if (served > 1_000) {
          controller.error(new Error("byte cap never aborted the read"))
          return
        }
        controller.enqueue(new Uint8Array(chunkBytes))
      },
      cancel() {
        cancelled = true
      },
    })
    return {
      response: new Response(stream, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      cancelled: () => cancelled,
      chunksServed: () => served,
    }
  }

  it("cancels the reader and degrades to parse_error when the body exceeds the cap", async () => {
    const { response, cancelled, chunksServed } = endlessResponse(64)
    const result = await searchVideosViaAdmin(
      { q: "x", locale: "en" },
      {
        config: { ...CONFIG, maxResponseBytes: 100 },
        fetchImpl: vi.fn().mockResolvedValue(response),
      },
    )
    // Over-cap rides the EXISTING graceful path — no new failure reason.
    expect(result).toMatchObject({ ok: false, reason: "parse_error" })
    // The mechanism: the underlying stream was ABORTED, not merely abandoned.
    expect(cancelled()).toBe(true)
    // ...and it aborted at the cap, not after draining an unbounded upstream.
    expect(chunksServed()).toBeLessThan(10)
  })

  it("reads a body that fits under the cap normally (anti-vacuous companion)", async () => {
    const encoded = new TextEncoder().encode(JSON.stringify(VIDEOS_BODY))
    const { response, cancelled } = streamingResponse([encoded])
    const result = await searchVideosViaAdmin(
      { q: "x", locale: "en" },
      {
        config: { ...CONFIG, maxResponseBytes: encoded.byteLength + 1 },
        fetchImpl: vi.fn().mockResolvedValue(response),
      },
    )
    expect(result).toStrictEqual({ ok: true, data: VIDEOS_BODY })
    expect(cancelled()).toBe(false)
  })

  it("reassembles a body split across chunk boundaries (multi-byte-safe)", async () => {
    // A single TextDecoder().decode() over the MERGED buffer is what makes a
    // UTF-8 sequence straddling a chunk boundary safe; per-chunk decoding would
    // corrupt it. Non-Latin titles are ordinary in this catalog.
    const body = {
      videos: [
        {
          videoId: "v1",
          title: "イエスは嵐を静める",
          snippet: "風をしかりつけられた。",
          slug: "jesus-calms-the-storm",
          imageUrl: null,
        },
      ],
    }
    const encoded = new TextEncoder().encode(JSON.stringify(body))
    const mid = Math.floor(encoded.byteLength / 2)
    const { response } = streamingResponse([
      encoded.slice(0, mid),
      encoded.slice(mid),
    ])
    const result = await searchVideosViaAdmin(
      { q: "x", locale: "en" },
      {
        config: { ...CONFIG, maxResponseBytes: 1_000_000 },
        fetchImpl: vi.fn().mockResolvedValue(response),
      },
    )
    expect(result).toStrictEqual({ ok: true, data: body })
  })

  it("accepts a body of EXACTLY maxResponseBytes and aborts at one byte over", async () => {
    // Pins the `>` vs `>=` boundary. Without both halves, a cap that rejected
    // exactly-at-limit payloads (or accepted one byte over) passes every other
    // test in this file.
    const body = JSON.stringify(VIDEOS_BODY)
    const exact = new TextEncoder().encode(body)

    const atCap = streamingResponse([exact])
    await expect(
      searchVideosViaAdmin(
        { q: "x", locale: "en" },
        {
          config: { ...CONFIG, maxResponseBytes: exact.byteLength },
          fetchImpl: vi.fn().mockResolvedValue(atCap.response),
        },
      ),
    ).resolves.toStrictEqual({ ok: true, data: VIDEOS_BODY })
    expect(atCap.cancelled()).toBe(false)

    const overCap = endlessResponse(exact.byteLength + 1)
    const over = await searchVideosViaAdmin(
      { q: "x", locale: "en" },
      {
        config: { ...CONFIG, maxResponseBytes: exact.byteLength },
        fetchImpl: vi.fn().mockResolvedValue(overCap.response),
      },
    )
    expect(over).toMatchObject({ ok: false, reason: "parse_error" })
    expect(overCap.cancelled()).toBe(true)
  })

  it("default-source pin: the real config carries a concrete byte cap to the client", async () => {
    // Every other test in this file INJECTS a config, so none of them would
    // notice if `maxResponseBytes` stopped being projected by
    // getAdminAgentToolsConfig() — the read would silently become
    // `undefined`, and `total > undefined` is always false: the OOM guard
    // would be off in production with the suite green.
    const { getAdminAgentToolsConfig } = await import("../config/env")
    expect(getAdminAgentToolsConfig().maxResponseBytes).toBeGreaterThan(0)
  })

  it("degrades a body-less 200 to parse_error without throwing", async () => {
    const result = await searchVideosViaAdmin(
      { q: "x", locale: "en" },
      {
        config: CONFIG,
        fetchImpl: vi
          .fn()
          .mockResolvedValue(new Response(null, { status: 200 })),
      },
    )
    expect(result).toMatchObject({ ok: false, reason: "parse_error" })
  })
})

describe("lookupBibleVerseViaAdmin", () => {
  it("posts to the lookup-bible-verse endpoint and returns parsed books", async () => {
    const body = {
      books: [
        {
          bookId: "b1",
          osisId: "John",
          displayName: "John",
          testament: "NT",
          order: 43,
        },
      ],
    }
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, body))
    const result = await lookupBibleVerseViaAdmin(
      { query: "John" },
      { config: CONFIG, fetchImpl },
    )
    expect(result).toEqual({ ok: true, data: body })
    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      "https://admin.example/api/internal/agent-tools/lookup-bible-verse",
    )
  })
})

describe("fetchVideoImageViaAdmin", () => {
  it("posts to the fetch-video-image endpoint and returns parsed image", async () => {
    const body = {
      imageUrl: "https://cdn/hero.png",
      variant: "mobileCinematicHigh",
    }
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, body))
    const result = await fetchVideoImageViaAdmin(
      { videoId: "v1" },
      { config: CONFIG, fetchImpl },
    )
    expect(result).toEqual({ ok: true, data: body })
    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      "https://admin.example/api/internal/agent-tools/fetch-video-image",
    )
  })
})
