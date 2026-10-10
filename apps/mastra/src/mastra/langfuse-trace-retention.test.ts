import { readFileSync } from "node:fs"

import { afterEach, describe, expect, it, vi } from "vitest"

import type { LangfuseConfig } from "../config/env"

import { AI_CHAT_RETENTION_DAYS } from "./ai-chat-retention"
import {
  LANGFUSE_ERASURE_LIST_PAGE_SIZE,
  LANGFUSE_RETENTION_LIST_PAGE_SIZE,
  LANGFUSE_TRACE_RETENTION_FIRE_HOUR_UTC,
  MAX_DELETE_REQUESTS_PER_RUN,
  MAX_LIST_PAGES_PER_RUN,
  MAX_TRACE_IDS_PER_DELETE_REQUEST,
  RETENTION_WALL_WARN_AGE_DAYS,
  deleteTraceBatch,
  isLangfuseTraceRetentionConfigured,
  listExpiredObservationsPage,
  listObservationsByUserIdPage,
  msUntilNextUtcFireHour,
  runLangfuseTraceRetentionSweep,
  startLangfuseTraceRetention,
} from "./langfuse-trace-retention"

const NOW = Date.UTC(2026, 7, 10)
const DAY_MS = 24 * 60 * 60 * 1000
// Every default fixture row is safely past the 25d cutoff but under the
// 28d wall-warn threshold, so wall-risk assertions stay explicit opt-ins.
const OLD_ISO = new Date(NOW - 26 * DAY_MS).toISOString()
const CUTOFF_ISO = new Date(NOW - AI_CHAT_RETENTION_DAYS * DAY_MS).toISOString()

const CONFIG: LangfuseConfig = {
  baseUrl: "https://langfuse.example",
  publicKey: "pk-test",
  secretKey: "sk-test",
  timeoutMs: 3000,
  userAgent: "forge-mastra-langfuse/1.0",
  maxResponseBytes: 262_144,
  promptCacheTtlMs: 60_000,
  promptFailureCooldownMs: 10_000,
}

type RecordedRequest = { url: URL; init: RequestInit }

/**
 * Fetch fake driven by a queue of responders. Records every request so tests
 * can assert the wire shape (params, method, body) our client actually sends.
 */
function fakeFetch(responders: Array<(request: RecordedRequest) => Response>): {
  fetchImpl: typeof fetch
  requests: RecordedRequest[]
} {
  const requests: RecordedRequest[] = []
  const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const request = { url: new URL(String(input)), init: init ?? {} }
    requests.push(request)
    const responder = responders.shift()
    if (!responder) throw new Error("fakeFetch: no responder queued")
    return responder(request)
  }) as typeof fetch
  return { fetchImpl, requests }
}

/** One observation row per trace id, all with an expired (26d) startTime. */
function observationsPage(
  traceIds: string[],
  cursor?: string | null,
  startTimeIso: string = OLD_ISO,
): Response {
  return new Response(
    JSON.stringify({
      data: traceIds.map((traceId, i) => ({
        id: `obs-${traceId}-${i}`,
        traceId,
        type: "AGENT_RUN",
        startTime: startTimeIso,
      })),
      meta: { cursor: cursor ?? null },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  )
}

function deleteAccepted(): Response {
  return new Response(JSON.stringify({ message: "accepted" }), { status: 200 })
}

function deleteBody(request: RecordedRequest): string[] {
  return (JSON.parse(String(request.init.body)) as { traceIds: string[] })
    .traceIds
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("isLangfuseTraceRetentionConfigured", () => {
  it("requires the full credential trio", () => {
    expect(isLangfuseTraceRetentionConfigured(CONFIG)).toBe(true)
    for (const missing of ["baseUrl", "publicKey", "secretKey"] as const) {
      expect(
        isLangfuseTraceRetentionConfigured({ ...CONFIG, [missing]: undefined }),
      ).toBe(false)
    }
  })

  it("is deliberately NOT gated on LANGFUSE_TRACING_ENABLED (kill-switch completeness: the flag stops new exports, not retention of already-exported traces)", () => {
    // Whole-source backstop: the module must never consult the tracing flag —
    // a future edit that wires it in would silently pause retention on
    // already-exported special-category data whenever tracing is flipped off.
    const source = readFileSync(
      new URL("./langfuse-trace-retention.ts", import.meta.url),
      "utf8",
    )
    expect(source).not.toContain("isLangfuseTracingEnabled")
    // Strip block and line comments (where the decision is explained), then
    // assert no CODE reference remains — robust to trailing comments too.
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")
    expect(stripped).not.toContain("LANGFUSE_TRACING_ENABLED")
  })
})

describe("listExpiredObservationsPage", () => {
  it("sends toStartTime + fields=core + limit with Basic auth and no io group", async () => {
    const { fetchImpl, requests } = fakeFetch([
      () => observationsPage(["t1", "t2"]),
    ])
    const result = await listExpiredObservationsPage({
      config: CONFIG,
      toStartTimeIso: CUTOFF_ISO,
      fetchImpl,
    })
    expect(result).toMatchObject({
      ok: true,
      traceIds: ["t1", "t2"],
      observationCount: 2,
      filterSkipped: 0,
    })
    const { url, init } = requests[0]!
    expect(url.pathname).toBe("/api/public/v2/observations")
    expect(url.searchParams.get("toStartTime")).toBe(CUTOFF_ISO)
    // fields=core and ONLY core: the io group (raw conversation text) must
    // never be requested by this module.
    expect(url.searchParams.get("fields")).toBe("core")
    expect(url.searchParams.get("limit")).toBe(
      String(LANGFUSE_RETENTION_LIST_PAGE_SIZE),
    )
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe(
      `Basic ${Buffer.from("pk-test:sk-test").toString("base64")}`,
    )
    expect(init.redirect).toBe("error")
  })

  it("refuses an unparseable cutoff BEFORE any request — a NaN cutoff would fail the re-check OPEN, not closed", async () => {
    // Security-review hardening (2026-08-11, suggested independently by both
    // passes): comparisons with a NaN cutoff are all false, so every row
    // would pass the client-side re-check and the mass-delete guard would
    // silently rest on the server filter alone. Unreachable from the sweep;
    // this makes the guard total for direct callers.
    const fetchMock = vi.fn<typeof fetch>()
    const result = await listExpiredObservationsPage({
      config: CONFIG,
      toStartTimeIso: "not-a-date",
      fetchImpl: fetchMock,
    })
    expect(result).toEqual({ ok: false, reason: "parse_error" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("re-checks each row's startTime client-side: in-window and unparseable rows are skipped, never marked for deletion", async () => {
    // Filter integrity: a server that ignores toStartTime must degrade to a
    // loud no-op, never a project-wide delete.
    const fresh = new Date(NOW - 1 * DAY_MS).toISOString()
    const { fetchImpl } = fakeFetch([
      () =>
        new Response(
          JSON.stringify({
            data: [
              { traceId: "expired", startTime: OLD_ISO },
              { traceId: "fresh", startTime: fresh },
              { traceId: "no-start-time" },
              { traceId: "bad-start-time", startTime: "not-a-date" },
              // Exactly AT the cutoff is NOT strictly before it.
              { traceId: "at-cutoff", startTime: CUTOFF_ISO },
            ],
            meta: { cursor: null },
          }),
          { status: 200 },
        ),
    ])
    const result = await listExpiredObservationsPage({
      config: CONFIG,
      toStartTimeIso: CUTOFF_ISO,
      fetchImpl,
    })
    expect(result).toMatchObject({
      ok: true,
      traceIds: ["expired"],
      observationCount: 5,
      filterSkipped: 4,
    })
  })

  it("reports the oldest valid row's startTime", async () => {
    const oldest = new Date(NOW - 29 * DAY_MS).toISOString()
    const { fetchImpl } = fakeFetch([
      () =>
        new Response(
          JSON.stringify({
            data: [
              { traceId: "a", startTime: OLD_ISO },
              { traceId: "b", startTime: oldest },
            ],
            meta: { cursor: null },
          }),
          { status: 200 },
        ),
    ])
    const result = await listExpiredObservationsPage({
      config: CONFIG,
      toStartTimeIso: CUTOFF_ISO,
      fetchImpl,
    })
    expect(result).toMatchObject({
      ok: true,
      oldestStartTimeMs: Date.parse(oldest),
    })
  })

  it("threads the cursor and surfaces meta.cursor as nextCursor", async () => {
    const { fetchImpl, requests } = fakeFetch([
      () => observationsPage(["t1"], "cursor-2"),
    ])
    const result = await listExpiredObservationsPage({
      config: CONFIG,
      toStartTimeIso: CUTOFF_ISO,
      cursor: "cursor-1",
      fetchImpl,
    })
    expect(result).toMatchObject({ ok: true, nextCursor: "cursor-2" })
    expect(requests[0]!.url.searchParams.get("cursor")).toBe("cursor-1")
  })

  it("tolerates a response with no meta key at all (treated as last page)", async () => {
    const { fetchImpl } = fakeFetch([
      () =>
        new Response(
          JSON.stringify({ data: [{ traceId: "t1", startTime: OLD_ISO }] }),
          { status: 200 },
        ),
    ])
    const result = await listExpiredObservationsPage({
      config: CONFIG,
      toStartTimeIso: CUTOFF_ISO,
      fetchImpl,
    })
    expect(result).toMatchObject({ ok: true, traceIds: ["t1"] })
    expect((result as { nextCursor?: string }).nextCursor).toBeUndefined()
  })

  it("dedupes trace ids within a page and skips rows without a string traceId", async () => {
    const { fetchImpl } = fakeFetch([
      () =>
        new Response(
          JSON.stringify({
            data: [
              { traceId: "t1", startTime: OLD_ISO },
              { traceId: "t1", startTime: OLD_ISO },
              { traceId: 42, startTime: OLD_ISO },
              { startTime: OLD_ISO },
              { traceId: "t2", startTime: OLD_ISO },
            ],
            meta: { cursor: null },
          }),
          { status: 200 },
        ),
    ])
    const result = await listExpiredObservationsPage({
      config: CONFIG,
      toStartTimeIso: CUTOFF_ISO,
      fetchImpl,
    })
    expect(result).toMatchObject({
      ok: true,
      traceIds: ["t1", "t2"],
      observationCount: 5,
    })
  })

  it("classifies 429 with Retry-After as rate_limited (first-class, never swallowed)", async () => {
    const { fetchImpl } = fakeFetch([
      () => new Response("", { status: 429, headers: { "retry-after": "17" } }),
    ])
    const result = await listExpiredObservationsPage({
      config: CONFIG,
      toStartTimeIso: CUTOFF_ISO,
      fetchImpl,
    })
    expect(result).toEqual({
      ok: false,
      reason: "rate_limited",
      status: 429,
      retryAfterSeconds: 17,
    })
  })

  it("maps a missing or non-numeric Retry-After to undefined seconds", async () => {
    const headerVariants: Record<string, string>[] = [
      {},
      { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" },
    ]
    for (const headers of headerVariants) {
      const { fetchImpl } = fakeFetch([
        () => new Response("", { status: 429, headers }),
      ])
      const result = await listExpiredObservationsPage({
        config: CONFIG,
        toStartTimeIso: CUTOFF_ISO,
        fetchImpl,
      })
      expect(result).toMatchObject({ ok: false, reason: "rate_limited" })
      expect(
        (result as { retryAfterSeconds?: number }).retryAfterSeconds,
      ).toBeUndefined()
    }
  })

  it("classifies auth/rejection/server statuses and malformed bodies", async () => {
    for (const [status, reason] of [
      [401, "auth_failed"],
      [403, "auth_failed"],
      [404, "rejected"],
      [500, "network_error"],
    ] as const) {
      const { fetchImpl } = fakeFetch([() => new Response("", { status })])
      const result = await listExpiredObservationsPage({
        config: CONFIG,
        toStartTimeIso: CUTOFF_ISO,
        fetchImpl,
      })
      expect(result).toMatchObject({ ok: false, reason, status })
    }
    const { fetchImpl } = fakeFetch([
      () => new Response("not json", { status: 200 }),
    ])
    const result = await listExpiredObservationsPage({
      config: CONFIG,
      toStartTimeIso: CUTOFF_ISO,
      fetchImpl,
    })
    expect(result).toMatchObject({ ok: false, reason: "parse_error" })
  })

  it("classifies a timeout on the typed error surface", async () => {
    const fetchImpl = (async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" })
    }) as typeof fetch
    const result = await listExpiredObservationsPage({
      config: CONFIG,
      toStartTimeIso: CUTOFF_ISO,
      fetchImpl,
    })
    expect(result).toEqual({ ok: false, reason: "timeout" })
  })

  it("classifies a timeout thrown MID-BODY-READ as timeout, not parse_error", async () => {
    // The documented PR #1621 defect in the sibling copies: a latency
    // incident surfacing as parse_error steers the operator at the wrong
    // root cause. This copy deliberately rethrows and reclassifies.
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        throw Object.assign(new Error("body timed out"), {
          name: "TimeoutError",
        })
      },
    })
    const { fetchImpl } = fakeFetch([() => new Response(stream)])
    const result = await listExpiredObservationsPage({
      config: CONFIG,
      toStartTimeIso: CUTOFF_ISO,
      fetchImpl,
    })
    expect(result).toEqual({ ok: false, reason: "timeout" })
  })

  it("aborts the body stream past the byte cap and degrades to parse_error", async () => {
    // The abort MECHANISM, per the repo's byte-cap law: assert cancel() was
    // actually invoked (socket aborted), not just the graceful return.
    let cancelled = false
    const chunk = new TextEncoder().encode("x".repeat(64 * 1024))
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk)
      },
      cancel() {
        cancelled = true
      },
    })
    const { fetchImpl } = fakeFetch([() => new Response(stream)])
    const result = await listExpiredObservationsPage({
      config: { ...CONFIG, maxResponseBytes: 128 * 1024 },
      toStartTimeIso: CUTOFF_ISO,
      fetchImpl,
    })
    expect(result).toMatchObject({ ok: false, reason: "parse_error" })
    expect(cancelled).toBe(true)
  })
})

/** One observation row per [traceId, userId] pair for the by-userId listing. */
function userObservationsPage(
  rows: Array<Record<string, unknown>>,
  cursor?: string | null,
): Response {
  return new Response(
    JSON.stringify({ data: rows, meta: { cursor: cursor ?? null } }),
    { status: 200, headers: { "content-type": "application/json" } },
  )
}

describe("listObservationsByUserIdPage", () => {
  const TARGET = "user:auth-123"

  it("sends userId + fields=core,basic + limit with Basic auth — and NEVER the structured filter param", async () => {
    const { fetchImpl, requests } = fakeFetch([
      () =>
        userObservationsPage([
          { traceId: "t1", userId: TARGET },
          { traceId: "t2", userId: TARGET },
        ]),
    ])
    const result = await listObservationsByUserIdPage({
      config: CONFIG,
      userId: TARGET,
      fetchImpl,
    })
    expect(result).toMatchObject({
      ok: true,
      rows: [
        { traceId: "t1", userId: TARGET },
        { traceId: "t2", userId: TARGET },
      ],
      observationCount: 2,
      missingUserIdCount: 0,
    })
    const { url, init } = requests[0]!
    expect(url.pathname).toBe("/api/public/v2/observations")
    expect(url.searchParams.get("userId")).toBe(TARGET)
    // core,basic and ONLY core,basic: the io group (raw conversation text)
    // must never be requested by this module.
    expect(url.searchParams.get("fields")).toBe("core,basic")
    // The erasure-specific page size: core,basic rows are 2–3× the core row
    // the sweep's 500 was sized for, so this listing pages at 100.
    expect(url.searchParams.get("limit")).toBe(
      String(LANGFUSE_ERASURE_LIST_PAGE_SIZE),
    )
    // The structured filter param would take PRECEDENCE over userId if ever
    // sent — its absence is part of the wire contract.
    expect(url.searchParams.has("filter")).toBe(false)
    expect(url.searchParams.has("toStartTime")).toBe(false)
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe(
      `Basic ${Buffer.from("pk-test:sk-test").toString("base64")}`,
    )
    expect(init.redirect).toBe("error")
  })

  it("refuses a blank userId BEFORE any request — an empty filter would list the whole project", async () => {
    const fetchMock = vi.fn<typeof fetch>()
    for (const userId of ["", "   "]) {
      const result = await listObservationsByUserIdPage({
        config: CONFIG,
        userId,
        fetchImpl: fetchMock,
      })
      expect(result).toEqual({ ok: false, reason: "parse_error" })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("threads the cursor and surfaces meta.cursor as nextCursor (caller-driven drain until the cursor ends)", async () => {
    const { fetchImpl, requests } = fakeFetch([
      () => userObservationsPage([{ traceId: "t1", userId: TARGET }], "c2"),
      () => userObservationsPage([{ traceId: "t2", userId: TARGET }], null),
    ])
    const first = await listObservationsByUserIdPage({
      config: CONFIG,
      userId: TARGET,
      fetchImpl,
    })
    expect(first).toMatchObject({ ok: true, nextCursor: "c2" })
    expect(requests[0]!.url.searchParams.has("cursor")).toBe(false)
    const second = await listObservationsByUserIdPage({
      config: CONFIG,
      userId: TARGET,
      cursor: (first as { nextCursor?: string }).nextCursor,
      fetchImpl,
    })
    expect(requests[1]!.url.searchParams.get("cursor")).toBe("c2")
    expect(second).toMatchObject({
      ok: true,
      rows: [{ traceId: "t2", userId: TARGET }],
    })
    expect((second as { nextCursor?: string }).nextCursor).toBeUndefined()
  })

  it("strips injected input/output keys — the io group never surfaces in the return value", async () => {
    const { fetchImpl } = fakeFetch([
      () =>
        userObservationsPage([
          {
            traceId: "t1",
            userId: TARGET,
            input: "RAW CONVERSATION TEXT",
            output: "RAW MODEL REPLY",
            metadata: { leak: "no" },
          },
        ]),
    ])
    const result = await listObservationsByUserIdPage({
      config: CONFIG,
      userId: TARGET,
      fetchImpl,
    })
    expect(result).toMatchObject({ ok: true })
    const ok = result as { rows: Array<Record<string, unknown>> }
    // Field-by-field projection: EXACTLY { traceId, userId } per row.
    expect(ok.rows).toEqual([{ traceId: "t1", userId: TARGET }])
    expect(JSON.stringify(result)).not.toContain("RAW CONVERSATION TEXT")
    expect(JSON.stringify(result)).not.toContain("RAW MODEL REPLY")
  })

  it("SURFACES rows lacking a readable string userId instead of silently dropping them (the R7 refusal signal)", async () => {
    const { fetchImpl } = fakeFetch([
      () =>
        userObservationsPage([
          { traceId: "t1", userId: TARGET },
          { traceId: "t2" }, // absent
          { traceId: "t3", userId: null },
          { traceId: "t4", userId: 42 },
          { traceId: "t5", userId: "" }, // empty string is not readable
        ]),
    ])
    const result = await listObservationsByUserIdPage({
      config: CONFIG,
      userId: TARGET,
      fetchImpl,
    })
    expect(result).toMatchObject({
      ok: true,
      rows: [{ traceId: "t1", userId: TARGET }],
      observationCount: 5,
      missingUserIdCount: 4,
      missingTraceIdCount: 0,
    })
  })

  it("counts rows with a readable userId but no readable traceId separately (undeletable rows are visible, not vanished)", async () => {
    const { fetchImpl } = fakeFetch([
      () =>
        userObservationsPage([
          { traceId: "t1", userId: TARGET },
          { userId: TARGET }, // traceId absent
          { traceId: 42, userId: TARGET },
          { traceId: "", userId: TARGET },
        ]),
    ])
    const result = await listObservationsByUserIdPage({
      config: CONFIG,
      userId: TARGET,
      fetchImpl,
    })
    expect(result).toMatchObject({
      ok: true,
      rows: [{ traceId: "t1", userId: TARGET }],
      observationCount: 4,
      missingUserIdCount: 0,
      missingTraceIdCount: 3,
    })
  })

  it("returns ROWS, not deduped ids — a userId the caller must re-check rides every row (dedupe is U6's job)", async () => {
    const other = "user:someone-else"
    const { fetchImpl } = fakeFetch([
      () =>
        userObservationsPage([
          { traceId: "t1", userId: TARGET },
          { traceId: "t1", userId: TARGET }, // duplicate traceId kept
          { traceId: "t2", userId: other }, // server-filter mismatch kept for the caller's re-check
        ]),
    ])
    const result = await listObservationsByUserIdPage({
      config: CONFIG,
      userId: TARGET,
      fetchImpl,
    })
    expect(result).toMatchObject({
      ok: true,
      rows: [
        { traceId: "t1", userId: TARGET },
        { traceId: "t1", userId: TARGET },
        { traceId: "t2", userId: other },
      ],
    })
  })

  it("classifies 429 with Retry-After as rate_limited", async () => {
    const { fetchImpl } = fakeFetch([
      () => new Response("", { status: 429, headers: { "retry-after": "23" } }),
    ])
    const result = await listObservationsByUserIdPage({
      config: CONFIG,
      userId: TARGET,
      fetchImpl,
    })
    expect(result).toEqual({
      ok: false,
      reason: "rate_limited",
      status: 429,
      retryAfterSeconds: 23,
    })
  })

  it("classifies auth/rejection/server statuses and malformed bodies", async () => {
    for (const [status, reason] of [
      [401, "auth_failed"],
      [403, "auth_failed"],
      [404, "rejected"],
      [500, "network_error"],
    ] as const) {
      const { fetchImpl } = fakeFetch([() => new Response("", { status })])
      const result = await listObservationsByUserIdPage({
        config: CONFIG,
        userId: TARGET,
        fetchImpl,
      })
      expect(result).toMatchObject({ ok: false, reason, status })
    }
    const { fetchImpl } = fakeFetch([
      () => new Response("not json", { status: 200 }),
    ])
    const result = await listObservationsByUserIdPage({
      config: CONFIG,
      userId: TARGET,
      fetchImpl,
    })
    expect(result).toMatchObject({ ok: false, reason: "parse_error" })
  })

  it("classifies a timeout thrown MID-BODY-READ as timeout, not parse_error (the fixed byte-cap reader copy)", async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        throw Object.assign(new Error("body timed out"), {
          name: "TimeoutError",
        })
      },
    })
    const { fetchImpl } = fakeFetch([() => new Response(stream)])
    const result = await listObservationsByUserIdPage({
      config: CONFIG,
      userId: TARGET,
      fetchImpl,
    })
    expect(result).toEqual({ ok: false, reason: "timeout" })
  })

  it("classifies a timeout on the typed fetch-throw surface", async () => {
    const fetchImpl = (async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" })
    }) as typeof fetch
    const result = await listObservationsByUserIdPage({
      config: CONFIG,
      userId: TARGET,
      fetchImpl,
    })
    expect(result).toEqual({ ok: false, reason: "timeout" })
  })

  it("aborts the body stream past the byte cap and degrades to parse_error", async () => {
    let cancelled = false
    const chunk = new TextEncoder().encode("x".repeat(64 * 1024))
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk)
      },
      cancel() {
        cancelled = true
      },
    })
    const { fetchImpl } = fakeFetch([() => new Response(stream)])
    const result = await listObservationsByUserIdPage({
      config: { ...CONFIG, maxResponseBytes: 128 * 1024 },
      userId: TARGET,
      fetchImpl,
    })
    expect(result).toMatchObject({ ok: false, reason: "parse_error" })
    expect(cancelled).toBe(true)
  })
})

describe("deleteTraceBatch", () => {
  it("DELETEs /api/public/traces with a { traceIds } JSON body", async () => {
    const { fetchImpl, requests } = fakeFetch([() => deleteAccepted()])
    const result = await deleteTraceBatch({
      config: CONFIG,
      traceIds: ["t1", "t2"],
      fetchImpl,
    })
    expect(result).toEqual({ ok: true })
    const { url, init } = requests[0]!
    expect(url.pathname).toBe("/api/public/traces")
    expect(init.method).toBe("DELETE")
    expect(JSON.parse(String(init.body))).toEqual({ traceIds: ["t1", "t2"] })
  })

  it("surfaces 429 + Retry-After as rate_limited", async () => {
    const { fetchImpl } = fakeFetch([
      () => new Response("", { status: 429, headers: { "retry-after": "60" } }),
    ])
    const result = await deleteTraceBatch({
      config: CONFIG,
      traceIds: ["t1"],
      fetchImpl,
    })
    expect(result).toEqual({
      ok: false,
      reason: "rate_limited",
      status: 429,
      retryAfterSeconds: 60,
    })
  })

  it("drains the response body on success AND failure statuses", async () => {
    // Socket hygiene: a body this module never reads must still be cancelled.
    const drained: boolean[] = []
    const bodyResponse = (status: number) => {
      const stream = new ReadableStream<Uint8Array>({
        cancel() {
          drained.push(true)
        },
      })
      return new Response(stream, { status })
    }
    const okCall = await deleteTraceBatch({
      config: CONFIG,
      traceIds: ["t1"],
      fetchImpl: fakeFetch([() => bodyResponse(200)]).fetchImpl,
    })
    expect(okCall).toEqual({ ok: true })
    const failCall = await deleteTraceBatch({
      config: CONFIG,
      traceIds: ["t1"],
      fetchImpl: fakeFetch([() => bodyResponse(500)]).fetchImpl,
    })
    expect(failCall).toMatchObject({ ok: false, reason: "network_error" })
    expect(drained).toEqual([true, true])
  })
})

describe("runLangfuseTraceRetentionSweep", () => {
  it("computes the cutoff from the flat retention constant (pinned at 25 days)", async () => {
    // Anti-tautology pin: 25 is written as a literal here, not derived from
    // the constant — a drifted policy fails this test.
    expect(AI_CHAT_RETENTION_DAYS).toBe(25)
    const { fetchImpl, requests } = fakeFetch([() => observationsPage([])])
    const result = await runLangfuseTraceRetentionSweep({
      config: CONFIG,
      fetchImpl,
      now: () => NOW,
    })
    expect(result).toMatchObject({ outcome: "swept", uniqueTraces: 0 })
    expect(requests[0]!.url.searchParams.get("toStartTime")).toBe(
      new Date(NOW - 25 * DAY_MS).toISOString(),
    )
  })

  it("skips (never fetches) when the credential trio is incomplete", async () => {
    const { fetchImpl, requests } = fakeFetch([])
    const result = await runLangfuseTraceRetentionSweep({
      config: { ...CONFIG, secretKey: undefined },
      fetchImpl,
    })
    expect(result).toEqual({ outcome: "skipped", reason: "config_missing" })
    expect(requests).toHaveLength(0)
  })

  it("paginates, dedupes across pages, and batches deletes at <=50 ids per request", async () => {
    // 120 unique ids across 3 pages (t50 repeats across pages) -> 3 delete
    // requests of 50/50/20.
    const pageA = Array.from({ length: 50 }, (_, i) => `t${i}`)
    const pageB = Array.from({ length: 50 }, (_, i) => `t${i + 50}`)
    const pageC = [
      "t50",
      ...Array.from({ length: 20 }, (_, i) => `t${i + 100}`),
    ]
    const deleteBodies: string[][] = []
    const { fetchImpl } = fakeFetch([
      () => observationsPage(pageA, "c1"),
      () => observationsPage(pageB, "c2"),
      () => observationsPage(pageC),
      ...Array.from({ length: 3 }, () => (request: RecordedRequest) => {
        deleteBodies.push(deleteBody(request))
        return deleteAccepted()
      }),
    ])
    const result = await runLangfuseTraceRetentionSweep({
      config: CONFIG,
      fetchImpl,
      now: () => NOW,
    })
    expect(result).toMatchObject({
      outcome: "swept",
      listedObservations: 121,
      uniqueTraces: 120,
      deleteRequests: 3,
      deletedSubmitted: 120,
      filterSkipped: 0,
      paginationSuspect: false,
      listTruncated: false,
    })
    expect(deleteBodies.map((b) => b.length)).toEqual([50, 50, 20])
    expect(new Set(deleteBodies.flat()).size).toBe(120)
  })

  it("stops listing at the delete-budget id ceiling and carries the remainder", async () => {
    // Pages of 200 unique ids with a cursor; the id budget is 50 x 40 =
    // 2,000 -> exactly 10 pages listed — under the 20-page cap, so THIS stop
    // is attributable to the id budget alone — then 40 delete requests,
    // truncation flagged.
    const idBudget =
      MAX_TRACE_IDS_PER_DELETE_REQUEST * MAX_DELETE_REQUESTS_PER_RUN
    let page = 0
    const responders = Array.from({ length: 30 }, () => () => {
      const ids = Array.from({ length: 200 }, (_, i) => `p${page}-${i}`)
      page += 1
      return observationsPage(ids, `cursor-${page}`)
    })
    const deletes: Array<() => Response> = Array.from(
      { length: MAX_DELETE_REQUESTS_PER_RUN },
      () => deleteAccepted,
    )
    const { fetchImpl, requests } = fakeFetch([...responders, ...deletes])
    const result = await runLangfuseTraceRetentionSweep({
      config: CONFIG,
      fetchImpl,
      now: () => NOW,
    })
    expect(result).toMatchObject({
      outcome: "swept",
      listedObservations: idBudget,
      uniqueTraces: idBudget,
      deleteRequests: MAX_DELETE_REQUESTS_PER_RUN,
      deletedSubmitted: idBudget,
      listTruncated: true,
    })
    // 10 list pages + 40 deletes, never a 41st delete request.
    expect(requests).toHaveLength(idBudget / 200 + MAX_DELETE_REQUESTS_PER_RUN)
  })

  it("stops listing at the page cap independently of the id budget", async () => {
    // 10 unique traces per 500-row page (50 observations each): after the
    // 20-page cap only 200 traces are collected — far under the 500-id
    // budget — so THIS stop is attributable to the page cap alone.
    let page = 0
    const responders = Array.from(
      { length: MAX_LIST_PAGES_PER_RUN + 5 },
      () => () => {
        const ids = Array.from({ length: 10 }, (_, i) => `p${page}-t${i}`)
        const rows = Array.from({ length: 500 }, (_, i) => ids[i % 10]!)
        page += 1
        return observationsPage(rows, `cursor-${page}`)
      },
    )
    const deletes: Array<() => Response> = Array.from(
      { length: 4 },
      () => deleteAccepted,
    )
    const { fetchImpl, requests } = fakeFetch([...responders, ...deletes])
    const result = await runLangfuseTraceRetentionSweep({
      config: CONFIG,
      fetchImpl,
      now: () => NOW,
    })
    expect(result).toMatchObject({
      outcome: "swept",
      listedObservations: 500 * MAX_LIST_PAGES_PER_RUN,
      uniqueTraces: 200,
      deleteRequests: 4,
      deletedSubmitted: 200,
      listTruncated: true,
    })
    expect(requests).toHaveLength(MAX_LIST_PAGES_PER_RUN + 4)
  })

  it("flags a FULL page without a cursor as pagination-suspect", async () => {
    // A drifted cursor contract would otherwise silently cap every sweep at
    // page one, logging like a clean project.
    const fullPage = Array.from({ length: 500 }, (_, i) => `t${i}`)
    const { fetchImpl } = fakeFetch([
      () => observationsPage(fullPage, null),
      ...Array.from({ length: 10 }, () => deleteAccepted),
    ])
    const result = await runLangfuseTraceRetentionSweep({
      config: CONFIG,
      fetchImpl,
      now: () => NOW,
    })
    expect(result).toMatchObject({ outcome: "swept", paginationSuspect: true })
  })

  it("reports the oldest listed age in whole days", async () => {
    const { fetchImpl } = fakeFetch([
      () =>
        observationsPage(
          ["t1"],
          null,
          new Date(NOW - 29 * DAY_MS).toISOString(),
        ),
      () => deleteAccepted(),
    ])
    const result = await runLangfuseTraceRetentionSweep({
      config: CONFIG,
      fetchImpl,
      now: () => NOW,
    })
    expect(result).toMatchObject({ outcome: "swept", oldestAgeDays: 29 })
  })

  it("treats a delete 429 as a first-class rate_limited outcome and stops spending the quota", async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `t${i}`)
    const { fetchImpl, requests } = fakeFetch([
      () => observationsPage(ids),
      () => deleteAccepted(),
      () =>
        new Response("", { status: 429, headers: { "retry-after": "3600" } }),
    ])
    const result = await runLangfuseTraceRetentionSweep({
      config: CONFIG,
      fetchImpl,
      now: () => NOW,
    })
    expect(result).toMatchObject({
      outcome: "rate_limited",
      stage: "delete",
      retryAfterSeconds: 3600,
      listedObservations: 120,
      uniqueTraces: 120,
      // ATTEMPTED count: the 429'd second request still spent quota.
      deleteRequests: 2,
      deletedSubmitted: 50,
    })
    // No third delete attempt after the 429 — the backlog carries.
    expect(requests).toHaveLength(3)
  })

  it("a list 429 still deletes what was collected (separate quota buckets)", async () => {
    const { fetchImpl, requests } = fakeFetch([
      () =>
        observationsPage(
          Array.from({ length: 10 }, (_, i) => `t${i}`),
          "c1",
        ),
      () => new Response("", { status: 429, headers: { "retry-after": "20" } }),
      () => deleteAccepted(),
    ])
    const result = await runLangfuseTraceRetentionSweep({
      config: CONFIG,
      fetchImpl,
      now: () => NOW,
    })
    expect(result).toMatchObject({
      outcome: "rate_limited",
      stage: "list",
      retryAfterSeconds: 20,
      listedObservations: 10,
      uniqueTraces: 10,
      deleteRequests: 1,
      deletedSubmitted: 10,
      listTruncated: true,
    })
    expect(requests).toHaveLength(3)
  })

  it("a hard list failure ALSO still deletes what was collected and keeps the stats", async () => {
    // Mirrors the 429 path: already-collected ids passed the window
    // re-check, so a page-2 outage must not discard page-1's work.
    const ids = Array.from({ length: 10 }, (_, i) => `t${i}`)
    const deleteBodies: string[][] = []
    const { fetchImpl } = fakeFetch([
      () => observationsPage(ids, "c1"),
      () => new Response("", { status: 500 }),
      (request) => {
        deleteBodies.push(deleteBody(request))
        return deleteAccepted()
      },
    ])
    const result = await runLangfuseTraceRetentionSweep({
      config: CONFIG,
      fetchImpl,
      now: () => NOW,
    })
    expect(result).toMatchObject({
      outcome: "failed",
      stage: "list",
      reason: "network_error",
      status: 500,
      listedObservations: 10,
      uniqueTraces: 10,
      deleteRequests: 1,
      deletedSubmitted: 10,
      listTruncated: true,
    })
    expect(deleteBodies[0]).toHaveLength(10)
  })

  it("fails loud mid-delete and keeps the partial-spend stats", async () => {
    // The failed remainder simply re-lists on the next day's run — deletion
    // is self-healing without remembered state (see the module header).
    const ids = Array.from({ length: 60 }, (_, i) => `t${i}`)
    const { fetchImpl } = fakeFetch([
      () => observationsPage(ids),
      () => deleteAccepted(),
      () => new Response("", { status: 500 }),
    ])
    const result = await runLangfuseTraceRetentionSweep({
      config: CONFIG,
      fetchImpl,
      now: () => NOW,
    })
    expect(result).toMatchObject({
      outcome: "failed",
      stage: "delete",
      reason: "network_error",
      status: 500,
      // ATTEMPTED count: the failed second request still spent quota.
      deleteRequests: 2,
      deletedSubmitted: 50,
    })
  })
})

describe("module constants", () => {
  it("pins the per-run cap to the per-day allocation — honest ONLY under runs/day = 1 (wall-clock schedule, no boot sweep)", () => {
    // 1 run/day x 40 requests = the full 40/day retention allocation of the
    // org's 50/day quota, preserving >=10/day feat-337 erasure headroom —
    // literals on the right so a raised cap fails here, not in prod. The
    // runs/day = 1 premise is what the boot-arms-never-sweeps test pins;
    // reintroducing a boot sweep invalidates THIS arithmetic too.
    expect(MAX_DELETE_REQUESTS_PER_RUN * 1).toBeLessThanOrEqual(40)
    // The firing hour sits in the observed deploy trough (see the constant's
    // comment); a re-aim is legitimate but must be a conscious edit here.
    expect(LANGFUSE_TRACE_RETENTION_FIRE_HOUR_UTC).toBe(8)
    // The wall warning fires before the Hobby 30-day visibility wall and
    // after the retention window itself.
    expect(RETENTION_WALL_WARN_AGE_DAYS).toBeLessThan(30)
    expect(RETENTION_WALL_WARN_AGE_DAYS).toBeGreaterThan(AI_CHAT_RETENTION_DAYS)
  })

  it("defaults both entry points to the retention config, never the prompt-tuned one (timeout seam pin)", () => {
    // Reverting either default back to getLangfuseConfig() reinstates the 3s
    // prompt timeout the live batch-DELETE was MEASURED to exceed (~3.4s,
    // 2026-08-11) — a one-line revert that compiles and leaves every mocked
    // test green, so pin the seam at the source level.
    const source = readFileSync(
      new URL("./langfuse-trace-retention.ts", import.meta.url),
      "utf8",
    )
    // Strip comments first (mirroring the tracing-flag sibling test) so the
    // pins match CODE, not prose that may legitimately name the old accessor.
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")
    expect(stripped).toContain("getConfig = getLangfuseTraceRetentionConfig")
    expect(stripped).toContain("config = getLangfuseTraceRetentionConfig()")
    // Total ban: since the review-driven gate-default swap, NO code path in
    // this module may reference the prompt-tuned accessor at all. (The
    // retention accessor's name does not contain this substring.)
    expect(stripped).not.toContain("getLangfuseConfig")
  })
})

describe("msUntilNextUtcFireHour", () => {
  it("targets today's firing hour when still ahead, tomorrow's when passed, and never returns zero", () => {
    const midnight = Date.UTC(2026, 7, 10) // 00:00 UTC
    expect(msUntilNextUtcFireHour(midnight, 8)).toBe(8 * 60 * 60 * 1000)
    const nineAm = Date.UTC(2026, 7, 10, 9)
    expect(msUntilNextUtcFireHour(nineAm, 8)).toBe(23 * 60 * 60 * 1000)
    // Exactly AT the firing instant: the next fire is tomorrow's — a re-arm
    // immediately after firing must never re-fire the same day.
    const atFire = Date.UTC(2026, 7, 10, 8)
    expect(msUntilNextUtcFireHour(atFire, 8)).toBe(24 * 60 * 60 * 1000)
  })
})

describe("startLangfuseTraceRetention", () => {
  it("no-ops with one quiet line when the credential trio is absent", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    const handle = startLangfuseTraceRetention({
      getConfig: () => ({ ...CONFIG, baseUrl: undefined }),
    })
    expect(handle).toBeNull()
    expect(info).toHaveBeenCalledWith(
      "[langfuse-retention] event=retention_disabled reason=config_missing",
    )
  })

  it("boot ARMS the wall-clock timer, logs next_fire, and NEVER sweeps (zero fetches at start)", async () => {
    // The anti-boot-sweep pin: reintroducing boot spend falsifies the
    // per-run == per-day cap arithmetic (runs/day = 1 by construction).
    vi.useFakeTimers()
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    try {
      let calls = 0
      const fetchImpl = (async () => {
        calls += 1
        return deleteAccepted()
      }) as typeof fetch
      // NOW is midnight UTC -> first fire is 08:00 the same day.
      const handle = startLangfuseTraceRetention({
        getConfig: () => CONFIG,
        fetchImpl,
        now: () => NOW,
      })
      expect(handle).not.toBeNull()
      await vi.advanceTimersByTimeAsync(0)
      expect(calls).toBe(0)
      expect(info).toHaveBeenCalledWith(
        "[langfuse-retention] event=sweep_scheduled next_fire=2026-08-10T08:00:00.000Z",
      )
      handle?.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it("fires at the firing hour, sweeps, logs sweep_complete, and re-arms for the NEXT day", async () => {
    vi.useFakeTimers()
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      let clock = NOW
      let calls = 0
      const fetchImpl = (async (input: URL | RequestInfo) => {
        const url = new URL(String(input))
        if (url.pathname.endsWith("/observations")) {
          calls += 1
          return observationsPage(["t1"])
        }
        return deleteAccepted()
      }) as typeof fetch
      const handle = startLangfuseTraceRetention({
        getConfig: () => CONFIG,
        fetchImpl,
        now: () => clock,
      })
      // Advance the injectable clock in lockstep with the fake timers so the
      // post-fire re-arm computes its delay from the firing instant.
      clock = NOW + 8 * 60 * 60 * 1000
      await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000)
      expect(calls).toBe(1)
      expect(info).toHaveBeenCalledWith(
        "[langfuse-retention] event=sweep_complete listed=1 traces=1 delete_requests=1 deleted_submitted=1 carried_over=0 oldest_age_days=26 list_truncated=0",
      )
      // Re-armed for tomorrow's firing hour, logged on the re-arm too.
      expect(info).toHaveBeenCalledWith(
        "[langfuse-retention] event=sweep_scheduled next_fire=2026-08-11T08:00:00.000Z",
      )
      clock += 24 * 60 * 60 * 1000
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
      expect(calls).toBe(2)
      handle?.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it("logs loudly on EVERY failing run (never throws out of the timer) and still re-arms", async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "info").mockImplementation(() => {})
    try {
      let clock = NOW
      const fetchImpl = (async () =>
        new Response("", { status: 500 })) as typeof fetch
      const handle = startLangfuseTraceRetention({
        getConfig: () => CONFIG,
        fetchImpl,
        now: () => clock,
      })
      const failedLine =
        "[langfuse-retention] event=sweep_failed stage=list reason=network_error status=500 listed=0 traces=0 delete_requests=0 deleted_submitted=0"
      clock = NOW + 8 * 60 * 60 * 1000
      await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000)
      expect(warn).toHaveBeenCalledWith(failedLine)
      warn.mockClear()
      // A failed run retries at the NEXT day's fire (no earlier retry).
      clock += 24 * 60 * 60 * 1000
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
      expect(warn).toHaveBeenCalledWith(failedLine)
      handle?.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it("warns retention_wall_risk when the oldest listed trace nears the 30-day wall", async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "info").mockImplementation(() => {})
    try {
      let clock = NOW
      const nearWall = new Date(NOW - 29 * DAY_MS).toISOString()
      const fetchImpl = (async (input: URL | RequestInfo) => {
        const url = new URL(String(input))
        return url.pathname.endsWith("/observations")
          ? observationsPage(["t1"], null, nearWall)
          : deleteAccepted()
      }) as typeof fetch
      const handle = startLangfuseTraceRetention({
        getConfig: () => CONFIG,
        fetchImpl,
        now: () => clock,
      })
      clock = NOW + 8 * 60 * 60 * 1000
      await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000)
      expect(warn).toHaveBeenCalledWith(
        "[langfuse-retention] event=retention_wall_risk oldest_age_days=29",
      )
      handle?.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it("warns list_filter_suspect when the client-side window re-check refuses rows", async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "info").mockImplementation(() => {})
    try {
      let clock = NOW
      const fresh = new Date(NOW - 1 * DAY_MS).toISOString()
      const fetchImpl = (async (input: URL | RequestInfo) => {
        const url = new URL(String(input))
        return url.pathname.endsWith("/observations")
          ? observationsPage(["in-window"], null, fresh)
          : deleteAccepted()
      }) as typeof fetch
      const handle = startLangfuseTraceRetention({
        getConfig: () => CONFIG,
        fetchImpl,
        now: () => clock,
      })
      clock = NOW + 8 * 60 * 60 * 1000
      await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000)
      expect(warn).toHaveBeenCalledWith(
        "[langfuse-retention] event=list_filter_suspect skipped=1",
      )
      handle?.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it("a backward wall-clock step during the sweep cannot re-fire the same UTC day (last-fired-day latch)", async () => {
    vi.useFakeTimers()
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      let clock = NOW
      let listCalls = 0
      const fetchImpl = (async (input: URL | RequestInfo) => {
        const url = new URL(String(input))
        if (url.pathname.endsWith("/observations")) {
          listCalls += 1
          // Simulate an NTP step landing mid-sweep: the wall clock jumps
          // BACK to 60s before today's firing hour.
          clock = NOW + 8 * 60 * 60 * 1000 - 60_000
          return observationsPage([])
        }
        return deleteAccepted()
      }) as typeof fetch
      const handle = startLangfuseTraceRetention({
        getConfig: () => CONFIG,
        fetchImpl,
        now: () => clock,
      })
      clock = NOW + 8 * 60 * 60 * 1000
      await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000)
      expect(listCalls).toBe(1)
      // Without the latch the re-arm would aim at TODAY's 08:00 again (60s
      // away) and this next-day line would never be logged.
      expect(info).toHaveBeenCalledWith(
        "[langfuse-retention] event=sweep_scheduled next_fire=2026-08-11T08:00:00.000Z",
      )
      // ...and a second same-day sweep would fire within the next minutes.
      await vi.advanceTimersByTimeAsync(10 * 60_000)
      expect(listCalls).toBe(1)
      handle?.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it("stop() during an in-flight sweep suppresses the re-arm (no post-stop scheduling or fetches)", async () => {
    vi.useFakeTimers()
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      let clock = NOW
      let listCalls = 0
      let releaseList: (() => void) | undefined
      const gate = new Promise<void>((resolve) => {
        releaseList = resolve
      })
      const fetchImpl = (async (input: URL | RequestInfo) => {
        const url = new URL(String(input))
        if (url.pathname.endsWith("/observations")) {
          listCalls += 1
          await gate // hold the sweep in flight across the stop() call
          return observationsPage([])
        }
        return deleteAccepted()
      }) as typeof fetch
      const handle = startLangfuseTraceRetention({
        getConfig: () => CONFIG,
        fetchImpl,
        now: () => clock,
      })
      clock = NOW + 8 * 60 * 60 * 1000
      await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000)
      expect(listCalls).toBe(1)
      handle?.stop()
      info.mockClear()
      releaseList?.()
      await vi.advanceTimersByTimeAsync(0)
      // The settled sweep must NOT re-arm after stop() — deleting the
      // `if (stopped) return` guard turns this red (clearTimeout alone is a
      // no-op on the already-elapsed timer).
      expect(info).not.toHaveBeenCalledWith(
        expect.stringContaining("event=sweep_scheduled"),
      )
      await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000)
      expect(listCalls).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("an unexpected throw AFTER the sweep settles hits the catch, logs unexpected_error, and still re-arms", async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    // The result-logging path itself explodes — the class of throw the
    // chain's .catch exists for (the sweep's own API failures are enum
    // outcomes and never reject).
    const info = vi
      .spyOn(console, "info")
      .mockImplementation((...args: unknown[]) => {
        if (String(args[0]).includes("event=sweep_complete")) {
          throw new Error("logging pipeline exploded")
        }
      })
    try {
      let clock = NOW
      const fetchImpl = (async (input: URL | RequestInfo) => {
        const url = new URL(String(input))
        return url.pathname.endsWith("/observations")
          ? observationsPage([])
          : deleteAccepted()
      }) as typeof fetch
      const handle = startLangfuseTraceRetention({
        getConfig: () => CONFIG,
        fetchImpl,
        now: () => clock,
      })
      clock = NOW + 8 * 60 * 60 * 1000
      await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000)
      expect(warn).toHaveBeenCalledWith(
        "[langfuse-retention] event=sweep_failed reason=unexpected_error",
      )
      // The never-crash contract includes re-arming after the throw.
      expect(info).toHaveBeenCalledWith(
        "[langfuse-retention] event=sweep_scheduled next_fire=2026-08-11T08:00:00.000Z",
      )
      handle?.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it("warns list_truncated when the listing stopped with backlog remaining (prefix-only age metric)", async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "info").mockImplementation(() => {})
    try {
      let clock = NOW
      let call = 0
      const fetchImpl = (async (input: URL | RequestInfo) => {
        const url = new URL(String(input))
        if (url.pathname.endsWith("/observations")) {
          call += 1
          return call === 1
            ? observationsPage(["t1"], "c1")
            : new Response("", {
                status: 429,
                headers: { "retry-after": "20" },
              })
        }
        return deleteAccepted()
      }) as typeof fetch
      const handle = startLangfuseTraceRetention({
        getConfig: () => CONFIG,
        fetchImpl,
        now: () => clock,
      })
      clock = NOW + 8 * 60 * 60 * 1000
      await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000)
      expect(warn).toHaveBeenCalledWith(
        "[langfuse-retention] event=list_truncated oldest_age_basis=listed_prefix_only",
      )
      handle?.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it("stop() before the fire prevents the sweep entirely", async () => {
    vi.useFakeTimers()
    vi.spyOn(console, "info").mockImplementation(() => {})
    try {
      let calls = 0
      const fetchImpl = (async () => {
        calls += 1
        return deleteAccepted()
      }) as typeof fetch
      const handle = startLangfuseTraceRetention({
        getConfig: () => CONFIG,
        fetchImpl,
        now: () => NOW,
      })
      handle?.stop()
      await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000)
      expect(calls).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
