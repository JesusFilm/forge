import { afterEach, describe, expect, it, vi } from "vitest"

import type { SeekerGateDecision } from "@/lib/seeker-gate"

import {
  buildHistoryProxyConfig,
  composeHistoryTimeoutMs,
  handleHistoryListProxyRequest,
  handleHistoryThreadProxyRequest,
  HISTORY_LIST_MAX_RESPONSE_BYTES,
  HISTORY_READ_TIMEOUT_CEILING_MS,
  HISTORY_READ_TIMEOUT_FLOOR_MS,
  resolveHistoryResource,
  type HistoryProxyConfig,
  type HistoryProxyHandlerInput,
} from "./history-proxy"

const OWNER = "user:sub-1"
const GRANTED: SeekerGateDecision = { seekerEnabled: true, outcome: "granted" }
const DENIED: SeekerGateDecision = {
  seekerEnabled: false,
  outcome: "not_allowlisted",
}

const BASE_CONFIG: HistoryProxyConfig = {
  baseUrl: "https://mastra.internal",
  apiKey: "lane-key",
  allowedHosts: undefined,
  requireAllowlist: false,
  timeoutMs: 5000,
}

function jsonUpstream(status: number, body: unknown): typeof fetch {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
}

type CoreInput = Partial<HistoryProxyHandlerInput>

function runList(over: CoreInput = {}): Promise<Response> {
  return handleHistoryListProxyRequest({
    readJson: async () => ({ page: 0 }),
    config: BASE_CONFIG,
    resolveGate: () => Promise.resolve(GRANTED),
    resolveResource: () => OWNER,
    fetchImpl: jsonUpstream(200, {
      threads: [],
      page: 0,
      perPage: 20,
      total: 0,
      hasMore: false,
    }),
    ...over,
  })
}

function runThread(over: CoreInput = {}): Promise<Response> {
  return handleHistoryThreadProxyRequest({
    readJson: async () => ({ conversationId: "conv-1" }),
    config: BASE_CONFIG,
    resolveGate: () => Promise.resolve(GRANTED),
    resolveResource: () => OWNER,
    fetchImpl: jsonUpstream(200, { messages: [] }),
    ...over,
  })
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("history proxy — body validation", () => {
  it.each([
    ["non-object body", "not-json"],
    ["null body", null],
    ["non-number page", { page: "1" }],
    ["negative page", { page: -1 }],
    ["non-integer page", { page: 0.5 }],
  ])("list rejects %s with 400 invalid_body", async (_label, raw) => {
    const fetchSpy = vi.fn()
    const res = await runList({
      readJson: async () => raw,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })
    expect(res.status).toBe(400)
    expect(await bodyOf(res)).toEqual({ reason: "invalid_body" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it.each([
    ["missing conversationId", {}],
    ["empty conversationId", { conversationId: "" }],
    ["over-length conversationId", { conversationId: "x".repeat(201) }],
    ["non-string conversationId", { conversationId: 7 }],
  ])("thread rejects %s with 400 invalid_body", async (_label, raw) => {
    const fetchSpy = vi.fn()
    const res = await runThread({
      readJson: async () => raw,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })
    expect(res.status).toBe(400)
    expect(await bodyOf(res)).toEqual({ reason: "invalid_body" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("rejects an unparseable body with 400", async () => {
    const res = await runList({
      readJson: async () => {
        throw new Error("bad json")
      },
    })
    expect(res.status).toBe(400)
  })
})

describe("history proxy — session + gate ladder (AE3/AE5/AE2)", () => {
  it("returns 401 invalid_session when no user resource resolves; gate and upstream never touched", async () => {
    for (const route of [runList, runThread]) {
      const gateSpy = vi.fn(async () => GRANTED)
      const fetchSpy = vi.fn()
      const res = await route({
        resolveResource: () => null,
        resolveGate: gateSpy,
        fetchImpl: fetchSpy as unknown as typeof fetch,
      })
      expect(res.status).toBe(401)
      expect(await bodyOf(res)).toEqual({ reason: "invalid_session" })
      expect(gateSpy).not.toHaveBeenCalled()
      expect(fetchSpy).not.toHaveBeenCalled()
    }
  })

  it("returns 403 gate_denied on a gate deny; upstream never called; gate resolved per request", async () => {
    const gateSpy = vi.fn(async () => DENIED)
    const fetchSpy = vi.fn()
    for (const route of [runList, runThread]) {
      const res = await route({
        resolveGate: gateSpy,
        fetchImpl: fetchSpy as unknown as typeof fetch,
      })
      expect(res.status).toBe(403)
      expect(await bodyOf(res)).toEqual({ reason: "gate_denied" })
    }
    expect(gateSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe("history proxy — resource is session-derived only (AE10, R5)", () => {
  it("ignores client-supplied resource fields; the upstream body carries only the session resource", async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body)) as unknown,
      })
      return new Response(JSON.stringify({ threads: [] }), { status: 200 })
    }
    await runList({
      readJson: async () => ({
        page: 3,
        resourceId: "user:attacker",
        resource: "anon:evil",
      }),
      fetchImpl,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(
      "https://mastra.internal/forge-ai-chat-history-list",
    )
    expect(calls[0]!.body).toEqual({ resourceId: OWNER, page: 3 })
  })

  it("forwards the conversation id as the upstream threadId with the session resource", async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body)) as unknown,
      })
      return new Response(JSON.stringify({ messages: [] }), { status: 200 })
    }
    await runThread({
      readJson: async () => ({
        conversationId: "conv-9",
        resourceId: "user:attacker",
      }),
      fetchImpl,
    })
    expect(calls[0]!.url).toBe(
      "https://mastra.internal/forge-ai-chat-history-replay",
    )
    expect(calls[0]!.body).toEqual({ resourceId: OWNER, threadId: "conv-9" })
  })
})

describe("history proxy — config + SSRF guard (AE11)", () => {
  it("refuses when the lane bearer is unset, without any upstream call", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const fetchSpy = vi.fn()
    const res = await runList({
      config: { ...BASE_CONFIG, apiKey: undefined },
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })
    expect(res.status).toBe(502)
    expect(await bodyOf(res)).toEqual({ reason: "unavailable" })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(warn.mock.calls.flat().join("\n")).toContain("reason=config_missing")
  })

  it("refuses an http: non-loopback base URL without an upstream call", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const fetchSpy = vi.fn()
    const res = await runThread({
      config: { ...BASE_CONFIG, baseUrl: "http://mastra.example.com" },
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })
    expect(res.status).toBe(502)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(warn.mock.calls.flat().join("\n")).toContain("reason=ssrf_blocked")
  })

  // Wiring case for the production egress pin — the cores must thread
  // config.requireAllowlist into the guard, not just the send path.
  it("refuses when requireAllowlist is set and the allowlist is unset", async () => {
    const fetchSpy = vi.fn()
    const res = await runList({
      config: {
        ...BASE_CONFIG,
        allowedHosts: undefined,
        requireAllowlist: true,
      },
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })
    expect(res.status).toBe(502)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // Anti-vacuous companion: a correctly pinned host must still be admitted.
  it("admits a listed host under requireAllowlist → 200", async () => {
    const res = await runList({
      config: {
        ...BASE_CONFIG,
        allowedHosts: "mastra.internal",
        requireAllowlist: true,
      },
    })
    expect(res.status).toBe(200)
  })

  it("refuses a non-allowlisted host when an allowlist is set", async () => {
    const fetchSpy = vi.fn()
    const res = await runList({
      config: { ...BASE_CONFIG, allowedHosts: "other.internal" },
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })
    expect(res.status).toBe(502)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // Wiring case for the PROD transport shape (label-boundary matrix lives in
  // lib/server/mastra-upstream's unit suite): the history proxy must keep
  // admitting an http *.railway.internal base end-to-end.
  it("allows an http *.railway.internal base URL (prod transport wiring) → 200", async () => {
    const res = await runList({
      config: {
        ...BASE_CONFIG,
        baseUrl: "http://example-service.railway.internal:4111",
      },
    })
    expect(res.status).toBe(200)
  })

  it("maps a hanging upstream to 504 timeout within the configured budget", async () => {
    const fetchImpl: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        )
      })
    const res = await runList({
      config: { ...BASE_CONFIG, timeoutMs: 20 },
      fetchImpl,
    })
    expect(res.status).toBe(504)
    expect(await bodyOf(res)).toEqual({ reason: "timeout" })
  })

  it("maps a transport failure to 502 unavailable", async () => {
    const res = await runList({
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED")
      },
    })
    expect(res.status).toBe(502)
    expect(await bodyOf(res)).toEqual({ reason: "unavailable" })
  })

  // Pins the Correction 3 fold: the shared classifier's "cancelled" outcome
  // (caller aborted, budget idle) folds into 502 unavailable here — history
  // never surfaces a distinct caller-abort status, and never 504.
  it("maps a caller-abort during fetch to 502 unavailable (cancelled fold)", async () => {
    const caller = new AbortController()
    const fetchImpl: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        )
        caller.abort()
      })
    const res = await runList({ requestSignal: caller.signal, fetchImpl })
    expect(res.status).toBe(502)
    expect(await bodyOf(res)).toEqual({ reason: "unavailable" })
  })
})

describe("history proxy — upstream status classification (KTD8)", () => {
  it("classifies statuses before any body parse; JSON error bodies never become success payloads", async () => {
    const cases: Array<[number, unknown, number, string]> = [
      [401, { error: "Service bearer required" }, 502, "unavailable"],
      [400, { reason: "invalid_body" }, 502, "unavailable"],
      [403, { reason: "resource_forbidden" }, 502, "unavailable"],
      [500, { reason: "store_failed" }, 502, "unavailable"],
      [503, { error: "unavailable" }, 502, "unavailable"],
      [504, { reason: "timeout" }, 504, "timeout"],
    ]
    for (const [status, upstreamBody, expectedStatus, reason] of cases) {
      const res = await runThread({
        fetchImpl: jsonUpstream(status, upstreamBody),
      })
      expect(res.status).toBe(expectedStatus)
      expect(await bodyOf(res)).toEqual({ reason })
    }
  })

  it("passes thread_forbidden through only when the upstream body carries it", async () => {
    const res = await runThread({
      fetchImpl: jsonUpstream(403, { reason: "thread_forbidden" }),
    })
    expect(res.status).toBe(403)
    expect(await bodyOf(res)).toEqual({ reason: "thread_forbidden" })
  })

  it("passes thread_not_found through only when the upstream body carries it", async () => {
    const res = await runThread({
      fetchImpl: jsonUpstream(404, { reason: "thread_not_found" }),
    })
    expect(res.status).toBe(404)
    expect(await bodyOf(res)).toEqual({ reason: "thread_not_found" })
  })

  it("maps a reasonless 404 (the flag-off shape) to unavailable — never the no-longer-available state", async () => {
    const res = await runThread({
      fetchImpl: jsonUpstream(404, { error: "Not found" }),
    })
    expect(res.status).toBe(502)
    expect(await bodyOf(res)).toEqual({ reason: "unavailable" })
  })
})

describe("history proxy — byte cap (OOM guard)", () => {
  it("aborts the read past the cap via reader.cancel and maps to unavailable, never logging the error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    let cancelled = false
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(256 * 1024))
      },
      cancel() {
        cancelled = true
      },
    })
    const res = await runList({
      fetchImpl: async () => new Response(endless, { status: 200 }),
    })
    expect(res.status).toBe(502)
    expect(await bodyOf(res)).toEqual({ reason: "unavailable" })
    expect(cancelled).toBe(true)
    // Enum-only log lines: no parse/transport error text ever reaches logs.
    for (const line of warn.mock.calls.flat()) {
      expect(String(line)).toMatch(/^\[history-proxy\] event=\w+ reason=\w+$/)
    }
  })

  it("maps a stalled 200 body to 504 timeout once the read budget aborts", async () => {
    // The fetch succeeds, then the body never completes (under the byte cap)
    // — the read race must settle on the budget side as a clean timeout.
    const stalled = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"threads": ['))
        // never closes
      },
    })
    const res = await runList({
      config: { ...BASE_CONFIG, timeoutMs: 30 },
      fetchImpl: async () => new Response(stalled, { status: 200 }),
    })
    expect(res.status).toBe(504)
    expect(await bodyOf(res)).toEqual({ reason: "timeout" })
  })

  it("maps malformed upstream JSON to unavailable without logging the parse error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const res = await runList({
      fetchImpl: async () =>
        new Response('{"threads": [BROKEN_JSON_SECRET', { status: 200 }),
    })
    expect(res.status).toBe(502)
    expect(warn.mock.calls.flat().join("\n")).not.toContain(
      "BROKEN_JSON_SECRET",
    )
  })
})

describe("history proxy — happy paths", () => {
  it("forwards the listing page verbatim (projection is server-side)", async () => {
    const page = {
      threads: [
        {
          id: "t1",
          title: "Faith and doubt",
          updatedAt: "2026-07-12T08:00:00.000Z",
        },
        { id: "t2", title: "", updatedAt: "2026-07-10T08:00:00.000Z" },
      ],
      page: 0,
      perPage: 20,
      total: 2,
      hasMore: false,
    }
    const res = await runList({ fetchImpl: jsonUpstream(200, page) })
    expect(res.status).toBe(200)
    expect(await bodyOf(res)).toEqual(page)
  })

  it("forwards the replay transcript verbatim", async () => {
    const transcript = {
      messages: [
        {
          id: "m1",
          role: "user",
          text: "hello",
          createdAt: "2026-07-10T10:00:00.000Z",
        },
        {
          id: "m2",
          role: "assistant",
          text: "hi",
          createdAt: "2026-07-10T10:00:05.000Z",
        },
      ],
    }
    const res = await runThread({ fetchImpl: jsonUpstream(200, transcript) })
    expect(res.status).toBe(200)
    expect(await bodyOf(res)).toEqual(transcript)
  })
})

describe("history proxy — log confidentiality (KTD13)", () => {
  it("never logs conversation ids, titles, or upstream body fragments", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    await runThread({
      readJson: async () => ({ conversationId: "SECRET-conversation-id" }),
      fetchImpl: jsonUpstream(403, {
        reason: "thread_forbidden",
        title: "SECRET-title",
      }),
    })
    const logged = [...warn.mock.calls.flat(), ...log.mock.calls.flat()].join(
      "\n",
    )
    expect(logged).not.toContain("SECRET")
    for (const line of warn.mock.calls.flat()) {
      expect(String(line)).toMatch(/^\[history-proxy\] event=\w+ reason=\w+$/)
    }
  })
})

describe("history proxy — config builder + resource resolution", () => {
  it("caps the read budget at the 10s ceiling (never the 95s generation timeout)", () => {
    const config = buildHistoryProxyConfig()
    expect(config.timeoutMs).toBeLessThanOrEqual(
      HISTORY_READ_TIMEOUT_CEILING_MS,
    )
    expect(config.timeoutMs).toBeGreaterThanOrEqual(
      HISTORY_READ_TIMEOUT_FLOOR_MS,
    )
  })

  it("clamps the send-path timeout into [floor, ceiling] — a lowered SEEKER_TIMEOUT_MS cannot invert the ladder", () => {
    // Below the floor: the send-path escape hatch must not drag the history
    // budget under Mastra's 8s historyRead (outbound-timeout ordering).
    expect(composeHistoryTimeoutMs(5_000)).toBe(HISTORY_READ_TIMEOUT_FLOOR_MS)
    // In the window: passes through.
    expect(composeHistoryTimeoutMs(9_500)).toBe(9_500)
    // Above the ceiling (the default 95s): capped.
    expect(composeHistoryTimeoutMs(95_000)).toBe(
      HISTORY_READ_TIMEOUT_CEILING_MS,
    )
    // The window itself sits strictly above the mastra route budget.
    expect(HISTORY_READ_TIMEOUT_FLOOR_MS).toBeGreaterThan(8_000)
  })

  it("resolves user resources only; anonymous and blank-sub identities yield null", () => {
    expect(resolveHistoryResource(null)).toBeNull()
    expect(resolveHistoryResource({ sub: "  " })).toBeNull()
    expect(resolveHistoryResource({ sub: "auth0|abc" })).toBe("user:auth0|abc")
  })

  it("exposes a list byte cap sized for pages, below the thread cap", () => {
    expect(HISTORY_LIST_MAX_RESPONSE_BYTES).toBe(2 * 1024 * 1024)
  })
})
