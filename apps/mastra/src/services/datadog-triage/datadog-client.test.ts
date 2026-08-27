import { describe, expect, it, vi } from "vitest"

import { DatadogTriageClient } from "./datadog-client"

const CONFIG = {
  site: "datadoghq.com",
  apiKey: "dd-api-key",
  applicationKey: "dd-app-key",
  timeoutMs: 1_000,
  maxResponseBytes: 1_048_576,
}

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  })
}

function emptyResponse(
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response("", { status, headers })
}

function stubFetch(response: Response | (() => Response | Promise<Response>)) {
  return vi.fn(async () =>
    typeof response === "function" ? await response() : response,
  ) as unknown as typeof fetch
}

/**
 * The exact field names observed live through the Datadog MCP against the real
 * `forge-mobile` project on 2026-08-19. This fixture is the VERIFIED half of
 * the contract: per-issue `total_count`, `state`, and the two version fields
 * the release-session filter reads all appeared on every returned issue.
 */
const LIVE_ISSUE_ROW = {
  issue_id: "30a2cc1a-976b-11f1-89f7-da7ad0900002",
  total_count: 27,
  state: "FOR_REVIEW",
  service: "forge-mobile",
  error_type: "Error",
  error_message:
    "UnexpectedException: Could not connect to the server. (at ExpoModulesCore/Promise.swift:56)",
  first_seen: "2026-08-13T23:03:12.564Z",
  first_seen_version: "fixcheck-20260805",
  last_seen: "2026-08-18T21:49:34.562Z",
  last_seen_version: "fixcheck-20260805",
  is_crash: false,
  platform: "REACT_NATIVE",
}

const WINDOW = {
  service: "forge-mobile",
  track: "rum" as const,
  from: new Date("2026-08-18T10:00:00Z"),
  to: new Date("2026-08-18T11:00:00Z"),
}

describe("DatadogTriageClient issue search", () => {
  it("reads the live field names, including the per-window occurrence count", async () => {
    const fetchImpl = stubFetch(jsonResponse({ data: [LIVE_ISSUE_ROW] }))
    const client = new DatadogTriageClient(CONFIG, fetchImpl)

    const result = await client.searchIssues(WINDOW)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.value.unparsedRows).toBe(0)
    expect(result.value.issues[0]).toEqual({
      issueId: "30a2cc1a-976b-11f1-89f7-da7ad0900002",
      service: "forge-mobile",
      state: "FOR_REVIEW",
      errorType: "Error",
      errorMessage:
        "UnexpectedException: Could not connect to the server. (at ExpoModulesCore/Promise.swift:56)",
      filePath: undefined,
      functionName: undefined,
      platform: "REACT_NATIVE",
      isCrash: false,
      firstSeen: "2026-08-13T23:03:12.564Z",
      lastSeen: "2026-08-18T21:49:34.562Z",
      firstSeenVersion: "fixcheck-20260805",
      lastSeenVersion: "fixcheck-20260805",
      totalCount: 27,
    })
  })

  it("reads the same fields when the envelope nests them under attributes", async () => {
    // UNVERIFIED half: the JSON:API `data[].attributes` + `included[]` wrapping
    // comes from the API documentation, not an observed response. Accepting
    // both shapes is why an envelope difference degrades instead of blanking
    // the sweep. The pre-enable smoke settles which one production sends.
    const fetchImpl = stubFetch(
      jsonResponse({
        data: [
          {
            id: "30a2cc1a-976b-11f1-89f7-da7ad0900002",
            attributes: { total_count: 27, state: "FOR_REVIEW" },
          },
        ],
        included: [
          {
            id: "30a2cc1a-976b-11f1-89f7-da7ad0900002",
            attributes: {
              service: "forge-mobile",
              error_message: "boom",
              last_seen_version: "1.4.2",
            },
          },
        ],
      }),
    )
    const client = new DatadogTriageClient(CONFIG, fetchImpl)

    const result = await client.searchIssues(WINDOW)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.value.issues[0]).toMatchObject({
      issueId: "30a2cc1a-976b-11f1-89f7-da7ad0900002",
      service: "forge-mobile",
      state: "FOR_REVIEW",
      errorMessage: "boom",
      lastSeenVersion: "1.4.2",
      totalCount: 27,
    })
  })

  it("counts a row with no usable issue id instead of dropping it silently", async () => {
    const fetchImpl = stubFetch(
      jsonResponse({ data: [{ attributes: { total_count: 9 } }] }),
    )
    const client = new DatadogTriageClient(CONFIG, fetchImpl)

    const result = await client.searchIssues(WINDOW)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.value.issues).toEqual([])
    expect(result.value.unparsedRows).toBe(1)
  })

  it("counts a row whose occurrence count is unreadable, never zero", async () => {
    // Silently reading a moved count field as 0 would baseline every issue at
    // zero and then fail the recurrence floor forever — a clean report and a
    // pipeline that has quietly stopped detecting anything.
    const fetchImpl = stubFetch(
      jsonResponse({ data: [{ issue_id: "abc", state: "FOR_REVIEW" }] }),
    )
    const client = new DatadogTriageClient(CONFIG, fetchImpl)

    const result = await client.searchIssues(WINDOW)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.value.issues).toEqual([])
    expect(result.value.unparsedRows).toBe(1)
  })

  it("refuses an envelope whose row array moved to another key", async () => {
    // The dangerous drift: parsing to a clean empty page would advance the
    // cursor and keep the liveness signal green while nothing is triaged.
    const client = new DatadogTriageClient(
      CONFIG,
      stubFetch(jsonResponse({ issues: [LIVE_ISSUE_ROW] })),
    )

    expect(await client.searchIssues(WINDOW)).toMatchObject({
      ok: false,
      reason: "parse_error",
    })
  })

  it("still accepts a genuinely empty result", async () => {
    const client = new DatadogTriageClient(
      CONFIG,
      stubFetch(jsonResponse({ data: [] })),
    )

    const result = await client.searchIssues(WINDOW)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.value).toEqual({
      issues: [],
      unparsedRows: 0,
      truncated: false,
    })
  })

  it("flags a full page as truncated so a partial read is never read as complete", async () => {
    const rows = Array.from({ length: 3 }, (_, index) => ({
      ...LIVE_ISSUE_ROW,
      issue_id: `ISSUE-${index}`,
    }))
    const client = new DatadogTriageClient(
      CONFIG,
      stubFetch(jsonResponse({ data: rows })),
    )

    const result = await client.searchIssues({ ...WINDOW, limit: 3 })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.value.truncated).toBe(true)
  })

  it("does not flag a short page as truncated", async () => {
    const client = new DatadogTriageClient(
      CONFIG,
      stubFetch(jsonResponse({ data: [LIVE_ISSUE_ROW] })),
    )

    const result = await client.searchIssues({ ...WINDOW, limit: 3 })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.value.truncated).toBe(false)
  })

  // Pagination. Without it a service whose baseline window exceeds one page
  // could never seed, so its Error Tracking coverage was silent forever.
  function rows(ids: string[]) {
    return ids.map((id) => ({ ...LIVE_ISSUE_ROW, issue_id: id }))
  }

  type PageArgs = { limit: number; cursor?: string }

  function pagedFetch(pages: unknown[]) {
    const queue = [...pages]
    const sentPages: PageArgs[] = []
    const impl = vi.fn(async (_url: URL, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        data: { attributes: { page: PageArgs } }
      }
      sentPages.push(body.data.attributes.page)
      return jsonResponse(queue.shift() ?? { data: [] })
    })
    return { impl: impl as unknown as typeof fetch, sentPages, calls: impl }
  }

  it.each([
    ["meta.page.after", (c: string) => ({ meta: { page: { after: c } } })],
    [
      "meta.pagination.next_cursor",
      (c: string) => ({ meta: { pagination: { next_cursor: c } } }),
    ],
  ])(
    "follows the cursor at %s until the window is exhausted",
    async (_, at) => {
      const paged = pagedFetch([
        { data: rows(["A", "B"]), ...at("cur-1") },
        { data: rows(["C"]) },
      ])
      const client = new DatadogTriageClient(CONFIG, paged.impl)

      const result = await client.searchIssues({ ...WINDOW, limit: 2 })

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error("expected success")
      expect(result.value.issues.map((i) => i.issueId)).toEqual(["A", "B", "C"])
      expect(result.value.truncated).toBe(false)
      // First request carries no cursor; the second carries the one returned.
      expect(paged.sentPages).toEqual([
        { limit: 2 },
        { limit: 2, cursor: "cur-1" },
      ])
    },
  )

  it("deduplicates an issue that repeats across a cursor", async () => {
    // The second page must carry BOTH a repeat and a new id, or the assertion
    // cannot tell deduplication from never having followed the cursor.
    const paged = pagedFetch([
      { data: rows(["A", "B"]), meta: { page: { after: "cur-1" } } },
      { data: rows(["B", "C"]) },
    ])
    const client = new DatadogTriageClient(CONFIG, paged.impl)

    const result = await client.searchIssues({ ...WINDOW, limit: 2 })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.value.issues.map((i) => i.issueId)).toEqual(["A", "B", "C"])
  })

  it("stops at the page cap and reports the read truncated", async () => {
    const paged = pagedFetch([
      { data: rows(["A"]), meta: { page: { after: "c1" } } },
      { data: rows(["B"]), meta: { page: { after: "c2" } } },
      { data: rows(["C"]), meta: { page: { after: "c3" } } },
    ])
    const client = new DatadogTriageClient(CONFIG, paged.impl)

    const result = await client.searchIssues({
      ...WINDOW,
      limit: 1,
      maxPages: 2,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.value.issues.map((i) => i.issueId)).toEqual(["A", "B"])
    expect(result.value.truncated).toBe(true)
    expect(paged.calls).toHaveBeenCalledTimes(2)
  })

  it("fails the whole read when a later page fails", async () => {
    // Returning the pages already gathered would look like a complete short
    // window and seed a baseline missing everything behind the failure.
    let call = 0
    const client = new DatadogTriageClient(
      CONFIG,
      stubFetch(() => {
        call += 1
        return call === 1
          ? jsonResponse({
              data: rows(["A"]),
              meta: { page: { after: "cur-1" } },
            })
          : jsonResponse({ errors: ["nope"] }, { status: 403 })
      }),
    )

    expect(await client.searchIssues({ ...WINDOW, limit: 1 })).toMatchObject({
      ok: false,
      reason: "auth_failed",
    })
  })

  it("accumulates unparsed rows across pages", async () => {
    const paged = pagedFetch([
      {
        data: [{ issue_id: "A" }, ...rows(["B"])],
        meta: { page: { after: "cur-1" } },
      },
      { data: [{ issue_id: "C" }] },
    ])
    const client = new DatadogTriageClient(CONFIG, paged.impl)

    const result = await client.searchIssues({ ...WINDOW, limit: 2 })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.value.unparsedRows).toBe(2)
    expect(result.value.issues.map((i) => i.issueId)).toEqual(["B"])
  })

  it("sends an absolute window, a service-scoped query, and both credentials", async () => {
    const fetchImpl = stubFetch(jsonResponse({ data: [] }))
    const client = new DatadogTriageClient(CONFIG, fetchImpl)

    await client.searchIssues(WINDOW)

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [URL, RequestInit]
    // `include=issue` and `track` were both verified REQUIRED on the live
    // API 2026-08-27: without them detail rows are absent / the call 400s.
    expect(url.toString()).toBe(
      "https://api.datadoghq.com/api/v2/error-tracking/issues/search?include=issue",
    )
    expect(init.redirect).toBe("error")
    expect(init.headers).toMatchObject({
      "dd-api-key": "dd-api-key",
      "dd-application-key": "dd-app-key",
    })
    expect(JSON.parse(String(init.body))).toEqual({
      data: {
        type: "search_request",
        attributes: {
          query: "service:forge-mobile",
          track: "rum",
          from: WINDOW.from.getTime(),
          to: WINDOW.to.getTime(),
          page: { limit: 100 },
        },
      },
    })
  })
})

describe("DatadogTriageClient failure classification", () => {
  it.each([
    [401, "auth_failed", false],
    [403, "auth_failed", false],
    [429, "rate_limited", true],
    [500, "network_error", true],
    [503, "network_error", true],
    [400, "rejected", false],
    [404, "rejected", false],
  ])("maps HTTP %i to %s", async (status, reason, retryable) => {
    const client = new DatadogTriageClient(
      CONFIG,
      stubFetch(emptyResponse(status)),
    )

    const result = await client.searchIssues(WINDOW)

    expect(result).toMatchObject({ ok: false, reason, retryable })
  })

  it("carries Retry-After and the rate-limit headers off a 429 so the source can defer", async () => {
    const client = new DatadogTriageClient(
      CONFIG,
      stubFetch(
        emptyResponse(429, {
          "retry-after": "42",
          "x-ratelimit-limit": "300",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "37",
        }),
      ),
    )

    const result = await client.searchIssues(WINDOW)

    expect(result).toMatchObject({
      ok: false,
      reason: "rate_limited",
      retryable: true,
      retryAfterSeconds: 42,
      rateLimit: { limit: 300, remaining: 0, resetSeconds: 37 },
    })
  })

  it("captures rate-limit headers on a successful read too", async () => {
    const client = new DatadogTriageClient(
      CONFIG,
      stubFetch(
        jsonResponse(
          { data: [] },
          { headers: { "x-ratelimit-remaining": "8" } },
        ),
      ),
    )

    const result = await client.searchIssues(WINDOW)

    expect(result).toMatchObject({ ok: true, rateLimit: { remaining: 8 } })
  })

  it("maps a malformed body to parse_error", async () => {
    const client = new DatadogTriageClient(
      CONFIG,
      stubFetch(
        new Response("{not json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    )

    const result = await client.searchIssues(WINDOW)

    expect(result).toMatchObject({ ok: false, reason: "parse_error" })
  })

  it("classifies a mid-body timeout as timeout, not parse_error", async () => {
    // The REAL typed shape a fetch abort produces. A generic Error here would
    // satisfy a regex backstop while leaving the typed branch untested.
    const timeout = Object.assign(new Error("The operation was aborted"), {
      name: "TimeoutError",
    })
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"data":'))
      },
      pull() {
        throw timeout
      },
    })
    const client = new DatadogTriageClient(
      CONFIG,
      stubFetch(new Response(body, { status: 200 })),
    )

    const result = await client.searchIssues(WINDOW)

    expect(result).toMatchObject({
      ok: false,
      reason: "timeout",
      retryable: true,
    })
  })

  it("classifies a transport-level timeout as timeout", async () => {
    const client = new DatadogTriageClient(
      CONFIG,
      stubFetch(() => {
        throw Object.assign(new Error("timed out"), { name: "TimeoutError" })
      }),
    )

    expect(await client.searchIssues(WINDOW)).toMatchObject({
      ok: false,
      reason: "timeout",
    })
  })

  it("aborts an over-cap body at the reader and degrades gracefully", async () => {
    let cancelled = false
    const chunk = new Uint8Array(64).fill(65)
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk)
      },
      cancel() {
        cancelled = true
      },
    })
    const client = new DatadogTriageClient(
      { ...CONFIG, maxResponseBytes: 128 },
      stubFetch(new Response(body, { status: 200 })),
    )

    const result = await client.searchIssues(WINDOW)

    expect(cancelled).toBe(true)
    // Its OWN reason, not parse_error. The runbook routes the two to different
    // operator actions -- a shape change means fix the parser, an over-cap body
    // means look at the payload size -- and the Linear sibling separates them.
    expect(result).toMatchObject({
      ok: false,
      reason: "response_too_large",
      retryable: true,
    })
  })

  it("short-circuits on missing credentials before any fetch", async () => {
    const fetchImpl = stubFetch(jsonResponse({ data: [] }))
    const client = new DatadogTriageClient(
      { ...CONFIG, apiKey: undefined, applicationKey: undefined },
      fetchImpl,
    )

    expect(await client.searchIssues(WINDOW)).toMatchObject({
      ok: false,
      reason: "config_missing",
      retryable: false,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("refuses a site outside the allowlist before any fetch", async () => {
    const fetchImpl = stubFetch(jsonResponse({ data: [] }))
    const client = new DatadogTriageClient(
      { ...CONFIG, site: "datadog.attacker.example" },
      fetchImpl,
    )

    expect(await client.searchIssues(WINDOW)).toMatchObject({
      ok: false,
      reason: "invalid_config",
      retryable: false,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("never marks a read failure ambiguous", async () => {
    const client = new DatadogTriageClient(
      CONFIG,
      stubFetch(emptyResponse(500)),
    )

    const result = await client.searchIssues(WINDOW)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.ambiguous).toBe(false)
  })

  it("writes nothing to the console on any failure path", async () => {
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    ]
    try {
      const client = new DatadogTriageClient(
        CONFIG,
        stubFetch(new Response("upstream body with a secret", { status: 500 })),
      )
      await client.searchIssues(WINDOW)
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})

describe("DatadogTriageClient monitors and aggregates", () => {
  it("scopes the monitor list to one service tag", async () => {
    const fetchImpl = stubFetch(
      jsonResponse([
        {
          id: 42,
          name: "Mobile crash rate",
          overall_state: "Alert",
          overall_state_modified: "2026-08-18T10:30:00Z",
          tags: ["service:forge-mobile", "team:mobile"],
        },
      ]),
    )
    const client = new DatadogTriageClient(CONFIG, fetchImpl)

    const result = await client.listMonitors({
      monitorTag: "service:forge-mobile",
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.value.monitors).toEqual([
      {
        monitorId: "42",
        name: "Mobile crash rate",
        overallState: "Alert",
        overallStateModified: "2026-08-18T10:30:00.000Z",
        tags: ["service:forge-mobile", "team:mobile"],
      },
    ])
    const [url] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [URL]
    expect(url.searchParams.get("monitor_tags")).toBe("service:forge-mobile")
  })

  it("surfaces a 200 aggregate carrying meta.status timeout as partial", async () => {
    const client = new DatadogTriageClient(
      CONFIG,
      stubFetch(
        jsonResponse({
          data: { buckets: [{ by: {}, computes: { c0: 12 } }] },
          meta: { status: "timeout" },
        }),
      ),
    )

    const result = await client.aggregateRumEvents({
      query: "service:forge-mobile",
      from: WINDOW.from,
      to: WINDOW.to,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.value.partial).toBe(true)
    expect(result.value.buckets).toEqual([{ key: "total", count: 12 }])
  })

  it("reports a complete aggregate as not partial", async () => {
    const client = new DatadogTriageClient(
      CONFIG,
      stubFetch(
        jsonResponse({
          data: {
            buckets: [
              { by: { "@error.source": "network" }, computes: { c0: 3 } },
            ],
          },
          meta: { status: "done" },
        }),
      ),
    )

    const result = await client.aggregateLogs({
      query: "service:forge-mobile",
      from: WINDOW.from,
      to: WINDOW.to,
      groupBy: "@error.source",
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.value.partial).toBe(false)
    expect(result.value.buckets).toEqual([{ key: "network", count: 3 }])
  })

  it("sends an absolute aggregate window", async () => {
    const fetchImpl = stubFetch(jsonResponse({ data: { buckets: [] } }))
    const client = new DatadogTriageClient(CONFIG, fetchImpl)

    await client.aggregateLogs({
      query: "service:forge-mobile",
      from: WINDOW.from,
      to: WINDOW.to,
    })

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [URL, RequestInit]
    expect(JSON.parse(String(init.body)).filter).toEqual({
      query: "service:forge-mobile",
      from: "2026-08-18T10:00:00.000Z",
      to: "2026-08-18T11:00:00.000Z",
    })
  })

  // A renamed OUTER key is the failure the inner `buckets` requirement misses.
  // Optional here reads as zero activity forever, so spike detection dies
  // silently while every operator surface reports a healthy quiet service.
  it.each([
    ["outer data renamed", { series: { buckets: [] } }],
    ["outer data absent", { meta: { status: "done" } }],
    ["outer data null", { data: null }],
  ])("fails loudly when the aggregate envelope drifts: %s", async (_, body) => {
    const client = new DatadogTriageClient(
      CONFIG,
      stubFetch(jsonResponse(body)),
    )

    const result = await client.aggregateLogs({
      query: "service:forge-mobile",
      from: WINDOW.from,
      to: WINDOW.to,
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected a parse failure")
    expect(result.reason).toBe("parse_error")
  })

  it("still reads a present but empty bucket list as a real zero", async () => {
    const client = new DatadogTriageClient(
      CONFIG,
      stubFetch(jsonResponse({ data: { buckets: [] } })),
    )

    const result = await client.aggregateLogs({
      query: "service:forge-mobile",
      from: WINDOW.from,
      to: WINDOW.to,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.value.buckets).toEqual([])
  })
})
