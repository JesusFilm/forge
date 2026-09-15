import { afterEach, describe, expect, it, vi } from "vitest"

import type { SeekerGateDecision } from "@/lib/seeker-gate"

import {
  buildHistoryWriteProxyConfig,
  handleHistoryRenameProxyRequest,
  HISTORY_RENAME_MAX_RESPONSE_BYTES,
  MAX_RENAME_TITLE_RAW_UNITS,
} from "./write-proxy"
import {
  HISTORY_READ_TIMEOUT_CEILING_MS,
  HISTORY_READ_TIMEOUT_FLOOR_MS,
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

const RENAME_BODY = { threadId: "conv-1", title: "Faith and doubt" }

function jsonUpstream(status: number, body: unknown): typeof fetch {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
}

function textUpstream(status: number, text: string): typeof fetch {
  return async () => new Response(text, { status })
}

type CoreInput = Partial<HistoryProxyHandlerInput>

function runRename(over: CoreInput = {}): Promise<Response> {
  return handleHistoryRenameProxyRequest({
    readJson: async () => RENAME_BODY,
    config: BASE_CONFIG,
    resolveGate: () => Promise.resolve(GRANTED),
    resolveResource: () => OWNER,
    fetchImpl: jsonUpstream(200, { ok: true, title: "Faith and doubt" }),
    ...over,
  })
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

/** Capture the upstream call (URL + parsed body) and answer 200. */
function capturingUpstream(): {
  fetchImpl: typeof fetch
  calls: Array<{ url: string; body: unknown }>
} {
  const calls: Array<{ url: string; body: unknown }> = []
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body)) as unknown,
    })
    return new Response(JSON.stringify({ ok: true, title: "x" }), {
      status: 200,
    })
  }
  return { fetchImpl, calls }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("rename proxy — body validation (KTD5)", () => {
  it.each([
    ["non-object body", "not-json"],
    ["null body", null],
    ["missing threadId", { title: "t" }],
    ["empty threadId", { threadId: "", title: "t" }],
    ["non-string threadId", { threadId: 7, title: "t" }],
    ["over-bound threadId (201)", { threadId: "x".repeat(201), title: "t" }],
    ["missing title", { threadId: "conv-1" }],
    ["non-string title", { threadId: "conv-1", title: 7 }],
    [
      "over-bound raw title (1,025 units)",
      { threadId: "conv-1", title: "x".repeat(MAX_RENAME_TITLE_RAW_UNITS + 1) },
    ],
  ])("rejects %s with 400 invalid_body, no upstream call", async (_l, raw) => {
    const fetchSpy = vi.fn()
    const res = await runRename({
      readJson: async () => raw,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })
    expect(res.status).toBe(400)
    expect(await bodyOf(res)).toEqual({ reason: "invalid_body" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("admits a threadId at exactly the shared 200-char bound and a title at exactly 1,024 units", async () => {
    const { fetchImpl, calls } = capturingUpstream()
    const res = await runRename({
      readJson: async () => ({
        threadId: "x".repeat(200),
        title: "y".repeat(MAX_RENAME_TITLE_RAW_UNITS),
      }),
      fetchImpl,
    })
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
  })

  it("rejects an unparseable body with 400", async () => {
    const res = await runRename({
      readJson: async () => {
        throw new Error("bad json")
      },
    })
    expect(res.status).toBe(400)
  })
})

describe("rename proxy — session + gate ladder", () => {
  it("returns 401 invalid_session when no user resource resolves; gate and upstream never touched", async () => {
    const gateSpy = vi.fn(async () => GRANTED)
    const fetchSpy = vi.fn()
    const res = await runRename({
      resolveResource: () => null,
      resolveGate: gateSpy,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })
    expect(res.status).toBe(401)
    expect(await bodyOf(res)).toEqual({ reason: "invalid_session" })
    expect(gateSpy).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("returns 403 gate_denied on a gate deny; upstream never called", async () => {
    const fetchSpy = vi.fn()
    const res = await runRename({
      resolveGate: async () => DENIED,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })
    expect(res.status).toBe(403)
    expect(await bodyOf(res)).toEqual({ reason: "gate_denied" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // Both ride 403: the body reason is the ONLY discriminator.
  it("discriminates gate_denied from an upstream thread_forbidden by body reason", async () => {
    const denied = await runRename({ resolveGate: async () => DENIED })
    const forbidden = await runRename({
      fetchImpl: jsonUpstream(403, { reason: "thread_forbidden" }),
    })
    expect(denied.status).toBe(403)
    expect(forbidden.status).toBe(403)
    expect(await bodyOf(denied)).toEqual({ reason: "gate_denied" })
    expect(await bodyOf(forbidden)).toEqual({ reason: "thread_forbidden" })
  })
})

describe("rename proxy — resource is session-derived only (R13, resource-forgery pin)", () => {
  it("ignores a client-supplied resourceId; the upstream body carries the session resource, threadId, and title", async () => {
    const { fetchImpl, calls } = capturingUpstream()
    await runRename({
      readJson: async () => ({
        ...RENAME_BODY,
        resourceId: "user:attacker",
        resource: "anon:evil",
      }),
      fetchImpl,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(
      "https://mastra.internal/forge-ai-chat-history-rename",
    )
    expect(calls[0]!.body).toEqual({
      resourceId: OWNER,
      threadId: "conv-1",
      title: "Faith and doubt",
    })
  })

  // Anti-vacuous companion: the forwarded resource FOLLOWS the session seam,
  // so the assertion above reads a live value — not a constant that would
  // also match a proxy hard-coding OWNER.
  it("forwards a different session resource when the session seam changes", async () => {
    const { fetchImpl, calls } = capturingUpstream()
    await runRename({
      readJson: async () => ({ ...RENAME_BODY, resourceId: OWNER }),
      resolveResource: () => "user:someone-else",
      fetchImpl,
    })
    expect((calls[0]!.body as { resourceId: string }).resourceId).toBe(
      "user:someone-else",
    )
  })
})

describe("rename proxy — config + SSRF guard", () => {
  it("refuses when the lane bearer is unset, without any upstream call", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const fetchSpy = vi.fn()
    const res = await runRename({
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
    const res = await runRename({
      config: { ...BASE_CONFIG, baseUrl: "http://mastra.example.com" },
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })
    expect(res.status).toBe(502)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(warn.mock.calls.flat().join("\n")).toContain("reason=ssrf_blocked")
  })

  // Wiring case: the write core must thread config.requireAllowlist into the
  // guard exactly as the read cores do (the builder pin lives in
  // config/egress-pin-wiring.test.ts).
  it("refuses when requireAllowlist is set and the allowlist is unset", async () => {
    const fetchSpy = vi.fn()
    const res = await runRename({
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
    const res = await runRename({
      config: {
        ...BASE_CONFIG,
        allowedHosts: "mastra.internal",
        requireAllowlist: true,
      },
    })
    expect(res.status).toBe(200)
  })

  it("allows an http *.railway.internal base URL (prod transport wiring) → 200", async () => {
    const res = await runRename({
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
    const res = await runRename({
      config: { ...BASE_CONFIG, timeoutMs: 20 },
      fetchImpl,
    })
    expect(res.status).toBe(504)
    expect(await bodyOf(res)).toEqual({ reason: "timeout" })
  })

  it("maps an unreachable upstream to 502 unavailable", async () => {
    const res = await runRename({
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED")
      },
    })
    expect(res.status).toBe(502)
    expect(await bodyOf(res)).toEqual({ reason: "unavailable" })
  })
})

describe("rename proxy — upstream status classification (KTD5)", () => {
  // Per semantically-mapped status: a reason-carrying fixture relays; the
  // reasonless and non-JSON siblings map to unavailable (a status is never a
  // semantic discriminator without a body reason).
  it.each([
    [400, "invalid_title"],
    [403, "thread_forbidden"],
    [404, "thread_not_found"],
  ] as const)(
    "relays upstream %i only when the body carries %s",
    async (status, reason) => {
      const carried = await runRename({
        fetchImpl: jsonUpstream(status, { reason }),
      })
      expect(carried.status).toBe(status)
      expect(await bodyOf(carried)).toEqual({ reason })

      const reasonless = await runRename({
        fetchImpl: jsonUpstream(status, { error: "Not found" }),
      })
      expect(reasonless.status).toBe(502)
      expect(await bodyOf(reasonless)).toEqual({ reason: "unavailable" })

      const nonJson = await runRename({
        fetchImpl: textUpstream(status, "<html>nope</html>"),
      })
      expect(nonJson.status).toBe(502)
      expect(await bodyOf(nonJson)).toEqual({ reason: "unavailable" })
    },
  )

  it("never relays a foreign reason under a mapped status (400 invalid_body stays unavailable)", async () => {
    const res = await runRename({
      fetchImpl: jsonUpstream(400, { reason: "invalid_body" }),
    })
    expect(res.status).toBe(502)
    expect(await bodyOf(res)).toEqual({ reason: "unavailable" })
  })

  it("maps a reasonless 404 (route not yet deployed / flag off) to unavailable — a retryable outage, never a data claim (KTD1)", async () => {
    const res = await runRename({
      fetchImpl: jsonUpstream(404, { error: "Not found" }),
    })
    expect(res.status).toBe(502)
    expect(await bodyOf(res)).toEqual({ reason: "unavailable" })
  })

  it("classifies every other non-200 before any body parse", async () => {
    const cases: Array<[number, unknown, number, string]> = [
      [401, { error: "Service bearer required" }, 502, "unavailable"],
      [403, { reason: "resource_forbidden" }, 502, "unavailable"],
      [500, { reason: "store_failed" }, 502, "unavailable"],
      [503, { reason: "writes_disabled" }, 502, "unavailable"],
      [504, { reason: "timeout" }, 504, "timeout"],
    ]
    for (const [status, upstreamBody, expectedStatus, reason] of cases) {
      const res = await runRename({
        fetchImpl: jsonUpstream(status, upstreamBody),
      })
      expect(res.status).toBe(expectedStatus)
      expect(await bodyOf(res)).toEqual({ reason })
    }
  })
})

describe("rename proxy — success relay + byte cap", () => {
  it("relays { ok: true, title } from the upstream body (the clamped title)", async () => {
    const res = await runRename({
      fetchImpl: jsonUpstream(200, {
        ok: true,
        title: "Faith and doubt",
        extraServerField: "ignored",
      }),
    })
    expect(res.status).toBe(200)
    expect(await bodyOf(res)).toEqual({ ok: true, title: "Faith and doubt" })
  })

  it("maps a 200 whose body is not { ok: true, title: string } to 502 unavailable (never a title-less or ok:false success)", async () => {
    for (const body of [
      { ok: true },
      { ok: true, title: 7 },
      { ok: false, title: "x" },
      { title: "x" },
      [],
      "str",
    ]) {
      const res = await runRename({ fetchImpl: jsonUpstream(200, body) })
      expect(res.status).toBe(502)
      expect(await bodyOf(res)).toEqual({ reason: "unavailable" })
    }
  })

  it("aborts the read past the 4 KiB cap via reader.cancel and maps to unavailable, never logging the error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    let cancelled = false
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024))
      },
      cancel() {
        cancelled = true
      },
    })
    const res = await runRename({
      fetchImpl: async () => new Response(endless, { status: 200 }),
    })
    expect(res.status).toBe(502)
    expect(await bodyOf(res)).toEqual({ reason: "unavailable" })
    expect(cancelled).toBe(true)
    for (const line of warn.mock.calls.flat()) {
      expect(String(line)).toMatch(/^\[history-proxy\] event=\w+ reason=\w+$/)
    }
  })

  // The capped read is raced against the composed signal (undefinedOnAbort):
  // a 200 whose body stalls under the cap settles as a clean timeout, never a
  // hang past the budget.
  it("maps a stalled 200 body to 504 timeout once the budget aborts", async () => {
    const stalled = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"ok": true, "ti'))
      },
    })
    const res = await runRename({
      config: { ...BASE_CONFIG, timeoutMs: 30 },
      fetchImpl: async () => new Response(stalled, { status: 200 }),
    })
    expect(res.status).toBe(504)
    expect(await bodyOf(res)).toEqual({ reason: "timeout" })
  })

  it("sizes the cap for an echoed title, far below the read caps", () => {
    expect(HISTORY_RENAME_MAX_RESPONSE_BYTES).toBe(4 * 1024)
    // A maximal echoed title is 120 UTF-16 units ≤ 3 bytes each (the shared
    // clamp), plus a JSON envelope — comfortably inside the cap.
    const maximal = JSON.stringify({ ok: true, title: "あ".repeat(120) })
    expect(new TextEncoder().encode(maximal).byteLength).toBeLessThan(
      HISTORY_RENAME_MAX_RESPONSE_BYTES,
    )
  })
})

describe("rename proxy — log confidentiality (R15)", () => {
  it("never logs the thread id, the title, or upstream body fragments on any branch", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const raw = { threadId: "SECRET-thread-id", title: "SECRET-title" }
    const upstreams: Array<typeof fetch> = [
      jsonUpstream(200, { ok: true, title: "SECRET-title" }),
      jsonUpstream(200, { ok: true }),
      jsonUpstream(400, { reason: "invalid_title", title: "SECRET-title" }),
      jsonUpstream(403, { reason: "thread_forbidden", id: "SECRET-thread-id" }),
      jsonUpstream(404, { reason: "thread_not_found" }),
      jsonUpstream(404, { error: "SECRET-body" }),
      jsonUpstream(503, { reason: "writes_disabled" }),
      textUpstream(500, "SECRET-html"),
      async () => {
        throw new Error("SECRET-transport")
      },
    ]
    for (const fetchImpl of upstreams) {
      await runRename({ readJson: async () => raw, fetchImpl })
    }
    await runRename({ readJson: async () => raw, resolveResource: () => null })
    await runRename({
      readJson: async () => raw,
      resolveGate: async () => DENIED,
    })
    await runRename({
      readJson: async () => ({ threadId: "SECRET-thread-id" }),
    })
    const logged = [
      ...warn.mock.calls.flat(),
      ...log.mock.calls.flat(),
      ...error.mock.calls.flat(),
    ].join("\n")
    expect(logged).not.toContain("SECRET")
    for (const line of warn.mock.calls.flat()) {
      expect(String(line)).toMatch(/^\[history-proxy\] event=\w+ reason=\w+$/)
    }
  })
})

describe("rename proxy — config builder", () => {
  it("clamps the write budget into the read window [9s, 10s] — above Mastra's 8s historyRead", () => {
    const config = buildHistoryWriteProxyConfig()
    expect(config.timeoutMs).toBeLessThanOrEqual(
      HISTORY_READ_TIMEOUT_CEILING_MS,
    )
    expect(config.timeoutMs).toBeGreaterThanOrEqual(
      HISTORY_READ_TIMEOUT_FLOOR_MS,
    )
  })
})
