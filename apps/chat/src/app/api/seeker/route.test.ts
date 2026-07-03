import { describe, expect, it, vi } from "vitest"

import { handleSeekerProxyRequest, type SeekerProxyConfig } from "./route"
import { encodeSseFrame, readSseStream } from "@/lib/sse"

const BASE_CONFIG: SeekerProxyConfig = {
  enabled: true,
  baseUrl: "https://mastra.internal",
  apiKey: "svc-key",
  allowedHosts: undefined,
  timeoutMs: 95000,
}

// An upstream Response whose body streams the given SSE frames.
function upstream(
  frames: Array<{ event: string; data: unknown }>,
  status = 200,
): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) {
        controller.enqueue(encoder.encode(encodeSseFrame(f.event, f.data)))
      }
      controller.close()
    },
  })
  return new Response(body, {
    status,
    headers: { "content-type": "text/event-stream" },
  })
}

// Drain the proxy's own SSE response into a frame list.
async function proxyFrames(
  response: Response,
): Promise<Array<{ event: string; data: unknown }>> {
  const frames: Array<{ event: string; data: unknown }> = []
  if (response.body == null) return frames
  await readSseStream(response.body, (event, data) =>
    frames.push({ event, data }),
  )
  return frames
}

function readJson(body: unknown) {
  return () => Promise.resolve(body)
}

describe("handleSeekerProxyRequest — body validation", () => {
  it("returns 400 JSON (not SSE) on a malformed body, with no fetch", async () => {
    const fetchImpl = vi.fn()
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "" }),
      config: BASE_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(res.status).toBe(400)
    expect(res.headers.get("content-type")).toContain("application/json")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("rejects an over-length prompt with 400 and no fetch", async () => {
    const fetchImpl = vi.fn()
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "x".repeat(8001), conversationId: "c1" }),
      config: BASE_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(res.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("rejects an over-length conversationId with 400 and no fetch", async () => {
    const fetchImpl = vi.fn()
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "x".repeat(201) }),
      config: BASE_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(res.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe("handleSeekerProxyRequest — gates", () => {
  it("flag off → config_missing error frame, no fetch", async () => {
    const fetchImpl = vi.fn()
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: { ...BASE_CONFIG, enabled: false },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(res.status).toBe(200)
    expect(await proxyFrames(res)).toEqual([
      { event: "error", data: { reason: "config_missing" } },
    ])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("SSRF: base host not in allowlist → ssrf_blocked, no fetch", async () => {
    const fetchImpl = vi.fn()
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: { ...BASE_CONFIG, allowedHosts: "trusted.internal" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await proxyFrames(res)).toEqual([
      { event: "error", data: { reason: "ssrf_blocked" } },
    ])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("rejects a non-https base URL (bearer-in-cleartext guard) → ssrf_blocked", async () => {
    const fetchImpl = vi.fn()
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: { ...BASE_CONFIG, baseUrl: "http://mastra.internal" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await proxyFrames(res)).toEqual([
      { event: "error", data: { reason: "ssrf_blocked" } },
    ])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("allows http for a loopback base URL (local dev) → fetch proceeds", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      upstream([
        {
          event: "result",
          data: { text: "ok", sources: [], grounded: false },
        },
      ]),
    )
    await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: { ...BASE_CONFIG, baseUrl: "http://localhost:4111" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("SSRF: loopback http base host NOT in a set allowlist → ssrf_blocked", async () => {
    const fetchImpl = vi.fn()
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: {
        ...BASE_CONFIG,
        baseUrl: "http://localhost:4111",
        allowedHosts: "trusted.internal",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await proxyFrames(res)).toEqual([
      { event: "error", data: { reason: "ssrf_blocked" } },
    ])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("SSRF: loopback http base host IN the allowlist → fetch proceeds", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      upstream([
        {
          event: "result",
          data: { text: "ok", sources: [], grounded: false },
        },
      ]),
    )
    await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: {
        ...BASE_CONFIG,
        baseUrl: "http://localhost:4111",
        allowedHosts: "localhost",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("allows http for a bracketed IPv6 loopback base URL → fetch proceeds", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      upstream([
        {
          event: "result",
          data: { text: "ok", sources: [], grounded: false },
        },
      ]),
    )
    await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: { ...BASE_CONFIG, baseUrl: "http://[::1]:4111" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("allows http for an IPv4 loopback base URL → fetch proceeds", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      upstream([
        {
          event: "result",
          data: { text: "ok", sources: [], grounded: false },
        },
      ]),
    )
    await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: { ...BASE_CONFIG, baseUrl: "http://127.0.0.1:4111" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("allows http for a *.railway.internal base URL (prod private networking) → fetch proceeds", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      upstream([
        {
          event: "result",
          data: { text: "ok", sources: [], grounded: false },
        },
      ]),
    )
    await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: {
        ...BASE_CONFIG,
        baseUrl: "http://example-service.railway.internal",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("allows http for a *.railway.internal base URL with a port → fetch proceeds", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      upstream([
        {
          event: "result",
          data: { text: "ok", sources: [], grounded: false },
        },
      ]),
    )
    await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: {
        ...BASE_CONFIG,
        baseUrl: "http://example-service.railway.internal:4111",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("rejects an http public host → ssrf_blocked, no fetch", async () => {
    const fetchImpl = vi.fn()
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: { ...BASE_CONFIG, baseUrl: "http://evil.com" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await proxyFrames(res)).toEqual([
      { event: "error", data: { reason: "ssrf_blocked" } },
    ])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("rejects http railway.internal.evil.com (suffix is a full-label match, not a substring) → ssrf_blocked", async () => {
    const fetchImpl = vi.fn()
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: { ...BASE_CONFIG, baseUrl: "http://railway.internal.evil.com" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await proxyFrames(res)).toEqual([
      { event: "error", data: { reason: "ssrf_blocked" } },
    ])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("rejects http evilrailway.internal (no dot boundary) → ssrf_blocked", async () => {
    const fetchImpl = vi.fn()
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: { ...BASE_CONFIG, baseUrl: "http://evilrailway.internal" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await proxyFrames(res)).toEqual([
      { event: "error", data: { reason: "ssrf_blocked" } },
    ])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("rejects http bare railway.internal (no leading label) → ssrf_blocked", async () => {
    const fetchImpl = vi.fn()
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: { ...BASE_CONFIG, baseUrl: "http://railway.internal" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await proxyFrames(res)).toEqual([
      { event: "error", data: { reason: "ssrf_blocked" } },
    ])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("rejects http .railway.internal (empty leading label) → ssrf_blocked", async () => {
    const fetchImpl = vi.fn()
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: { ...BASE_CONFIG, baseUrl: "http://.railway.internal" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await proxyFrames(res)).toEqual([
      { event: "error", data: { reason: "ssrf_blocked" } },
    ])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("rejects http foo..railway.internal (empty inner label) → ssrf_blocked", async () => {
    const fetchImpl = vi.fn()
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: { ...BASE_CONFIG, baseUrl: "http://foo..railway.internal" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await proxyFrames(res)).toEqual([
      { event: "error", data: { reason: "ssrf_blocked" } },
    ])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("rejects a trailing-dot FQDN railway.internal. host → ssrf_blocked (pins fail-closed)", async () => {
    const fetchImpl = vi.fn()
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: {
        ...BASE_CONFIG,
        baseUrl: "http://example-service.railway.internal.:4111",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await proxyFrames(res)).toEqual([
      { event: "error", data: { reason: "ssrf_blocked" } },
    ])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("allows http for an uppercase *.RAILWAY.INTERNAL host (parser lowercases) → fetch proceeds", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      upstream([
        {
          event: "result",
          data: { text: "ok", sources: [], grounded: false },
        },
      ]),
    )
    await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: {
        ...BASE_CONFIG,
        baseUrl: "http://EXAMPLE-SERVICE.RAILWAY.INTERNAL:4111",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("SSRF: railway.internal http base host NOT in a set allowlist → ssrf_blocked", async () => {
    const fetchImpl = vi.fn()
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: {
        ...BASE_CONFIG,
        baseUrl: "http://example-service.railway.internal:4111",
        allowedHosts: "trusted.internal",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await proxyFrames(res)).toEqual([
      { event: "error", data: { reason: "ssrf_blocked" } },
    ])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("SSRF: railway.internal http base host IN the allowlist → fetch proceeds", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      upstream([
        {
          event: "result",
          data: { text: "ok", sources: [], grounded: false },
        },
      ]),
    )
    await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: {
        ...BASE_CONFIG,
        baseUrl: "http://example-service.railway.internal:4111",
        allowedHosts: "example-service.railway.internal",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("SSRF: base host in allowlist → fetch proceeds", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      upstream([
        {
          event: "result",
          data: { text: "ok", sources: [], grounded: false },
        },
      ]),
    )
    await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: { ...BASE_CONFIG, allowedHosts: "mastra.internal" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})

describe("handleSeekerProxyRequest — relay + outbound request shape", () => {
  it("sets bearer, redirect:error, threadId, and accept on the outbound fetch", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      upstream([
        {
          event: "result",
          data: { text: "ok", sources: [], grounded: false },
        },
      ]),
    )
    await handleSeekerProxyRequest({
      readJson: readJson({ text: "hello", conversationId: "conv-7" }),
      config: BASE_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(String(url)).toBe("https://mastra.internal/forge-seeker")
    expect(init.redirect).toBe("error")
    expect(init.headers.authorization).toBe("Bearer svc-key")
    expect(init.headers.accept).toBe("text/event-stream")
    expect(JSON.parse(init.body)).toEqual({
      prompt: "hello",
      threadId: "conv-7",
    })
  })

  it("relays token_delta then result verbatim (incl. empty sources)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      upstream([
        { event: "token_delta", data: { text: "Hel" } },
        { event: "token_delta", data: { text: "lo" } },
        {
          event: "result",
          data: { text: "Hello", sources: [], grounded: true },
        },
      ]),
    )
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: BASE_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await proxyFrames(res)).toEqual([
      { event: "token_delta", data: { text: "Hel" } },
      { event: "token_delta", data: { text: "lo" } },
      { event: "result", data: { text: "Hello", sources: [], grounded: true } },
    ])
  })

  it("relays an upstream timeout error frame as timeout (not generation_failed)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        upstream([{ event: "error", data: { reason: "timeout" } }]),
      )
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: BASE_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await proxyFrames(res)).toEqual([
      { event: "error", data: { reason: "timeout" } },
    ])
  })

  it("relays an upstream generation_failed error frame", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        upstream([{ event: "error", data: { reason: "generation_failed" } }]),
      )
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: BASE_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await proxyFrames(res)).toEqual([
      { event: "error", data: { reason: "generation_failed" } },
    ])
  })

  it("upstream ends with no terminal frame → parse_error after the relayed tokens", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        upstream([{ event: "token_delta", data: { text: "partial" } }]),
      )
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: BASE_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await proxyFrames(res)).toEqual([
      { event: "token_delta", data: { text: "partial" } },
      { event: "error", data: { reason: "parse_error" } },
    ])
  })

  it("aborts the upstream after a terminal frame instead of draining a held-open connection", async () => {
    const encoder = new TextEncoder()
    let upstreamSignal: AbortSignal | undefined
    // Upstream sends `result` then never closes — only aborting the upstream
    // fetch unwinds it. The mock errors its body on abort, mirroring real fetch.
    const fetchImpl = vi.fn().mockImplementation((_url, init) => {
      const signal = (init as { signal?: AbortSignal }).signal
      upstreamSignal = signal
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              encodeSseFrame("result", {
                text: "ok",
                sources: [],
                grounded: false,
              }),
            ),
          )
          signal?.addEventListener("abort", () => {
            try {
              controller.error(new DOMException("aborted", "AbortError"))
            } catch {
              // already errored/closed
            }
          })
        },
      })
      return Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      )
    })
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: BASE_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    // Resolves promptly (proxy closed after the terminal frame) and the upstream
    // fetch was aborted rather than left draining to the budget ceiling.
    expect(await proxyFrames(res)).toEqual([
      { event: "result", data: { text: "ok", sources: [], grounded: false } },
    ])
    expect(upstreamSignal?.aborted).toBe(true)
  })
})

describe("handleSeekerProxyRequest — upstream HTTP status classification", () => {
  it("401 → auth_failed", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("nope", { status: 401 }))
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: BASE_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await proxyFrames(res)).toEqual([
      { event: "error", data: { reason: "auth_failed" } },
    ])
  })

  it("403 → auth_failed", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("forbidden", { status: 403 }))
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: BASE_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await proxyFrames(res)).toEqual([
      { event: "error", data: { reason: "auth_failed" } },
    ])
  })

  it("503 with model_key_missing body → model_key_missing (not network_error)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ reason: "model_key_missing" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    )
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: BASE_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await proxyFrames(res)).toEqual([
      { event: "error", data: { reason: "model_key_missing" } },
    ])
  })

  it("503 with an unparseable / reason-less body → config_missing", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("not json", { status: 503 }))
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: BASE_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await proxyFrames(res)).toEqual([
      { event: "error", data: { reason: "config_missing" } },
    ])
  })

  it("404 (route disabled upstream) → config_missing", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("Not found", { status: 404 }))
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: BASE_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await proxyFrames(res)).toEqual([
      { event: "error", data: { reason: "config_missing" } },
    ])
  })
})

describe("handleSeekerProxyRequest — transport failures", () => {
  it("fetch rejection → network_error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("boom"))
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: BASE_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await proxyFrames(res)).toEqual([
      { event: "error", data: { reason: "network_error" } },
    ])
  })

  it("caller-signal abort before fetch → cancelled", async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("aborted"), { name: "AbortError" }),
      )
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: BASE_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      requestSignal: controller.signal,
    })
    expect(await proxyFrames(res)).toEqual([
      { event: "error", data: { reason: "cancelled" } },
    ])
  })

  it("cancelling the proxy stream aborts the upstream fetch signal", async () => {
    let upstreamSignal: AbortSignal | undefined
    // A response whose body never closes, so the relay stays mid-read until we
    // cancel — without read()ing the proxy stream (which would block).
    const fetchImpl = vi.fn().mockImplementation((_url, init) => {
      upstreamSignal = (init as { signal?: AbortSignal }).signal
      const body = new ReadableStream<Uint8Array>({ start() {} })
      return Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      )
    })
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: BASE_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    // start() runs async — let it issue the upstream fetch before cancelling.
    for (let i = 0; i < 50 && !upstreamSignal; i++) {
      await new Promise((r) => setTimeout(r, 0))
    }
    expect(upstreamSignal).toBeDefined()
    await res.body!.cancel()
    expect(upstreamSignal?.aborted).toBe(true)
  })

  it("budget timeout → timeout (tiny injected budget)", async () => {
    const fetchImpl = vi.fn().mockImplementation((_url, init) => {
      // Reject as the composed signal fires, mimicking fetch aborting.
      return new Promise((_resolve, reject) => {
        const signal = (init as { signal?: AbortSignal }).signal
        signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("timeout"), { name: "TimeoutError" })),
        )
      })
    })
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: { ...BASE_CONFIG, timeoutMs: 5 },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await proxyFrames(res)).toEqual([
      { event: "error", data: { reason: "timeout" } },
    ])
  })
})

describe("handleSeekerProxyRequest — mid-stream read failures", () => {
  // The body errors only AFTER one token and only on the budget abort, so the
  // relay throws mid-stream with no terminal frame yet → the catch must classify
  // by the budget signal (route's mid-stream catch, distinct from the fetch catch).
  it("mid-stream throw with the budget aborted → timeout (after partial tokens)", async () => {
    const encoder = new TextEncoder()
    const fetchImpl = vi.fn().mockImplementation((_url, init) => {
      const signal = (init as { signal?: AbortSignal }).signal
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(encodeSseFrame("token_delta", { text: "hi" })),
          )
          signal?.addEventListener("abort", () => {
            try {
              controller.error(new DOMException("aborted", "AbortError"))
            } catch {
              // already errored/closed
            }
          })
        },
      })
      return Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      )
    })
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: { ...BASE_CONFIG, timeoutMs: 5 },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await proxyFrames(res)).toEqual([
      { event: "token_delta", data: { text: "hi" } },
      { event: "error", data: { reason: "timeout" } },
    ])
  })

  it("mid-stream throw with no signal aborted → network_error", async () => {
    const encoder = new TextEncoder()
    const fetchImpl = vi.fn().mockImplementation(() => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(encodeSseFrame("token_delta", { text: "hi" })),
          )
          // Defer the error a tick so the token is read+relayed first (a sync
          // error right after enqueue drops the buffered chunk).
          setTimeout(() => controller.error(new Error("socket reset")), 0)
        },
      })
      return Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      )
    })
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: BASE_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await proxyFrames(res)).toEqual([
      { event: "token_delta", data: { text: "hi" } },
      { event: "error", data: { reason: "network_error" } },
    ])
  })

  // The composed signal bounds fetch(), not a body read on an already-received
  // 503 — a never-resolving json() must still terminate via the abort race.
  it("503 whose json() outlives the budget → config_missing (abort race)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 503,
      ok: false,
      json: () => new Promise(() => {}),
      body: null,
    } as unknown as Response)
    const res = await handleSeekerProxyRequest({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: { ...BASE_CONFIG, timeoutMs: 5 },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await proxyFrames(res)).toEqual([
      { event: "error", data: { reason: "config_missing" } },
    ])
  })
})
