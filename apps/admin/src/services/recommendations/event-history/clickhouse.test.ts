import { describe, expect, it, vi } from "vitest"
import { createRecommendationEventEnvelope } from "./envelope"
import {
  createRecommendationClickHouseClient,
  RecommendationClickHouseError,
} from "./clickhouse"

const event = createRecommendationEventEnvelope({
  family: "watch-exposure",
  logicalId: "watch:one",
  revision: 1,
  occurredAt: new Date("2026-10-28T00:00:00.000Z"),
  acceptedAt: new Date("2026-10-28T00:00:01.000Z"),
  expiresAt: new Date("2026-11-11T00:00:00.000Z"),
  payload: { videoId: "safe" },
  allowedFields: ["videoId"],
})

const config = {
  endpoint: "https://clickhouse.example.test:8443/",
  database: "events",
  username: "ingest",
  password: "secret",
}

describe("recommendation ClickHouse HTTP boundary", () => {
  it("rejects an invalid closed-ID sweep before making any remote change", async () => {
    const fetch = vi.fn(async () => new Response("", { status: 200 }))
    const client = createRecommendationClickHouseClient({ ...config, fetch })
    await expect(
      client.sweepClosedExpired({
        family: "watch-exposure",
        entries: [
          {
            logicalId: "watch:one",
            maxOriginalExpiry: new Date(event.expiresAt),
          },
        ],
        now: new Date(Number.NaN),
      }),
    ).rejects.toMatchObject({ code: "invalid_input" })
    await expect(
      client.sweepClosedExpired({
        family: "watch-exposure",
        entries: [
          { logicalId: "watch:one", maxOriginalExpiry: new Date(Number.NaN) },
        ],
        now: new Date("2026-11-12T00:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "invalid_input" })
    expect(fetch).not.toHaveBeenCalled()
  })
  it("runs a fixed bounded anonymous Watch aggregate without caller SQL", async () => {
    const fetch = vi.fn(
      async (_url: URL, init: RequestInit) =>
        new Response(
          String(init.body).startsWith(
            "SELECT toUInt32(countIf(conflicts > 0))",
          )
            ? '{"conflicts":0}\n'
            : "",
          { status: 200 },
        ),
    )
    const client = createRecommendationClickHouseClient({ ...config, fetch })
    await client.watchExposureBreakdown({
      start: new Date("2026-10-27T00:00:00.000Z"),
      end: new Date("2026-10-28T00:00:00.000Z"),
      now: new Date("2026-10-28T00:00:00.000Z"),
      filter: {
        surface: "watch-home' OR TRUE --",
        block: "hero",
        presentation: "hero-card",
      },
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    const [url, init] = fetch.mock.calls[1]
    expect(String(init.body)).not.toContain("watch-home' OR TRUE --")
    expect(url.searchParams.get("param_surface")).toBe("watch-home' OR TRUE --")
    expect(url.searchParams.get("max_execution_time")).toBe("3")
    expect(url.searchParams.get("max_rows_to_read")).toBe("20000000")
    expect(init.redirect).toBe("error")
  })
  it("rejects malformed anonymous aggregate output without leaking provider text", async () => {
    const fetch = vi.fn(
      async (_url: URL, init: RequestInit) =>
        new Response(
          String(init.body).startsWith(
            "SELECT toUInt32(countIf(conflicts > 0))",
          )
            ? '{"conflicts":0}\n'
            : '{"provider":"secret payload"}\n',
          { status: 200 },
        ),
    )
    const client = createRecommendationClickHouseClient({ ...config, fetch })
    await expect(
      client.watchExposureBreakdown({
        start: new Date("2026-10-27T00:00:00.000Z"),
        end: new Date("2026-10-28T00:00:00.000Z"),
        now: new Date("2026-10-28T00:00:00.000Z"),
      }),
    ).rejects.toMatchObject({
      code: "response",
      message: "Recommendation ClickHouse response",
    })
  })
  it("never revives currently expired history at an old as-of cutoff", async () => {
    const expired = createRecommendationEventEnvelope({
      family: "watch-exposure",
      logicalId: "watch:historical",
      revision: 1,
      occurredAt: new Date("2026-10-27T00:00:00.000Z"),
      acceptedAt: new Date("2026-10-27T00:00:01.000Z"),
      expiresAt: new Date("2026-10-28T00:00:00.000Z"),
      payload: { kind: "served" },
      allowedFields: ["kind"],
    })
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            logical_id: expired.logicalId,
            latest_revision: 1,
            conflicts: 0,
            occurred_at: expired.occurredAt,
            accepted_at: expired.acceptedAt,
            expires_at: expired.expiresAt,
            payload_digest: expired.payloadDigest,
            payload: JSON.stringify(expired.payload),
          }) + "\n",
          { status: 200 },
        ),
    )
    const client = createRecommendationClickHouseClient({ ...config, fetch })
    await expect(
      client.read({
        family: "watch-exposure",
        logicalIds: [expired.logicalId],
        asOf: new Date("2026-10-27T12:00:00.000Z"),
        now: new Date("2026-10-29T00:00:00.000Z"),
      }),
    ).resolves.toEqual([])
  })
  it("uses the actual current time for historical reads when now is omitted", async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date("2026-10-29T00:00:00.000Z"))
      const fetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              logical_id: event.logicalId,
              latest_revision: 1,
              conflicts: 0,
              occurred_at: event.occurredAt,
              accepted_at: event.acceptedAt,
              expires_at: "2026-10-28T12:00:00.000Z",
              payload_digest: event.payloadDigest,
              payload: JSON.stringify(event.payload),
            }) + "\n",
            { status: 200 },
          ),
      )
      const client = createRecommendationClickHouseClient({ ...config, fetch })
      await expect(
        client.read({
          family: "watch-exposure",
          logicalIds: [event.logicalId],
          asOf: new Date("2026-10-28T06:00:00.000Z"),
        }),
      ).resolves.toEqual([])
      expect(fetch).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
  it("shares one deadline across the aggregate and conflict audit", async () => {
    vi.useFakeTimers()
    let active = 0
    const fetch = vi.fn(
      (_url: URL, init: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          active++
          const signal = init.signal!
          const onAbort = () => {
            clearTimeout(timer)
            signal.removeEventListener("abort", onAbort)
            active--
            reject(new DOMException("aborted", "AbortError"))
          }
          signal.addEventListener("abort", onAbort, { once: true })
          const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort)
            active--
            resolve(
              new Response(
                String(init.body).startsWith(
                  "SELECT toUInt32(countIf(conflicts > 0))",
                )
                  ? '{"conflicts":0}\n'
                  : "",
                { status: 200 },
              ),
            )
          }, 60)
        }),
    )
    try {
      const client = createRecommendationClickHouseClient({
        ...config,
        fetch,
        timeoutMs: 100,
      })
      const result = client.watchExposureBreakdown({
        start: new Date("2026-10-27T00:00:00.000Z"),
        end: new Date("2026-10-28T00:00:00.000Z"),
        now: new Date("2026-10-28T00:00:00.000Z"),
      })
      const rejected = expect(result).rejects.toMatchObject({ code: "timeout" })
      await vi.advanceTimersByTimeAsync(100)
      await rejected
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(active).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
  it("confirms a bounded synchronous insert only after a clean complete response", async () => {
    const fetch = vi.fn(
      async (_url: URL, init: RequestInit) =>
        new Response(
          String(init.body).startsWith("SELECT uniqExact(")
            ? '{"count":"0"}\n'
            : String(init.body).startsWith("SELECT toUInt32(")
              ? '{"conflicts":0}\n'
              : "",
          { status: 200 },
        ),
    )
    const client = createRecommendationClickHouseClient({ ...config, fetch })
    await expect(client.insert([event])).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(5)
    const [url, init] = fetch.mock.calls[2]
    expect(url.searchParams.get("async_insert")).toBe("0")
    expect(url.searchParams.get("wait_end_of_query")).toBe("1")
    expect(init.redirect).toBe("error")
    expect(init.headers).toMatchObject({
      "X-ClickHouse-User": "ingest",
      "X-ClickHouse-Key": "secret",
    })
    expect(init.body).toContain('"logical_id":"watch:one"')
  })

  it.each([
    new Response("partial", { status: 200 }),
    new Response("failed secret", { status: 500 }),
  ])(
    "rejects ambiguous or failed insert responses without leaking provider text",
    async (response) => {
      const client = createRecommendationClickHouseClient({
        ...config,
        fetch: async (_url, init) =>
          String(init?.body).startsWith("SELECT uniqExact(")
            ? new Response('{"count":"0"}\n')
            : String(init?.body).startsWith("SELECT toUInt32(")
              ? new Response('{"conflicts":0}\n')
              : response,
      })
      await expect(client.insert([event])).rejects.toMatchObject({
        code: response.status === 200 ? "response" : "transport",
      })
    },
  )

  it("rejects overlarge batches before network I/O", async () => {
    const fetch = vi.fn()
    const client = createRecommendationClickHouseClient({ ...config, fetch })
    await expect(client.insert(Array(101).fill(event))).rejects.toBeInstanceOf(
      RecommendationClickHouseError,
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it("rejects conflicting identities in one batch before network I/O", async () => {
    const fetch = vi.fn()
    const client = createRecommendationClickHouseClient({ ...config, fetch })
    const changed = createRecommendationEventEnvelope({
      family: "watch-exposure",
      logicalId: "watch:one",
      revision: 1,
      occurredAt: new Date("2026-10-28T00:00:00.000Z"),
      acceptedAt: new Date("2026-10-28T00:00:01.000Z"),
      expiresAt: new Date("2026-11-11T00:00:00.000Z"),
      payload: { videoId: "different" },
      allowedFields: ["videoId"],
    })
    await expect(client.insert([event, changed])).rejects.toMatchObject({
      code: "conflict",
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it("rejects a stalled response body within the overall deadline", async () => {
    const cancel = vi.fn()
    const client = createRecommendationClickHouseClient({
      ...config,
      timeoutMs: 100,
      fetch: async (_url, init) =>
        String(init?.body).startsWith("SELECT uniqExact(")
          ? new Response('{"count":"0"}\n')
          : String(init?.body).startsWith("SELECT toUInt32(")
            ? new Response('{"conflicts":0}\n')
            : new Response(new ReadableStream({ start() {}, cancel }), {
                status: 200,
              }),
    })
    await expect(client.insert([event])).rejects.toMatchObject({
      code: "timeout",
    })
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
  })

  it("shares one deadline across all insert checks and aborts the in-flight request", async () => {
    let active = 0
    const fetch = vi.fn(async (_url: URL, init: RequestInit) => {
      active++
      try {
        await new Promise<void>((resolve, reject) => {
          const signal = init.signal
          const onAbort = () => {
            clearTimeout(timer)
            reject(new Error("aborted"))
          }
          const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort)
            resolve()
          }, 30)
          signal?.addEventListener("abort", onAbort, { once: true })
        })
        return new Response(
          String(init.body).startsWith("SELECT uniqExact(")
            ? '{"count":"0"}\n'
            : String(init.body).startsWith("SELECT toUInt32(")
              ? '{"conflicts":0}\n'
              : "",
        )
      } finally {
        active--
      }
    })
    const client = createRecommendationClickHouseClient({
      ...config,
      timeoutMs: 100,
      fetch,
    })
    await expect(client.insert([event])).rejects.toMatchObject({
      code: "timeout",
    })
    await vi.waitFor(() => expect(active).toBe(0))
    const callsAtTimeout = fetch.mock.calls.length
    expect(callsAtTimeout).toBeLessThan(5)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(fetch).toHaveBeenCalledTimes(callsAtTimeout)
  })

  it("shares the deadline between erasure marker and physical deletion", async () => {
    let active = 0
    const fetch = vi.fn(async (_url: URL, init: RequestInit) => {
      active++
      try {
        await new Promise<void>((resolve, reject) => {
          const signal = init.signal
          const onAbort = () => {
            clearTimeout(timer)
            reject(new Error("aborted"))
          }
          const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort)
            resolve()
          }, 100)
          signal?.addEventListener("abort", onAbort, { once: true })
        })
        return new Response("")
      } finally {
        active--
      }
    })
    const client = createRecommendationClickHouseClient({
      ...config,
      timeoutMs: 160,
      fetch,
    })
    await expect(
      client.erase({ family: "watch-exposure", logicalIds: ["watch:one"] }),
    ).rejects.toMatchObject({ code: "timeout" })
    await vi.waitFor(() => expect(active).toBe(0))
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it("bounds requested IDs before network I/O", async () => {
    const fetch = vi.fn()
    const client = createRecommendationClickHouseClient({ ...config, fetch })
    await expect(
      client.read({
        family: "watch-exposure",
        logicalIds: Array.from({ length: 101 }, (_, i) => `id:${i}`),
        asOf: new Date(),
      }),
    ).rejects.toMatchObject({ code: "invalid_input" })
    expect(fetch).not.toHaveBeenCalled()
  })

  it("rejects an incomplete canonical row rather than treating it as absent", async () => {
    const client = createRecommendationClickHouseClient({
      ...config,
      fetch: async () => new Response('{"logical_id":"watch:one"}\n'),
    })
    await expect(
      client.read({
        family: "watch-exposure",
        logicalIds: ["watch:one"],
        asOf: new Date("2026-10-30"),
      }),
    ).rejects.toMatchObject({ code: "response" })
  })

  it("does not accept an unexpected success status as persistence proof", async () => {
    const client = createRecommendationClickHouseClient({
      ...config,
      fetch: async (_url, init) =>
        String(init.body).startsWith("SELECT uniqExact(")
          ? new Response('{"count":"0"}\n')
          : String(init.body).startsWith("SELECT toUInt32(")
            ? new Response('{"conflicts":0}\n')
            : new Response(null, { status: 204 }),
    })
    await expect(client.insert([event])).rejects.toMatchObject({
      code: "transport",
    })
  })
})
