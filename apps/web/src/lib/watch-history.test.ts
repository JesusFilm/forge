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

const { WATCH_HISTORY_FANOUT_CONCURRENCY, fetchWatchHistoryVideoDetails } =
  await import("./watch-history")

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

  it("preserves request order across the bounded pool", async () => {
    query.mockImplementation(({ variables }: { variables: { id: string } }) => {
      // Later ids settle first, so input order can only survive if the pool
      // writes each result back into its own slot.
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

  it("drops a video the Admin surface resolves as null without dropping siblings", async () => {
    query.mockImplementation(({ variables }: { variables: { id: string } }) =>
      variables.id === "v0"
        ? Promise.resolve({ data: { video: null } })
        : Promise.resolve(videoPayload(variables.id)),
    )

    const items = await fetchWatchHistoryVideoDetails(requests(2))

    expect(items.map((item) => item.videoId)).toEqual(["v1"])
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
      "[watch-history] event=history_fanout_degraded requested=2 returned=1 failed=1",
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
      "[watch-history] event=history_fanout_degraded requested=9 returned=0 failed=9",
    )
  })

  it("resolves to an empty list without calling Admin for an empty history", async () => {
    await expect(fetchWatchHistoryVideoDetails([])).resolves.toEqual([])

    expect(query).not.toHaveBeenCalled()
  })

  it("stays silent when every video resolves", async () => {
    await fetchWatchHistoryVideoDetails(requests(3))

    expect(console.warn).not.toHaveBeenCalled()
  })
})
