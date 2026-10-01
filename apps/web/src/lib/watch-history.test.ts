import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { query } = vi.hoisted(() => ({ query: vi.fn() }))

vi.mock("@/lib/admin-client", () => ({ default: { query } }))
vi.mock("@/env", () => ({
  env: {
    ADMIN_GRAPHQL_URL: "https://admin.example/api/graphql",
    NEXT_PUBLIC_CANONICAL_ORIGIN: "https://watch.example",
    WEB_ADMIN_API_KEYS: "test-key",
  },
}))

const {
  WATCH_HISTORY_FANOUT_BUDGET_MS,
  WATCH_HISTORY_FANOUT_CONCURRENCY,
  fetchWatchHistoryVideoDetails,
} = await import("./watch-history")

/**
 * A minimal Admin `video` payload. Every field the mapper reads is present so
 * a dropped item can only be explained by the fan-out, never by mapping.
 */
function videoPayload(videoId: string) {
  return {
    data: {
      video: {
        documentId: videoId,
        slug: `slug-${videoId}`,
        label: "SHORT_FILM",
        durationSeconds: 120,
        images: [
          { url: null, thumbnail: `https://img.example/${videoId}.jpg` },
        ],
        locales: [{ title: `Title ${videoId}`, imageAlt: `Alt ${videoId}` }],
        dubs: [
          {
            slug: "english",
            published: true,
            hls: "https://hls.example/x.m3u8",
            language: { slug: "english" },
          },
        ],
        parents: [],
      },
    },
  }
}

function requests(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    videoId: `v${index}`,
    languageSlug: "english",
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
  query.mockImplementation(({ variables }: { variables: { id: string } }) =>
    Promise.resolve(videoPayload(variables.id)),
  )
})

afterEach(() => vi.restoreAllMocks())

describe("fetchWatchHistoryVideoDetails", () => {
  it("returns every healthy sibling when exactly one video rejects", async () => {
    // The discriminating case for per-item isolation: the batch is otherwise
    // entirely healthy, so a bare `Promise.all` rejects here and nothing else
    // in this file can explain the loss. A whole-batch failure would pass
    // either way, which is why it is not the fixture used.
    query.mockImplementation(({ variables }: { variables: { id: string } }) =>
      variables.id === "v1"
        ? Promise.reject(new Error("GraphQL error: video unavailable"))
        : Promise.resolve(videoPayload(variables.id)),
    )

    const items = await fetchWatchHistoryVideoDetails(requests(3))

    expect(items.map((item) => item.videoId)).toEqual(["v0", "v2"])
  })

  it("keeps going when a video rejects after a timeout-shaped abort", async () => {
    // SYNTHETIC FIXTURE, and a deliberate near-duplicate of the test above:
    // `fetchWatchHistoryVideoDetails` never branches on `error.name`, so this
    // proves no branch the generic rejection does not. It is kept only to pin
    // the real shape `AbortSignal.timeout` in `admin-client.ts` rejects with,
    // so a future reader adding name-based handling starts from the true one.
    query.mockImplementation(({ variables }: { variables: { id: string } }) =>
      variables.id === "v0"
        ? Promise.reject(
            Object.assign(
              new Error("The operation was aborted due to timeout"),
              {
                name: "TimeoutError",
              },
            ),
          )
        : Promise.resolve(videoPayload(variables.id)),
    )

    const items = await fetchWatchHistoryVideoDetails(requests(2))

    expect(items.map((item) => item.videoId)).toEqual(["v1"])
  })

  it("survives a batch in which every video rejects", async () => {
    query.mockRejectedValue(new Error("admin unreachable"))

    await expect(fetchWatchHistoryVideoDetails(requests(4))).resolves.toEqual(
      [],
    )
  })

  it("holds in-flight requests at exactly the concurrency cap", async () => {
    // Asserting only `<= cap` would stay green if the fan-out regressed to a
    // sequential loop (max 1), the trap named in
    // docs/solutions/best-practices/bounded-parallelism-per-target-workflow-pattern-20260505.md.
    // The batch is larger than the cap so the cap must actually be reached.
    let inFlight = 0
    let maxInFlight = 0
    const release: Array<() => void> = []

    query.mockImplementation(({ variables }: { variables: { id: string } }) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      return new Promise((resolve) => {
        release.push(() => {
          inFlight -= 1
          resolve(videoPayload(variables.id))
        })
      })
    })

    const pending = fetchWatchHistoryVideoDetails(requests(20))
    // Drain in waves so the pool has to refill rather than settle at once.
    while (release.length > 0) {
      release.splice(0, release.length).forEach((resolveOne) => resolveOne())
      await new Promise((resolve) => setImmediate(resolve))
    }
    await pending

    expect(maxInFlight).toBe(WATCH_HISTORY_FANOUT_CONCURRENCY)
    expect(WATCH_HISTORY_FANOUT_CONCURRENCY).toBe(8)
  })

  it("preserves request order when later ids settle first", async () => {
    // Narrow by design: this catches a completion-order `results.push`
    // regression and nothing else. A chunked-wave pool, a sequential loop and
    // the pre-fix bare `Promise.all` all preserve order too, so do NOT read a
    // green here as evidence about the pool's shape — the stall test below is
    // what discriminates that.
    query.mockImplementation(({ variables }: { variables: { id: string } }) => {
      const delay = variables.id === "v0" ? 8 : 0
      return new Promise((resolve) =>
        setTimeout(() => resolve(videoPayload(variables.id)), delay),
      )
    })

    const items = await fetchWatchHistoryVideoDetails(requests(10))

    expect(items.map((item) => item.videoId)).toEqual(
      requests(10).map((request) => request.videoId),
    )
  })

  it("refills a free slot without waiting for the slowest item in flight", async () => {
    // The property the pool's doc comment claims and the only one that
    // separates a sliding window from chunked waves: with the cap at 8 and one
    // slow item holding slot 0, item 8 must START before item 0 settles. Under
    // chunked waves or a sequential loop it cannot, because the round does not
    // end until every member of it has.
    let releaseSlowItem: (() => void) | undefined
    let slowItemSettled = false
    const startedBeforeSlowSettled: string[] = []

    query.mockImplementation(({ variables }: { variables: { id: string } }) => {
      if (!slowItemSettled) startedBeforeSlowSettled.push(variables.id)
      if (variables.id !== "v0")
        return Promise.resolve(videoPayload(variables.id))
      return new Promise((resolve) => {
        releaseSlowItem = () => {
          slowItemSettled = true
          resolve(videoPayload(variables.id))
        }
      })
    })

    const pending = fetchWatchHistoryVideoDetails(requests(12))
    // Let the seven fast siblings drain and the pool refill their slots.
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))

    expect(startedBeforeSlowSettled).toContain("v8")

    releaseSlowItem?.()
    await pending
  })

  it("counts a video Admin resolves as null apart from a failure", async () => {
    // Both a caught rejection and a legitimately missing video return null and
    // get filtered out, so without this the two are indistinguishable and a
    // refactor that counted a missing video as a failure would keep every
    // other test green. The summary must say notFound=1 failed=0, and no
    // per-item failure line may be emitted.
    query.mockImplementation(({ variables }: { variables: { id: string } }) =>
      variables.id === "v0"
        ? Promise.resolve({ data: { video: null } })
        : Promise.resolve(videoPayload(variables.id)),
    )

    const items = await fetchWatchHistoryVideoDetails(requests(2))

    expect(items.map((item) => item.videoId)).toEqual(["v1"])
    expect(vi.mocked(console.warn).mock.calls.map(([line]) => line)).toEqual([
      "[watch-history] event=history_fanout_degraded requested=2 returned=1 failed=0 notFound=1 timedOut=false",
    ])
  })

  it("names a non-Error rejection by its type rather than crashing on it", async () => {
    // `errorName`'s second branch. Every other fixture rejects with a real
    // Error, so nothing else reaches `typeof error` — and a throw from inside
    // the logger would take down the very batch the catch exists to protect.
    query.mockImplementation(({ variables }: { variables: { id: string } }) =>
      variables.id === "v0"
        ? Promise.reject("admin said no")
        : Promise.resolve(videoPayload(variables.id)),
    )

    const items = await fetchWatchHistoryVideoDetails(requests(2))

    expect(items.map((item) => item.videoId)).toEqual(["v1"])
    expect(vi.mocked(console.warn).mock.calls.map(([line]) => line)).toContain(
      "[watch-history] event=history_video_fetch_failure videoId=v0 reason=string",
    )
  })

  it("neutralizes a videoId crafted to forge a second log line", async () => {
    // `entrySchema` bounds videoId only to a non-empty string and submitted
    // entries reach the fan-out whether or not they persist, so the sink is
    // where this has to be stopped.
    const hostile =
      "v0\n[watch-history] event=history_fanout_degraded requested=1 returned=1 failed=0"
    query.mockRejectedValue(new Error("boom"))

    await fetchWatchHistoryVideoDetails([
      { videoId: hostile, languageSlug: "english" },
    ])

    const lines = vi.mocked(console.warn).mock.calls.map(([line]) => line)
    expect(lines[0]).toBe(
      "[watch-history] event=history_video_fetch_failure videoId=v0__watch-history__event_history_fanout_degraded_requested_1_ret reason=Error",
    )
    expect(lines[0]).not.toContain("\n")
  })

  it("logs one plain-string line per dropped video and a summary", async () => {
    query.mockImplementation(({ variables }: { variables: { id: string } }) =>
      variables.id === "v1"
        ? Promise.reject(new Error("boom"))
        : Promise.resolve(videoPayload(variables.id)),
    )

    await fetchWatchHistoryVideoDetails(requests(2))

    const lines = vi.mocked(console.warn).mock.calls.map(([line]) => line)
    // Railway logsV2 silences JSON-stringified payloads from Next.js route
    // handlers, so these must stay plain `event=` strings.
    expect(lines).toEqual([
      "[watch-history] event=history_video_fetch_failure videoId=v1 reason=Error",
      "[watch-history] event=history_fanout_degraded requested=2 returned=1 failed=1 notFound=0 timedOut=false",
    ])
  })

  it("caps per-video failure lines while the summary keeps the true count", async () => {
    // A wholly unreachable Admin must not turn one request into 200 log lines.
    query.mockRejectedValue(new Error("admin unreachable"))

    await fetchWatchHistoryVideoDetails(requests(9))

    const lines = vi.mocked(console.warn).mock.calls.map(([line]) => line)
    expect(lines).toHaveLength(6)
    expect(
      lines.filter(
        (line) =>
          typeof line === "string" &&
          line.includes("event=history_video_fetch_failure"),
      ),
    ).toHaveLength(5)
    expect(lines.at(-1)).toBe(
      "[watch-history] event=history_fanout_degraded requested=9 returned=0 failed=9 notFound=0 timedOut=false",
    )
  })

  it("resolves to an empty list without calling Admin for an empty history", async () => {
    await expect(fetchWatchHistoryVideoDetails([])).resolves.toEqual([])

    expect(query).not.toHaveBeenCalled()
  })

  it("settles within its own budget instead of running 25 rounds of 15 s", async () => {
    // Bounding concurrency without bounding the total is the regression this
    // pins: at width 8 the 200-id cap is 25 sequential rounds, so a hanging
    // Admin would hold the handler for ~375 s. With a real 60 ms signal the
    // whole batch must settle in well under a second. `AbortSignal.timeout`
    // cannot be driven by fake timers, so this uses a tiny REAL budget.
    query.mockImplementation(() => new Promise(() => {}))

    const startedAt = Date.now()
    const items = await fetchWatchHistoryVideoDetails(requests(200), {
      signal: AbortSignal.timeout(60),
    })
    const elapsed = Date.now() - startedAt

    expect(items).toEqual([])
    expect(elapsed).toBeLessThan(2_000)
  })

  it("keeps the cards that resolved before the budget expired", async () => {
    // Partial success is the contract: a spent budget costs the cards that
    // did not resolve, never the ones that did.
    query.mockImplementation(({ variables }: { variables: { id: string } }) =>
      variables.id === "v0"
        ? Promise.resolve(videoPayload(variables.id))
        : new Promise(() => {}),
    )

    const items = await fetchWatchHistoryVideoDetails(requests(50), {
      signal: AbortSignal.timeout(60),
    })

    expect(items.map((item) => item.videoId)).toEqual(["v0"])
  })

  it("cancels in-flight Admin calls when the budget expires", async () => {
    // Stopping the pool from CLAIMING new work is not enough — the calls
    // already in flight must be aborted too, or the handler keeps upstream
    // work alive for a response nobody will read.
    const seen: AbortSignal[] = []
    query.mockImplementation(
      ({ context }: { context: { fetchOptions: { signal: AbortSignal } } }) => {
        seen.push(context.fetchOptions.signal)
        return new Promise(() => {})
      },
    )

    await fetchWatchHistoryVideoDetails(requests(20), {
      signal: AbortSignal.timeout(60),
    })

    expect(seen).toHaveLength(WATCH_HISTORY_FANOUT_CONCURRENCY)
    expect(seen.every((signal) => signal.aborted)).toBe(true)
  })

  it("reports a spent budget distinctly from upstream failures", async () => {
    query.mockImplementation(() => new Promise(() => {}))

    await fetchWatchHistoryVideoDetails(requests(20), {
      signal: AbortSignal.timeout(60),
    })

    const summary = vi
      .mocked(console.warn)
      .mock.calls.map(([line]) => line)
      .at(-1)
    expect(summary).toContain("event=history_fanout_degraded")
    expect(summary).toContain("timedOut=true")
  })

  it("defaults to the module budget when no signal is injected", async () => {
    // Anti-vacuous companion to the injected-signal tests above: production
    // passes no signal, so the default is the only thing bounding it.
    expect(WATCH_HISTORY_FANOUT_BUDGET_MS).toBe(20_000)

    const items = await fetchWatchHistoryVideoDetails(requests(2))

    expect(items.map((item) => item.videoId)).toEqual(["v0", "v1"])
    expect(query.mock.calls[0]?.[0].context.fetchOptions.signal).toBeInstanceOf(
      AbortSignal,
    )
  })

  it("isolates a video whose mapping throws, not just one whose fetch rejects", async () => {
    // The catch wraps the whole per-item body. Every other failure fixture
    // rejects inside `fetchHistoryVideo`; this one gets past it and throws
    // from the mapping, which is the boundary those fixtures cannot reach.
    query.mockImplementation(({ variables }: { variables: { id: string } }) => {
      if (variables.id !== "v1")
        return Promise.resolve(videoPayload(variables.id))
      const payload = videoPayload(variables.id)
      Object.defineProperty(payload.data.video, "locales", {
        get() {
          throw new Error("mapping blew up")
        },
      })
      return Promise.resolve(payload)
    })

    const items = await fetchWatchHistoryVideoDetails(requests(3))

    expect(items.map((item) => item.videoId)).toEqual(["v0", "v2"])
  })

  it("stays silent when every video resolves", async () => {
    await fetchWatchHistoryVideoDetails(requests(3))

    expect(console.warn).not.toHaveBeenCalled()
  })
})
