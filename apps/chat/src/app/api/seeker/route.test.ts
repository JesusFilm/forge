import { describe, expect, it, vi } from "vitest"

import {
  handleSeekerProxyRequest,
  type SeekerProxyConfig,
  type SeekerProxyHandlerInput,
} from "./route"
import type { SeekerGateDecision } from "@/lib/seeker-gate"
import { encodeSseFrame, readSseStream } from "@/lib/sse"

const GRANTED: SeekerGateDecision = { seekerEnabled: true, outcome: "granted" }

// Wrapper injecting the required resourceId (feat-208) and a granting gate
// resolver (feat-233) so the pre-existing suites stay focused on their own
// concern. Each has its own describe block below.
function runProxy(
  input: Omit<SeekerProxyHandlerInput, "resourceId" | "resolveGate"> & {
    resourceId?: string
    resolveGate?: SeekerProxyHandlerInput["resolveGate"]
  },
): Promise<Response> {
  return handleSeekerProxyRequest({
    resourceId: "anon:00000000-0000-4000-8000-000000000000",
    resolveGate: () => Promise.resolve(GRANTED),
    ...input,
  })
}

const BASE_CONFIG: SeekerProxyConfig = {
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
    const res = await runProxy({
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
    const res = await runProxy({
      readJson: readJson({ text: "x".repeat(8001), conversationId: "c1" }),
      config: BASE_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(res.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("rejects an over-length conversationId with 400 and no fetch", async () => {
    const fetchImpl = vi.fn()
    const res = await runProxy({
      readJson: readJson({ text: "hi", conversationId: "x".repeat(201) }),
      config: BASE_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(res.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe("handleSeekerProxyRequest — seeker gate (feat-233)", () => {
  it("AE1: a granting gate lets the request proxy upstream", async () => {
    const resolveGate = vi.fn(async (): Promise<SeekerGateDecision> => GRANTED)
    const fetchImpl = vi.fn().mockResolvedValue(
      upstream([
        {
          event: "result",
          data: { text: "ok", sources: [], grounded: false },
        },
      ]),
    )
    const res = await runProxy({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: BASE_CONFIG,
      resolveGate,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await proxyFrames(res)).toEqual([
      { event: "result", data: { text: "ok", sources: [], grounded: false } },
    ])
    expect(resolveGate).toHaveBeenCalledOnce()
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  // AE2/AE4: EVERY deny cause surfaces as the single non-probing gate_denied
  // frame (KTD2) and the upstream fetch is never issued.
  it.each(["kill_switch", "anonymous", "no_email", "not_allowlisted"] as const)(
    "deny (%s) → terminal gate_denied frame, upstream never fetched",
    async (outcome) => {
      const fetchImpl = vi.fn()
      const res = await runProxy({
        readJson: readJson({ text: "hi", conversationId: "c1" }),
        config: BASE_CONFIG,
        resolveGate: () => Promise.resolve({ seekerEnabled: false, outcome }),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
      expect(res.status).toBe(200)
      expect(await proxyFrames(res)).toEqual([
        { event: "error", data: { reason: "gate_denied" } },
      ])
      expect(fetchImpl).not.toHaveBeenCalled()
    },
  )

  it("runs AFTER body validation: malformed body → 400 JSON, gate never consulted", async () => {
    const resolveGate = vi.fn(async (): Promise<SeekerGateDecision> => GRANTED)
    const fetchImpl = vi.fn()
    const res = await runProxy({
      readJson: readJson({ text: "" }),
      config: BASE_CONFIG,
      resolveGate,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(res.status).toBe(400)
    expect(res.headers.get("content-type")).toContain("application/json")
    expect(resolveGate).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe("handleSeekerProxyRequest — gates", () => {
  // Migrated from the retired config.enabled arm (feat-233): the kill switch
  // now denies via the gate resolver; config_missing only guards baseUrl/apiKey.
  it("missing baseUrl → config_missing error frame, no fetch", async () => {
    const fetchImpl = vi.fn()
    const res = await runProxy({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: { ...BASE_CONFIG, baseUrl: undefined },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(res.status).toBe(200)
    expect(await proxyFrames(res)).toEqual([
      { event: "error", data: { reason: "config_missing" } },
    ])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("missing apiKey → config_missing error frame, no fetch", async () => {
    const fetchImpl = vi.fn()
    const res = await runProxy({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: { ...BASE_CONFIG, apiKey: undefined },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await proxyFrames(res)).toEqual([
      { event: "error", data: { reason: "config_missing" } },
    ])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("SSRF: base host not in allowlist → ssrf_blocked, no fetch", async () => {
    const fetchImpl = vi.fn()
    const res = await runProxy({
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
    const res = await runProxy({
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
    await runProxy({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: { ...BASE_CONFIG, baseUrl: "http://localhost:4111" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("SSRF: loopback http base host NOT in a set allowlist → ssrf_blocked", async () => {
    const fetchImpl = vi.fn()
    const res = await runProxy({
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
    await runProxy({
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
    await runProxy({
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
    await runProxy({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: { ...BASE_CONFIG, baseUrl: "http://127.0.0.1:4111" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  // Wiring case for the PROD transport shape, kept at the proxy level on
  // purpose: the label-boundary matrix lives in lib/server/mastra-upstream's
  // unit suite, but only this proves the proxy still admits a railway base.
  it("allows http for a *.railway.internal base URL (prod transport wiring) → fetch proceeds", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      upstream([
        {
          event: "result",
          data: { text: "ok", sources: [], grounded: false },
        },
      ]),
    )
    await runProxy({
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
    const res = await runProxy({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: { ...BASE_CONFIG, baseUrl: "http://evil.com" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await proxyFrames(res)).toEqual([
      { event: "error", data: { reason: "ssrf_blocked" } },
    ])
    expect(fetchImpl).not.toHaveBeenCalled()
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
    await runProxy({
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
    await runProxy({
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
      resourceId: "anon:00000000-0000-4000-8000-000000000000",
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
    const res = await runProxy({
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
    const res = await runProxy({
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
    const res = await runProxy({
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
    const res = await runProxy({
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
    const res = await runProxy({
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
    const res = await runProxy({
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
    const res = await runProxy({
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
    const res = await runProxy({
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
    const res = await runProxy({
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
    const res = await runProxy({
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
    const res = await runProxy({
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
    const res = await runProxy({
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
    const res = await runProxy({
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
    const res = await runProxy({
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
    const res = await runProxy({
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
    const res = await runProxy({
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
    const res = await runProxy({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: { ...BASE_CONFIG, timeoutMs: 5 },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await proxyFrames(res)).toEqual([
      { event: "error", data: { reason: "config_missing" } },
    ])
  })
})

// ===========================================================================
// feat-208 — memory resource keying, rolling anon cookie, thread-gate reasons
// ===========================================================================

describe("handleSeekerProxyRequest — resource keying (feat-208)", () => {
  it("forwards the caller-resolved resourceId verbatim in the upstream body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      upstream([
        {
          event: "result",
          data: { text: "ok", sources: [], grounded: false },
        },
      ]),
    )
    await runProxy({
      readJson: readJson({ text: "hello", conversationId: "conv-9" }),
      config: BASE_CONFIG,
      resourceId: "user:auth0|abc123",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const [, init] = fetchImpl.mock.calls[0]
    expect(JSON.parse(init.body).resourceId).toBe("user:auth0|abc123")
  })

  it("attaches the anon Set-Cookie to the SSE response (rolling reissue)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      upstream([
        {
          event: "result",
          data: { text: "ok", sources: [], grounded: false },
        },
      ]),
    )
    const res = await runProxy({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: BASE_CONFIG,
      anonSetCookie: "jfp_chat_anon_id=abc; Path=/; Max-Age=2592000; HttpOnly",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("set-cookie")).toContain("jfp_chat_anon_id=abc")
    expect(res.headers.get("content-type")).toContain("text/event-stream")
  })

  it("omits Set-Cookie when no anon cookie is being issued (signed-in path)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      upstream([
        {
          event: "result",
          data: { text: "ok", sources: [], grounded: false },
        },
      ]),
    )
    const res = await runProxy({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: BASE_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(res.headers.get("set-cookie")).toBeNull()
  })
})

describe("handleSeekerProxyRequest — thread-gate reason passthrough (feat-208)", () => {
  it.each(["thread_forbidden", "thread_limit"] as const)(
    "relays an upstream %s error frame verbatim (never generation_failed)",
    async (reason) => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(upstream([{ event: "error", data: { reason } }]))
      const res = await runProxy({
        readJson: readJson({ text: "hi", conversationId: "c1" }),
        config: BASE_CONFIG,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
      expect(await proxyFrames(res)).toEqual([
        { event: "error", data: { reason } },
      ])
    },
  )

  it("still folds unknown upstream reasons into generation_failed", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        upstream([{ event: "error", data: { reason: "some_future_reason" } }]),
      )
    const res = await runProxy({
      readJson: readJson({ text: "hi", conversationId: "c1" }),
      config: BASE_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await proxyFrames(res)).toEqual([
      { event: "error", data: { reason: "generation_failed" } },
    ])
  })
})
